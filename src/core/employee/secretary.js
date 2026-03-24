import { Employee } from './base-employee.js';
import { createEmployee } from './index.js';

import { knowledgeManager } from './knowledge.js';
import { chatStore } from '../agent/chat-store.js';
import { cliBackendRegistry } from '../agent/cli-agent/backends/index.js';
import { JobTemplates } from '../organization/workforce/hr.js';
import { robustJSONParse } from '../utils/json-parse.js';
import { getAppLanguageName, buildLanguageInstruction } from '../utils/app-language.js';


/**
 * Incremental JSON "content" field extractor.
 * As raw JSON tokens stream in, this class tracks whether we're inside the
 * `"content": "..."` value and yields the decoded text characters.
 *
 * State machine:
 *   SCANNING → found `"content"` key → AWAIT_COLON → AWAIT_QUOTE → INSIDE_VALUE → done
 */
class JSONContentExtractor {
  constructor() {
    this.state = 'SCANNING'; // SCANNING | AWAIT_COLON | AWAIT_QUOTE | INSIDE_VALUE | DONE
    this.buffer = '';
    this.escapeNext = false;
  }

  /**
   * Feed a chunk of raw JSON text. Returns any decoded "content" value text,
   * or empty string if nothing to emit yet.
   */
  feed(chunk) {
    if (this.state === 'DONE') return '';

    let output = '';
    for (const ch of chunk) {
      switch (this.state) {
        case 'SCANNING':
          this.buffer += ch;
          // Look for `"content"` key (with possible whitespace)
          if (this.buffer.endsWith('"content"') || this.buffer.endsWith('"content" ')) {
            this.state = 'AWAIT_COLON';
            this.buffer = '';
          }
          // Keep buffer bounded — only need last 12 chars to detect the key
          if (this.buffer.length > 20) {
            this.buffer = this.buffer.slice(-15);
          }
          break;

        case 'AWAIT_COLON':
          if (ch === ':') {
            this.state = 'AWAIT_QUOTE';
          } else if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') {
            // Not a colon — false alarm, go back to scanning
            this.state = 'SCANNING';
            this.buffer = '';
          }
          break;

        case 'AWAIT_QUOTE':
          if (ch === '"') {
            this.state = 'INSIDE_VALUE';
          } else if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') {
            // Value is not a string — go back to scanning
            this.state = 'SCANNING';
            this.buffer = '';
          }
          break;

        case 'INSIDE_VALUE':
          if (this.escapeNext) {
            // Handle JSON escape sequences
            switch (ch) {
              case 'n': output += '\n'; break;
              case 't': output += '\t'; break;
              case '"': output += '"'; break;
              case '\\': output += '\\'; break;
              case '/': output += '/'; break;
              default: output += ch; break;
            }
            this.escapeNext = false;
          } else if (ch === '\\') {
            this.escapeNext = true;
          } else if (ch === '"') {
            // End of content string
            this.state = 'DONE';
            return output;
          } else {
            output += ch;
          }
          break;
      }
    }
    return output;
  }
}


/**
 * Secretary's Dedicated HR Assistant
 * Handles recruitment operations, talent market search, and recall
 */
export class HRAssistant {
  constructor({ secretary, providerConfig }) {
    // HR assistant is always an Employee (LLM-based)
    this.employee = new Employee({
      name: 'HR-Bot',
      role: 'HR Recruiter',
      prompt: `You are the secretary's dedicated HR assistant, responsible for executing recruitment operations.
Your duties include: searching for suitable candidates in the talent market, evaluating candidates' historical performance and skill match,
executing the recruitment process, and coordinating new employee onboarding. You need to make optimal decisions between "recalling former employees" and "hiring new ones" based on position requirements.`,
      skills: ['talent-search', 'resume-screening', 'performance-evaluation', 'recruitment-process', 'onboarding'],
      provider: providerConfig,
    });
    this.secretary = secretary;
  }

  smartRecruit(requirement, hr) {
    const { templateId, name, preferRecall = true } = requirement;

    if (preferRecall && hr.talentMarket) {
      const template = hr.getTemplate(templateId);
      if (template) {
        const candidates = hr.searchTalentMarket({
          role: template.title, skills: template.skills,
        });

        if (candidates.length > 0) {
          const best = this._pickBestCandidate(candidates, template);
          if (best) {
            console.log(`  🔍 [HR-Bot] Found matching candidate in talent market: ${best.name} (${best.role})`);
            const decision = this._decideRecallOrNew(best, template);
            if (decision === 'recall') {
              console.log(`  ✅ [HR-Bot] Decided to recall former employee: ${best.name}`);
              return hr.recallFromMarket(best.id);
            } else {
              console.log(`  🆕 [HR-Bot] Decided to hire new (former employee not a good match)`);
            }
          }
        } else {
          console.log(`  🔍 [HR-Bot] No matching candidates in talent market, will hire new`);
        }
      }
    }

    return hr.recruit(templateId, name);
  }

