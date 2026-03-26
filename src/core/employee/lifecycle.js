/**
 * Employee Lifecycle Manager
 *
 * Owns all per-employee behaviour that was previously scattered across
 * GroupChatLoop:
 *
 *  - Random-interval poll cycle (read group messages)
 *  - Inner monologue / flow-state (InnerMonologue)
 *  - "Should I speak?" decision (LLM call + fallback)
 *  - Anti-spam / rate-limiting
 *  - Self-check for stuck workflow nodes
 *  - Idle-chat topic initiation
 *  - Prompt building for dept-chat & work-chat
 *  - Agent memory (monologue summaries across rounds)
 *
 * The lifecycle is attached to a single Employee and receives a reference
 * to the GroupChatLoop (the thin global coordinator) for event emission,
 * company resolution, and cross-agent nudging.
 */

import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { existsSync } from 'fs';
import {
  PROMPT,
  getFewShotExamples,
  getFallbackReplies,
} from '../prompts.js';
import { robustJSONParse } from '../utils/json-parse.js';
import { chatStore } from '../agent/chat-store.js';

// ─── File reference expansion ──────────────────────────────────────────
// Agent writes [[file:path/to/file]], we expand to [[file:deptId:path|displayName]]
const SIMPLE_FILE_REF = /\[\[file:([^\]|:]+)\]\]/g;
const INCOMPLETE_FILE_REF = /\[\[file:([^:]+):([^\]|]+)\]\]/g;

/**
 * Expand short-form file references into full format for the frontend.
 * [[file:src/index.js]] → [[file:dept123:src/index.js|index.js]]
 * [[file:dept123:src/index.js]] → [[file:dept123:src/index.js|index.js]]
 * Only creates clickable references for files that actually exist on disk.
 * Returns { content, invalidRefs } so caller can provide feedback for bad references.
 */
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

// ─── Default Config ────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  pollIntervalMinMs: 10000,        // 10 s
  pollIntervalMaxMs: 300000,       // 5 min
  idleChatThresholdMs: 3600000,    // 1 h
  maxInnerMonologueLen: 5,
  maxGroupMessagesPerTurn: 1,
  debounceMs: 3000,
  antiSpamWindowMs: 300000,        // 5 min
  antiSpamMaxMessages: 2,
  cooldownAfterSpeakMs: 60000,     // 60 s
  selfCheckIntervalMs: 120000,     // 120 s
  stuckThresholdMs: 180000,        // 3 min
  // Department casual chat — relaxed
  deptAntiSpamWindowMs: 600000,
  deptAntiSpamMaxMessages: 4,
  deptCooldownAfterSpeakMs: 30000,
  deptIdleChatThresholdMs: 600000,
  topicSaturationThreshold: 7,
};

// ─── InnerMonologue (flow state) ───────────────────────────────────────
export class InnerMonologue {
  constructor(agentId, agentName, groupId) {
    this.id = uuidv4();
    this.agentId = agentId;
    this.agentName = agentName;
    this.groupId = groupId;
    this.thoughts = [];
    this.startedAt = new Date();
    this.status = 'thinking'; // thinking | decided | done
    this.decision = null;
  }

  addThought(content) {
    this.thoughts.push({ id: uuidv4(), content, timestamp: new Date() });
  }

  toJSON() {
    return {
      id: this.id,
      agentId: this.agentId,
      agentName: this.agentName,
      groupId: this.groupId,
      thoughts: this.thoughts,
      startedAt: this.startedAt,
      status: this.status,
      decision: this.decision,
    };
  }
}

// ─── EmployeeLifecycle ─────────────────────────────────────────────────
export class EmployeeLifecycle {
  /**
   * @param {import('./base-employee.js').Employee} employee
   * @param {object} [config]  Override individual config keys
   */
  constructor(employee, config = {}) {
    this.employee = employee;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Per-group state  key = groupId
    this._lastReadIndex = new Map();       // groupId → number
    this._lastProcessedVisible = new Map(); // groupId → number
    this._recentSpeaks = new Map();        // groupId → Date[]
    this._lastSelfCheck = new Map();       // groupId → Date
    this._agentMemory = new Map();         // groupId → string[]
    this._activeMonologues = new Map();    // groupId → InnerMonologue
    this._monologueHistory = new Map();    // groupId → InnerMonologue[]
    this._lastGroupActivity = new Map();   // groupId → Date

    // Processing guards
    this._processing = new Set();          // groupId

    // Poll timer (single timer for the employee)
    this._pollTimer = null;

    // Adaptive poll delay — set by AI's interest/saturation output, consumed by _scheduleNext
    this._nextPollDelay = null;            // ms or null (null = use default random)

    // Back-reference to global coordinator (set externally)
    this._coordinator = null;

    // DM state — self-driven polling (same as group chat)
    this._dmLastReadIndex = new Map();     // sessionId → number (last read message count)
    this._dmProcessing = new Set();        // sessionId (guard against concurrent processing)
  }

  // ──────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────

  /** Attach the global coordinator (GroupChatLoop) so we can emit events & nudge peers. */
  setCoordinator(coordinator) {
    this._coordinator = coordinator;
  }

  /** Start the random-interval poll loop for this employee. */
  start(silent = false) {
    if (this._pollTimer) return; // already running
    this._scheduleNext();
    if (!silent) {
      console.log(`  🔄 [Lifecycle] ${this.employee.name} started (${this.config.pollIntervalMinMs}-${this.config.pollIntervalMaxMs}ms)`);
    }
  }

