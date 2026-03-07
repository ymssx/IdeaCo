import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { ProviderRegistry, ModelProviders, JobCategory, JobCategoryLabel } from './workforce/providers.js';
import { HRSystem, JobTemplates } from './workforce/hr.js';
import { Department } from './department.js';
import { Employee, createEmployee, deserializeEmployee, Secretary } from '../employee/index.js';
import { LLMAgent, CLIAgent, WebAgent } from '../agent/index.js';
import { PerformanceSystem } from '../employee/performance.js';
import { TalentMarket } from './workforce/talent-market.js';
import { MessageBus } from '../agent/message-bus.js';
import { existsSync, mkdirSync } from 'fs';
import { WorkspaceManager } from '../workspace.js';
import { debouncedSave } from './persistence.js';
import { llmClient } from '../agent/llm-agent/client.js';
import { webClientRegistry } from '../agent/web-agent/web-client.js';
import { loadAgentMemory, saveAgentMemory } from '../employee/memory/store.js';
import { Memory } from '../employee/memory/index.js';
import { RequirementManager, RequirementStatus } from '../requirement.js';
import { TeamManager, SprintStatus } from './team.js';
import { hookRegistry, HookEvent } from '../../lib/hooks.js';
import { sessionManager } from '../agent/session.js';
import { robustJSONParse } from '../utils/json-parse.js';
import { cronScheduler } from '../system/cron.js';
import { pluginRegistry } from '../system/plugin.js';
import { auditLogger, AuditCategory, AuditLevel } from '../system/audit.js';
import { chatStore } from '../agent/chat-store.js';
import { cliBackendRegistry } from '../agent/cli-agent/backends/index.js';
import { groupChatLoop } from './group-chat-loop.js';

// Expand short-form file references: [[file:path]] → [[file:deptId:path|name]]
// Also fix incomplete references: [[file:deptId:path]] → [[file:deptId:path|name]]
// Only creates clickable references for files that actually exist on disk.
// Returns { content, invalidRefs } so caller can provide feedback for bad references.
const SIMPLE_FILE_REF = /\[\[file:([^\]|:]+)\]\]/g;
const INCOMPLETE_FILE_REF = /\[\[file:([^:]+):([^\]|]+)\]\]/g;
function expandFileReferences(content, departmentId, workspacePath) {
  if (!content || !departmentId) return { content, invalidRefs: [] };
  const invalidRefs = [];
  // First: fix incomplete refs [[file:deptId:path]] → [[file:deptId:path|name]]
  let expanded = content.replace(INCOMPLETE_FILE_REF, (_match, deptId, filePath) => {
    const trimmed = filePath.trim();
    if (workspacePath) {
      const fullPath = path.join(workspacePath, trimmed);
      if (!existsSync(fullPath)) {
        invalidRefs.push(trimmed);
        return trimmed;
      }
    }
    const displayName = path.basename(trimmed);
    return `[[file:${deptId}:${trimmed}|${displayName}]]`;
  });
  // Then: expand simple refs [[file:path]] → [[file:deptId:path|name]]
  expanded = expanded.replace(SIMPLE_FILE_REF, (_match, filePath) => {
    const trimmed = filePath.trim();
    if (workspacePath) {
      const fullPath = path.join(workspacePath, trimmed);
      if (!existsSync(fullPath)) {
        invalidRefs.push(trimmed);
        return trimmed;
      }
    }
    const displayName = path.basename(trimmed);
    return `[[file:${departmentId}:${trimmed}|${displayName}]]`;
  });
  return { content: expanded, invalidRefs };
}


/**
 * Company - AI Enterprise
 * Integrates message bus and workspace management, enabling Agents to actually perform work
 */
export class Company {
  constructor(companyName, bossName = 'Boss', secretaryConfig = null) {
    this.id = uuidv4();
    this.name = companyName;
    this.bossName = bossName;
    this.bossAvatar = null; // Boss avatar URL
    this.departments = new Map();
    this.providerRegistry = new ProviderRegistry();
    // Sync CLI backends into provider registry so they appear in Brain Providers
    this.providerRegistry.syncCLIBackends(cliBackendRegistry);
    // Auto-detect CLI backends in background (async, fire-and-forget)
    cliBackendRegistry.detectAll().then(() => {
      this.providerRegistry.syncCLIBackends(cliBackendRegistry);
    }).catch(() => {});
    this.talentMarket = new TalentMarket();
    this.performanceSystem = new PerformanceSystem();
    this.hr = new HRSystem(this.providerRegistry, this.talentMarket);
    this.logs = [];
    // Chat history with secretary
    // chatHistory kept as in-memory cache (for fast frontend UI access), also written to chatStore for persistence
    this.chatHistory = [];
    // Chat session ID (used for chatStore file storage)
    this.chatSessionId = `boss-secretary-${this.id}`;
    chatStore.createSession(this.chatSessionId, {
      title: `${bossName} & Secretary`,
      participants: [bossName, 'Secretary'],
      type: 'boss-secretary',
    });
    // Department progress reports
    this.progressReports = [];
    // Mailbox: private messages from Agents to boss
    this.mailbox = [];
    // Pending recruitment plans for approval
    this.pendingPlans = new Map();

    // Message bus (inter-Agent communication)
    this.messageBus = new MessageBus();

    // Workspace manager
    this.workspaceManager = new WorkspaceManager();

    // Requirement manager
    this.requirementManager = new RequirementManager();

    // Team manager
    this.teamManager = new TeamManager();

    // Group chat loop engine
    this.groupChatLoop = groupChatLoop;

    // Configure provider for secretary
    let secretaryProviderConfig;
    if (secretaryConfig && secretaryConfig.providerId) {
      const provider = this.providerRegistry.getById(secretaryConfig.providerId);
      if (provider) {
        this.providerRegistry.configure(secretaryConfig.providerId, secretaryConfig.apiKey || 'sk-configured');
        secretaryProviderConfig = provider;
      }
    }
    // Fallback: use a placeholder provider reference (NOT enabled — user must configure a real one via onboarding)
    if (!secretaryProviderConfig) {
      secretaryProviderConfig = { id: 'none', name: '⚠️ Not Configured', enabled: false, category: 'general' };
    }

    // Initialize personal secretary
    this.secretary = new Secretary({
      company: this,
      providerConfig: secretaryProviderConfig,
      secretaryName: secretaryConfig?.secretaryName,
      secretaryAvatar: secretaryConfig?.secretaryAvatar,
      secretaryGender: secretaryConfig?.secretaryGender || 'female',
      secretaryAge: secretaryConfig?.secretaryAge || 18,
    });

    // If secretary uses a CLI provider, rebuild agent as CLIAgent
    if (secretaryProviderConfig.isCLI && secretaryProviderConfig.cliBackendId) {
      const fallback = this.providerRegistry.recommend('general');
      this.secretary.agent = new CLIAgent({
        cliBackend: secretaryProviderConfig.cliBackendId,
        cliProvider: secretaryProviderConfig,
        fallbackProvider: fallback, provider: fallback,
      });
    }
    // If secretary uses a Web provider, rebuild agent as WebAgent
    if (secretaryProviderConfig.isWeb) {
      this.secretary.agent = new WebAgent({ provider: secretaryProviderConfig });
      // Re-bind employeeId after agent replacement (for per-employee session isolation)
      this.secretary.agent.setEmployeeId(this.secretary.id);
    }

    // Initialize secretary's toolKit so she can use tools (shell, file ops, etc.)
    const secretaryWorkspace = this.workspaceManager.createDepartmentWorkspace('secretary', 'secretary');
    this.secretary.initToolKit(secretaryWorkspace, this.messageBus);

    this._log('Company founded', `"${this.name}" founded by ${this.bossName}`);
    this._log('Secretary ready', `Secretary ${this.secretary.name} using model ${secretaryProviderConfig.name}`);

    // Initialize distilled subsystems
    this._initSubsystems();
  }

  /**
   * Chat with secretary (task assignment or casual conversation)
   * @param {string} message - Boss's message
   * @returns {Promise<object>} Secretary's reply
   */
  async chatWithSecretary(message) {
    const bossMsg = {
      role: 'boss',
      content: message,
      time: new Date(),
    };
    this.chatHistory.push(bossMsg);
    // Persist to file storage
    chatStore.appendMessage(this.chatSessionId, bossMsg);

    const sec = this.secretary;
    let reply;

    // If secretary has CLI backend configured, chat also goes through CLI
    if (sec.cliBackend) {
      try {
        const recentMessages = chatStore.getRecentMessages(this.chatSessionId, 10);
        const chatContext = recentMessages.slice(-6).map(m =>
          `${m.role === 'boss' ? 'Boss' : sec.name}: ${m.content}`
        ).join('\n');

        const departments = [...this.departments.values()].map(d => ({
          name: d.name, id: d.id, mission: d.mission, status: d.status,
          memberCount: d.agents.size,
          leader: d.getLeader()?.name || 'Unassigned',
        }));
        const deptContext = departments.length > 0
          ? departments.map(d => `  🏢 ${d.name} [id:${d.id}] - Mission: ${d.mission} | ${d.memberCount} people | Leader: ${d.leader}`).join('\n')
          : 'No departments yet.';

        const cliPrompt = `You are "${sec.name}", the personal secretary of "${this.bossName}".
${sec.prompt ? `Your persona: ${sec.prompt}\n` : ''}
Current company "${this.name}" status:
- Departments: ${this.departments.size}
${deptContext}

Recent conversation:
${chatContext}

Boss's latest message: ${message}

You MUST reply with a JSON object (return JSON only, no other text):
{
  "content": "Your natural language reply to the boss (warm, personal, with emoji)",
  "action": null or one of:
    - { "type": "secretary_handle", "taskDescription": "detailed task for yourself to execute" } — for simple tasks you can handle alone
    - { "type": "task_assigned", "departmentId": "real dept id from above", "departmentName": "dept name", "taskTitle": "short title", "taskDescription": "detailed description" } — assign to existing department
    - { "type": "create_department", "departmentName": "name", "mission": "mission", "members": [{ "templateId": "id", "name": "nickname", "isLeader": true/false, "reportsTo": null or 0 }] } — boss wants to create a new department (design team directly)
    - { "type": "need_new_department", "suggestedMission": "task description" } — no existing dept can handle this
    - { "type": "progress_report" } — boss wants progress
    - null — casual chat, no action needed
}

Available job templates for team design (create_department): ${JSON.stringify(Object.values(JobTemplates).map(t => ({ id: t.id, title: t.title, category: t.category })))}
Enabled provider categories: ${[...new Set(this.providerRegistry.listEnabled().map(p => p.category))].join(', ')}
ONLY use templates whose category has an enabled provider above.

Rules:
- If boss wants to create a department → create_department (MUST include members array with 2-6 people, first must be project-leader with isLeader=true)
- If boss gives a task and an existing department matches → task_assigned (use the real departmentId!)
- If boss gives a simple task you can handle alone → secretary_handle
- If boss gives a task but no department matches → need_new_department
- Casual chat → null
- ALWAYS return valid JSON only, no markdown fences`;

        const cliResult = await cliBackendRegistry.executeTask(
          sec.cliBackend, sec,
          { title: `Secretary chat reply`, description: cliPrompt },
          sec.toolKit?.workspaceDir || process.cwd(), {}, { timeout: 60000 }
        );
        const rawOutput = cliResult.output || cliResult.errorOutput || '...';

        reply = this._parseSecretaryJSON(rawOutput, message);
      } catch (cliErr) {
        const hasLLM = sec.agent.provider && sec.agent.provider.enabled && sec.agent.provider.apiKey && !sec.agent.provider.apiKey.startsWith('cli');
        if (hasLLM) {
          console.warn(`  ⚠️ [Secretary] CLI chat failed, falling back to LLM: ${cliErr.message || cliErr.error}`);
          reply = await this.secretary.handleBossMessage(message, this);
        } else {
          // No available LLM provider, return CLI error message
          console.error(`  ❌ [Secretary] CLI chat failed, no LLM fallback available: ${cliErr.message || cliErr.error}`);
          reply = {
            content: `⚠️ CLI execution error: ${cliErr.message || 'Unknown error'}. Please check if CodeBuddy CLI is running properly.`,
            action: null,
          };
        }
      }
    } else {
      // Let secretary analyze whether it's task assignment or casual conversation
      reply = await this.secretary.handleBossMessage(message, this);
    }

    const secretaryMsg = {
      role: 'secretary',
      content: reply.content,
      action: reply.action || null,
      time: new Date(),
    };
    this.chatHistory.push(secretaryMsg);
    // Persist to file storage
    chatStore.appendMessage(this.chatSessionId, secretaryMsg);

    // Keep only the latest 50 messages in memory (for frontend cache)
    if (this.chatHistory.length > 50) {
      this.chatHistory = this.chatHistory.slice(-50);
    }

    this._log('Secretary chat', `Boss: "${message.slice(0, 30)}..." → Secretary replied`);
    return reply;
  }