  _pickBestCandidate(candidates, template) {
    const scored = candidates.map(c => {
      const allSkills = [...c.skills, ...c.acquiredSkills];
      const matchCount = template.skills.filter(s =>
        allSkills.some(cs => cs.includes(s) || s.includes(cs))
      ).length;
      const skillScore = matchCount / template.skills.length;
      const perfScore = c.performanceData?.averageScore ? c.performanceData.averageScore / 100 : 0.5;
      return { ...c, totalScore: skillScore * 0.6 + perfScore * 0.4 };
    });
    scored.sort((a, b) => b.totalScore - a.totalScore);
    return scored[0] || null;
  }

  _decideRecallOrNew(candidate, template) {
    if (candidate.performanceData?.averageScore < 50) return 'new';
    const allSkills = [...candidate.skills, ...candidate.acquiredSkills];
    const matchCount = template.skills.filter(s =>
      allSkills.some(cs => cs.includes(s) || s.includes(cs))
    ).length;
    if (matchCount >= template.skills.length * 0.5) return 'recall';
    return 'new';
  }

  /**
   * Execute recruitment based on a team plan.
   * @param {object} plan - Team plan with members array
   * @param {object} hr - HRSystem instance
   * @returns {Array} Array of recruited employees
   */
  executeRecruitment(plan, hr) {
    console.log(`\n🔔 [HR] Starting recruitment, HR assistant [${this.employee.name}] handling operations...`);

    const employees = [];
    const skipped = [];

    for (const memberPlan of plan.members) {
      console.log(`\n  📌 Position: ${memberPlan.templateTitle} (${memberPlan.name})`);

      try {
        const recruitConfig = this.smartRecruit(
          { templateId: memberPlan.templateId, name: memberPlan.name, preferRecall: true },
          hr
        );
        const employee = createEmployee(recruitConfig);

        if (recruitConfig.cliBackend) {
          console.log(`  🖥️ [${employee.name}] assigned CLI backend: ${recruitConfig.cliBackend}`);
        }

        if (recruitConfig.isRecalled) {
          console.log(`  🔄 [${employee.name}] is a former employee recalled from talent market, carrying original memories`);
        }

        employees.push(employee);
      } catch (e) {
        if (e.message.startsWith('PROVIDER_DISABLED:')) {
          const parts = e.message.split(':');
          const category = parts[1];
          const reason = parts[2];
          console.log(`  ⚠️ [HR-Bot] Cannot hire "${memberPlan.templateTitle}": ${reason}`);
          console.log(`     Hint: Please configure API Key for ${category} type providers first`);
          skipped.push({ ...memberPlan, reason });
          employees.push(null);
        } else {
          throw e;
        }
      }
    }

    const validEmployees = employees.filter(Boolean);

    for (let i = 0; i < plan.members.length; i++) {
      if (!employees[i]) continue;
      const memberPlan = plan.members[i];
      if (memberPlan.reportsTo !== null && employees[memberPlan.reportsTo]) {
        employees[i].setManager(employees[memberPlan.reportsTo]);
      }
    }

    if (skipped.length > 0) {
      console.log(`\n⚠️ [HR] ${skipped.length} positions skipped due to unconfigured providers:`);
      skipped.forEach(s => console.log(`   - ${s.templateTitle}: ${s.reason}`));
    }

    console.log(`\n✅ [HR] Recruitment complete! Successfully hired ${validEmployees.length}, skipped ${skipped.length}`);
    return validEmployees;
  }
}

/**
 * Secretary — A specialized Employee.
 * Extends Employee with team design, recruitment coordination,
 * boss message handling, and direct task execution abilities.
 */
export class Secretary extends Employee {
  constructor({ company, providerConfig, secretaryName, secretaryAvatar, secretaryGender, secretaryAge }) {
    super({
      name: secretaryName || 'Secretary',
      role: 'Personal Secretary',
      prompt: `You are the boss's personal secretary, the core hub for company operations management.

## Your Core Capabilities:
1. **Organizational Management**: Create new departments, dissolve departments, adjust organizational structure
2. **Human Resources**: Coordinate HR recruitment, adjust staffing, transfer employees between departments, design team composition
3. **Task Management**: Understand boss requirements, assign tasks to appropriate departments, track and report progress
4. **Business Analysis**: Analyze business requirements, plan team size and role types based on project needs
5. **Team Design**: Design organizational structure (who does what, who reports to whom, how to collaborate), ensure teams can efficiently achieve goals

You have a dedicated HR assistant to help you handle specific recruitment tasks, including searching and recalling talent from the talent market.

When communicating with the boss, you need to:
1. Understand the boss's intent (create department, assign task, adjust staffing, progress inquiry, or casual conversation)
2. For department creation requests: design the team structure and initiate recruitment
3. For task requests: assign to the corresponding department or handle simple ones yourself
4. For staffing adjustments: coordinate HR to execute personnel changes
5. Periodically report department progress to the boss`,
      skills: ['requirements-analysis', 'team-planning', 'org-design', 'hr-coordination', 'project-management', 'task-assignment', 'progress-reporting'],
      provider: providerConfig,
      avatar: secretaryAvatar,
      gender: secretaryGender || 'female',
      age: secretaryAge || 18,
    });

    this.company = company;

    // Initialize dedicated HR assistant
    this.hrAssistant = new HRAssistant({
      secretary: this,
      providerConfig,
    });

    console.log(`  🧑‍💼 Secretary's dedicated HR assistant is ready: ${this.hrAssistant.employee.name}`);
  }