  /** Stop polling. */
  stop() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    this._processing.clear();
    this._recentSpeaks.clear();
    this._lastSelfCheck.clear();
    this._lastProcessedVisible.clear();
    // Clear DM processing guard (read indices persist across stop/start)
    this._dmProcessing.clear();
    // NOTE: _agentMemory is NOT cleared — memories persist across stop/start
  }

  /** Trigger a delayed check for a specific group (e.g. when someone @mentions this employee). */
  async triggerCheck(groupId) {
    const delay = this._randomDelay();
    console.log(`  📨 [Lifecycle] ${this.employee.name} will check ${groupId} in ${Math.round(delay / 1000)}s`);
    setTimeout(async () => {
      try {
        if (!this._isRunning()) return;
        await this._processGroupMessages(groupId, false);
      } catch (err) {
        console.error(`  ❌ [Lifecycle] ${this.employee.name} delayed trigger error:`, err.message);
      }
    }, delay);
  }

  // ──────────────────────────────────────────────────────────────────────
  // DM (Direct Message) — Self-driven polling (same rhythm as group chat)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Process a DM conversation with another agent.
   * Self-driven: called from _pollCycle when unread messages are detected.
   * Uses the same flow-of-thought (shouldSpeak / interest / saturation) as group chat.
   *
   * @param {string} sessionId - The chatStore session ID (agent-agent-xxx-yyy)
   * @param {Array} unreadMessages - Unread messages in this DM session
   * @param {string} otherAgentId - The other agent's ID
   */
  async _processDM(sessionId, unreadMessages, otherAgentId) {
    const agent = this.employee;
    if (this._dmProcessing.has(sessionId)) return;
    this._dmProcessing.add(sessionId);

    try {
      const company = this._getCompany();
      if (!company) return;

      const otherAgent = company.findAgentById(otherAgentId);
      const otherName = otherAgent?.name || otherAgentId;
      const otherRole = otherAgent?.role || 'Unknown';
      const dmGroupId = `dm-${[agent.id, otherAgentId].sort().join('-')}`;

      // Get full recent messages for context
      const recentMessages = chatStore.getRecentMessages(sessionId, 20);
      if (recentMessages.length === 0) return;

      // Build memory context
      const memoryContext = agent.memory.buildMemoryContext(dmGroupId);
      const historySummaryContext = agent.memory.buildHistorySummaryContext(dmGroupId);

      // Build the DM system prompt
      const systemPrompt = agent._buildSystemMessage()
        + `\n\n## Current Conversation\n`
        + `You are having a private 1-on-1 DM conversation with ${otherName} (${otherRole}).\n`
        + `Respond naturally based on your personality and role.\n`
        + memoryContext
        + agent._buildGroupChatResponseFormat({ scenario: 'dm' });

      // Format chat history — distinguish read vs unread
      const totalCount = recentMessages.length;
      const unreadCount = unreadMessages.length;
      const readCount = totalCount - unreadCount;

      const formattedHistory = recentMessages.map((msg, idx) => {
        const isMe = msg.fromAgentId === agent.id;
        const isRead = idx < readCount;
        const senderName = msg.fromAgentName || (isMe ? agent.name : otherName);
        const time = new Date(msg.time).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
        const readMark = isRead ? '[read] ' : '[unread] ';
        return {
          role: isMe ? 'assistant' : 'user',
          content: `${readMark}[${time}] ${senderName}: ${msg.content}`,
          _isMe: isMe,
        };
      });

      // Build LLM messages
      const messages = [
        { role: 'system', content: systemPrompt },
      ];

      // Add history (except last message)
      for (const msg of formattedHistory.slice(0, -1)) {
        messages.push({ role: msg.role, content: msg.content });
      }

      // Add current message with history summary
      const currentContent = formattedHistory[formattedHistory.length - 1]?.content || '';
      const userMessage = historySummaryContext
        ? `${historySummaryContext}\n\n${currentContent}`
        : currentContent;
      messages.push({ role: 'user', content: userMessage });

      // Call LLM
      let response;
      if (agent.canChat()) {
        try {
          if (agent.toolKit) {
            response = await agent.chatWithTools(messages, agent.toolKit, {
              temperature: 0.9, maxTokens: 2048, maxIterations: 5,
            });
          } else {
            response = await agent.chat(messages, { temperature: 0.9, maxTokens: 1024 });
          }
        } catch (err) {
          console.warn(`  ⚠️ [Lifecycle] ${agent.name} DM LLM error:`, err.message);
          return;
        }
      } else {
        return;
      }

      if (agent.stamina) agent.stamina.onLLMCall();

      const rawContent = response.content || '';
      const result = robustJSONParse(rawContent);

      // Process structured response (memory, relationships, tasks)
      const parsed = agent.parseStructuredResponse(rawContent, dmGroupId);

      const shouldSpeak = result.shouldSpeak !== false;
      const interestLevel = typeof result.interestLevel === 'number' ? result.interestLevel : 7;
      const topicSaturation = typeof result.topicSaturation === 'number' ? result.topicSaturation : 3;

      if (shouldSpeak && result.content && result.content.trim()) {
        // Write reply directly to chatStore (no messageBus relay)
        chatStore.appendMessage(sessionId, {
          role: 'agent',
          content: result.content,
          time: new Date(),
          fromAgentId: agent.id,
          fromAgentName: agent.name,
          toAgentId: otherAgentId,
          toAgentName: otherName,
        });
        console.log(`  💬 [Lifecycle] ${agent.name} replied to DM from ${otherName}: ${result.content.slice(0, 80)}`);
      } else {
        console.log(`  🤫 [Lifecycle] ${agent.name} read DM from ${otherName} but chose not to reply (interest=${interestLevel}, saturation=${topicSaturation})`);
      }

      // Handle onResolve for any resolved tasks
      if (parsed._resolvedTasks && parsed._resolvedTasks.length > 0) {
        for (const resolved of parsed._resolvedTasks) {
          await this._handleTaskOnResolve(resolved);
        }
      }

      // ── Adaptive poll delay for DM (same logic as group chat) ──
      const adaptiveDelay = this._computeAdaptiveDelay(topicSaturation, interestLevel);
      if (this._nextPollDelay === null || adaptiveDelay < this._nextPollDelay) {
        this._nextPollDelay = adaptiveDelay;
      }
      console.log(`  ⏱️ [Lifecycle] ${agent.name} DM adaptive delay ${Math.round(adaptiveDelay / 1000)}s (interest=${interestLevel}, saturation=${topicSaturation})`);

      company.save();

    } finally {
      this._dmProcessing.delete(sessionId);
    }
  }

  /**
   * Handle onResolve for a resolved task — trigger normal chat flow in the target conversation.
   * @param {{ task: import('./task.js').AgentTask, onResolveTarget: string, onResolveHint: string }} resolved
   */
  async _handleTaskOnResolve(resolved) {
    const { task, onResolveTarget, onResolveHint } = resolved;
    if (!onResolveTarget) return;

    const agent = this.employee;
    console.log(`  🎯 [Lifecycle] ${agent.name} task ${task.id} resolved — triggering onResolve for ${onResolveTarget}`);

    // Determine the target conversation type and trigger normal chat flow
    if (onResolveTarget.startsWith('boss-chat-')) {
      // Target is a boss chat — trigger via company.chatWithAgent equivalent
      await this._triggerBossChatOnResolve(task, onResolveTarget, onResolveHint);
    } else if (onResolveTarget.startsWith('dm-')) {
      // Target is a DM conversation — trigger DM processing
      const parts = onResolveTarget.replace('dm-', '').split('-');
      const targetAgentId = parts.find(id => id !== agent.id) || parts[0];
      const ids = [agent.id, targetAgentId].sort();
      const dmSessionId = `agent-agent-${ids[0]}-${ids[1]}`;
      const dmMessages = chatStore.getRecentMessages(dmSessionId, 5);
      if (dmMessages.length > 0) {
        await this._processDM(dmSessionId, dmMessages, targetAgentId);
      }
    } else {
      // Target is a group chat — trigger group message processing
      await this._processGroupMessages(onResolveTarget, false);
    }
  }

  /**
   * Trigger a boss chat reply when a task is resolved.
   * Builds the normal boss-chat context + appends task completion info.
   */
  async _triggerBossChatOnResolve(task, onResolveTarget, onResolveHint) {
    const agent = this.employee;
    const company = this._getCompany();
    if (!company) return;

    const bossChatGroupId = onResolveTarget;
    const agentId = agent.id;
    const sessionId = `boss-agent-${agentId}`;

    // Build memory context
    const memoryContext = agent.memory.buildMemoryContext(bossChatGroupId);
    const historySummaryContext = agent.memory.buildHistorySummaryContext(bossChatGroupId);

    // Find department
    let targetDept = null;
    for (const dept of company.departments.values()) {
      if (dept.agents.has(agentId)) { targetDept = dept; break; }
    }

    // Build system prompt (same as normal boss chat)
    const systemMessage = agent._buildSystemMessage()
      + `\n\n## Current Conversation\nYou are having a private 1-on-1 conversation with your boss "${company.bossName}".`
      + (targetDept ? ` You work in the "${targetDept.name}" department.` : '')
      + ` Respond naturally based on your personality and role. Be helpful but stay in character.`
      + memoryContext
      + agent._buildBossChatResponseFormat();

    // Get recent chat history
    const recentMessages = chatStore.getRecentMessages(sessionId, 20);
    const messages = [{ role: 'system', content: systemMessage }];
    for (const msg of recentMessages) {
      messages.push({
        role: msg.role === 'boss' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // Append task completion info as a system-injected user message
    const taskCompletionMsg = `[System notification] Your task has been completed:\n`
      + `- Task: ${task.description}\n`
      + `- Result: ${task.result || 'Completed'}\n`
      + (onResolveHint ? `- What to do: ${onResolveHint}\n` : '')
      + `\nPlease respond to the boss with the relevant information.`;
    messages.push({ role: 'user', content: historySummaryContext ? `${historySummaryContext}\n\n${taskCompletionMsg}` : taskCompletionMsg });

    // Call LLM
    try {
      let response;
      if (agent.toolKit) {
        response = await agent.chatWithTools(messages, agent.toolKit, {
          temperature: 0.8, maxTokens: 2048, maxIterations: 5,
        });
      } else {
        response = await agent.chat(messages, { temperature: 0.8, maxTokens: 2048 });
      }

      const rawContent = response.content || '';
      let replyContent = rawContent;

      // Parse structured response
      try {
        const parsed = robustJSONParse(rawContent);
        if (parsed && parsed.content) {
          replyContent = parsed.content;
          // Process memory/relationship/task ops
          agent.parseStructuredResponse(rawContent, bossChatGroupId);
        }
      } catch (e) {
        // Plain text reply, that's fine
      }

      // Append to chat store
      chatStore.appendMessage(sessionId, {
        role: 'agent',
        content: replyContent,
        time: new Date(),
      });

      console.log(`  📨 [Lifecycle] ${agent.name} sent onResolve reply to boss: ${replyContent.slice(0, 80)}`);

      // Emit event for frontend
      this._emit('dm:reply', {
        agentId: agent.id,
        agentName: agent.name,
        target: 'boss',
        sessionId,
        content: replyContent,
      });

    } catch (err) {
      console.error(`  ❌ [Lifecycle] ${agent.name} onResolve boss chat error:`, err.message);
    }
  }

  // ─── Query helpers (used by GroupChatLoop / API) ────────────────────

  getActiveMonologue(groupId) {
    return this._activeMonologues.get(groupId) || null;
  }

  getMonologueHistory(groupId, limit = 10) {
    return (this._monologueHistory.get(groupId) || []).slice(-limit);
  }

  getActiveThinking() {
    const result = [];
    for (const [, monologue] of this._activeMonologues) {
      if (monologue.status === 'thinking') {
        result.push({
          agentId: monologue.agentId,
          agentName: monologue.agentName,
          groupId: monologue.groupId,
          startedAt: monologue.startedAt,
          thoughtCount: monologue.thoughts.length,
          status: 'thinking',
        });
      }
    }
    return result;
  }

  // ─── Serialization ──────────────────────────────────────────────────

  serialize() {
    const obj = (map) => {
      const o = {};
      for (const [k, v] of map) o[k] = v;
      return o;
    };
    return {
      lastReadIndex: obj(this._lastReadIndex),
      lastProcessedVisible: obj(this._lastProcessedVisible),
      agentMemory: obj(this._agentMemory),
      dmLastReadIndex: obj(this._dmLastReadIndex),
    };
  }

  restore(data) {
    if (!data) return;
    const load = (map, raw) => { if (raw) for (const [k, v] of Object.entries(raw)) map.set(k, v); };
    load(this._lastReadIndex, data.lastReadIndex);
    load(this._lastProcessedVisible, data.lastProcessedVisible);
    load(this._agentMemory, data.agentMemory);
    load(this._dmLastReadIndex, data.dmLastReadIndex);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — Poll Cycle
  // ──────────────────────────────────────────────────────────────────────

  _scheduleNext() {
    if (!this._isRunning()) return;
    // Use adaptive delay if set by the last thinking round, otherwise random
    const delay = this._nextPollDelay ?? this._randomDelay();
    this._nextPollDelay = null; // consume it
    this._pollTimer = setTimeout(async () => {
      try {
        await this._pollCycle();
      } catch (err) {
        console.error(`  ❌ [Lifecycle] ${this.employee.name} poll error:`, err.message);
      }
      this._scheduleNext();
    }, delay);
  }

  async _pollCycle() {
    if (!this._isRunning()) return;
    const agent = this.employee;
    if (agent.status === 'dismissed') return;

    // Periodically clean expired short-term memories
    agent.memory.cleanExpiredShortTerm();

    // 1. Process group messages (work groups + dept chats)
    const groups = this._getAgentGroups();
    for (const group of groups) {
      await this._checkGroupForAgent(group);
      await this._selfCheckWorkflow(group);
    }

    // 2. Self-driven DM polling — scan all DM sessions for unread messages
    await this._pollDMSessions();
  }

  /**
   * Self-driven DM polling: scan all agent-agent sessions in chatStore,
   * find ones that involve this employee, and process any unread messages.
   * This is the same self-driven rhythm as group chat — no external notification needed.
   */
  async _pollDMSessions() {
    const agent = this.employee;
    const allSessions = chatStore.listSessions();

    for (const meta of allSessions) {
      // Only process agent-agent DM sessions
      if (meta.type !== 'agent-agent') continue;
      // Only process sessions that involve this employee
      if (!meta.participants || !meta.participants.includes(agent.id)) continue;

      const sessionId = meta.sessionId;
      const totalMessages = chatStore.getMessageCount(sessionId);
      const lastRead = this._dmLastReadIndex.get(sessionId) || 0;

      if (totalMessages <= lastRead) continue; // No new messages

      // Get unread messages
      const allRecent = chatStore.getRecentMessages(sessionId, totalMessages);
      const unreadMessages = allRecent.slice(lastRead);

      // Mark as read (advance the read index)
      this._dmLastReadIndex.set(sessionId, totalMessages);

      // Skip if all unread messages are from ourselves
      const othersMessages = unreadMessages.filter(m => m.fromAgentId !== agent.id);
      if (othersMessages.length === 0) continue;

      // Determine the other agent's ID
      const otherAgentId = meta.participants.find(id => id !== agent.id);
      if (!otherAgentId) continue;

      try {
        await this._processDM(sessionId, unreadMessages, otherAgentId);
      } catch (err) {
        console.error(`  ❌ [Lifecycle] ${agent.name} DM poll error for ${sessionId}:`, err.message);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — Group discovery
  // ──────────────────────────────────────────────────────────────────────

  _getAgentGroups() {
    const company = this._getCompany();
    if (!company) return [];

    const agent = this.employee;
    const groups = [];

    // 1. Requirement work groups
    const requirements = company.requirementManager.listAll();
    for (const req of requirements) {
      if (req.status !== 'in_progress' && req.status !== 'planning') continue;
      const dept = company.findDepartment(req.departmentId);
      if (!dept || !dept.agents.has(agent.id)) continue;
      groups.push({
        id: req.id,
        title: req.title,
        departmentId: req.departmentId,
        type: 'work',
        messages: req.groupChat || [],
        requirement: req,
      });
    }

    // 2. Department general chat groups
    for (const dept of company.departments.values()) {
      if (!dept.agents.has(agent.id)) continue;
      if (dept.status === 'disbanded') continue;
      groups.push({
        id: `dept-${dept.id}`,
        title: `${dept.name} Department Chat`,
        departmentId: dept.id,
        type: 'chat',
        messages: dept.groupChat || [],
        department: dept,
      });
    }

    return groups;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — Check & process messages
  // ──────────────────────────────────────────────────────────────────────

  async _checkGroupForAgent(group) {
    const groupId = group.id;
    if (this._processing.has(groupId)) return;

    const lastRead = this._lastReadIndex.get(groupId) || 0;
    const messages = group.messages;

    if (messages.length <= lastRead) {
      if (group.type === 'chat') await this._maybeInitiateChat(group);
      return;
    }

    const unreadMessages = messages.slice(lastRead);
    this._lastReadIndex.set(groupId, messages.length);

    const agent = this.employee;
    const isMentioned = unreadMessages
      .filter(msg => msg.visibility !== 'flow')
      .some(msg => this._isMentionedInMessage(msg));

    // Any group-visible message from others (including system summaries/reports)
    // should trigger the monologue flow — the agent reads them, thinks, and
    // may choose to stay silent. The key is to *enter* the thinking process.
    const othersMessages = unreadMessages.filter(msg =>
      msg.from?.id !== agent.id && msg.visibility !== 'flow'
    );

    if (othersMessages.length === 0 && !isMentioned) return;

    await this._processGroupMessages(groupId, isMentioned);
  }

  /**
   * Core logic — process unread messages for a group.
   */
  async _processGroupMessages(groupId, isMentioned = false) {
    if (this._processing.has(groupId)) return;
    this._processing.add(groupId);

    const agent = this.employee;
    const company = this._getCompany();

    // NOTE: wakeUp follows lazy-loading principle.
    // For web agents: automatically woken up on first chat() via _ensureSession().
    // For LLM/CLI agents: wakeUp only sets a flag (no API call), since _agentThink()
    // already builds a fully self-contained prompt with identity+memory+scene.

    try {
      const isDeptChat = groupId.startsWith('dept-');
      let dept, chatTarget, contextTitle;

      let allVisibleMessages;
      if (isDeptChat) {
        const deptId = groupId.replace('dept-', '');
        dept = company.findDepartment(deptId);
        if (!dept) return;
        chatTarget = dept;
        contextTitle = `${dept.name} Department Chat`;
        allVisibleMessages = (dept.groupChat || []).filter(m => m.visibility !== 'flow');
      } else {
        const requirement = company.requirementManager.get(groupId);
        if (!requirement) return;
        dept = company.findDepartment(requirement.departmentId);
        if (!dept) return;
        chatTarget = requirement;
        contextTitle = requirement.title;
        allVisibleMessages = (requirement.groupChat || []).filter(m => m.visibility !== 'flow');
      }

      // ── Per-employee context scene management ──
      // Switch the employee's active context if the group has changed.
      // For web agents: injects scene prompt into the existing ChatGPT conversation.
      // For LLM/CLI agents: only updates internal _currentContext tracking (no API call);
      //   the _agentThink() prompt is fully self-contained with identity+scene+memory.
      if (agent.switchContext) {
        const contextType = isDeptChat ? 'dept-chat' : 'work-chat';
        const members = dept.getMembers().map(a => `${a.name}(${a.role})`).join(', ');
        const scenePrompt = isDeptChat
          ? `You are now in the "${contextTitle}" group.\nMembers: ${members}\nThis is a casual department chat. Respond naturally in your personality.`
          : `You are now in the "${contextTitle}" work group.\nMembers: ${members}\nThis is a task-focused discussion. Stay on topic and contribute professionally.`;
        await agent.switchContext({
          contextId: groupId,
          contextType,
          contextTitle,
          scenePrompt,
        });
      }

      // Distinguish read vs unread
      const contextKey = groupId;
      const lastProcessedCount = this._lastProcessedVisible.get(contextKey) || 0;
      const readContext = allVisibleMessages.slice(0, lastProcessedCount).slice(-10);
      const unreadNew = allVisibleMessages.slice(lastProcessedCount);
      this._lastProcessedVisible.set(contextKey, allVisibleMessages.length);

      let recentMessages = [
        ...readContext.map(m => ({ ...m, _isRead: true })),
        ...unreadNew.map(m => ({ ...m, _isRead: false })),
      ];

      if (unreadNew.length === 0 && !isMentioned) return;

      // Jitter wait (5-20s)
      const jitter = 5000 + Math.random() * 15000;
      await this._delay(jitter);

      // Re-fetch fresh messages after waiting
      let freshVisibleMessages;
      if (isDeptChat) {
        freshVisibleMessages = (chatTarget.groupChat || []).filter(m => m.visibility !== 'flow');
      } else {
        freshVisibleMessages = (chatTarget.groupChat || []).filter(m => m.visibility !== 'flow');
      }
      if (freshVisibleMessages.length > allVisibleMessages.length) {
        const extraMessages = freshVisibleMessages.slice(allVisibleMessages.length);
        recentMessages = [
          ...recentMessages,
          ...extraMessages.map(m => ({ ...m, _isRead: false })),
        ];
        this._lastProcessedVisible.set(contextKey, freshVisibleMessages.length);
      }

      // Create flow state
      const monologue = new InnerMonologue(agent.id, agent.name, groupId);
      this._activeMonologues.set(groupId, monologue);

      this._emit('monologue:start', {
        agentId: agent.id, agentName: agent.name, groupId,
      });

      // LLM flow thinking
      const thinkingResult = await this._agentThink(
        { id: groupId, title: contextTitle }, dept, recentMessages, isMentioned, monologue
      );

      if (monologue.thoughts.length === 0 && thinkingResult.reason) {
        monologue.addThought(thinkingResult.reason);
      }

      // Write inner monologue to group stream (boss peek)
      const innerThoughtsContent = thinkingResult.innerThoughts || thinkingResult.reason || null;
      if (innerThoughtsContent) {
        chatTarget.addGroupMessage(
          { id: agent.id, name: agent.name, avatar: agent.avatar, role: agent.role },
          innerThoughtsContent,
          'monologue',
          'flow'
        );
      }

      // Topic saturation gate
      const topicSaturation = thinkingResult.topicSaturation || 0;
      const interestLevel = thinkingResult.interestLevel || 5;
      if (thinkingResult.shouldSpeak && topicSaturation >= this.config.topicSaturationThreshold && !isMentioned) {
        console.log(`  🎯 [Lifecycle] ${agent.name} silenced by topic saturation (score=${topicSaturation})`);
        thinkingResult.shouldSpeak = false;
        thinkingResult.reason = `Topic saturation: ${topicSaturation}/10`;
        monologue.addThought(PROMPT.monologue.topicSaturated(topicSaturation));
      }

      // ── Adaptive poll delay: interest↑ → faster, saturation↑ → slower ──
      const adaptiveDelay = this._computeAdaptiveDelay(topicSaturation, interestLevel);
      this._nextPollDelay = adaptiveDelay;
      console.log(`  ⏱️ [Lifecycle] ${agent.name} next poll in ${Math.round(adaptiveDelay / 1000)}s (interest=${interestLevel}, saturation=${topicSaturation})`);
      monologue.addThought(`[Adaptive timing] Interest: ${interestLevel}/10, Saturation: ${topicSaturation}/10 → next check in ${Math.round(adaptiveDelay / 1000)}s`);

      // Cooldown check
      if (thinkingResult.shouldSpeak) {
        const spamRecheck = this._getSpamInfo(groupId, isDeptChat);
        if (spamRecheck.isOnCooldown) {
          console.log(`  🕐 [Lifecycle] ${agent.name} on cooldown, suppressing`);
          thinkingResult.shouldSpeak = false;
          thinkingResult.reason = 'On cooldown after recent speak';
          monologue.addThought(PROMPT.monologue.cooldownSilence);
        }
      }

      // Send messages
      if (thinkingResult.shouldSpeak) {
        const messagesToSend = thinkingResult.messages || [];
        for (const msg of messagesToSend.slice(0, this.config.maxGroupMessagesPerTurn)) {
          // Expand [[file:path]] → [[file:deptId:path|name]] for frontend rendering
          const { content: expandedContent, invalidRefs } = expandFileReferences(msg.content, dept.id, dept.workspacePath);
          chatTarget.addGroupMessage(
            { id: agent.id, name: agent.name, avatar: agent.avatar, role: agent.role },
            expandedContent,
            'message'
          );
          monologue.addThought(`[Sent to group] ${expandedContent}`);

          // Auto-feedback: force agent to correct invalid file references
          if (invalidRefs.length > 0) {
            const invalidList = invalidRefs.map(f => `  - ${f}`).join('\n');
            chatTarget.addGroupMessage(
              { id: 'system', name: 'System', role: 'system' },
              `⚠️ @[${agent.id}] The following files you referenced do not exist in the workspace:\n${invalidList}\nYou MUST use the workspace_files or file_search tool to check available files, then resend with correct paths. This is mandatory and cannot be ignored.`,
              'message', null, { auto: true }
            );
            // Force agent to re-think immediately to address the invalid refs
const { groupChatLoop } = await import('../organization/group-chat-loop.js');
            setTimeout(() => {
              groupChatLoop.triggerImmediate(agent.id, groupId, {
                content: `[System] You MUST fix invalid file references: ${invalidRefs.join(', ')}. Use workspace_files tool to find correct paths.`,
                from: { id: 'system', name: 'System' },
              }).catch(() => {});
            }, 1000);
          }
          this._lastGroupActivity.set(groupId, new Date());
          this._recordSpeak(groupId);

          // Nudge other group members
          const allGroupMembers = dept.getMembers();
          for (const member of allGroupMembers) {
            if (member.id === agent.id) continue;
            const nudgeDelay = this._randomDelay();
            setTimeout(() => {
              this._nudgePeer(member.id, groupId);
            }, nudgeDelay);
          }
        }
        // Save company state
        company.save();
      }

      // Finalise monologue
      monologue.status = 'done';
      monologue.finishedAt = Date.now();
      monologue.decision = thinkingResult.shouldSpeak ? 'spoke' : 'silent';

      if (!this._monologueHistory.has(groupId)) this._monologueHistory.set(groupId, []);
      const history = this._monologueHistory.get(groupId);
      history.push(monologue);
      if (history.length > 20) this._monologueHistory.set(groupId, history.slice(-20));

      this._activeMonologues.delete(groupId);

      // Save agent memory — now uses the structured Memory system.
      // The AI-driven memoryOps (processed in _agentThink) handle long-term/short-term memory.
      // Here we still keep a lightweight _agentMemory for backward compat (e.g. monologue peek).
      if (!this._agentMemory.has(groupId)) this._agentMemory.set(groupId, []);
      const legacyMemory = this._agentMemory.get(groupId);
      const memoryThoughts = monologue.thoughts
        .filter(t => !t.content.startsWith('[Sent to group]') && !t.content.startsWith('[Self-regulation]'))
        .map(t => t.content);
      if (memoryThoughts.length > 0) {
        const summary = memoryThoughts[memoryThoughts.length - 1];
        const action = monologue.decision === 'spoke' ? '[spoke]' : '[silent]';
        legacyMemory.push(`${action} ${summary.slice(0, 200)}`);
        if (legacyMemory.length > 10) this._agentMemory.set(groupId, legacyMemory.slice(-10));
      }

      this._emit('monologue:end', {
        agentId: agent.id, agentName: agent.name, groupId,
        decision: monologue.decision,
        thoughtCount: monologue.thoughts.length,
        thoughts: monologue.thoughts,
        reason: thinkingResult.reason || '',
      });

      // Handle onResolve for any resolved tasks
      if (thinkingResult._resolvedTasks && thinkingResult._resolvedTasks.length > 0) {
        for (const resolved of thinkingResult._resolvedTasks) {
          await this._handleTaskOnResolve(resolved);
        }
      }

    } catch (error) {
      console.error(`  ❌ [Lifecycle] ${agent.name} process error in ${groupId}:`, error.message);
      this._activeMonologues.delete(groupId);
    } finally {
      this._processing.delete(groupId);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — LLM thinking
  // ──────────────────────────────────────────────────────────────────────

  async _agentThink(requirement, dept, recentMessages, isMentioned, monologue) {
    const agent = this.employee;
    const members = dept.getMembers().map(a => ({ id: a.id, name: a.name, role: a.role }));

    // Format messages — includes sender id, name, time
    const readMessages = recentMessages.filter(m => m._isRead);
    const unreadMessages = recentMessages.filter(m => !m._isRead);

    const formatMsg = (msg) => {
      const senderName = msg.from?.name || 'Unknown';
      const senderId = msg.from?.id || 'unknown';
      const time = new Date(msg.time).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
      if (msg.type === 'system') return `[System] ${msg.content}`;
      const selfMark = msg.from?.id === agent.id ? ' (you)' : '';
      return `[${time}] ${senderName}(${senderId})${selfMark}: ${msg.content}`;
    };

    // Dedupe warning
    const colleagueReplies = unreadMessages.filter(m =>
      m.from?.id !== agent.id && m.from?.id !== 'boss' && members.some(mem => mem.id === m.from?.id)
    );
    const dedupeWarning = colleagueReplies.length > 0
      ? PROMPT.context.dedupeWarning(
          colleagueReplies.length,
          colleagueReplies.map(m => `- ${m.from?.name}: "${(m.content || '').slice(0, 80)}"`).join('\n')
        )
      : '';

    // Random angle seed
    const angles = PROMPT.angles;
    const myAngle = angles[Math.floor(Math.random() * angles.length)];
    const angleHint = PROMPT.context.angleHint(myAngle);

    let chatContext = '';
    if (readMessages.length > 0) {
      chatContext += PROMPT.context.readHeader + '\n';
      chatContext += readMessages.map(formatMsg).join('\n');
      chatContext += '\n\n';
    }
    if (unreadMessages.length > 0) {
      chatContext += PROMPT.context.unreadHeader + '\n';
      chatContext += unreadMessages.map(formatMsg).join('\n');
    } else {
      chatContext += PROMPT.context.noNewMessages;
    }
    chatContext += dedupeWarning;
    chatContext += angleHint;

    // Build structured memory context from the employee's Memory system
    // memoryContext = long-term + short-term memories + relationship impressions (injected into system prompt)
    // historySummaryContext = rolling conversation summary (injected into user prompt)
    const participantIds = members.filter(m => m.id !== agent.id).map(m => m.id);
    const groupId = requirement.id;
    const memoryContext = agent.memory.buildFullContext(groupId, participantIds);
    const historySummaryContext = agent.memory.buildHistorySummaryContext(groupId);

    const p = agent.personality;

    // Anti-spam context
    const isDeptChat = groupId.startsWith('dept-');
    const spamInfo = this._getSpamInfo(groupId, isDeptChat);

    const systemPrompt = isDeptChat
      ? this._buildDeptChatPrompt(p, requirement, members, memoryContext, spamInfo, isMentioned)
      : this._buildWorkChatPrompt(p, requirement, members, memoryContext, spamInfo, isMentioned);

    // Thinking peers
    const thinkingPeers = this._getThinkingPeers(groupId);
    const thinkingInfo = thinkingPeers.length > 0
      ? PROMPT.context.thinkingPeers(thinkingPeers.join(', '))
      : '';

    const userPrompt = isDeptChat
      ? PROMPT.userPrompt.deptChat(chatContext, thinkingInfo, agent.name, agent.age, agent.personality.trait, historySummaryContext)
      : PROMPT.userPrompt.workChat(chatContext, thinkingInfo, agent.name, agent.age, agent.personality.trait, historySummaryContext);

    try {
      if (!agent.canChat()) {
        return this._fallbackThink(groupId, isMentioned, recentMessages);
      }

      // Use chatWithTools (same as boss 1-on-1 chat) so the employee can execute
      // tool calls via the actions protocol in the JSON response.
      // ToolLoop automatically detects JSON actions, executes them, and loops
      // until actions is empty — the final response contains the complete JSON.
      const chatMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      let response;
      if (agent.toolKit) {
        response = await agent.chatWithTools(chatMessages, agent.toolKit, {
          temperature: 0.95, maxTokens: 2048, maxIterations: 5,
        });
      } else {
        response = await agent.chat(chatMessages, { temperature: 0.95, maxTokens: 1024 });
      }

      // ── Stamina: track LLM call ──
      if (agent.stamina) agent.stamina.onLLMCall();

      const rawContent = response.content || '';
      const result = robustJSONParse(rawContent);

      const thoughtContent = (result.innerThoughts && result.innerThoughts.trim())
        ? result.innerThoughts.trim()
        : result.reason
          ? `[Inner thought] ${result.reason}`
          : `[Read group messages, processing...]`;
      monologue.addThought(thoughtContent);

      // ── Process memory & relationship ops via shared parseStructuredResponse ──
      // This reuses the same logic as boss 1-on-1 chat (unified protocol).
      // Capture old affinity values BEFORE processing for stamina tracking.
      const oldAffinities = new Map();
      if (result.relationshipOps && Array.isArray(result.relationshipOps)) {
        for (const op of result.relationshipOps) {
          if (op.employeeId) {
            const existing = agent.memory.relationships.get(op.employeeId);
            oldAffinities.set(op.employeeId, existing?.affinity || 50);
          }
        }
      }

      // parseStructuredResponse handles: memorySummary, memoryOps, relationshipOps, taskOps
      const parsedResult = agent.parseStructuredResponse(rawContent, groupId);

      // ── Stamina: detect chat sentiment from affinity changes ──
      if (agent.stamina && result.relationshipOps && Array.isArray(result.relationshipOps) && result.relationshipOps.length > 0) {
        let totalDelta = 0;
        for (const op of result.relationshipOps) {
          if (!op.employeeId) continue;
          const oldAff = oldAffinities.get(op.employeeId) || 50;
          const newRel = agent.memory.relationships.get(op.employeeId);
          if (newRel) totalDelta += (newRel.affinity - oldAff);
        }
        const sentiment = totalDelta > 5 ? 'positive' : totalDelta < -5 ? 'negative' : 'neutral';
        if (sentiment !== 'neutral') {
          agent.stamina.onChatSentiment(sentiment, { affinityDelta: totalDelta });
          console.log(`  🎭 [Stamina] ${agent.name} chat sentiment: ${sentiment} (delta=${totalDelta}, comfort=${agent.stamina.comfort})`);
        }
      }

      // Anti-spam gate
      const spamCheck = this._getSpamInfo(requirement.id, isDeptChat);
      const maxMessages = isDeptChat ? this.config.deptAntiSpamMaxMessages : this.config.antiSpamMaxMessages;
      if (result.shouldSpeak && spamCheck.recentCount >= maxMessages) {
        console.log(`  🔇 [Lifecycle] ${agent.name} suppressed (anti-spam: ${spamCheck.recentCount} msgs)`);
        result.shouldSpeak = false;
        result.reason = `Anti-spam: already sent ${spamCheck.recentCount} messages recently`;
        result.messages = [];
        monologue.addThought(`[Self-regulation] I wanted to speak but I've been too active recently. Better stay quiet.`);
      }

      if (result.messages && result.messages.length > 1) {
        result.messages = [result.messages[0]];
      }

      return {
        shouldSpeak: !!result.shouldSpeak,
        messages: (result.messages || []).filter(m => m.content && m.content.trim()),
        reason: result.reason || '',
        innerThoughts: thoughtContent,
        topicSaturation: typeof result.topicSaturation === 'number' ? result.topicSaturation : 0,
        interestLevel: typeof result.interestLevel === 'number' ? result.interestLevel : 5,
        _resolvedTasks: parsedResult._resolvedTasks || [],
      };

    } catch (error) {
      console.warn(`  ⚠️ [Lifecycle] ${agent.name} LLM think error:`, error.message);
      return this._fallbackThink(groupId, isMentioned, recentMessages);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — Prompt building
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Build group chat system prompt.
   * Architecture: _buildSystemMessage() (shared base) + social control layer.
   * The only difference between group chat and 1v1 chat is the social control.
   *
   * @param {'dept'|'work'} scenario
   */
  _buildGroupChatPrompt(scenario, p, requirement, members, memoryContext, spamInfo, isMentioned) {
    const agent = this.employee;
    const isDept = scenario === 'dept';
    const fewShot = getFewShotExamples(p.trait);
    const memberList = members.map(m => `${m.name}(${m.role})`).join(', ');
    const pt = isDept ? PROMPT.deptChat : PROMPT.workChat;

    // ── Shared base: identity + personality + tools + skills + knowledge + language ──
    const basePrompt = agent._buildSystemMessage();

    // ── Social control layer (group-chat only) ──
    let socialControl = '';

    // Group context
    socialControl += `\n## Group Context\n${pt.groupContext(requirement.title, memberList)}\n`;

    // Memory context
    if (memoryContext) socialControl += `\n${memoryContext}\n`;

    // Few-shot examples
    socialControl += `\n${pt.examplesHeader}\n\n${fewShot}\n`;

    // Speaking rules (scenario-specific)
    if (isDept) {
      socialControl += `\n${pt.rules(spamInfo.recentCount, isMentioned)}\n`;
    } else {
      socialControl += `\n${pt.shouldSpeak}\n`;
      socialControl += `\n${pt.shouldNotSpeak(spamInfo.recentCount, spamInfo.isOnCooldown, isMentioned)}\n`;
    }

    // Topic saturation
    socialControl += `\n${pt.topicSaturation}\n`;

    // Response format (from base-employee, unified with boss-chat)
    socialControl += agent._buildGroupChatResponseFormat({ scenario });

    // Boss custom instructions (work chat only)
    if (!isDept && agent.customPrompt) {
      socialControl += `\n## Boss's Special Instructions For You\n${agent.customPrompt}\n`;
    }

    // Anti-AI warning
    socialControl += `\n${pt.antiAIWarning(agent.age)}`;

    return `${basePrompt}\n${socialControl}`;
  }

  _buildDeptChatPrompt(p, requirement, members, memoryContext, spamInfo, isMentioned) {
    return this._buildGroupChatPrompt('dept', p, requirement, members, memoryContext, spamInfo, isMentioned);
  }

  _buildWorkChatPrompt(p, requirement, members, memoryContext, spamInfo, isMentioned) {
    return this._buildGroupChatPrompt('work', p, requirement, members, memoryContext, spamInfo, isMentioned);
  }

  // NOTE: _buildToolsAndSkillsSection removed — group chat now uses
  // agent._buildSystemMessage() which already includes all tools & skills.

  // ──────────────────────────────────────────────────────────────────────
  // Internal — Fallback thinking
  // ──────────────────────────────────────────────────────────────────────

  _fallbackThink(groupId, isMentioned, recentMessages) {
    const agent = this.employee;
    const isDeptChat = groupId.startsWith('dept-');
    const spamCheck = this._getSpamInfo(groupId, isDeptChat);
    const maxMessages = isDeptChat ? this.config.deptAntiSpamMaxMessages : this.config.antiSpamMaxMessages;
    if (spamCheck.recentCount >= maxMessages) {
      return { shouldSpeak: false, messages: [], reason: 'Anti-spam: too many recent messages' };
    }

    const trait = agent.personality?.trait || '';
    const replies = getFallbackReplies(trait);

    if (isDeptChat) {
      const lastMsg = recentMessages[recentMessages.length - 1];
      if (lastMsg && lastMsg.from?.id !== agent.id) {
        return { shouldSpeak: true, messages: [{ content: replies.dept }], reason: 'Department chat fallback' };
      }
    }

    const lastMsg = recentMessages[recentMessages.length - 1];
    if (lastMsg && lastMsg.from?.id === 'boss') {
      return { shouldSpeak: true, messages: [{ content: replies.boss }], reason: 'Boss message fallback' };
    }
    if (isMentioned) {
      return { shouldSpeak: true, messages: [{ content: replies.mention }], reason: 'Mentioned fallback' };
    }

    return { shouldSpeak: false, messages: [], reason: 'LLM unavailable, staying silent' };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — Anti-spam
  // ──────────────────────────────────────────────────────────────────────

  _recordSpeak(groupId) {
    if (!this._recentSpeaks.has(groupId)) this._recentSpeaks.set(groupId, []);
    this._recentSpeaks.get(groupId).push(Date.now());
  }

  _getSpamInfo(groupId, isDeptChat = false) {
    const timestamps = this._recentSpeaks.get(groupId) || [];
    const now = Date.now();
    const windowMs = isDeptChat ? this.config.deptAntiSpamWindowMs : this.config.antiSpamWindowMs;
    const cooldownMs = isDeptChat ? this.config.deptCooldownAfterSpeakMs : this.config.cooldownAfterSpeakMs;
    const recentTimestamps = timestamps.filter(t => t > now - windowMs);
    this._recentSpeaks.set(groupId, recentTimestamps);

    return {
      recentCount: recentTimestamps.length,
      isOnCooldown: recentTimestamps.some(t => t > now - cooldownMs),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — Workflow self-check
  // ──────────────────────────────────────────────────────────────────────

  async _selfCheckWorkflow(group) {
    if (!group.requirement?.workflow?.nodes) return;

    const agent = this.employee;
    const groupId = group.id;
    const now = Date.now();
    const lastCheck = this._lastSelfCheck.get(groupId) || 0;
    if (now - lastCheck < this.config.selfCheckIntervalMs) return;

    const nodes = group.requirement.workflow.nodes;
    const myStuckNodes = nodes.filter(n => {
      if (n.assigneeId !== agent.id && n.reviewerId !== agent.id) return false;
      if (!['running', 'reviewing', 'revision'].includes(n.status)) return false;
      if (!n.startedAt) return false;
      return now - new Date(n.startedAt).getTime() > this.config.stuckThresholdMs;
    });
    if (myStuckNodes.length === 0) return;

    this._lastSelfCheck.set(groupId, now);

    const recentGroupMessages = (group.requirement.groupChat || [])
      .filter(m => m.visibility !== 'flow').slice(-10);
    const myRecentMessages = recentGroupMessages.filter(m => m.from?.id === agent.id && m.type === 'message');
    if (myRecentMessages.length > 0) {
      const lastMsgTime = new Date(myRecentMessages[myRecentMessages.length - 1].time).getTime();
      if (now - lastMsgTime < this.config.selfCheckIntervalMs * 2) return;
    }

    const spamCheck = this._getSpamInfo(groupId);
    if (spamCheck.recentCount >= this.config.antiSpamMaxMessages) return;

    for (const node of myStuckNodes.slice(0, 1)) {
      const elapsed = Math.round((now - new Date(node.startedAt).getTime()) / 1000);
      const isReviewer = node.reviewerId === agent.id;

      let checkInContent;
      if (isReviewer && node.status === 'reviewing') {
        checkInContent = `🔍 Still reviewing "${node.title}" (${elapsed}s elapsed). Working on it...`;
      } else if (node.status === 'revision') {
        checkInContent = `✏️ Working on revisions for "${node.title}" (${elapsed}s elapsed). Making progress...`;
      } else {
        checkInContent = `⚙️ Still working on "${node.title}" (${elapsed}s elapsed). Will update when I have results.`;
      }

      group.requirement.addGroupMessage(
        { id: agent.id, name: agent.name, avatar: agent.avatar, role: agent.role },
        checkInContent,
        'message', null, { auto: true }
      );

      this._recordSpeak(groupId);
      this._lastGroupActivity.set(groupId, new Date());
      console.log(`  🔔 [Lifecycle] ${agent.name} self-check: ${checkInContent}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — Idle chat initiation
  // ──────────────────────────────────────────────────────────────────────

  async _maybeInitiateChat(group) {
    const lastActivity = this._lastGroupActivity.get(group.id);
    if (!lastActivity) return;

    const idleMs = Date.now() - lastActivity.getTime();
    const threshold = group.type === 'chat' ? this.config.deptIdleChatThresholdMs : this.config.idleChatThresholdMs;
    if (idleMs < threshold) return;
    if (group.type !== 'chat') return;
    if (Math.random() > 0.15) return;

    console.log(`  💬 [Lifecycle] ${this.employee.name} considering topic in idle group ${group.title}`);
    await this._processGroupMessages(group.id, false);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — Mention detection
  // ──────────────────────────────────────────────────────────────────────

  _isMentionedInMessage(message) {
    const agent = this.employee;
    if (!message.content || typeof message.content !== 'string') return false;
    const content = message.content;
    if (content.includes(`@[${agent.id}]`)) return true;
    if (content.includes(`@${agent.name}`)) return true;
    if (content.includes('@all') || content.includes('@everyone')) return true;
    return false;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — Helpers
  // ──────────────────────────────────────────────────────────────────────

  _isRunning() {
    return this._coordinator?.running ?? false;
  }

  _getCompany() {
    return this._coordinator?.company ?? null;
  }

  _randomDelay() {
    return this.config.pollIntervalMinMs +
      Math.random() * (this.config.pollIntervalMaxMs - this.config.pollIntervalMinMs);
  }

  /**
   * Compute adaptive poll delay based on AI's interest level and topic saturation.
   *
   * Formula:
   *   interestFactor  = (10 - interest) / 9   → 0 (very interested) ~ 1 (not interested)
   *   saturationFactor = saturation / 10       → 0 (fresh) ~ 1 (exhausted)
   *   combined = 0.6 * interestFactor + 0.4 * saturationFactor  (interest weighted more)
   *   delay = MIN + combined * (MAX - MIN)
   *
   * Result range: pollIntervalMinMs (10s) ~ pollIntervalMaxMs (5min)
   *
   * Examples:
   *   interest=9, saturation=2 → ~15s  (very engaged, fresh topic)
   *   interest=5, saturation=5 → ~2min (moderate)
   *   interest=2, saturation=8 → ~4.5min (bored, topic dead)
   */
  _computeAdaptiveDelay(topicSaturation, interestLevel) {
    const interest = Math.max(1, Math.min(10, interestLevel));
    const saturation = Math.max(0, Math.min(10, topicSaturation));

    const interestFactor = (10 - interest) / 9;   // 0 = max interest, 1 = zero interest
    const saturationFactor = saturation / 10;       // 0 = fresh, 1 = exhausted

    // Interest has more weight (60%) than saturation (40%)
    const combined = 0.6 * interestFactor + 0.4 * saturationFactor;

    const minMs = this.config.pollIntervalMinMs;  // 10s
    const maxMs = this.config.pollIntervalMaxMs;  // 300s

    // Add a small random jitter (±10%) to avoid sync between employees
    const base = minMs + combined * (maxMs - minMs);
    const jitter = base * 0.1 * (Math.random() * 2 - 1); // ±10%
    return Math.round(Math.max(minMs, Math.min(maxMs, base + jitter)));
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _emit(event, data) {
    this._coordinator?.emit(event, data);
  }

  /** Nudge another employee to check a group via the coordinator. */
  _nudgePeer(peerId, groupId) {
    this._coordinator?.nudgeAgent(peerId, groupId);
  }

  /** Get names of peers currently thinking in the same group (via coordinator). */
  _getThinkingPeers(groupId) {
    if (!this._coordinator) return [];
    const peers = [];
    // Ask coordinator for all active monologues in this group (from all employees)
    const allThinking = this._coordinator.getActiveThinkingAgents();
    for (const t of allThinking) {
      if (t.groupId === groupId && t.agentId !== this.employee.id) {
        peers.push(t.agentName);
      }
    }
    return peers;
  }
}