  /**
   * Parse secretary's returned JSON (shared by CLI and LLM)
   * Extracts { content, action } structure from raw text
   */
  _parseSecretaryJSON(rawOutput, originalMessage) {
    try {
      const parsed = robustJSONParse(rawOutput);
      const result = {
        content: parsed.content || rawOutput,
        action: parsed.action || null,
      };

      // Validate task_assigned departmentId
      if (result.action?.type === 'task_assigned' && result.action.departmentId) {
        const deptById = this.departments.get(result.action.departmentId);
        if (!deptById) {
          // departmentId invalid, try matching by name
          const deptIdValue = result.action.departmentId;
          const deptNameValue = result.action.departmentName || deptIdValue;
          let foundDept = null;
          for (const dept of this.departments.values()) {
            if (dept.name === deptIdValue || dept.name === deptNameValue ||
                dept.name.includes(deptIdValue) || deptIdValue.includes(dept.name)) {
              foundDept = dept;
              break;
            }
          }
          if (foundDept) {
            console.log(`🔧 [CLI] Fixed departmentId: "${deptIdValue}" → "${foundDept.id}" (${foundDept.name})`);
            result.action.departmentId = foundDept.id;
            result.action.departmentName = foundDept.name;
          } else {
            console.warn(`⚠️ [CLI] departmentId "${deptIdValue}" doesn't match any department, clearing action`);
            result.action = null;
          }
        }
      }

      console.log(`🤖 [Secretary-CLI] action type: ${result.action?.type || 'null'}`);
      return result;
    } catch (parseError) {
      console.warn('⚠️ [Secretary-CLI] JSON parse failed, using raw output:', parseError.message);
      // JSON parse failed, try to extract content field
      let displayContent = rawOutput;
      const contentFieldMatch = rawOutput.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (contentFieldMatch) {
        try {
          displayContent = JSON.parse('"' + contentFieldMatch[1] + '"');
        } catch {
          displayContent = contentFieldMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
      }

      // Try to extract action from raw output
      let action = null;
      const actionTypeMatch = rawOutput.match(/"type"\s*:\s*"(task_assigned|need_new_department|create_department|progress_report|secretary_handle)"/);
      if (actionTypeMatch) {
        const actionType = actionTypeMatch[1];
        if (actionType === 'task_assigned') {
          const deptNameMatch = rawOutput.match(/"departmentName"\s*:\s*"([^"]+)"/);
          if (deptNameMatch) {
            for (const dept of this.departments.values()) {
              if (dept.name === deptNameMatch[1] || dept.name.includes(deptNameMatch[1]) || deptNameMatch[1].includes(dept.name)) {
                const titleMatch = rawOutput.match(/"taskTitle"\s*:\s*"([^"]+)"/);
                const descMatch = rawOutput.match(/"taskDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                action = {
                  type: 'task_assigned',
                  departmentId: dept.id,
                  departmentName: dept.name,
                  taskTitle: titleMatch ? titleMatch[1] : originalMessage.slice(0, 50),
                  taskDescription: descMatch ? descMatch[1].replace(/\\n/g, '\n') : originalMessage,
                };
                break;
              }
            }
          }
        } else if (actionType === 'create_department') {
          const deptNameMatch = rawOutput.match(/"departmentName"\s*:\s*"([^"]+)"/);
          const missionMatch = rawOutput.match(/"mission"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          action = { type: 'create_department', departmentName: deptNameMatch?.[1] || '', mission: missionMatch?.[1]?.replace(/\\n/g, '\n') || originalMessage };
        } else if (actionType === 'need_new_department') {
          const missionMatch = rawOutput.match(/"suggestedMission"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          action = { type: 'need_new_department', suggestedMission: missionMatch?.[1]?.replace(/\\n/g, '\n') || originalMessage };
        } else if (actionType === 'secretary_handle') {
          const descMatch = rawOutput.match(/"taskDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          action = { type: 'secretary_handle', taskDescription: descMatch?.[1]?.replace(/\\n/g, '\n') || originalMessage };
        } else if (actionType === 'progress_report') {
          action = { type: 'progress_report' };
        }
      }

      return { content: displayContent, action };
    }
  }

  /**
   * Update boss profile (avatar)
   */
  updateBossProfile(settings) {
    if (settings.avatar) {
      this.bossAvatar = settings.avatar;
    }
    this._log('Boss profile updated', `Avatar updated`);
    return { bossAvatar: this.bossAvatar };
  }

  /**
   * Chat with a specific agent (boss <-> agent 1-on-1)
   * @param {string} agentId - Agent ID
   * @param {string} message - Boss's message
   * @returns {Promise<object>} Agent's reply
   */
  async chatWithAgent(agentId, message) {
    // Find the agent
    let targetAgent = null;
    let targetDept = null;
    for (const dept of this.departments.values()) {
      const agent = dept.agents.get(agentId);
      if (agent) {
        targetAgent = agent;
        targetDept = dept;
        break;
      }
    }
    if (!targetAgent) throw new Error(`Employee not found: ${agentId}`);

    // Create or get chat session
    const sessionId = `boss-agent-${agentId}`;
    chatStore.createSession(sessionId, {
      title: `${this.bossName} & ${targetAgent.name}`,
      participants: [this.bossName, targetAgent.name],
      type: 'boss-agent',
    });

    // Append boss message
    const bossMsg = { role: 'boss', content: message, time: new Date() };
    chatStore.appendMessage(sessionId, bossMsg);

    // Get recent chat history for context
    const recentMessages = chatStore.getRecentMessages(sessionId, 20);

    // Build memory context from the new Memory system
    const bossChatGroupId = `boss-chat-${agentId}`;
    const memoryContext = targetAgent.memory.buildMemoryContext(bossChatGroupId);

    // Build messages for LLM — now with structured memory + JSON output
    const systemMessage = targetAgent._buildSystemMessage()
      + `\n\n## Current Conversation\nYou are having a private 1-on-1 conversation with your boss "${this.bossName}".`
      + ` You work in the "${targetDept.name}" department.`
      + ` Respond naturally based on your personality and role. Be helpful but stay in character.`
      + memoryContext
      + `\n\n## Output Format\nYou MUST return a JSON object (JSON only, nothing else):\n{\n  "content": "Your natural language reply",\n  "memorySummary": "A concise summary of older messages in this conversation — key facts, decisions, topics discussed. null if conversation just started.",\n  "memoryOps": [\n    { "op": "add", "type": "long_term", "content": "Important fact about the boss or decision made", "category": "fact", "importance": 8 },\n    { "op": "add", "type": "short_term", "content": "Current topic context", "category": "context", "importance": 5, "ttl": 3600 },\n    { "op": "delete", "id": "mem_id_to_forget" }\n  ],\n  "relationshipOps": [\n    { "employeeId": "boss", "name": "Boss", "impression": "Demanding but fair, values results", "affinity": 65 }\n  ]\n}\n\n## Memory Management\n- memorySummary: Summarize older conversation messages to compress context. Keep key info, skip chitchat. null if no old messages.\n- memoryOps: Manage your memory — add important facts/preferences about the boss as long_term, add current topic as short_term. [] if nothing to remember.\n- category: preference | fact | instruction | task | context | relationship | experience\n- importance: 1-10 (higher = more important)\n\n## Relationship Impressions\n- relationshipOps: Update your impression of the boss based on this conversation. Max 30 chars per impression, affinity 1-100 (50=neutral).\n- affinity should change gradually (+/- 5~15 per interaction). Start from 50 if first meeting.\n- Only update when something noteworthy happened. [] if nothing to update.`;

    const messages = [
      { role: 'system', content: systemMessage },
    ];

    // Add recent history as context
    for (const msg of recentMessages.slice(0, -1)) { // exclude the one we just added
      messages.push({
        role: msg.role === 'boss' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    // If this is a CLI agent, execute chat via CLI backend
    let replyContent;
    const displayInfo = targetAgent.getDisplayInfo();
    const chatEngine = displayInfo.type === 'cli'
      ? { engine: 'cli', cliName: displayInfo.name }
      : displayInfo.type === 'web'
        ? { engine: 'web', webName: displayInfo.name }
        : { engine: 'llm', llmName: displayInfo.name };

    if (targetAgent.agentType === 'cli' && targetAgent.isAvailable()) {
      // CLI agent chat goes through CLI backend
      try {
        const chatContext = recentMessages.slice(-6).map(m =>
          `${m.role === 'boss' ? 'Boss' : targetAgent.name}: ${m.content}`
        ).join('\n');

        const cliResult = await cliBackendRegistry.executeTask(
          targetAgent.cliBackend,
          targetAgent,
          {
            title: `Chat reply`,
            description: `You are having a 1-on-1 conversation with your boss "${this.bossName}". Reply naturally and helpfully based on your personality and role. Keep your reply concise (2-6 sentences). Do NOT use any tools or execute any code — just reply conversationally.\n\nRecent conversation:\n${chatContext}\n\nBoss: ${message}\n\nReply as ${targetAgent.name}:`,
          },
          targetAgent.toolKit?.workspaceDir || process.cwd(),
          {},
          { timeout: 60000 }
        );
        replyContent = cliResult.output || cliResult.errorOutput || '...';
      } catch (cliErr) {
        // On CLI failure, attempt fallback to LLM
        if (targetAgent.canChat()) {
          console.warn(`  ⚠️ [${targetAgent.name}] CLI chat failed, falling back to LLM: ${cliErr.message || cliErr.error}`);
          try {
            const response = await targetAgent.chat(messages, { temperature: 0.8, maxTokens: 2048 });
            replyContent = response.content;
          } catch (err) {
            replyContent = `(Sorry boss, my brain froze: ${err.message})`;
          }
        } else {
          console.error(`  ❌ [${targetAgent.name}] CLI chat failed, no LLM fallback: ${cliErr.message || cliErr.error}`);
          replyContent = `⚠️ CLI execution error: ${cliErr.message || 'Unknown error'}. Please check if CLI is running properly.`;
        }
      }
    } else if (targetAgent.canChat()) {
      // Regular LLM agent or CLI with fallback
      try {
        const response = await targetAgent.chat(messages, { temperature: 0.8, maxTokens: 2048 });
        replyContent = response.content;
      } catch (err) {
        replyContent = `(Sorry boss, my brain froze: ${err.message})`;
      }
    }

    // Process structured memory from AI response (new Memory system)
    try {
      const { robustJSONParse } = await import('../utils/json-parse.js');
      const parsed = robustJSONParse(replyContent);
      if (parsed && parsed.content) {
        // Extract actual reply content from JSON
        replyContent = parsed.content;

        // Process rolling history summary
        if (parsed.memorySummary) {
          targetAgent.memory.updateHistorySummary(bossChatGroupId, parsed.memorySummary);
          console.log(`  📜 [${targetAgent.name}] Boss-chat history summary updated`);
        }

        // Process memory operations
        if (parsed.memoryOps && Array.isArray(parsed.memoryOps)) {
          const result = targetAgent.memory.processMemoryOps(parsed.memoryOps);
          if (result.added + result.updated + result.deleted > 0) {
            console.log(`  🧠 [${targetAgent.name}] Boss-chat memory: +${result.added} ~${result.updated} -${result.deleted}`);
          }
        }

        // Process relationship impressions
        if (parsed.relationshipOps && Array.isArray(parsed.relationshipOps)) {
          const relResult = targetAgent.memory.processRelationshipOps(parsed.relationshipOps);
          if (relResult.updated > 0) {
            console.log(`  👥 [${targetAgent.name}] Boss-chat relationship updates: ${relResult.updated}`);
          }
        }
      }
    } catch (e) {
      // JSON parse failed — replyContent is plain text, that's fine
    }

    // Append agent reply
    const agentMsg = { role: 'agent', content: replyContent, time: new Date() };
    chatStore.appendMessage(sessionId, agentMsg);



    this.save();

    return {
      agentId: targetAgent.id,
      agentName: targetAgent.name,
      reply: replyContent,
      time: new Date(),
      chatEngine,
    };
  }

  /**
   * Get chat history with a specific agent
   * @param {string} agentId - Agent ID
   * @param {number} limit - Max messages to return
   * @returns {Array} Chat messages
   */
  getAgentChatHistory(agentId, limit = 30) {
    const sessionId = `boss-agent-${agentId}`;
    return chatStore.getRecentMessages(sessionId, limit);
  }

  /**
   * Mark chat with agent as read
   */
  markAgentChatRead(agentId) {
    const sessionId = `boss-agent-${agentId}`;
    chatStore.markSessionRead(sessionId);
  }

  /**
   * Get summary info for all boss-agent private chat sessions
   * Used to display private chat session list in Mailbox
   */
  _getAgentChatSessions() {
    const sessions = chatStore.listSessions();
    const agentSessions = sessions.filter(s => s.type === 'boss-agent');
    
    return agentSessions.map(session => {
      // Extract agentId from sessionId: "boss-agent-{agentId}"
      const agentId = session.sessionId.replace('boss-agent-', '');
      
      // Find corresponding agent info
      let agent = null;
      let deptName = null;
      for (const dept of this.departments.values()) {
        const a = dept.agents.get(agentId);
        if (a) {
          agent = a;
          deptName = dept.name;
          break;
        }
      }

      // Get latest message as preview
      const recentMessages = chatStore.getRecentMessages(session.sessionId, 1);
      const lastMsg = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;

      // Get read timestamp to determine if there are unread messages
      const meta = chatStore.getSessionMeta(session.sessionId);
      const bossLastReadAt = meta?.bossLastReadAt || null;
      const lastTime = lastMsg?.time || session.lastActiveAt || session.createdAt;
      // If never marked as read, or latest message time is after read time, it is unread
      const unread = !bossLastReadAt || (lastTime && new Date(lastTime) > new Date(bossLastReadAt));

      return {
        sessionId: session.sessionId,
        agentId,
        agentName: agent?.name || session.participants?.[1] || 'Unknown',
        agentAvatar: agent?.avatar || null,
        agentRole: agent?.role || null,
        agentSignature: agent?.signature || null,
        departmentName: deptName,
        lastMessage: lastMsg?.content?.slice(0, 50) || null,
        lastMessageRole: lastMsg?.role || null,
        lastTime,
        totalMessages: session.totalMessages || 0,
        unread,
      };
    }).filter(s => s.totalMessages > 0 && s.agentName !== 'Unknown' && s.agentAvatar !== null) // Only return sessions with messages, filter out dismissed agents (cannot find agent)
      .sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime)); // Sort by time descending
  }

  /**
   * Get all agent-to-agent chat sessions for a given agent
   * Used to "view chat records between this agent and others"
   * @param {string} agentId - Target agent ID
   * @returns {Array} Chat session list
   */
  getAgentConversations(agentId) {
    const sessions = chatStore.listSessions();
    // Find all agent-agent sessions that include this agent
    const agentSessions = sessions.filter(s => {
      if (s.type !== 'agent-agent') return false;
      // sessionId format: agent-agent-{id1}-{id2}
      return s.sessionId.includes(agentId);
    });

    // Also include boss-agent chats
    const bossSessions = sessions.filter(s => 
      s.type === 'boss-agent' && s.sessionId === `boss-agent-${agentId}`
    );

    const conversations = [];

    for (const session of agentSessions) {
      // Use participants to find the other party ID (more reliable than parsing sessionId)
      const participants = session.participants || [];
      const peerId = participants.find(p => p !== agentId) || null;
      if (!peerId) continue;

      // Find the other agent info
      let peerAgent = null;
      let peerDeptName = null;
      for (const dept of this.departments.values()) {
        const a = dept.agents.get(peerId);
        if (a) {
          peerAgent = a;
          peerDeptName = dept.name;
          break;
        }
      }

      const recentMessages = chatStore.getRecentMessages(session.sessionId, 1);
      const lastMsg = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;

      conversations.push({
        sessionId: session.sessionId,
        type: 'agent-agent',
        peerId,
        peerName: peerAgent?.name || session.participants?.find(p => p !== agentId) || 'Unknown',
        peerAvatar: peerAgent?.avatar || null,
        peerRole: peerAgent?.role || null,
        peerDepartment: peerDeptName,
        lastMessage: lastMsg?.content?.slice(0, 60) || null,
        lastTime: lastMsg?.time || session.lastActiveAt || session.createdAt,
        totalMessages: session.totalMessages || 0,
      });
    }

    // Boss chat
    for (const session of bossSessions) {
      const recentMessages = chatStore.getRecentMessages(session.sessionId, 1);
      const lastMsg = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;

      conversations.push({
        sessionId: session.sessionId,
        type: 'boss-agent',
        peerId: 'boss',
        peerName: this.bossName || 'Boss',
        peerAvatar: this.bossAvatar || null,
        peerRole: 'Boss',
        peerDepartment: null,
        lastMessage: lastMsg?.content?.slice(0, 60) || null,
        lastTime: lastMsg?.time || session.lastActiveAt || session.createdAt,
        totalMessages: session.totalMessages || 0,
      });
    }

    // Sort by time descending
    conversations.sort((a, b) => {
      if (!a.lastTime) return 1;
      if (!b.lastTime) return -1;
      return new Date(b.lastTime) - new Date(a.lastTime);
    });

    return conversations;
  }

  /**
   * Get chat messages for an agent-agent session
   * @param {string} sessionId - Session ID
   * @param {number} limit - Max message count
   * @returns {Array} Message list
   */
  getAgentAgentChatHistory(sessionId, limit = 50) {
    const messages = chatStore.getRecentMessages(sessionId, limit);
    // Also return session participants info, for frontend to determine message direction
    const meta = chatStore.getSessionMeta(sessionId);
    return {
      messages,
      participants: meta?.participants || [],
    };
  }

  /**
   * Update secretary settings (name, avatar, prompt, etc.)
   */
  updateSecretarySettings(settings) {
    const sec = this.secretary;
    if (settings.name) sec.name = settings.name;
    if (settings.avatar) sec.avatar = settings.avatar;
    if (settings.avatarParams) sec.avatarParams = settings.avatarParams;
    if (settings.gender) sec.gender = settings.gender;
    if (settings.age != null) sec.age = settings.age;
    if (settings.prompt) sec.prompt = settings.prompt;
    if (settings.signature) sec.signature = settings.signature;
    // Switch provider
    if (settings.providerId) {
      const newProvider = this.providerRegistry.getById(settings.providerId);
      if (!newProvider) throw new Error(`Provider not found: ${settings.providerId}`);
      if (!newProvider.enabled) throw new Error(`Provider ${newProvider.name} is not enabled, please configure API Key first`);

      // Determine target agent type
      const targetType = newProvider.isCLI ? 'cli' : newProvider.isWeb ? 'web' : 'llm';
      const needsTypeSwitch = sec.agentType !== targetType;

      if (needsTypeSwitch) {
        // Agent type mismatch — rebuild the communication agent only
        if (newProvider.isCLI && newProvider.cliBackendId) {
          const fallback = this.providerRegistry.recommend('general');
          sec.agent = new CLIAgent({
            cliBackend: newProvider.cliBackendId,
            cliProvider: newProvider, fallbackProvider: fallback, provider: fallback,
          });
          this._log('Secretary settings', `Secretary agent rebuilt as CLIAgent: ${newProvider.name} (${newProvider.cliBackendId})`);
        } else if (newProvider.isWeb) {
          sec.agent = new WebAgent({ provider: newProvider });
          sec.agent.setEmployeeId(sec.id);
          // Reset session so next chat reinitializes with the new provider
          sec._sessionAwake = false;
          this._log('Secretary settings', `Secretary agent rebuilt as WebAgent: ${newProvider.name}`);
        } else {
          sec.agent = new LLMAgent({ provider: newProvider });
          this._log('Secretary settings', `Secretary agent rebuilt as LLMAgent: ${newProvider.name}`);
        }
      } else {
        sec.switchProvider(newProvider);
      }
      // Sync HR assistant's provider
      sec.hrAssistant.employee.switchProvider(newProvider);
      this._log('Secretary settings', `Secretary provider switched to: ${newProvider.name}`);
    }
    this._log('Secretary settings', `Updated secretary settings: ${Object.keys(settings).join(', ')}`);
    this.save();
    const displayInfo = sec.getProviderDisplayInfo();
    return {
      name: sec.name,
      avatar: sec.avatar,
      gender: sec.gender,
      age: sec.age,
      prompt: sec.prompt,
      signature: sec.signature,
      provider: displayInfo.name,
      providerId: displayInfo.id,
    };
  }

  /**
   * Initialize distilled subsystems (hooks, cron, plugins, sessions)
   */
  _initSubsystems() {
    // 1. Configure cron executor to run tasks via company
    cronScheduler.executor = async (agentId, taskPrompt, jobId) => {
      // Find the agent and their department
      for (const dept of this.departments.values()) {
        const agent = dept.agents.get(agentId);
        if (agent) {
          const result = await agent.executeTask({
            title: `Scheduled: ${taskPrompt.slice(0, 40)}`,
            description: taskPrompt,
            context: `This is an automated scheduled task (job: ${jobId})`,
          });
          return result.output;
        }
      }
      throw new Error(`Agent ${agentId} not found for cron job`);
    };

    // 2. Register cron callbacks for hooks integration
    cronScheduler.onJobRun = (job) => {
      hookRegistry.trigger(HookEvent.TASK_ASSIGNED, {
        source: 'cron', jobId: job.id, jobName: job.name, agentId: job.agentId,
      });
    };
    cronScheduler.onJobComplete = (job, result) => {
      hookRegistry.trigger(HookEvent.TASK_COMPLETED, {
        source: 'cron', jobId: job.id, jobName: job.name, agentId: job.agentId,
      });
    };
    cronScheduler.onJobError = (job, error) => {
      hookRegistry.trigger(HookEvent.TASK_FAILED, {
        source: 'cron', jobId: job.id, jobName: job.name, error: error.message,
      });
      auditLogger.log({
        category: AuditCategory.AGENT_ACTION, level: AuditLevel.WARN,
        agentId: job.agentId, action: `Cron job failed: ${job.name}`,
        details: { error: error.message, jobId: job.id },
      });
    };

    // 3. Enable built-in plugins by default
    for (const plugin of pluginRegistry.list()) {
      if (plugin.state === 'installed') {
        try { pluginRegistry.enable(plugin.id); } catch {}
      }
    }

    // 4. Start cron scheduler
    cronScheduler.start();

    // 5. Start session pruning
    sessionManager.startPruning();

    // 6. Start group chat loop engine
    groupChatLoop.start(this);
    // Start group chat loop for all existing agents
    for (const dept of this.departments.values()) {
      for (const agent of dept.getMembers()) {
        groupChatLoop.startAgentLoop(agent);
      }
    }

    // 7. Fire system startup hook
    hookRegistry.trigger(HookEvent.SYSTEM_STARTUP, {
      companyName: this.name, bossName: this.bossName,
    });

    console.log('⚡ Distilled subsystems initialized (hooks, cron, plugins, sessions)');
  }

  _log(action, detail) {
    this.logs.push({ time: new Date(), action, detail });
    // Auto-persist on every state change
    debouncedSave(this);
  }

  /**
   * Manually trigger persistence (call after important operations)
   */
  save() {
    debouncedSave(this, 500);
  }

  /**
   * Step 1: Generate recruitment plan (don't execute, wait for boss approval)
   */
  async planDepartment(name, mission) {
    // Use a temporary Department instance for team design analysis
    const tempDept = new Department({ name, mission, company: this.id });
    const teamPlan = await tempDept.designTeam(mission, this.secretary, this.providerRegistry);
    teamPlan.departmentName = name;

    const planId = uuidv4();
    this.pendingPlans.set(planId, { teamPlan, name, mission });

    this._log('Recruitment plan', `Secretary planned a ${teamPlan.members.length}-person team for "${name}", pending boss approval`);

    return {
      planId,
      departmentName: name,
      mission,
      reasoning: teamPlan.reasoning || null,
      members: teamPlan.members.map(m => {
        // Find job template for this position, get category and requiredCapabilities
        const template = this.hr.getTemplate(m.templateId);
        let providerName = null;
        let providerModel = null;
        if (template) {
          const recommended = this.providerRegistry.recommend(
            template.category,
            template.requiredCapabilities
          );
          if (recommended) {
            providerName = recommended.name;
            providerModel = recommended.model;
          }
        }
        return {
          templateId: m.templateId,
          title: m.templateTitle,
          name: m.name,
          isLeader: m.isLeader,
          reportsTo: m.reportsTo !== null ? teamPlan.members[m.reportsTo]?.name : null,
          reason: m.reason || null,
          providerName,   // Recommended provider name (model name)
          providerModel,  // Recommended provider model
        };
      }),
      collaborationRules: teamPlan.collaborationRules,
    };
  }

  /**
   * Step 2: Confirm recruitment plan, execute hiring
   */
  async confirmPlan(planId) {
    const plan = this.pendingPlans.get(planId);
    if (!plan) throw new Error('Recruitment plan not found or expired');

    this.pendingPlans.delete(planId);

    const { teamPlan, name, mission } = plan;

    // Recruit via HR assistant
    const agents = this.secretary.hrAssistant.executeRecruitment(teamPlan, this.hr);

    // Create department
    const dept = new Department({ name, mission, company: this.id });
    const wsPath = this.workspaceManager.createDepartmentWorkspace(dept.id, name);
    dept.workspacePath = wsPath;

    // Add to department + initialize toolkits
    agents.forEach(agent => {
      dept.addAgent(agent);
      agent.initToolKit(wsPath, this.messageBus);
    });

    // Set department leader
    const leader = agents.find(a => a.role === 'Project Leader');
    if (leader) {
      dept.setLeader(leader);
    } else if (agents.length > 0) {
      dept.setLeader(agents[0]);
    }

    this.departments.set(dept.id, dept);

    this._log('Department created', `"${name}" department established, recruited ${agents.length} talents`);

    // Fire hooks: department created + agents created
    hookRegistry.trigger(HookEvent.DEPT_CREATED, {
      departmentId: dept.id, departmentName: dept.name, memberCount: agents.length,
    });
    for (const agent of agents) {
      hookRegistry.trigger(HookEvent.AGENT_CREATED, {
        agentId: agent.id, agentName: agent.name, role: agent.role,
        departmentId: dept.id, departmentName: dept.name,
      });
    }

    // Background async: Agent self-intro + onboarding email + broadcast
    this._onboardAgents(agents, dept).catch(e => console.error('Onboarding process error:', e));

    // Start group chat loop for new employee
    for (const agent of agents) {
      groupChatLoop.startAgentLoop(agent);
    }

    // Persist
    this.save();

    return dept;
  }

  /**
   * Create department directly from secretary's team plan (no second AI call).
   * The secretary already designed the team in the create_department action.
   * @param {object} params
   * @param {string} params.departmentName - Department name
   * @param {string} params.mission - Department mission
   * @param {Array} params.members - Team members from secretary's plan
   * @returns {Promise<Department>} Created department
   */
  async createDepartmentDirect({ departmentName, mission, members }) {
    const name = departmentName || 'New Project Dept';

    // Validate and normalize members against JobTemplates
    const validTemplateIds = new Set(Object.values(JobTemplates).map(t => t.id));
    const validMembers = (members || []).filter(m => validTemplateIds.has(m.templateId));

    if (validMembers.length === 0) {
      // Fallback: if secretary returned no valid members, fall back to planDepartment
      console.warn('⚠️ Secretary returned no valid members, falling back to planDepartment');
      const plan = await this.planDepartment(name, mission);
      return await this.confirmPlan(plan.planId);
    }

    // Build teamPlan in the same format as designTeam returns
    const teamPlan = {
      departmentName: name,
      mission,
      members: validMembers.map((m, i) => {
        const template = Object.values(JobTemplates).find(t => t.id === m.templateId);
        return {
          templateId: m.templateId,
          templateTitle: template?.title || m.templateId,
          name: m.name || `Employee${i + 1}`,
          isLeader: m.isLeader || false,
          reportsTo: m.reportsTo ?? (i === 0 ? null : 0),
          reason: m.reason || '',
        };
      }),
    };

    console.log(`📋 Secretary's direct team plan: ${name}, ${teamPlan.members.length} people`);
    teamPlan.members.forEach(m => {
      const prefix = m.isLeader ? '👔' : '👤';
      console.log(`   ${prefix} ${m.name} - ${m.templateTitle}`);
    });

    // Recruit via HR assistant
    const agents = this.secretary.hrAssistant.executeRecruitment(teamPlan, this.hr);

    // Create department
    const dept = new Department({ name, mission, company: this.id });
    const wsPath = this.workspaceManager.createDepartmentWorkspace(dept.id, name);
    dept.workspacePath = wsPath;

    // Add to department + initialize toolkits
    agents.forEach(agent => {
      dept.addAgent(agent);
      agent.initToolKit(wsPath, this.messageBus);
    });

    // Set department leader
    const leader = agents.find(a => a.role === 'Project Leader');
    if (leader) {
      dept.setLeader(leader);
    } else if (agents.length > 0) {
      dept.setLeader(agents[0]);
    }

    this.departments.set(dept.id, dept);

    this._log('Department created', `"${name}" department established, recruited ${agents.length} talents`);

    // Fire hooks
    hookRegistry.trigger(HookEvent.DEPT_CREATED, {
      departmentId: dept.id, departmentName: dept.name, memberCount: agents.length,
    });
    for (const agent of agents) {
      hookRegistry.trigger(HookEvent.AGENT_CREATED, {
        agentId: agent.id, agentName: agent.name, role: agent.role,
        departmentId: dept.id, departmentName: dept.name,
      });
    }

    // Background: Agent self-intro + onboarding
    this._onboardAgents(agents, dept).catch(e => console.error('Onboarding process error:', e));

    // Start group chat loop
    for (const agent of agents) {
      groupChatLoop.startAgentLoop(agent);
    }

    this.save();

    return dept;
  }

  /**
   * Employee onboarding flow: generate self-intro + send onboarding email + broadcast
   */
  async _onboardAgents(agents, dept) {
    for (const agent of agents) {
      // Let the employee introduce themselves — this is THEIR moment, not secretary's
      const onboardResult = await agent.onboard({
        departmentName: dept.name,
        bossName: this.bossName,
      });

      // Send greeting to boss (employee's own words, or fallback template)
      const greetingContent = onboardResult.greeting
        || `Hi ${this.bossName}, I'm ${agent.name}, just joined "${dept.name}" as ${agent.role}. My motto: "${agent.signature}". Looking forward to working with you!`;
      agent.sendMailToBoss(null, greetingContent, this);

      // Broadcast to colleagues (employee's own words, or fallback)
      const allAgentIds = [];
      this.departments.forEach(d => {
        d.getMembers().forEach(a => {
          if (a.id !== agent.id) allAgentIds.push(a.id);
        });
      });
      if (allAgentIds.length > 0) {
        const broadcastContent = onboardResult.broadcast
          || `👋 Hi everyone, I'm ${agent.name}, the new ${agent.role} in "${dept.name}". Nice to meet you all!`;
        this.messageBus.broadcast(agent.id, allAgentIds, broadcastContent, 'broadcast');
      }
    }
  }

  /**
   * General department lookup: try ID first, then fuzzy match by name
   * @param {string} idOrName - Department ID or name
   * @returns {Department|null}
   */
  findDepartment(idOrName) {
    if (!idOrName) return null;
    // Prioritize exact ID match
    const byId = this.departments.get(idOrName);
    if (byId) return byId;
    // Fallback: match by name
    for (const d of this.departments.values()) {
      if (d.name === idOrName || d.name.includes(idOrName) || idOrName.includes(d.name)) {
        console.log(`🔧 Matched department by name: "${idOrName}" → ${d.id} (${d.name})`);
        return d;
      }
    }
    return null;
  }

  createDepartment(name, mission) {
    const dept = new Department({ name, mission, company: this.id });
    const wsPath = this.workspaceManager.createDepartmentWorkspace(dept.id, name);
    dept.workspacePath = wsPath;
    this.departments.set(dept.id, dept);
    return dept;
  }

  hireAgent(departmentId, templateId, name, providerId = null) {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const recruitConfig = this.hr.recruit(templateId, name, providerId);
    const agent = createEmployee(recruitConfig);
    dept.addAgent(agent);

    // Initialize toolkit
    if (dept.workspacePath) {
      agent.initToolKit(dept.workspacePath, this.messageBus);
    }

    // Start group chat loop
    groupChatLoop.startAgentLoop(agent);

    return agent;
  }

  recallAgent(departmentId, profileId, newSkills = []) {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const recruitConfig = this.hr.recallFromMarket(profileId, newSkills);
    const agent = createEmployee(recruitConfig);
    agent.memory.addLongTerm(
      `Recalled to the "${dept.name}" department, carrying past experience and memories back to work`,
      'experience'
    );
    dept.addAgent(agent);

    if (dept.workspacePath) {
      agent.initToolKit(dept.workspacePath, this.messageBus);
    }

    // Start group chat loop for recalled employee
    groupChatLoop.startAgentLoop(agent);

    console.log(`  🔄 [${agent.name}] Recalled from talent market, joined "${dept.name}" department`);
    return agent;
  }

  dismissAgent(departmentId, agentId, reason = 'Project ended') {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const agent = dept.removeAgent(agentId);
    if (!agent) throw new Error(`Employee not found: ${agentId}`);

    agent.status = 'dismissed';

    // Stop group chat loop
    groupChatLoop.stopAgentLoop(agentId);

    // Fire hook: agent dismissed
    hookRegistry.trigger(HookEvent.AGENT_DISMISSED, {
      agentId: agent.id, agentName: agent.name, role: agent.role,
      departmentId: departmentId, reason,
    });

    const performanceData = {
      reviews: this.performanceSystem.getReviews(agentId),
      averageScore: this.performanceSystem.getAverageScore(agentId),
    };

    const profile = this.talentMarket.register(agent, reason, performanceData);



    // Clean up message bus inbox
    this.messageBus.clearInbox(agentId);

    console.log(`  📤 [${agent.name}] has been dismissed, entered talent market`);
    return profile;
  }

  /**
   * Permanently delete a talent from the talent market, and clean up all their messages in mailbox and message bus
   * @param {string} profileId - Talent market profile ID
   */
  deleteTalent(profileId) {
    const profile = this.talentMarket.remove(profileId);
    const originalAgentId = profile.originalAgentId;

    // Clean up mailbox messages from this person
    this.mailbox = this.mailbox.filter(m => m.from?.id !== originalAgentId);

    // Clean up message bus messages (sent and received)
    this.messageBus.messages = this.messageBus.messages.filter(
      m => m.from !== originalAgentId && m.to !== originalAgentId
    );
    this.messageBus.inbox.delete(originalAgentId);

    this._log('Delete talent', `Permanently deleted "${profile.name}" from talent market and cleaned up related messages`);
    this.save();
    return profile;
  }

  /**
   * Adjust department staffing - Step 1: Get adjustment plan
   * @param {string} departmentId - Department ID
   * @param {string} adjustGoal - Adjustment goal
   * @returns {object} Adjustment plan (pending approval)
   */
  async planAdjustment(departmentId, adjustGoal) {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const adjustPlan = await dept.adjustTeam(adjustGoal, this.secretary, this.providerRegistry);

    const planId = uuidv4();
    this.pendingPlans.set(planId, {
      type: 'adjustment',
      departmentId,
      departmentName: dept.name,
      adjustGoal,
      adjustPlan,
    });

    this._log('Adjustment plan', `Secretary created adjustment plan for "${dept.name}": fire ${adjustPlan.fires.length}, hire ${adjustPlan.hires.length}, pending approval`);

    return {
      planId,
      departmentId,
      departmentName: dept.name,
      adjustGoal,
      reasoning: adjustPlan.reasoning,
      fires: adjustPlan.fires,
      hires: adjustPlan.hires.map(h => {
        // Find recommended provider info
        const template = this.hr.getTemplate(h.templateId);
        let providerName = null;
        let providerModel = null;
        if (template) {
          const recommended = this.providerRegistry.recommend(
            template.category,
            template.requiredCapabilities
          );
          if (recommended) {
            providerName = recommended.name;
            providerModel = recommended.model;
          }
        }
        return { ...h, providerName, providerModel };
      }),
    };
  }

  /**
   * Confirm adjustment plan - Step 2: Execute adjustment
   * @param {string} planId - Adjustment plan ID
   */
  async confirmAdjustment(planId) {
    const plan = this.pendingPlans.get(planId);
    if (!plan || plan.type !== 'adjustment') throw new Error('Adjustment plan not found or expired');

    this.pendingPlans.delete(planId);

    const dept = this.departments.get(plan.departmentId);
    if (!dept) throw new Error(`Department not found: ${plan.departmentId}`);

    const { adjustPlan } = plan;

    // Execute layoffs
    for (const fire of adjustPlan.fires) {
      try {
        this.dismissAgent(plan.departmentId, fire.agentId, fire.reason || 'Department restructuring');
        this._log('Adjustment layoff', `"${plan.departmentName}": ${fire.name} laid off - ${fire.reason || 'Department restructuring'}`);
      } catch (e) {
        console.error(`Layoff failed [${fire.name}]:`, e.message);
      }
    }

    // Execute hiring
    const newAgents = [];
    if (adjustPlan.hires.length > 0) {
      // Construct in same format as designTeam plan
      const hirePlan = {
        members: adjustPlan.hires.map(h => ({
          templateId: h.templateId,
          templateTitle: h.templateTitle || h.templateId,
          name: h.name,
          isLeader: h.isLeader || false,
          reportsTo: h.reportsTo ?? 0,
          reason: h.reason,
        })),
      };

      const agents = this.secretary.hrAssistant.executeRecruitment(hirePlan, this.hr);
      for (const agent of agents) {
        if (!agent) continue;
        dept.addAgent(agent);
        if (dept.workspacePath) {
          agent.initToolKit(dept.workspacePath, this.messageBus);
        }
        newAgents.push(agent);
      }

      if (newAgents.length > 0) {
        this._log('Adjustment hire', `"${plan.departmentName}": hired ${newAgents.length} new employees`);
        // Background async onboarding
        this._onboardAgents(newAgents, dept).catch(e => console.error('Onboarding process error:', e));
        // Start group chat loop for new employee
        for (const agent of newAgents) {
          groupChatLoop.startAgentLoop(agent);
        }
      }
    }

    this.save();
    return dept;
  }

  /**
   * Disband department - all members enter talent market
   * @param {string} departmentId - Department ID
   * @param {string} reason - Disbanding reason
   */
  disbandDepartment(departmentId, reason = 'Organizational restructuring') {
const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const deptName = dept.name;
    const members = dept.getMembers();

    // Dismiss all members one by one
    for (const agent of members) {
      try {
        this.dismissAgent(departmentId, agent.id, `Department "${deptName}" disbanded: ${reason}`);
      } catch (e) {
        console.error(`Dismissal failed [${agent.name}]:`, e.message);
      }
    }

    // Delete department
    this.departments.delete(departmentId);

    this._log('Department disbanded', `"${deptName}" department disbanded, ${members.length} employees entered talent market. Reason: ${reason}`);
    this.save();

    return { departmentName: deptName, dismissedCount: members.length };
  }

  evaluateAgent(agentId, reviewerId, taskTitle, scores = null, comment = null) {
    let agent = null;
    let reviewer = null;

    for (const dept of this.departments.values()) {
      if (!agent) agent = dept.agents.get(agentId);
      if (!reviewer) reviewer = dept.agents.get(reviewerId);
    }

    if (!agent) throw new Error(`Employee not found: ${agentId}`);
    if (!reviewer) throw new Error(`Reviewer not found: ${reviewerId}`);

    let review;
    if (scores) {
      review = this.performanceSystem.evaluate({
        agent, reviewer, taskTitle, scores, comment,
      });
    } else {
      review = this.performanceSystem.autoEvaluate({
        agent, reviewer, taskTitle,
      });
    }

    agent.receiveFeedback(review);
    return review;
  }

  viewTalentMarket() {
    this.talentMarket.print();
    return this.talentMarket.listAvailable();
  }

  searchTalentMarket(criteria) {
    return this.talentMarket.search(criteria);
  }

  viewPerformanceReport(agentId, agentName = '') {
    this.performanceSystem.printReport(agentId, agentName);
  }

  viewAgentMemory(agentId) {
    for (const dept of this.departments.values()) {
      const agent = dept.agents.get(agentId);
      if (agent) {
        agent.memory.print(agent.name);
        return agent.memory.getSummary();
      }
    }
    throw new Error(`Employee not found: ${agentId}`);
  }

  getOverview() {
    const overview = {
      company: this.name,
      boss: this.bossName,
      departments: [],
      totalAgents: 0,
      talentMarket: this.talentMarket.getStats(),
    };

    this.departments.forEach(dept => {
      const summary = dept.getSummary();
      overview.departments.push(summary);
      overview.totalAgents += summary.memberCount;
    });

    return overview;
  }

  listProviders(category = null) {
    if (category) {
      return this.providerRegistry.getByCategory(category);
    }
    return this.providerRegistry.listAll();
  }

  listJobTemplates(category = null) {
    if (category) {
      return this.hr.listTemplatesByCategory(category);
    }
    return this.hr.listAllTemplates();
  }

  configureProvider(providerId, apiKey) {
    const provider = this.providerRegistry.configure(providerId, apiKey);
    // Sync with the appropriate client
    if (provider.isWeb) {
      // For web providers, apiKey carries the cookie string
      webClientRegistry.configureCookie(providerId, apiKey);
    } else {
      // Clear LLM client cache to ensure next call uses new apiKey
      llmClient.clearClient(providerId);
    }
    this._log('Configure provider', `${provider.name} has been ${apiKey ? 'enabled' : 'disabled'}`);
    return provider;
  }

  getProviderDashboard() {
    return this.providerRegistry.getStats();
  }

  /**
   * Assign task to department and let employees actually execute it
   * This is the core method that makes AI employees "actually work"
   * Uses requirement management: standardize requirement → leader decomposes workflow → execute by DAG → group chat communication
   * @param {string} departmentId - Target department ID
   * @param {string} taskDescription - Task description
   * @param {string} [taskTitle] - Task title
   * @returns {Promise<object>} Execution result
   */
  async assignTaskToDepartment(departmentId, taskDescription, taskTitle = null) {
    const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error(`Department not found: ${departmentId}`);

    const members = dept.getMembers();
    if (members.length === 0) throw new Error(`Department "${dept.name}" has no employees`);

    const title = taskTitle || taskDescription.slice(0, 50);
    this._log('Task assigned', `"${dept.name}" received task: "${title}"`);

    // Fire hook: task assigned
    hookRegistry.trigger(HookEvent.TASK_ASSIGNED, {
      departmentId: dept.id, departmentName: dept.name, taskTitle: title,
    });

    // 1. Create standardized requirement
    const requirement = this.requirementManager.create({
      title,
      description: taskDescription,
      departmentId: dept.id,
      departmentName: dept.name,
      bossMessage: taskDescription,
    });

    // Persist immediately to prevent data loss after requirement creation
    this.save();
    console.log(`📝 Requirement created: ${requirement.id} - ${title}`);

    // 2. Leader decomposes workflow
    const leader = dept.getLeader() || members[0];

    // Update liveStatus: record leader info during planning phase
    requirement.updateLiveStatus({
      currentAgent: leader.name,
      currentAgentId: leader.id,
      currentAgentAvatar: leader.avatar,
      currentAction: `${leader.name} is analyzing and decomposing the requirement...`,
    });
    this.save();

    try {
      await this.requirementManager.planWorkflow(
        requirement, members
      );
    } catch (e) {
      console.error('Workflow decomposition failed:', e.message);
      // Save current state even if decomposition fails (fallback workflow is set inside planWorkflow)
    }

    // Save again after workflow decomposition
    this.save();

    // 3. Execute by workflow DAG
    let summary;
    try {
      summary = await this.requirementManager.executeWorkflow(
        requirement, dept, this.performanceSystem
      );
    } catch (e) {
      console.error('Workflow execution failed:', e.message);
      // Update requirement status to failed
      requirement.status = 'failed';
      requirement.completedAt = new Date();
      requirement.summary = { totalTasks: 0, successTasks: 0, failedTasks: 0, totalDuration: 0, outputs: [], error: e.message };
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `❌ Requirement execution failed: ${e.message}`,
        'system', null, { auto: true }
      );
      this.save();
      summary = requirement.summary;
    }

    // 4. Let leader send report email
    if (leader) {
      let reportContent = `Requirement "${title}" completed!\n\n`;
      reportContent += `📊 Execution Summary:\n`;
      reportContent += `- Tasks completed: ${summary.successTasks}/${summary.totalTasks}\n`;
      reportContent += `- Total duration: ${Math.round(summary.totalDuration / 1000)}s\n\n`;
      reportContent += `📝 Member outputs:\n`;
      for (const o of (summary.outputs || [])) {
        reportContent += `\n[${o.agentName} (${o.role})]\n`;
        reportContent += (o.content || '').slice(0, 300);
        if ((o.content || '').length > 300) reportContent += '...';
        reportContent += '\n';
      }
      leader.sendMailToBoss(`📋 Requirement Report: ${title}`, reportContent, this);
    }

    // 5. Record to progress reports
    this.progressReports.push({
      time: new Date(),
      type: 'task_completed',
      reports: [{
        department: dept.name,
        task: title,
        requirementId: requirement.id,
        success: summary.successTasks === summary.totalTasks,
        detail: `${summary.successTasks}/${summary.totalTasks} subtasks completed, took ${Math.round(summary.totalDuration / 1000)}s`,
      }],
    });

    // Fire hook: task completed
    hookRegistry.trigger(HookEvent.TASK_COMPLETED, {
      departmentId: dept.id, departmentName: dept.name, taskTitle: title,
      totalTasks: summary.totalTasks, successTasks: summary.successTasks,
    });

    this._log('Task completed', `"${dept.name}" completed task: "${title}", ${summary.successTasks}/${summary.totalTasks} succeeded`);
    this.save();

    // Return summary with requirement ID
    return {
      requirementId: requirement.id,
      projectId: requirement.id,
      title,
      department: dept.name,
      departmentId: dept.id,
      totalTasks: summary.totalTasks,
      successTasks: summary.successTasks,
      failedTasks: summary.failedTasks,
      totalDuration: summary.totalDuration,
      outputs: (summary.outputs || []).map(o => ({
        agentName: o.agentName,
        role: o.role,
        output: o.content,
        outputType: o.outputType,
        toolResults: o.metadata?.toolResults || [],
        success: true,
        duration: o.metadata?.duration || 0,
      })),
      completedAt: new Date(),
    };
  }

  /**
   * Convert an approved Sprint into a standard Requirement and execute it.
   * Only team members participate (not the entire department).
   * @param {object} sprint - Sprint object
   * @param {object} team - Team object
   * @returns {Promise<object>} The created requirement
   */
  async assignSprintAsDepartmentTask(sprint, team) {
    const dept = this.findDepartment(team.departmentId);
    if (!dept) throw new Error(`Department not found: ${team.departmentId}`);

    const members = team.memberIds.map(mid => dept.agents.get(mid)).filter(Boolean);
    if (members.length === 0) throw new Error(`Team "${team.name}" has no valid members`);

    const leader = dept.agents.get(team.leaderId) || members[0];

    // Build task description from sprint plan + goal
    const taskDescription = sprint.plan
      ? `# Sprint Goal\n${sprint.goal}\n\n# Implementation Plan\n${sprint.plan}`
      : sprint.goal;
    const title = sprint.title;

    this._log('Sprint → Requirement', `Team "${team.name}" sprint "${title}" approved, creating requirement`);

    // 1. Create standard requirement
    const requirement = this.requirementManager.create({
      title,
      description: taskDescription,
      departmentId: dept.id,
      departmentName: dept.name,
      bossMessage: sprint.goal,
    });

    // Link sprint ↔ requirement
    sprint.requirementId = requirement.id;
    this.save();
    console.log(`📝 Sprint → Requirement created: ${requirement.id} - ${title}`);

    // 2. Leader decomposes workflow (using only team members, not entire dept)
    requirement.updateLiveStatus({
      currentAgent: leader.name,
      currentAgentId: leader.id,
      currentAgentAvatar: leader.avatar,
      currentAction: `${leader.name} is analyzing and decomposing the sprint plan...`,
    });
    this.save();

    try {
      await this.requirementManager.planWorkflow(
        requirement, members
      );
    } catch (e) {
      console.error('Sprint workflow decomposition failed:', e.message);
    }
    this.save();

    // 3. Execute workflow DAG
    let summary;
    try {
      summary = await this.requirementManager.executeWorkflow(
        requirement, dept, this.performanceSystem
      );
    } catch (e) {
      console.error('Sprint workflow execution failed:', e.message);
      requirement.status = 'failed';
      requirement.completedAt = new Date();
      requirement.summary = { totalTasks: 0, successTasks: 0, failedTasks: 0, totalDuration: 0, outputs: [], error: e.message };
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `❌ Sprint requirement execution failed: ${e.message}`,
        'system', null, { auto: true }
      );
      this.save();
      summary = requirement.summary;
    }

    // 4. Leader sends report email
    if (leader && summary) {
      let reportContent = `Sprint "${title}" completed!\n\n`;
      reportContent += `📊 Execution Summary:\n`;
      reportContent += `- Tasks completed: ${summary.successTasks}/${summary.totalTasks}\n`;
      reportContent += `- Total duration: ${Math.round(summary.totalDuration / 1000)}s\n\n`;
      reportContent += `📝 Member outputs:\n`;
      for (const o of (summary.outputs || [])) {
        reportContent += `\n[${o.agentName} (${o.role})]\n`;
        reportContent += (o.content || '').slice(0, 300);
        if ((o.content || '').length > 300) reportContent += '...';
        reportContent += '\n';
      }
      leader.sendMailToBoss(`📋 Sprint Report: ${title}`, reportContent, this);
    }

    // 5. Update sprint status based on requirement result
    const { SprintStatus } = await import('@/core/organization/team.js');
    if (requirement.status === 'completed' || requirement.status === 'pending_approval') {
      // For pending_approval, the sprint is done but the requirement awaits Boss review
      sprint.status = SprintStatus.COMPLETED;
      sprint.completedAt = new Date();
      sprint.summary = requirement.summary;
    } else if (requirement.status === 'failed') {
      sprint.status = SprintStatus.FAILED;
      sprint.completedAt = new Date();
      sprint.summary = requirement.summary;
    }

    this.save();
    return requirement;
  }