  // ======================== Boss Message Handling ========================

  async handleBossMessage(message, company) {
    if (!this.canChat()) {
      if (this.agentType === 'cli') {
        throw new Error('Secretary is in CLI mode. Please use chatWithSecretary() which handles CLI path correctly.');
      }
      throw new Error('Secretary AI is not configured. Please configure a valid API Key for the secretary provider first.');
    }

    // Session initialization follows lazy-loading principle:
    // For web agents: _ensureSession() is called inside this.chat() to manage browser sessions.
    // For LLM/CLI agents: session management is skipped (stateless API, prompt is self-contained).
    return await this._llmHandleBossMessage(message, company);
  }

  async _llmHandleBossMessage(message, company) {
    const { messages, secretaryChatGroupId } = this._buildBossMessageContext(message, company);
    const response = await this.chat(messages, { temperature: 0.8, maxTokens: 2048 });
    return this._parseSecretaryResponse(response.content, message, company, secretaryChatGroupId);
  }

  // ======================== Boss Message Handling (Streaming) ========================

  /**
   * Streaming version of handleBossMessage.
   * Yields SSE-compatible chunks as the LLM generates tokens.
   * The "content" field is extracted incrementally from the JSON output.
   *
   * @param {string} message - Boss message
   * @param {object} company - Company instance
   * @yields {{ event: string, data: object }}
   *   - { event: 'thinking', data: { content } }      — reasoning/chain-of-thought token
   *   - { event: 'delta',    data: { content } }      — incremental content text
   *   - { event: 'done',     data: { reply } }        — final parsed reply (same as non-streaming)
   *   - { event: 'error',    data: { message } }      — error occurred
   */
  async *handleBossMessageStream(message, company) {
    if (!this.canChat()) {
      yield { event: 'error', data: { message: 'Secretary AI is not configured.' } };
      return;
    }

    // Build the same messages as _llmHandleBossMessage
    const { messages, secretaryChatGroupId } = this._buildBossMessageContext(message, company);

    let fullContent = '';
    // Track whether we're inside the "content" JSON field for incremental extraction
    let contentExtractor = new JSONContentExtractor();

    try {
      // Yield thinking/delta chunks as they arrive
      for await (const chunk of this.chatStream(messages, { temperature: 0.8, maxTokens: 2048 })) {
        if (chunk.type === 'thinking') {
          yield { event: 'thinking', data: { content: chunk.content } };
        } else if (chunk.type === 'delta') {
          fullContent += chunk.content;
          // Try to extract "content" field text incrementally
          const extracted = contentExtractor.feed(chunk.content);
          if (extracted) {
            yield { event: 'delta', data: { content: extracted } };
          }
        } else if (chunk.type === 'done') {
          // Stream finished — parse the complete JSON and do post-processing
          fullContent = chunk.content || fullContent;
        }
      }

      // Post-process: parse JSON, handle memory/relationship ops, fix dept IDs
      const reply = this._parseSecretaryResponse(fullContent, message, company, secretaryChatGroupId);
      yield { event: 'done', data: { reply } };
    } catch (err) {
      console.error(`❌ [Secretary] Stream error:`, err.message);
      // If we got partial content, try to salvage it
      if (fullContent.length > 0) {
        try {
          const reply = this._parseSecretaryResponse(fullContent, message, company, secretaryChatGroupId);
          yield { event: 'done', data: { reply } };
          return;
        } catch {}
      }
      yield { event: 'error', data: { message: err.message } };
    }
  }

  /**
   * Build the message context for boss message handling.
   * Extracted from _llmHandleBossMessage so it can be shared with the streaming variant.
   */
  _buildBossMessageContext(message, company) {
    this.memory.consolidateMemories();

    const deptCount = company.departments.size;
    const departments = [...company.departments.values()].map(d => ({
      name: d.name, id: d.id, mission: d.mission, status: d.status,
      memberCount: d.agents.size,
      leader: d.getLeader()?.name || 'Unassigned',
      members: [...d.agents.values()].map(a => ({
        name: a.name, role: a.role, status: a.status,
      })),
    }));
    const agentCount = departments.reduce((s, d) => s + d.memberCount, 0);
    const talentCount = company.talentMarket.listAvailable().length;

    // Wrap non-boss messages back into JSON so the LLM sees consistent JSON
    // output across conversation turns and doesn't drift into plain text.
    const _wrapHistoryContent = (h) => {
      if (h.role === 'boss') return h.content;
      // If the stored content already looks like JSON, use as-is
      const trimmed = (h.content || '').trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
      // Wrap plain-text secretary reply back into minimal JSON envelope
      return JSON.stringify({ content: h.content, action: h.action || null });
    };

    let recentHistory = [];
    try {
      const recentMessages = chatStore.getRecentMessages(company.chatSessionId, 10);
      recentHistory = recentMessages.map(h => ({
        role: h.role === 'boss' ? 'user' : 'assistant',
        content: _wrapHistoryContent(h),
      }));
    } catch (e) {
      recentHistory = (company.chatHistory || []).slice(-10).map(h => ({
        role: h.role === 'boss' ? 'user' : 'assistant',
        content: _wrapHistoryContent(h),
      }));
    }

    let searchContextSection = '';
    try {
      const searchResults = chatStore.searchWithContext(company.chatSessionId, message, 3, 1);
      if (searchResults.length > 0) {
        searchContextSection = '\n## Related Historical Context (from past conversations)\n';
        for (const result of searchResults) {
          const contextStr = result.context.map(m =>
            `  [${m.role}] ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}`
          ).join('\n');
          searchContextSection += `- Relevance: ${result.score.toFixed(2)}\n${contextStr}\n\n`;
        }
      }
    } catch (e) {}

    const secretaryPrompt = this.prompt || '';
    const availableRoles = Object.values(JobTemplates).map(t => ({
      id: t.id, title: t.title, category: t.category,
    }));
    const enabledProviders = company.providerRegistry.listEnabled().map(p => ({
      id: p.id, name: p.name, category: p.category,
      isCLI: p.isCLI || false, cliBackendId: p.cliBackendId || null,
    }));
    const availableCategories = [...new Set(enabledProviders.map(p => p.category))];

    let capabilitiesSection = '';
    try {
      const kbs = knowledgeManager.list();
      if (kbs.length > 0) {
        capabilitiesSection += `\n## Knowledge Bases (${kbs.length})\n`;
        kbs.forEach(kb => { capabilitiesSection += `- 📚 ${kb.name}: ${kb.description} (${kb.entryCount || 0} entries)\n`; });
      }
    } catch {}

    const secretaryChatGroupId = `secretary-boss-chat`;
    const memorySection = this.memory.buildMemoryContext(secretaryChatGroupId);

    // Reuse the exact same system prompt from _llmHandleBossMessage
    // (extracted here to avoid duplication, but keeping it inline for now due to template literals)
    const systemPrompt = this._buildSecretarySystemPrompt({
      company, secretaryPrompt, memorySection, searchContextSection,
      deptCount, departments, agentCount, talentCount,
      availableRoles, availableCategories, capabilitiesSection,
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: message },
    ];

    return { messages, secretaryChatGroupId };
  }

  /**
   * Parse the full secretary JSON response, process memory/relationship ops, fix dept IDs.
   * Shared by both streaming and non-streaming paths.
   */
  _parseSecretaryResponse(rawContent, message, company, secretaryChatGroupId) {
    try {
      const parsed = robustJSONParse(rawContent);
      let result = { content: parsed.content || rawContent, action: parsed.action || null };

      console.log(`🤖 [Secretary-LLM] action type: ${result.action?.type || 'null'}, departmentId: ${result.action?.departmentId || 'N/A'}`);

      if (parsed.memorySummary) {
        this.memory.updateHistorySummary(secretaryChatGroupId, parsed.memorySummary);
        console.log(`  📜 [Secretary] History summary updated`);
      }
      if (parsed.memoryOps && Array.isArray(parsed.memoryOps)) {
        const memResult = this.memory.processMemoryOps(parsed.memoryOps);
        if (memResult.added + memResult.updated + memResult.deleted > 0) {
          console.log(`  🧠 [Secretary] Memory: +${memResult.added} ~${memResult.updated} -${memResult.deleted}`);
        }
      }
      if (parsed.relationshipOps && Array.isArray(parsed.relationshipOps)) {
        const relResult = this.memory.processRelationshipOps(parsed.relationshipOps);
        if (relResult.updated > 0) {
          console.log(`  👥 [Secretary] Relationship updates: ${relResult.updated}`);
        }
      }

      // Fix department ID inconsistencies
      this._fixDepartmentId(result, company);
      return result;
    } catch (parseError) {
      console.warn('⚠️ Secretary JSON parse failed:', parseError.message, '\nRaw reply:', rawContent.slice(0, 200));
      return this._faultTolerantParse(rawContent, message, company, secretaryChatGroupId);
    }
  }