  /**
   * Boss sends a message in a requirement's group chat
   * The leader will see the message and decide whether to adjust the plan
   * @param {string} requirementId - Requirement ID
   * @param {string} message - Boss's message
   * @returns {Promise<object>} Leader's response
   */
  async sendBossGroupMessage(requirementId, message) {
    const requirement = this.requirementManager.get(requirementId);
    if (!requirement) throw new Error('Requirement not found');

    const dept = this.findDepartment(requirement.departmentId);
    if (!dept) throw new Error('Department not found');

    const leader = dept.getLeader() || dept.getMembers()[0];
    if (!leader) throw new Error('No leader found in department');

    // 1. Add Boss message to group chat (expand [[file:path]] → full format)
    const { content: expandedMessage, invalidRefs } = expandFileReferences(message, requirement.departmentId, dept.workspacePath);
    requirement.addGroupMessage(
      {
        id: 'boss',
        name: this.bossName || 'Boss',
        avatar: this.bossAvatar || null,
        role: 'Boss',
      },
      expandedMessage,
      'message'
    );
    // Auto-feedback: notify about invalid file references
    if (invalidRefs.length > 0) {
      const invalidList = invalidRefs.map(f => `  - ${f}`).join('\n');
      requirement.addGroupMessage(
        { id: 'system', name: 'System', role: 'system' },
        `⚠️ File reference error: the following files do not exist in workspace:\n${invalidList}`,
        'message', null, { auto: true }
      );
    }
    this.save();

    // 1.5 Trigger group chat loop: notify all members of new message (Boss message, everyone should pay attention)
    const allMembers = dept.getMembers();
    for (const member of allMembers) {
      // Delayed trigger to avoid everyone processing at the same time
      setTimeout(() => {
        groupChatLoop.triggerImmediate(member.id, requirementId, { from: { id: 'boss' }, content: message }).catch(() => {});
      }, 500 + Math.random() * 2000);
    }

    // 2. Leader asynchronously handles Boss message (use LLM to decide if adjustment needed)
    const leaderResponse = await this._leaderHandleBossMessage(leader, requirement, dept, message);

    // 3. Add Leader reply to group chat
    if (leaderResponse.reply) {
      requirement.addGroupMessage(leader, leaderResponse.reply, 'message', null, { auto: true });
    }

    // 4. Execute operations based on Leader decision
    if (leaderResponse.action === 'stop') {
      // Stop project
      requirement.status = 'failed';
      requirement.completedAt = new Date();
      requirement.updateLiveStatus({
        currentAction: 'Boss requested stop, project halted',
        currentAgent: null,
      });
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `⏹️ Project stopped by Boss request`,
        'system', null, { auto: true }
      );
    } else if (leaderResponse.action === 'restart') {
      // Restart project (mark as failed, frontend can use restart button)
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `🔄 Boss requested project restart, replanning...`,
        'system', null, { auto: true }
      );
      // Async re-execute, non-blocking
      const title = requirement.title;
      const description = requirement.description;
      const deptId = requirement.departmentId;
      // Delete old requirement
      this.requirementManager.requirements.delete(requirementId);
      // Re-dispatch
      this.assignTaskToDepartment(deptId, description, title).catch(e => {
        console.error('Restart requirement failed:', e.message);
      });
    } else if (leaderResponse.action === 'adjust' && leaderResponse.adjustments) {
      // Adjust plan: leader has explained the adjustment in reply, trigger actual workflow modification
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `📝 ${leader.name} is adjusting the plan based on Boss instructions...`,
        'system'
      );

      // Record old workflow for reference
      const previousWorkflow = requirement.workflow?.nodes?.map(n =>
        `- [${n.status}] ${n.title} → ${n.assigneeName || 'unknown'}${n.dependencies?.length ? ` (deps: ${n.dependencies.join(', ')})` : ''}`
      ).join('\n') || 'No previous workflow';

      // Record existing output files (preserved during adjustment, not deleted)
      const existingOutputs = requirement.outputs || [];

      // Reset requirement status (preserve outputs, do not delete existing files)
      requirement.status = RequirementStatus.PLANNING;
      requirement.workflow = null;
      // Note: do not clear outputs, modify/supplement on top of existing results
      requirement.summary = null;
      requirement.completedAt = null;
      requirement.updateLiveStatus({
        currentAgent: leader.name,
        currentAgentId: leader.id,
        currentAgentAvatar: leader.avatar,
        currentAction: `${leader.name} is re-planning the workflow based on Boss's instructions...`,
        toolCallsInProgress: [],
        recentFileChanges: [],
      });
      this.save();

      // Async replan + execute (non-blocking API return)
      const members = dept.getMembers();
      const adjustmentContext = {
        bossMessage: message,
        adjustments: leaderResponse.adjustments,
        previousWorkflow,
        existingOutputs: existingOutputs.map(o => o.fileName || o.title || 'unknown').join(', '),
      };

      (async () => {
        try {
          await this.requirementManager.planWorkflow(
            requirement, members, adjustmentContext
          );
          this.save();

          // Re-execute adjusted workflow
          await this.requirementManager.executeWorkflow(
            requirement, dept, this.performanceSystem
          );
          this.save();

          // After completion, leader sends report email
          if (leader) {
            const summary = requirement.summary || {};
            let reportContent = `Requirement "${requirement.title}" has been re-completed after adjustment!\n\n`;
            reportContent += `📊 Execution Results:\n`;
            reportContent += `- Completed tasks: ${summary.successTasks || 0}/${summary.totalTasks || 0}\n`;
            reportContent += `- Total duration: ${Math.round((summary.totalDuration || 0) / 1000)}s\n\n`;
            reportContent += `📝 Adjustment reason: ${message}\n`;
            leader.sendMailToBoss(`📋 Adjusted Requirement Report: ${requirement.title}`, reportContent, this);
          }
        } catch (e) {
          console.error('Adjust workflow failed:', e.message);
          requirement.status = RequirementStatus.FAILED;
          requirement.completedAt = new Date();
          requirement.addGroupMessage(
            { name: 'System', role: 'system' },
            `❌ Adjustment plan execution failed: ${e.message}`,
            'system', null, { auto: true }
          );
          this.save();
        }
      })();
    } else if (leaderResponse.action === 'approve') {
      // Boss approved the requirement — finalize it
      requirement.status = RequirementStatus.COMPLETED;
      requirement.completedAt = new Date();
      requirement.updateLiveStatus({
        currentAction: 'Boss approved — requirement completed',
        currentAgent: null,
      });
      requirement.addGroupMessage(
        { name: 'System', role: 'system' },
        `✅ Requirement "${requirement.title}" has been approved by Boss and is now completed!`,
        'system', null, { auto: true }
      );

      // Leader sends completion report email
      if (leader) {
        const summary = requirement.summary || {};
        let reportContent = `Requirement "${requirement.title}" has been approved and completed!\n\n`;
        reportContent += `📊 Execution Results:\n`;
        reportContent += `- Completed tasks: ${summary.successTasks || 0}/${summary.totalTasks || 0}\n`;
        reportContent += `- Total duration: ${Math.round((summary.totalDuration || 0) / 1000)}s\n`;
        leader.sendMailToBoss(`✅ Requirement Approved: ${requirement.title}`, reportContent, this);
      }
    }
    // action === 'continue' → No special handling needed, continue as normal

    this.save();

    return {
      requirementId,
      bossMessage: message,
      leaderReply: leaderResponse.reply,
      action: leaderResponse.action,
    };
  }

  /**
   * Boss sends a message in department group chat
   * @param {string} departmentId - Department ID
   * @param {string} message - Message content
   */
  sendBossDeptGroupMessage(departmentId, message) {
    const dept = this.findDepartment(departmentId);
    if (!dept) throw new Error('Department not found');

    // 1. Add Boss message to department group chat
    dept.addGroupMessage(
      {
        id: 'boss',
        name: this.bossName || 'Boss',
        avatar: this.bossAvatar || null,
        role: 'Boss',
      },
      message,
      'message'
    );
    this.save();

    // 2. Trigger group chat loop: notify all department members of new message
    const allMembers = dept.getMembers();
    for (const member of allMembers) {
      // Delayed trigger to avoid everyone processing at the same time
      setTimeout(() => {
        groupChatLoop.triggerImmediate(member.id, `dept-${dept.id}`, { from: { id: 'boss' }, content: message }).catch(() => {});
      }, 500 + Math.random() * 2000);
    }

    return { groupChat: dept.groupChat };
  }

  /**
   * Leader uses LLM to handle Boss message in group chat
   * @private
   */
  async _leaderHandleBossMessage(leader, requirement, department, bossMessage) {
    if (!leader.canChat()) {
      return {
        reply: `Received Boss instructions! I will execute them diligently.`,
        action: 'continue',
      };
    }

    try {
      // Build group chat history context (latest 20 messages)
      const recentChat = (requirement.groupChat || []).slice(-20).map(m => {
        const sender = m.from?.name || 'Unknown';
        const role = m.from?.role ? `(${m.from.role})` : '';
        return `[${sender}${role}]: ${m.content}`;
      }).join('\n');

      // Build workflow status
      const workflowStatus = requirement.workflow?.nodes?.map(n => {
        const agent = department.agents.get(n.assigneeId);
        return `- [${n.status}] ${n.title} (assigned to: ${agent?.name || n.assigneeName || 'unknown'})`;
      }).join('\n') || 'No workflow yet';

      const p = leader.personality || {};
      const response = await leader.chat([
        {
          role: 'system',
          content: `You are "${leader.name}", the project leader of department "${department.name}".
Your personality: ${p.trait || 'Professional'}. Speaking style: ${p.tone || 'Normal'}.
You are leading the team to work on requirement "${requirement.title}": ${requirement.description}

Current project status: ${requirement.status}
Current workflow:
${workflowStatus}

Recent group chat:
${recentChat}

The Boss (your employer) just sent a message in the group chat. You need to:
1. Carefully analyze the Boss's intent
2. Decide what action to take
3. Reply naturally in your personality style, addressing the Boss respectfully

You MUST reply in JSON format:
{
  "reply": "Your natural reply to the Boss (addressing them as Boss, speaking in your personality style, explaining what you'll do)",
  "action": "continue|adjust|stop|restart|approve",
  "adjustments": "If action is 'adjust', briefly describe what changes you'll make to the plan"
}

Action rules:
- "continue": Boss is just commenting/encouraging, no changes needed. Or giving minor feedback that doesn't change the plan.
- "approve": Boss is satisfied with the results and wants to close/accept/finalize the requirement. Use when Boss says things like "looks good", "approved", "OK", "done", "accept", "通过", "可以", "没问题", "完成", "好的", "确认", "LGTM", "ship it", etc. ${requirement.status === 'pending_approval' ? '**IMPORTANT: The project is currently PENDING APPROVAL. If the Boss seems satisfied or gives positive feedback, use "approve".**' : ''}
- "adjust": Boss wants to modify, supplement, or revise the current plan. IMPORTANT: This means working on top of existing results — existing files and outputs will be PRESERVED, only new/modified content will be added. Use this when Boss says things like "add more", "revise", "change X to Y", "also include", "supplement", "modify", "adjust" etc.
- "stop": Boss explicitly says to stop, halt, or cancel the project.
- "restart": Boss EXPLICITLY wants to start over completely from scratch, redo everything, or completely restart. Use ONLY when Boss clearly says "start over", "redo from scratch", "start fresh" etc. All existing files will be DELETED.

Reply in the same language the Boss used. Be concise but warm.`
        },
        {
          role: 'user',
          content: `Boss says: "${bossMessage}"`
        },
      ], { temperature: 0.7, maxTokens: 512 });

      // Parse JSON
      const tick = String.fromCharCode(96);
      const fence = tick + tick + tick;
      let jsonStr = response.content
        .replace(fence + 'json', '').replace(fence, '')
        .replace(fence + 'json', '').replace(fence, '')
        .trim();

      try {
        const parsed = JSON.parse(jsonStr);
        return {
          reply: parsed.reply || 'Understood, Boss!',
          action: ['continue', 'adjust', 'stop', 'restart', 'approve'].includes(parsed.action) ? parsed.action : 'continue',
          adjustments: parsed.adjustments || null,
        };
      } catch {
        // JSON parse failed, use raw reply
        return {
          reply: response.content?.trim() || 'Understood, Boss!',
          action: 'continue',
        };
      }
    } catch (e) {
      console.error(`Leader ${leader.name} failed to handle boss message:`, e.message);
      return {
        reply: `Received Boss instructions, I will handle it promptly!`,
        action: 'continue',
      };
    }
  }

  /**
   * Get full company state data (for Web rendering)
   */
  getFullState() {
    const departments = [];

    // Calculate company-wide Token/cost statistics
    let companyTotalTokens = 0;
    let companyTotalCost = 0;

    this.departments.forEach(dept => {
      let deptTokens = 0;
      let deptCost = 0;
      const members = dept.getMembers().map(a => {
        const usage = a.tokenUsage || { totalTokens: 0, totalCost: 0, promptTokens: 0, completionTokens: 0, callCount: 0 };
        deptTokens += usage.totalTokens;
        deptCost += usage.totalCost;
        return {
        id: a.id,
        name: a.name,
        role: a.role,
        avatar: a.avatar,
        gender: a.gender,
        age: a.age,
        signature: a.signature,
        personality: a.personality,
        status: a.status,
        provider: a.getProviderDisplayInfo(),
        cliBackend: a.cliBackend || null,
        fallbackProvider: a.getFallbackProviderName(),
        skills: a.skills,
        reportsTo: a.reportsTo,
        subordinates: a.subordinates,
        memory: a.memory.getSummary(),
        performanceHistory: a.performanceHistory,
        avgScore: a.performanceHistory.length > 0
          ? Math.round(a.performanceHistory.reduce((s, p) => s + p.score, 0) / a.performanceHistory.length)
          : null,
        taskCount: a.taskHistory.length,
        tokenUsage: { ...usage },
      };
      });

      companyTotalTokens += deptTokens;
      companyTotalCost += deptCost;

      departments.push({
        id: dept.id,
        name: dept.name,
        mission: dept.mission,
        status: dept.status,
        leader: dept.leader,
        workspacePath: dept.workspacePath || null,
        groupChat: dept.groupChat || [],
        members,
        tokenUsage: { totalTokens: deptTokens, totalCost: deptCost },
      });
    });

    // Add secretary and HR consumption
    const secUsage = this.secretary.tokenUsage || { totalTokens: 0, totalCost: 0 };
    const hrUsage = this.secretary.hrAssistant.employee.tokenUsage || { totalTokens: 0, totalCost: 0 };
    companyTotalTokens += secUsage.totalTokens + hrUsage.totalTokens;
    companyTotalCost += secUsage.totalCost + hrUsage.totalCost;

    return {
      id: this.id,
      name: this.name,
      boss: this.bossName,
      bossAvatar: this.bossAvatar,
      secretary: {
        name: this.secretary.name,
        avatar: this.secretary.avatar,
        gender: this.secretary.gender,
        age: this.secretary.age,
        signature: this.secretary.signature,
        prompt: this.secretary.prompt,
        provider: this.secretary.getProviderDisplayInfo().name,
        providerId: this.secretary.getProviderDisplayInfo().id,
        // Optional general-purpose + CLI + browser provider list (enabled only)
        availableProviders: [
          ...this.providerRegistry.getByCategory('general').filter(p => !p.isWeb).map(p => ({
            id: p.id,
            name: p.name,
          })),
          ...this.providerRegistry.getByCategory('cli').map(p => ({
            id: p.id,
            name: `${p.cliIcon || '🖥️'} ${p.name} (CLI)`,
            isCLI: true,
            cliBackendId: p.cliBackendId,
          })),
          ...this.providerRegistry.getByCategory('browser').map(p => ({
            id: p.id,
            name: `🌐 ${p.name}`,
            isWeb: true,
          })),
        ],
        hrAssistant: {
          name: this.secretary.hrAssistant.employee.name,
          avatar: this.secretary.hrAssistant.employee.avatar,
          signature: this.secretary.hrAssistant.employee.signature,
        },
      },
      departments,
      budget: {
        totalTokens: companyTotalTokens,
        totalCost: Math.round(companyTotalCost * 10000) / 10000,
        secretaryUsage: { ...secUsage },
        hrUsage: { ...hrUsage },
      },
      mailbox: this.mailbox.slice(-50).map(m => ({
        ...m,
        from: { ...m.from },
        replies: (m.replies || []).slice(-10),
      })),
      unreadMailCount: this.mailbox.filter(m => !m.read).length,
      pendingPlans: [...this.pendingPlans.entries()].map(([id, p]) => {
        if (p.type === 'adjustment') {
          return {
            planId: id,
            type: 'adjustment',
            departmentId: p.departmentId,
            departmentName: p.departmentName,
            adjustGoal: p.adjustGoal,
            reasoning: p.adjustPlan?.reasoning,
            fires: p.adjustPlan?.fires || [],
            hires: p.adjustPlan?.hires || [],
          };
        }
        return {
          planId: id,
          type: 'recruitment',
          name: p.name,
          mission: p.mission,
          members: (p.teamPlan?.members || []).map(m => ({
            templateId: m.templateId,
            title: m.templateTitle,
            name: m.name,
            isLeader: m.isLeader,
            reportsTo: m.reportsTo !== null ? p.teamPlan.members[m.reportsTo]?.name : null,
          })),
        };
      }),
      chatHistory: this.chatHistory.slice(-30),
      progressReports: this.progressReports.slice(-20),
      talentMarket: this.talentMarket.listAvailable().map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
        avatar: p.avatar,
        gender: p.gender,
        age: p.age,
        skills: [...p.skills, ...p.acquiredSkills],
        dismissalReason: p.dismissalReason,
        performanceScore: p.performanceData?.averageScore,
        registeredAt: p.registeredAt,
        memoryCount: p.memorySnapshot ? (p.memorySnapshot.shortTerm?.length || 0) + (p.memorySnapshot.longTerm?.length || 0) : 0,
      })),
      providerDashboard: this.providerRegistry.getStats(),
      messageBusStats: this.messageBus.getStats(),
      // Boss-Agent private chat session list
      agentChatSessions: this._getAgentChatSessions(),
      requirements: this.requirementManager.listAll().map(r => r.serialize()),
      teams: this.teamManager.listAll().map(t => t.serialize()),
      logs: this.logs.slice(-50),
    };
  }

  /**
   * Get recent messages from message bus
   */
  getRecentMessages(limit = 20) {
    return this.messageBus.getRecent(limit);
  }

  /**
   * Get conversation between Agents
   */
  getConversation(agentId1, agentId2, limit = 50) {
    return this.messageBus.getConversation(agentId1, agentId2, limit);
  }

  /**
   * Get workspace file tree
   */
  async getWorkspaceFiles(departmentId) {
const dept = this.findDepartment(departmentId);
    if (!dept || !dept.workspacePath) return [];
    return this.workspaceManager.getFileTree(dept.workspacePath);
  }

  /**
   * Get shallow (one-level) workspace file listing
   */
  async getShallowWorkspaceFiles(departmentId, subPath = '') {
    const dept = this.findDepartment(departmentId);
    if (!dept || !dept.workspacePath) return [];
    return this.workspaceManager.getShallowFileTree(dept.workspacePath, subPath);
  }

  /**
   * Read workspace file
   */
  async readWorkspaceFile(departmentId, filePath) {
const dept = this.findDepartment(departmentId);
    if (!dept || !dept.workspacePath) throw new Error('Department workspace does not exist');
    return this.workspaceManager.readFile(dept.workspacePath, filePath);
  }

  printCompanyOverview() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🏢 "${this.name}" Company Overview`);
    console.log(`${'='.repeat(60)}`);
    console.log(`👤 Boss: ${this.bossName}`);
    console.log(`🏢 Departments: ${this.departments.size}`);

    this.departments.forEach(dept => {
      console.log(`\n  📁 ${dept.name} (${dept.status})`);
      console.log(`     Mission: ${dept.mission}`);
      console.log(`     Members: ${dept.agents.size}`);
      dept.printOrgChart();
    });

    this.talentMarket.print();
    console.log(`${'='.repeat(60)}\n`);
  }

  // ========== Persistence Serialization ==========

  /**
   * Serialize complete company state (for disk persistence)
   */
  serialize() {
    // Serialize departments and Agents
    const departments = [];
    this.departments.forEach(dept => {
      const members = dept.getMembers().map(a => a.serialize());
      departments.push({
        id: dept.id,
        name: dept.name,
        mission: dept.mission,
        status: dept.status,
        leader: dept.leader,
        workspacePath: dept.workspacePath,
        createdAt: dept.createdAt,
        // groupChat is persisted in chatStore files (data/chats/group-dept-{id}/)
        members,
      });
    });

    // Serialize provider configs (only save API Key/cookie and enabled state)
    const providerConfigs = {};
    this.providerRegistry.listAll().forEach(p => {
      if (p.apiKey || p.cookie || p.enabled) {
        providerConfigs[p.id] = { apiKey: p.apiKey, enabled: p.enabled };
        if (p.isWeb && p.cookie) {
          providerConfigs[p.id].cookie = p.cookie;
        }
      }
    });

    // Serialize talent market
    const talentPool = [];
    this.talentMarket.pool.forEach((profile, id) => {
      talentPool.push({
        ...profile,
        // Only save provider id
        provider: profile.provider ? { id: profile.provider.id } : null,
      });
    });

    return {
      _version: 1,
      id: this.id,
      name: this.name,
      bossName: this.bossName,
      bossAvatar: this.bossAvatar,
      departments,
      providerConfigs,
      talentPool,
      mailbox: this.mailbox.slice(-200),
      chatSessionId: this.chatSessionId,
      chatHistory: this.chatHistory.slice(-50),
      progressReports: this.progressReports.slice(-30),
      logs: this.logs.slice(-100),
      secretary: {
        name: this.secretary.name,
        avatar: this.secretary.avatar,
        signature: this.secretary.signature,
        prompt: this.secretary.prompt,
        providerId: this.secretary.getProviderDisplayInfo().id,
        cliBackend: this.secretary.cliBackend || null,
        tokenUsage: { ...this.secretary.tokenUsage },
        hrTokenUsage: { ...this.secretary.hrAssistant.employee.tokenUsage },
      },
      messageBusMessages: this.messageBus.messages.slice(-500).map(m => m.toJSON()),
      requirements: this.requirementManager.serialize(),
      teams: this.teamManager.serialize(),
      cronJobs: cronScheduler.serialize(),
      cliBackends: cliBackendRegistry.serialize(),
      savedAt: new Date(),
    };
  }

  /**
   * Restore company from serialized data (static factory method)
   */
  static deserialize(data) {
    if (!data || !data.name) throw new Error('Invalid company state data');

    // Create shell company (don't trigger full initialization)
    // Get the real apiKey for the secretary's provider from providerConfigs
    const secretaryProviderId = data.secretary?.providerId || 'deepseek-v3';
    const secretaryApiKey = data.providerConfigs?.[secretaryProviderId]?.apiKey || 'sk-restored';
    const company = new Company(data.name, data.bossName, {
      providerId: secretaryProviderId,
      apiKey: secretaryApiKey,
      secretaryName: data.secretary?.name,
      secretaryAvatar: data.secretary?.avatar,
    });

    // Restore ID
    company.id = data.id;

    // Restore boss avatar
    if (data.bossAvatar) {
      company.bossAvatar = data.bossAvatar;
    }

    // Restore provider configs
    if (data.providerConfigs) {
      for (const [pid, cfg] of Object.entries(data.providerConfigs)) {
        try {
          // For web providers, restore cookie and configure webClientRegistry
          if (cfg.cookie) {
            const provider = company.providerRegistry.getById(pid);
            if (provider && provider.isWeb) {
              provider.cookie = cfg.cookie;
              provider.enabled = cfg.enabled;
              webClientRegistry.configureCookie(pid, cfg.cookie);
              continue;
            }
          }
          company.providerRegistry.configure(pid, cfg.apiKey);
          // Clear old LLM client cache to ensure the restored real apiKey is used
          llmClient.clearClient(pid);
        } catch (e) { /* ignore non-existent providers */ }
      }
    }

    // Restore secretary token usage
    if (data.secretary?.tokenUsage) {
      Object.assign(company.secretary.tokenUsage, data.secretary.tokenUsage);
    }
    if (data.secretary?.hrTokenUsage) {
      Object.assign(company.secretary.hrAssistant.employee.tokenUsage, data.secretary.hrTokenUsage);
    }
    // Restore secretary custom prompt
    if (data.secretary?.prompt) {
      company.secretary.prompt = data.secretary.prompt;
    }
    // Restore secretary signature
    if (data.secretary?.signature) {
      company.secretary.signature = data.secretary.signature;
    }
    // Restore secretary CLI backend configuration
    if (data.secretary?.cliBackend && company.secretary.agentType !== 'cli') {
      const cliProvider = company.providerRegistry.getById(data.secretary.providerId);
      if (cliProvider && cliProvider.isCLI && cliProvider.cliBackendId) {
        const fallback = company.providerRegistry.recommend('general');
        company.secretary.agent = new CLIAgent({
          cliBackend: cliProvider.cliBackendId,
          cliProvider: cliProvider,
          fallbackProvider: fallback, provider: fallback,
        });
      }
    }
    // Restore secretary Web agent configuration
    if (data.secretary?.providerId && company.secretary.agentType !== 'web') {
      const webProvider = company.providerRegistry.getById(data.secretary.providerId);
      if (webProvider && webProvider.isWeb) {
        company.secretary.agent = new WebAgent({ provider: webProvider });
        // Re-bind employeeId after agent replacement (for per-employee session isolation)
        company.secretary.agent.setEmployeeId(company.secretary.id);
      }
    }

    // Restore secretary memory from separate memory file
    if (company.secretary?.id) {
      const secretaryMemory = loadAgentMemory(company.secretary.id);
      if (secretaryMemory) {
        company.secretary.memory = Memory.deserialize(secretaryMemory);
        console.log(`  🧠 Secretary memory restored: ${secretaryMemory.shortTerm?.length || 0} short-term, ${secretaryMemory.longTerm?.length || 0} long-term`);
      }
    }

    // Restore departments and Agents
    company.departments.clear();
    for (const deptData of (data.departments || [])) {
      const dept = new Department({
        name: deptData.name,
        mission: deptData.mission,
        company: company.id,
      });
      dept.id = deptData.id;
      dept.status = deptData.status || 'active';
      dept.leader = deptData.leader;
      dept.workspacePath = deptData.workspacePath;
      // Ensure workspace directory exists (may be missing after migration or cleanup)
      if (dept.workspacePath && !existsSync(dept.workspacePath)) {
        try { mkdirSync(dept.workspacePath, { recursive: true }); } catch { /* ignore */ }
      }
      dept.createdAt = deptData.createdAt ? new Date(deptData.createdAt) : new Date();
      // Load groupChat from file storage (with legacy inline data migration)
      dept.loadGroupChatFromStore(deptData.groupChat);

      // Restore Agents
      for (const agentData of (deptData.members || [])) {
      // Load memory from separate file (higher priority than serialized data)
        const externalMemory = loadAgentMemory(agentData.id);
        if (externalMemory) {
          agentData.memory = externalMemory;
        }
        const agent = deserializeEmployee(agentData, company.providerRegistry);
        dept.addAgent(agent);
        // Restore toolkit
        if (dept.workspacePath) {
          agent.initToolKit(dept.workspacePath, company.messageBus);
        }
      }

      company.departments.set(dept.id, dept);
    }

    // Restore talent market
    company.talentMarket.pool.clear();
    for (const profile of (data.talentPool || [])) {
      // Restore provider reference
      if (profile.provider?.id) {
        profile.provider = company.providerRegistry.getById(profile.provider.id) || profile.provider;
      }
      company.talentMarket.pool.set(profile.id, profile);
    }

    // Restore mailbox, chat history, progress reports, logs
    company.mailbox = data.mailbox || [];
    company.chatHistory = data.chatHistory || [];
    // Restore chat session ID
    if (data.chatSessionId) {
      company.chatSessionId = data.chatSessionId;
    }
    // If there is old chatHistory data and file storage is empty, migrate it
    if (company.chatHistory.length > 0 && chatStore.getMessageCount(company.chatSessionId) === 0) {
      chatStore.migrateFromArray(company.chatSessionId, company.chatHistory);
    }
    company.progressReports = data.progressReports || [];
    company.logs = data.logs || [];

    // Restore message bus
    if (data.messageBusMessages) {
      // Only restore history, don't rebuild inbox
      company.messageBus.messages = data.messageBusMessages.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp),
        toJSON() { return m; },
      }));
    }

    // Restore requirement manager
    if (data.requirements) {
      company.requirementManager = RequirementManager.deserialize(data.requirements);
    }

    // Restore team manager
    if (data.teams) {
      company.teamManager = TeamManager.deserialize(data.teams);
    }

    // Restore cron jobs
    if (data.cronJobs) {
      cronScheduler.restore(data.cronJobs);
    }

    // Restore CLI backends (custom backends)
    if (data.cliBackends) {
      cliBackendRegistry.restore(data.cliBackends);
    }
    // Sync CLI backends into provider registry
    company.providerRegistry.syncCLIBackends(cliBackendRegistry);
    // Re-apply provider configs for CLI providers (to restore enabled state)
    const reapplyCLIConfigs = () => {
      if (data.providerConfigs) {
        for (const [pid, cfg] of Object.entries(data.providerConfigs)) {
          if (pid.startsWith('cli-')) {
            try { company.providerRegistry.configure(pid, cfg.apiKey); } catch {}
          }
        }
      }
    };
    reapplyCLIConfigs();
    // Auto-detect CLI backends in background, then re-sync and re-apply configs
    cliBackendRegistry.detectAll().then(() => {
      company.providerRegistry.syncCLIBackends(cliBackendRegistry);
      reapplyCLIConfigs();
    }).catch(() => {});

    // Re-start group chat loop for all restored agents
    // (_initSubsystems ran during constructor when departments were still empty,
    //  so we need to register all agents that were restored afterwards)
    groupChatLoop.start(company);
    for (const dept of company.departments.values()) {
      for (const agent of dept.getMembers()) {
        groupChatLoop.startAgentLoop(agent);
      }
    }

    console.log(`✅ Company "${company.name}" state restored: ${company.departments.size} departments`);
    return company;
  }
}