  /**
   * Fix department ID issues in the parsed result.
   */
  _fixDepartmentId(result, company) {
    if (result.action?.type === 'task_assigned' && result.action.departmentId) {
      const deptById = company.departments.get(result.action.departmentId);
      if (!deptById) {
        const deptIdValue = result.action.departmentId;
        const deptNameValue = result.action.departmentName || deptIdValue;
        let foundDept = null;
        for (const dept of company.departments.values()) {
          if (dept.name === deptIdValue || dept.name === deptNameValue ||
              dept.name.includes(deptIdValue) || deptIdValue.includes(dept.name)) {
            foundDept = dept; break;
          }
        }
        if (foundDept) {
          console.log(`🔧 Fixed departmentId: "${deptIdValue}" → "${foundDept.id}" (${foundDept.name})`);
          result.action.departmentId = foundDept.id;
          result.action.departmentName = foundDept.name;
        } else {
          console.warn(`⚠️ LLM returned departmentId "${deptIdValue}" doesn't match any department, clearing action`);
          result.action = null;
        }
      } else {
        const contentLower = (result.content || '').toLowerCase();
        const actionDeptName = deptById.name.toLowerCase();
        let contentMentionedDept = null;
        for (const dept of company.departments.values()) {
          if (dept.id !== deptById.id && contentLower.includes(dept.name.toLowerCase())) {
            contentMentionedDept = dept; break;
          }
        }
        if (contentMentionedDept && !contentLower.includes(actionDeptName)) {
          console.log(`🔧 Consistency fix: content mentions "${contentMentionedDept.name}" but action points to "${deptById.name}", using content as source of truth`);
          result.action.departmentId = contentMentionedDept.id;
          result.action.departmentName = contentMentionedDept.name;
        }
      }
    }
  }

  /**
   * Fault-tolerant parse for malformed JSON responses.
   */
  _faultTolerantParse(rawContent, message, company, secretaryChatGroupId) {
    let displayContent = rawContent;
    const contentFieldMatch = rawContent.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (contentFieldMatch) {
      try { displayContent = JSON.parse('"' + contentFieldMatch[1] + '"'); }
      catch { displayContent = contentFieldMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
    }

    let action = null;
    const actionTypeMatch = rawContent.match(/"type"\s*:\s*"(task_assigned|need_new_department|create_department|progress_report|secretary_handle)"/);
    if (actionTypeMatch) {
      const actionType = actionTypeMatch[1];
      if (actionType === 'task_assigned') {
        const deptNameMatch = rawContent.match(/"departmentName"\s*:\s*"([^"]+)"/);
        if (deptNameMatch) {
          const targetName = deptNameMatch[1];
          for (const dept of company.departments.values()) {
            if (dept.name === targetName || dept.name.includes(targetName) || targetName.includes(dept.name)) {
              const titleMatch = rawContent.match(/"taskTitle"\s*:\s*"([^"]+)"/);
              const descMatch = rawContent.match(/"taskDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
              action = {
                type: 'task_assigned', departmentId: dept.id, departmentName: dept.name,
                taskTitle: titleMatch ? titleMatch[1] : message.slice(0, 50),
                taskDescription: descMatch ? descMatch[1].replace(/\\n/g, '\n') : message,
              }; break;
            }
          }
        }
      } else if (actionType === 'create_department') {
        const deptNameMatch = rawContent.match(/"departmentName"\s*:\s*"([^"]+)"/);
        const missionMatch = rawContent.match(/"mission"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        action = {
          type: 'create_department',
          departmentName: deptNameMatch ? deptNameMatch[1] : '',
          mission: missionMatch ? missionMatch[1].replace(/\\n/g, '\n') : message,
        };
      } else if (actionType === 'need_new_department') {
        const missionMatch = rawContent.match(/"suggestedMission"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        action = { type: 'need_new_department', suggestedMission: missionMatch ? missionMatch[1].replace(/\\n/g, '\n') : message };
      } else if (actionType === 'secretary_handle') {
        const descMatch = rawContent.match(/"taskDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        action = { type: 'secretary_handle', taskDescription: descMatch ? descMatch[1].replace(/\\n/g, '\n') : message };
      } else if (actionType === 'progress_report') {
        action = { type: 'progress_report' };
      }
    }

    // Safety net: if the LLM returned plain text that looks like a task
    // acknowledgement but no action was extracted, auto-degrade to secretary_handle
    // so the task actually gets executed instead of producing an empty response.
    if (!action && message) {
      const lower = (displayContent || '').toLowerCase();
      const isAcknowledgement = /\b(let me|i'll|i will|one moment|checking|looking|right away|handle it|on it)\b/i.test(lower);
      const isQuestion = /[?？]/.test(message);
      const hasActionVerb = /[\u5e2e\u6211\u67e5\u770b\u5206\u6790\u5199\u505a\u641c\u7d22\u627e]|help|check|look up|write|analyze|search|find|build|create|run|execute|what|how|tell me|show me/i.test(message);
      if (isAcknowledgement || isQuestion || hasActionVerb) {
        console.log(`  🔄 [Secretary-FaultTolerant] No action found in malformed response, auto-degrading to secretary_handle`);
        action = { type: 'secretary_handle', taskDescription: message };
      }
    }

    let result = { content: displayContent, action };
    console.log(`🤖 [Secretary-LLM-FaultTolerant] action type: ${result.action?.type || 'null'}`);

    // Try to extract memory ops from malformed JSON
    try {
      const summaryMatch = rawContent.match(/"memorySummary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (summaryMatch) {
        this.memory.updateHistorySummary(secretaryChatGroupId, summaryMatch[1].replace(/\\n/g, '\n'));
      }
      const memOpsMatch = rawContent.match(/"memoryOps"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])/);
      if (memOpsMatch) {
        const ops = JSON.parse(memOpsMatch[1]);
        if (Array.isArray(ops)) {
          this.memory.processMemoryOps(ops);
        }
      }
    } catch {}

    return result;
  }

  /**
   * Build the secretary system prompt.
   * Extracted to be shared by streaming and non-streaming paths.
   */
  _buildSecretarySystemPrompt({ company, secretaryPrompt, memorySection, searchContextSection,
    deptCount, departments, agentCount, talentCount,
    availableRoles, availableCategories, capabilitiesSection }) {
    return `You are "${this.name}", the personal secretary of ${company.bossName || 'the Boss'}.
${secretaryPrompt ? `\nYour core persona: ${secretaryPrompt}\n` : ''}
Your personality: smart, efficient, approachable. Communicate with the boss like a real, thoughtful secretary — natural, warm, not robotic.
${memorySection}
${searchContextSection}
Current company "${company.name}" status:
- Departments: ${deptCount}
- Active employees: ${agentCount}
- Talent market: ${talentCount} available
${departments.length > 0 ? `\nDepartment details:\n${departments.map(d => `  🏢 ${d.name} [${d.status}] - Mission: ${d.mission} | ${d.memberCount} people | Leader: ${d.leader}\n     Members: ${d.members.map(m => m.name + '(' + m.role + ')').join(', ')}`).join('\n')}` : '\nNo departments yet.'}
${capabilitiesSection}

You must understand the boss's intent and reply naturally. Your reply MUST be a JSON object (return JSON only, nothing else):
{
  "content": "Your natural language reply (like a real secretary — warm, personal, no rigid templates)",
  "memorySummary": "A concise summary of older conversation messages — keep key facts, decisions, instructions, names. null if conversation just started or no old messages to summarize.",
  "memoryOps": [
    { "op": "add", "type": "long_term", "content": "Boss prefers weekly reports on Monday", "category": "preference", "importance": 8 },
    { "op": "add", "type": "short_term", "content": "Boss asked about Q3 revenue data", "category": "task", "importance": 5, "ttl": 3600 },
    { "op": "update", "id": "existing_mem_id", "content": "Updated content", "importance": 7 },
    { "op": "delete", "id": "outdated_mem_id" }
  ]
  Memory management rules:
    - memoryOps: Array of memory operations to manage your knowledge base
    - "add" + "long_term": Important facts, boss preferences, standing instructions, key decisions (stays forever)
    - "add" + "short_term": Current task context, temporary info (auto-expires, ttl in seconds, default 24h)
    - "update": Modify an existing memory by id when info changes
    - "delete": Remove outdated or incorrect memories by id
    - category: preference | fact | instruction | task | context | relationship | experience | decision
    - importance: 1-10 (higher = more important, less likely to be forgotten)
    - Only add memory when the boss tells you something worth remembering. Do NOT memorize casual greetings.
    - If nothing to add/update/delete, set memoryOps to [].
  "relationshipOps": [
    { "employeeId": "boss", "name": "Boss", "impression": "Decisive, prefers concise updates", "affinity": 70 }
  ]
  Relationship impression rules:
    - relationshipOps: Update your personal impression of the boss or other people mentioned in conversation. Max 200 chars. affinity: 1-100 (50=neutral).
    - affinity should change gradually (+/- 5~15 per interaction). Start from 50 if first meeting.
    - Only update when something noteworthy happened. [] if nothing to update.
  "action": null or one of the following:
    - { "type": "secretary_handle", "taskDescription": "detailed task description for yourself to execute" } - when you can handle this task yourself without needing a department (see rules below)
    - { "type": "task_assigned", "departmentId": "dept ID", "departmentName": "dept name", "taskTitle": "short task title (under 10 words)", "taskDescription": "detailed task description including what to do and what to deliver" } - when the boss wants to assign a task to an existing department
    - { "type": "create_department", "departmentName": "department name", "mission": "department mission/responsibilities", "members": [ { "templateId": "job template id", "name": "creative employee nickname", "isLeader": true/false, "reportsTo": null or member index (0=first member) } ] } - when the boss explicitly requests creating a new department — you MUST design the team directly
    - { "type": "need_new_department", "suggestedMission": "task description" } - when the boss wants to assign a task but no existing department can handle it (need to create dept first then assign)
    - { "type": "progress_report" } - when the boss wants to see progress reports
    - null - casual chat or no special action needed
}

## Intent Rules (by priority, high to low):

**Highest Priority - Organizational Management**:
When the boss says "create/establish/set up/found + department", this is an org management operation. **MUST** return create_department, **NEVER** return task_assigned.
  - Even if the message contains words like "help me", as long as the core intent is "create/establish a department", return create_department
  - departmentName: intelligently name the department based on boss's description
  - mission: summarize department mission and responsibilities from boss's description
  - members: you MUST design the team directly! Plan 2-6 members based on the mission. Rules:
    * Available job templates (you can ONLY choose from these): ${JSON.stringify(availableRoles)}
    * Currently enabled provider categories: ${availableCategories.join(', ')}
    * You can ONLY use templates whose category has an enabled provider (enabled categories above)
    * The first member MUST be project-leader with isLeader=true
    * Other members' reportsTo = 0 (index of leader)
    * If CLI providers are available and the task is coding-related, prefer cli-* templates
    * Employee names should be creative and fun

**High Priority - Secretary Handles Simple Tasks Directly**:
For simple, straightforward tasks that DON'T require a specialized team, you should handle them yourself using secretary_handle. Examples:
  - Writing/drafting: emails, short messages, announcements, summaries, translations
  - Quick analysis: simple comparisons, brief research, quick calculations
  - Information tasks: looking up info, explaining concepts, answering questions with your knowledge
  - Planning/organizing: making a schedule, creating a checklist, brainstorming ideas
  - Creative writing: slogans, naming suggestions, short copy, social media posts
  - Any task that a competent secretary could do alone in a few minutes using only their own knowledge
**Tasks you CANNOT handle yourself** (do NOT use secretary_handle for these):
  - Anything requiring deep domain expertise that needs a specialized department team
  - Large-scale projects that need ongoing team collaboration
Note: You DO have access to tools (shell commands, file operations, etc.) when executing tasks, so you CAN:
  - Look up real-time info via shell commands (curl, etc.)
  - Run code and scripts
  - Read/write files
When returning secretary_handle:
  - taskDescription should be a clear, detailed description of what you need to do
  - In "content", ONLY give a brief acknowledgement like "Let me check!" or "One moment, I'll handle it right away! 📝"
  - **ABSOLUTELY DO NOT** attempt to answer the question or provide any result in "content" — the actual answer will come from executeTaskDirectly using tools
  - **NEVER** include placeholders like [current date], [loading...] in "content" — just acknowledge and let the execution phase do the real work
  - Example: Boss asks "What's today's date?" → content: "Let me check for you~ 📝", action: secretary_handle with taskDescription: "Query the current date and inform the boss"

**Medium Priority - Assign Task to Existing Department (check departments first!)**:
When the boss wants something done that requires specialized team work, you MUST first check ALL existing departments listed above to see if any can handle it.
Matching criteria (any one is sufficient to assign):
  1. Department name contains task-related keywords (e.g. task is "travel guide", dept named "Travel Guide Dept" → match)
  2. Department mission/description relates to task content (e.g. dept mission mentions "travel"/"guide", task is also travel-related → match)
  3. Department name's core words are semantically related to the task (e.g. "Financial Analysis Dept" can handle "stock analysis" tasks)
Once a matching department is found, you **MUST** return task_assigned, **ABSOLUTELY CANNOT** return need_new_department!
  - departmentId MUST be the real id field from the department info above, don't fabricate
  - departmentName MUST exactly match the name corresponding to the id
  - taskDescription should detail the task content, goals, and deliverables
  - **The department name mentioned in content MUST match the departmentName in action — you can't say "assigning to Dept A" in content but point action to Dept B**

**Low Priority - Need New Department (rarely used!)**:
**ONLY when you've checked every existing department and confirmed none has even the slightest relation to the task** can you return need_new_department.
⚠️ Before returning need_new_department, triple-check:
  - Have you checked every existing department?
  - Is there really no department whose name contains task-related words?
  - Is there really no department whose mission relates to the task?
If in any doubt, assign to the closest department (task_assigned) rather than returning need_new_department

**Lowest Priority - View Progress**:
When the boss asks about progress/status/reports, return progress_report

**No Action**: casual chat, greetings, etc. — set action to null

## Notes:
1. Content should be natural and personal, avoid rigid templates, feel free to add emoji
2. Keep replies concise, don't be verbose
3. **Critical**: When the boss's message contains action verbs (like "help me", "build", "develop", "design", "do", "write", "analyze", "research", "create", "produce", "plan", etc.), you **MUST** return an action. **ABSOLUTELY NEVER** just say "I'll arrange it" in content without returning an action. This is the most important rule — without an action, the task won't actually execute!
4. **Critical**: Carefully distinguish "creating a department" from "assigning a task" — "help me set up an XX department" is create_department, while "help me write an analysis report" is task assignment (task_assigned/need_new_department)
5. **Critical**: When the boss says "do XX", "help me XX" and other clear task directives, return task_assigned if there's a suitable existing department, otherwise return need_new_department. Never just chat without working!
6. **Critical - Consistency Principle**: Your content and action MUST be consistent! If content says "assigning to XX department", then action's departmentId/departmentName must point to that same department. If content mentions one department but action is need_new_department, that's a serious error!
7. **Critical - Structured Output**: You MUST always return valid JSON. Do NOT wrap it in markdown code fences. Do NOT add any text outside the JSON object. The response must start with { and end with }.
8. **Critical - Action Required for Tasks**: If the boss's message expresses ANY intent to get work done (in any language), you MUST return an action. Analyze the semantic meaning, not just keywords. For example: "help me build a website", "write a report", "analyze the data" — ALL of these require an action, regardless of what language they are expressed in.
9. **Critical - Language Agnostic**: The boss may speak in any language (Chinese, English, Japanese, etc.). You must understand the intent regardless of language and return the correct structured action.
10. **Critical - Response Language**: You MUST write ALL your "content" text in ${getAppLanguageName()}. The boss expects replies in ${getAppLanguageName()}.`;
  }

  // ======================== Direct Task Execution ========================

  async executeTaskDirectly(taskDescription, company) {
    console.log(`\n📝 [Secretary] Handling task directly: "${taskDescription.slice(0, 50)}..."`);

    const secretaryPrompt = this.prompt || '';

    const memoryContext = this.memory.buildMemoryContext('secretary-task-exec');

    const systemPrompt = `You are "${this.name}", the personal secretary of ${company.bossName || 'the Boss'}.
${secretaryPrompt ? `\nYour persona: ${secretaryPrompt}\n` : ''}
You are now personally handling a task from the boss. Complete it thoroughly and deliver a high-quality result.
${memoryContext}
## Your Capabilities:
- You have access to tools: shell_exec (run shell commands like curl, date, node, python, etc.), file_read, file_write, file_list, file_delete
- You CAN access the internet via shell commands (e.g., curl for APIs, web requests)
- You CAN run code and scripts to get real-time data
- You CAN get the current date/time by running: shell_exec({ command: "date" })
- You CAN fetch weather by running: shell_exec({ command: "curl -s wttr.in/CityName?format=3" })

## CRITICAL RULES (MUST follow):
- **ALWAYS use tools first** before answering questions about real-time or factual data (date, time, weather, calculations, etc.)
- You do NOT know the current date or time — you MUST call shell_exec with "date" to find out
- You do NOT know real-time information — you MUST call shell_exec with appropriate commands to fetch it
- NEVER guess, assume, or use placeholders like [current date], [loading...], [TBD]
- If you're unsure about any factual information, USE A TOOL to verify it
- If a tool call fails, try alternative approaches before giving up

## Guidelines:
1. Deliver a complete, ready-to-use result (not just a plan or outline)
2. Be thorough but concise — quality over quantity
3. You MUST write your response in ${getAppLanguageName()}
4. Format the output nicely with markdown if appropriate
5. If the task involves writing, produce the actual writing (not meta-commentary about it)
6. Sign off naturally as a secretary would`;

    try {
      if (this.agentType === 'cli' && this.isAvailable()) {
        try {
          console.log(`  🖥️ [Secretary] Executing task via CLI backend: ${this.cliBackend}`);
          const cliResult = await cliBackendRegistry.executeTask(
            this.cliBackend, this,
            { title: `Secretary task`, description: `${systemPrompt}\n\nTask from the boss:\n${taskDescription}` },
            this.toolKit?.workspaceDir || process.cwd(), {}, { timeout: 120000 }
          );
          const content = cliResult.output || cliResult.errorOutput || '...';
          console.log(`✅ [Secretary] CLI task completed, output ${content.length} chars`);
          return { content, success: true };
        } catch (cliErr) {
          if (!this.canChat()) {
            console.error(`  ❌ [Secretary] CLI task failed, no LLM fallback: ${cliErr.message || cliErr.error}`);
            return { content: `⚠️ CLI task execution error: ${cliErr.message || 'Unknown error'}. Please check that the CLI is running correctly.`, success: false };
          }
          console.warn(`  ⚠️ [Secretary] CLI task failed, falling back to LLM: ${cliErr.message || cliErr.error}`);
        }
      }

      const toolExecutor = this.toolKit;
      let response;

      if (toolExecutor) {
        response = await this.chatWithTools(
          [{ role: 'system', content: systemPrompt }, { role: 'user', content: taskDescription }],
          toolExecutor, { temperature: 0.7, maxTokens: 2048, maxIterations: 5, newConversation: true }
        );
      } else {
        response = await this.chat(
          [{ role: 'system', content: systemPrompt }, { role: 'user', content: taskDescription }],
          { temperature: 0.7, maxTokens: 2048, newConversation: true }
        );
      }

      console.log(`✅ [Secretary] Task completed, output ${response.content.length} chars`);
      return { content: response.content, success: true };
    } catch (err) {
      console.error(`❌ [Secretary] Task execution failed:`, err.message);
      return { content: `Sorry, encountered an issue while executing the task: ${err.message}`, success: false };
    }
  }
}
