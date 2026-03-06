/**
 * Group Chat Loop Engine
 * 
 * Implements the AI employee group chat interaction loop:
 * 1. Each employee reads unread messages from joined group chats every 10 seconds
 * 2. Direct messages are replied to immediately
 * 3. Group messages → enter flow state (inner monologue, not broadcast to group)
 *    → Only sends messages to group chat when AI decides to speak
 * 4. When @mentioned, prioritize replying (but not mandatory if nothing to add)
 * 5. AI sends group message → triggers other employees' loops → forms chat loop
 * 6. When chat group is idle for a long time (1 hour), AI can initiate topics
 * 7. Boss can peek at employee's flow output (inner monologue)
 * 8. Periodically self-check: if a workflow task is stuck on this agent, nudge progress
 */
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'eventemitter3';
import { llmClient } from './llm-client.js';
import { getPromptLocale, getTraitStyle, getAgeStyle, getFewShotExamples, getFallbackReplies } from './prompt-locale.js';

// Default configuration
const DEFAULT_CONFIG = {
  pollIntervalMinMs: 30000,        // Min poll interval (30s)
  pollIntervalMaxMs: 300000,       // Max poll interval (5min)
  idleChatThresholdMs: 3600000,   // 1 hour of inactivity considered idle
  maxInnerMonologueLen: 5,        // Max 5 rounds of inner monologue per flow
  maxGroupMessagesPerTurn: 1,     // Max 1 message per turn sent to group (prevents flooding)
  debounceMs: 3000,               // 3-second debounce after being @mentioned (wait for consecutive messages)
  antiSpamWindowMs: 300000,       // 5-minute sliding window for anti-spam (requirement groups)
  antiSpamMaxMessages: 2,         // Max messages per agent per group in the anti-spam window (requirement groups)
  cooldownAfterSpeakMs: 60000,    // 60-second cooldown after speaking before speaking again (requirement groups)
  selfCheckIntervalMs: 120000,    // 120-second interval for workflow self-check
  stuckThresholdMs: 180000,       // 3 minutes: task running longer than this triggers self-check nudge
  // Department casual chat — slightly more relaxed but still controlled
  deptAntiSpamWindowMs: 600000,   // 10-minute sliding window
  deptAntiSpamMaxMessages: 4,     // Max 4 messages per 10 minutes
  deptCooldownAfterSpeakMs: 30000, // 30-second cooldown
  deptIdleChatThresholdMs: 600000, // 10-minute idle before proactively initiating a topic
  // Topic saturation threshold: if LLM reports topicSaturation >= this, force silence
  topicSaturationThreshold: 7,    // Score 7+ = topic is exhausted, don't speak
};

/**
 * Flow State - Employee's inner monologue in group chat
 */
class InnerMonologue {
  constructor(agentId, agentName, groupId) {
    this.id = uuidv4();
    this.agentId = agentId;
    this.agentName = agentName;
    this.groupId = groupId;       // requirementId
    this.thoughts = [];           // Inner monologue list [{ content, timestamp }]
    this.startedAt = new Date();
    this.status = 'thinking';     // thinking | decided | done
    this.decision = null;         // Final decision: whether to speak and what to say
  }

  addThought(content) {
    this.thoughts.push({
      id: uuidv4(),
      content,
      timestamp: new Date(),
    });
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

/**
 * GroupChatLoop - Group Chat Loop Engine
 * 
 * Manages the behavior loop of all AI employees in group chats
 */
export class GroupChatLoop extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Poll timers for each Agent: agentId => intervalId
    this._pollTimers = new Map();
    
    // Last read message index per Agent per group: `${agentId}:${groupId}` => lastReadIndex
    this._lastReadIndex = new Map();
    
    // Active flow states: `${agentId}:${groupId}` => InnerMonologue
    this._activeMonologues = new Map();
    
    // Historical flow records (for boss to peek): `${agentId}:${groupId}` => InnerMonologue[]
    this._monologueHistory = new Map();

    // Last message timestamp per group: groupId => Date
    this._lastGroupActivity = new Map();

    // Processing flags to prevent re-entry: `${agentId}:${groupId}` => boolean
    this._processing = new Set();

    // Recent speak timestamps per Agent per group: `${agentId}:${groupId}` => Date[]
    this._recentSpeaks = new Map();

    // Last self-check timestamp per Agent per group: `${agentId}:${groupId}` => Date
    this._lastSelfCheck = new Map();

    // Per-agent per-group visible message count at last processing: `${agentId}:${groupId}:lastProcessed` => number
    this._lastProcessedVisible = new Map();

    // Per-agent per-group monologue summary (agent's own context memory): `${agentId}:${groupId}` => string[]
    this._agentMemory = new Map();

    // Company reference (injected externally)
    this.company = null;

    // Running state
    this.running = false;
  }

  /**
   * Initialize and start the loop engine
   * @param {object} company - Company instance
   */
  start(company) {
    if (this.running) return;
    this.company = company;
    this.running = true;
    console.log('🔄 GroupChatLoop: Chat loop engine started');
    this.emit('started');
  }

  /**
   * Stop the loop engine
   */
  stop() {
    this.running = false;
    // Clean up all timers
    for (const [agentId, timerId] of this._pollTimers) {
      clearTimeout(timerId);
    }
    this._pollTimers.clear();
    this._processing.clear();
    this._recentSpeaks.clear();
    this._lastSelfCheck.clear();
    this._lastProcessedVisible.clear();
    // Note: do NOT clear _agentMemory, as memories should persist across stop/start
    console.log('⏹️ GroupChatLoop: Chat loop engine stopped');
    this.emit('stopped');
  }

  /**
   * Start polling for an Agent
   * Called when an Agent is hired and joins the company
   * 
   * @param {object} agent - Agent instance
   */
  startAgentLoop(agent) {
    if (!this.running) return;
    if (this._pollTimers.has(agent.id)) return; // Already polling

    // Use a random interval rather than fixed, to make behavior feel more natural
    const scheduleNext = () => {
      if (!this.running) return;
      const delay = this.config.pollIntervalMinMs + Math.random() * (this.config.pollIntervalMaxMs - this.config.pollIntervalMinMs);
      const timerId = setTimeout(async () => {
        try {
          await this._agentPollCycle(agent);
        } catch (err) {
          console.error(`  ❌ [GroupChatLoop] Agent ${agent.name} poll error:`, err.message);
        }
        scheduleNext();
      }, delay);
      this._pollTimers.set(agent.id, timerId);
    };
    scheduleNext();
    console.log(`  🔄 [GroupChatLoop] ${agent.name} joined chat loop (${this.config.pollIntervalMinMs}-${this.config.pollIntervalMaxMs}ms random)`);
  }

  /**
   * Stop polling for an Agent
   * Called when an Agent is dismissed
   */
  stopAgentLoop(agentId) {
    const timerId = this._pollTimers.get(agentId);
    if (timerId) {
      clearTimeout(timerId);
      this._pollTimers.delete(agentId);
    }
  }

  /**
   * Trigger an Agent to process group messages (@mention, boss message, etc.)
   * No longer processes immediately; instead uses a random delay through the normal flow process, to keep the rhythm more natural
   * 
   * @param {string} agentId - Agent ID
   * @param {string} groupId - Group chat ID (requirementId)
   * @param {object} triggerMessage - The triggering message (for context, not used directly)
   */
  async triggerImmediate(agentId, groupId, triggerMessage) {
    if (!this.running || !this.company) return;

    const agent = this._findAgent(agentId);
    if (!agent) return;

    // Random delay of 10s-3min before processing, consistent with normal poll rhythm; no longer responds immediately
    const delay = this.config.pollIntervalMinMs + Math.random() * (this.config.pollIntervalMaxMs - this.config.pollIntervalMinMs);
    console.log(`  📨 [GroupChatLoop] ${agent.name} will check ${groupId} in ${Math.round(delay / 1000)}s`);

    setTimeout(async () => {
      try {
        if (!this.running) return;
        await this._processGroupMessages(agent, groupId, false /* do not set isMentioned, let the flow decide */);
      } catch (err) {
        console.error(`  ❌ [GroupChatLoop] ${agent.name} delayed trigger error:`, err.message);
      }
    }, delay);
  }

  /**
   * Get Agent's current flow state (inner monologue) in a group chat
   * For boss peeking
   * 
   * @param {string} agentId
   * @param {string} groupId
   * @returns {InnerMonologue|null}
   */
  getActiveMonologue(agentId, groupId) {
    const key = `${agentId}:${groupId}`;
    return this._activeMonologues.get(key) || null;
  }

  /**
   * Get Agent's historical flow records in a group chat
   * 
   * @param {string} agentId
   * @param {string} groupId
   * @param {number} limit
   * @returns {InnerMonologue[]}
   */
  getMonologueHistory(agentId, groupId, limit = 10) {
    const key = `${agentId}:${groupId}`;
    const history = this._monologueHistory.get(key) || [];
    return history.slice(-limit);
  }

  /**
   * Get all Agents currently in flow state
   */
  getActiveThinkingAgents() {
    const result = [];
    for (const [key, monologue] of this._activeMonologues) {
      if (monologue.status === 'thinking') {
        result.push({
          agentId: monologue.agentId,
          agentName: monologue.agentName,
          groupId: monologue.groupId,
          startedAt: monologue.startedAt,
          thoughtCount: monologue.thoughts.length,
        });
      }
    }
    return result;
  }

  // ========================================================================
  // Internal Methods
  // ========================================================================

  /**
   * One poll cycle for an Agent
   * Checks all joined group chats for unread messages
   */
  async _agentPollCycle(agent) {
    if (!this.running || !this.company) return;
    if (agent.status === 'dismissed') return;

    // Get all group chats this Agent participates in
    const groups = this._getAgentGroups(agent);

    for (const group of groups) {
      await this._checkGroupForAgent(agent, group);

      // Self-check: if workflow task is stuck on this agent, nudge progress
      await this._selfCheckWorkflow(agent, group);
    }
  }

  /**
   * Get all group chats an Agent participates in
   * Includes: 1) Requirement work group chats  2) Department general chat groups
   */
  _getAgentGroups(agent) {
    if (!this.company) return [];

    const groups = [];

    // 1. Requirement work group chats
    const requirements = this.company.requirementManager.listAll();

    for (const req of requirements) {
      // Only care about in-progress requirements
      if (req.status !== 'in_progress' && req.status !== 'planning') continue;

      // Check if Agent is in this requirement's department
      const dept = this.company.findDepartment(req.departmentId);
      if (!dept) continue;
      if (!dept.agents.has(agent.id)) continue;

      groups.push({
        id: req.id,
        title: req.title,
        departmentId: req.departmentId,
        type: 'work',
        messages: req.groupChat || [],
        requirement: req,
      });
    }

    // 2. Department general chat groups (every department has one)
    for (const dept of this.company.departments.values()) {
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

  /**
   * Check if a group chat has unread messages for this Agent
   */
  async _checkGroupForAgent(agent, group) {
    const key = `${agent.id}:${group.id}`;
    
    // Prevent re-entry
    if (this._processing.has(key)) return;

    const lastRead = this._lastReadIndex.get(key) || 0;
    const messages = group.messages;

    if (messages.length <= lastRead) {
      // No new messages, check if proactive speaking is needed (idle chat detection)
      if (group.type === 'chat') {
        await this._maybeInitiateChat(agent, group);
      }
      return;
    }

    // Has unread messages
    const unreadMessages = messages.slice(lastRead);
    
    // Mark as read
    this._lastReadIndex.set(key, messages.length);

    // Check if @mentioned (only detect in broadcast messages, not in flow messages)
    const isMentioned = unreadMessages
      .filter(msg => msg.visibility !== 'flow')
      .some(msg => this._isMentionedInMessage(agent, msg));

    // Filter out own messages and flow messages (flow is private, shouldn't trigger others' loops)
    const othersMessages = unreadMessages.filter(msg => 
      msg.from?.id !== agent.id && msg.type !== 'system' && msg.visibility !== 'flow'
    );

    if (othersMessages.length === 0 && !isMentioned) return;

    // Process group messages
    await this._processGroupMessages(agent, group.id, isMentioned);
  }

  /**
   * Process unread messages in group chat - Core logic
   * 
   * 1. Read all unread messages
   * 2. Enter flow state (inner monologue)
   * 3. Decide whether to speak in the group
   * 4. If speaking, generate messages and send to group chat
   */
  async _processGroupMessages(agent, groupId, isMentioned = false) {
    const key = `${agent.id}:${groupId}`;
    
    // Prevent re-entry
    if (this._processing.has(key)) return;
    this._processing.add(key);

    try {
      // Determine group type: department chat (dept-xxx) or requirement work chat
      const isDeptChat = groupId.startsWith('dept-');
      let dept, chatTarget, recentMessages, contextTitle;

      // Fetch all non-flow messages, distinguishing between "already-read context" and "new unread messages"
      let allVisibleMessages;
      if (isDeptChat) {
        const deptId = groupId.replace('dept-', '');
        dept = this.company.findDepartment(deptId);
        if (!dept) return;
        chatTarget = dept;  // addGroupMessage target
        contextTitle = `${dept.name} Department Chat`;
        allVisibleMessages = (dept.groupChat || []).filter(m => m.visibility !== 'flow');
      } else {
        const requirement = this.company.requirementManager.get(groupId);
        if (!requirement) return;
        dept = this.company.findDepartment(requirement.departmentId);
        if (!dept) return;
        chatTarget = requirement;
        contextTitle = requirement.title;
        allVisibleMessages = (requirement.groupChat || []).filter(m => m.visibility !== 'flow');
      }

      // Use lastReadIndex to distinguish read vs unread
      // Note: lastReadIndex tracks the raw groupChat array index (including flow messages)
      // Here we use the message snapshot count from the last flow processing to distinguish
      const contextKey = `${agent.id}:${groupId}:lastProcessed`;
      const lastProcessedCount = this._lastProcessedVisible.get(contextKey) || 0;
      
      // Already-read context: previously processed messages (keep at most 10 for context)
      const readContext = allVisibleMessages.slice(0, lastProcessedCount).slice(-10);
      // New unread messages: messages since the last processing
      const unreadNew = allVisibleMessages.slice(lastProcessedCount);
      
      // Update processed count
      this._lastProcessedVisible.set(contextKey, allVisibleMessages.length);
      
      // Merge into final recentMessages (with read/unread markers)
      recentMessages = [
        ...readContext.map(m => ({ ...m, _isRead: true })),
        ...unreadNew.map(m => ({ ...m, _isRead: false })),
      ];
      
      // If no new unread messages (e.g. triggerImmediate called again), skip
      if (unreadNew.length === 0 && !isMentioned) {
        return;
      }

      // 1.5 Short random wait (5-20s) to stagger processing times across different agents
      // so that replies from agents processed first appear in the context of later ones
      const jitter = 5000 + Math.random() * 15000;
      await this._delay(jitter);

      // 1.6 After waiting, re-fetch the latest messages (other agents may have replied)
      let freshVisibleMessages;
      if (isDeptChat) {
        freshVisibleMessages = (chatTarget.groupChat || []).filter(m => m.visibility !== 'flow');
      } else {
        freshVisibleMessages = (chatTarget.groupChat || []).filter(m => m.visibility !== 'flow');
      }
      // If new messages appeared (another agent replied first), update context
      if (freshVisibleMessages.length > allVisibleMessages.length) {
        const extraMessages = freshVisibleMessages.slice(allVisibleMessages.length);
        recentMessages = [
          ...recentMessages,
          ...extraMessages.map(m => ({ ...m, _isRead: false })),
        ];
        // Update the processed count
        this._lastProcessedVisible.set(contextKey, freshVisibleMessages.length);
      }

      // 2. Create flow state
      const monologue = new InnerMonologue(agent.id, agent.name, groupId);
      this._activeMonologues.set(key, monologue);

      // Notify frontend: Agent entered flow state
      this.emit('monologue:start', {
        agentId: agent.id,
        agentName: agent.name,
        groupId,
      });

      // 3. Call LLM for flow thinking
      const thinkingResult = await this._agentThink(
        agent, { id: groupId, title: contextTitle }, dept, recentMessages, isMentioned, monologue
      );

      // 3.5. If the monologue is empty (fallback mode), add a thought from reason
      if (monologue.thoughts.length === 0 && thinkingResult.reason) {
        monologue.addThought(thinkingResult.reason);
      }

      // 3.6. Write inner monologue into the group message stream (type='monologue', visibility='flow')
      //      Frontend retrieves it via API filtering type==='monologue' (boss peek feature)
      const innerThoughtsContent = thinkingResult.innerThoughts || thinkingResult.reason || null;
      if (innerThoughtsContent) {
        chatTarget.addGroupMessage(
          {
            id: agent.id,
            name: agent.name,
            avatar: agent.avatar,
            role: agent.role,
          },
          innerThoughtsContent,
          'monologue',
          'flow'
        );
      }

    // 4. Topic saturation gate: if LLM reports high saturation, force silence
    //    This replaces the old random silence — now based on the AI's own assessment of topic exhaustion
    const topicSaturation = thinkingResult.topicSaturation || 0;
    if (thinkingResult.shouldSpeak && topicSaturation >= this.config.topicSaturationThreshold && !isMentioned) {
      console.log(`  🎯 [GroupChatLoop] ${agent.name} silenced by topic saturation (score=${topicSaturation} >= ${this.config.topicSaturationThreshold})`);
      thinkingResult.shouldSpeak = false;
      thinkingResult.reason = `Topic saturation: ${topicSaturation}/10 — topic is exhausted, staying quiet`;
      monologue.addThought(getPromptLocale().prompt.monologue.topicSaturated(topicSaturation));
    }

      // 4.1. Cooldown check: if agent spoke recently, force silence
      if (thinkingResult.shouldSpeak) {
        const spamRecheck = this._getSpamInfo(agent.id, groupId, isDeptChat);
        if (spamRecheck.isOnCooldown) {
          console.log(`  🕐 [GroupChatLoop] ${agent.name} on cooldown, suppressing`);
          thinkingResult.shouldSpeak = false;
          thinkingResult.reason = 'On cooldown after recent speak';
          monologue.addThought(getPromptLocale().prompt.monologue.cooldownSilence);
        }
      }

      // 4.2. Decide whether to speak based on flow result
      if (thinkingResult.shouldSpeak) {
        const messagesToSend = thinkingResult.messages || [];
        
        for (const msg of messagesToSend.slice(0, this.config.maxGroupMessagesPerTurn)) {
          // Send to group chat (works for both requirement and department)
          chatTarget.addGroupMessage(
            {
              id: agent.id,
              name: agent.name,
              avatar: agent.avatar,
              role: agent.role,
            },
            msg.content,
            'message'
          );

          monologue.addThought(`[Sent to group] ${msg.content}`);
          
          // Update group last activity time
          this._lastGroupActivity.set(groupId, new Date());

          // Record this speak event for anti-spam tracking
          this._recordSpeak(agent.id, groupId);

          // Trigger the flow loop for all other members in the group (both @mentioned and not)
          // All use random delays so different members see the message at different times, for a natural rhythm
          const allGroupMembers = dept.getMembers();
          for (const member of allGroupMembers) {
            if (member.id === agent.id) continue;  // Skip self
            // Random delay of 30s-5min, consistent with normal poll rhythm, not too fast
            const nudgeDelay = this.config.pollIntervalMinMs + Math.random() * (this.config.pollIntervalMaxMs - this.config.pollIntervalMinMs);
            setTimeout(() => {
              this._nudgeAgentForGroup(member.id, groupId).catch(() => {});
            }, nudgeDelay);
          }
        }

        // Save company state
        this.company.save();
      }

      // 5. Update flow state
      monologue.status = 'done';
      monologue.decision = thinkingResult.shouldSpeak ? 'spoke' : 'silent';

      // Save to history
      if (!this._monologueHistory.has(key)) {
        this._monologueHistory.set(key, []);
      }
      const history = this._monologueHistory.get(key);
      history.push(monologue);
      // Keep only the latest 20 records
      if (history.length > 20) {
        this._monologueHistory.set(key, history.slice(-20));
      }

      // Remove from active list
      this._activeMonologues.delete(key);

      // 6. Save Agent memory (inner monologue summary for context in the next flow thinking round)
      const memoryKey = `${agent.id}:${groupId}`;
      if (!this._agentMemory.has(memoryKey)) {
        this._agentMemory.set(memoryKey, []);
      }
      const memory = this._agentMemory.get(memoryKey);
      // Take the last inner thought (excluding [Sent to group] and [Self-regulation] prefix) as the memory
      const memoryThoughts = monologue.thoughts
        .filter(t => !t.content.startsWith('[Sent to group]') && !t.content.startsWith('[Self-regulation]'))
        .map(t => t.content);
      if (memoryThoughts.length > 0) {
        const summary = memoryThoughts[memoryThoughts.length - 1];
        const action = monologue.decision === 'spoke' ? '[spoke]' : '[silent]';
        memory.push(`${action} ${summary.slice(0, 200)}`);
        // Keep only the latest 10 memories
        if (memory.length > 10) {
          this._agentMemory.set(memoryKey, memory.slice(-10));
        }
      }

      // Notify frontend
      this.emit('monologue:end', {
        agentId: agent.id,
        agentName: agent.name,
        groupId,
        decision: monologue.decision,
        thoughtCount: monologue.thoughts.length,
      });

    } catch (error) {
      console.error(`  ❌ [GroupChatLoop] ${agent.name} process error in ${groupId}:`, error.message);
      this._activeMonologues.delete(key);
    } finally {
      this._processing.delete(key);
    }
  }

  /**
   * Agent flow thinking — Core LLM call
   * 
   * Inner monologue process after Agent reads group messages:
   * - Analyze context
   * - Decide whether to speak
   * - If so, generate speaking content
   * 
   * @returns {{ shouldSpeak: boolean, messages: Array<{content: string}>, reason: string }}
   */
  async _agentThink(agent, requirement, dept, recentMessages, isMentioned, monologue) {
    // Build group member list
    const members = dept.getMembers().map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
    }));

    // Build chat context — distinguish between already-read context and new unread messages
    const readMessages = recentMessages.filter(m => m._isRead);
    const unreadMessages = recentMessages.filter(m => !m._isRead);
    
    const formatMsg = (msg) => {
      const senderName = msg.from?.name || 'Unknown';
      const time = new Date(msg.time).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' });
      if (msg.type === 'system') return `[System] ${msg.content}`;
      const selfMark = msg.from?.id === agent.id ? ' (you)' : '';
      return `[${time}] ${senderName}${selfMark}: ${msg.content}`;
    };

    // Detect if other colleagues have already replied to the same batch of messages (prevent duplicate replies)
    const loc = getPromptLocale();
    const colleagueReplies = unreadMessages.filter(m => 
      m.from?.id !== agent.id && m.from?.id !== 'boss' && members.some(mem => mem.id === m.from?.id)
    );
    const dedupeWarning = colleagueReplies.length > 0
      ? loc.prompt.context.dedupeWarning(
          colleagueReplies.length,
          colleagueReplies.map(m => `- ${m.from?.name}: "${(m.content || '').slice(0, 80)}"`).join('\n')
        )
      : '';

    // Generate a random "thinking angle seed" per agent, forcing different agents to approach from different angles
    const angles = loc.prompt.angles;
    const myAngle = angles[Math.floor(Math.random() * angles.length)];
    const angleHint = loc.prompt.context.angleHint(myAngle);
    
    let chatContext = '';
    if (readMessages.length > 0) {
      chatContext += loc.prompt.context.readHeader + '\n';
      chatContext += readMessages.map(formatMsg).join('\n');
      chatContext += '\n\n';
    }
    if (unreadMessages.length > 0) {
      chatContext += loc.prompt.context.unreadHeader + '\n';
      chatContext += unreadMessages.map(formatMsg).join('\n');
    } else {
      chatContext += loc.prompt.context.noNewMessages;
    }
    chatContext += dedupeWarning;
    chatContext += angleHint;

    // Agent memory: previous inner monologue summaries (continuous context)
    const memoryKey = `${agent.id}:${requirement.id}`;
    const agentMemory = this._agentMemory.get(memoryKey) || [];
    const memoryContext = agentMemory.length > 0
      ? `\n\n**🧠 Your previous thoughts in this group (your memory):**\n${agentMemory.slice(-5).map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : '';

    const p = agent.personality;

    // Build anti-spam context info
    const groupId = requirement.id;
    const isDeptChat = groupId.startsWith('dept-');
    const spamInfo = this._getSpamInfo(agent.id, groupId, isDeptChat);

    // Build different prompts based on group type
    const systemPrompt = isDeptChat
      ? this._buildDeptChatPrompt(agent, p, requirement, members, memoryContext, spamInfo, isMentioned)
      : this._buildWorkChatPrompt(agent, p, requirement, members, memoryContext, spamInfo, isMentioned);
    // Get other agents currently thinking (lets the LLM know it's not the only one seeing this message)
    const thinkingPeers = [];
    for (const [mKey, mono] of this._activeMonologues) {
      if (mono.groupId === groupId && mono.agentId !== agent.id && mono.status === 'thinking') {
        thinkingPeers.push(mono.agentName);
      }
    }
    const thinkingInfo = thinkingPeers.length > 0
      ? loc.prompt.context.thinkingPeers(thinkingPeers.join(', '))
      : '';

    const userPrompt = isDeptChat
      ? loc.prompt.userPrompt.deptChat(chatContext, thinkingInfo, agent.name, agent.age, agent.personality.trait)
      : loc.prompt.userPrompt.workChat(chatContext, thinkingInfo, agent.name, agent.age, agent.personality.trait);

    try {
      // Check if Agent can do lightweight chat
      if (!agent.canChat()) {
        // No chat capability, use simple fallback rules
        return this._fallbackThink(agent, groupId, isMentioned, recentMessages);
      }

      const response = await agent.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], {
        temperature: 0.95,
        maxTokens: 1024,
      });

      // Parse JSON response
      const rawContent = response.content || '';
      let result;
      try {
        // Try direct parse
        result = JSON.parse(rawContent);
      } catch {
        // Try extracting from markdown code block
        const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[1].trim());
        } else {
          // Try finding the first { and last }
          const start = rawContent.indexOf('{');
          const end = rawContent.lastIndexOf('}');
          if (start !== -1 && end > start) {
            result = JSON.parse(rawContent.slice(start, end + 1));
          } else {
            throw new Error('Cannot parse LLM response as JSON');
          }
        }
      }

      // Record inner monologue (must have content)
      const thoughtContent = (result.innerThoughts && result.innerThoughts.trim())
        ? result.innerThoughts.trim()
        : result.reason
          ? `[Inner thought] ${result.reason}`
          : `[Read group messages, processing...]`;
      monologue.addThought(thoughtContent);

      // Anti-spam gate: if agent has been speaking too frequently, suppress output
      const spamCheck = this._getSpamInfo(agent.id, requirement.id, isDeptChat);
      const maxMessages = isDeptChat ? this.config.deptAntiSpamMaxMessages : this.config.antiSpamMaxMessages;
      if (result.shouldSpeak && spamCheck.recentCount >= maxMessages) {
        console.log(`  🔇 [GroupChatLoop] ${agent.name} suppressed (anti-spam: ${spamCheck.recentCount} msgs in window)`);
        result.shouldSpeak = false;
        result.reason = `Anti-spam: already sent ${spamCheck.recentCount} messages recently, staying silent`;
        result.messages = [];
        monologue.addThought(`[Self-regulation] I wanted to speak but I've been too active recently. Better stay quiet and let others talk.`);
      }

      // Limit to max 1 message per turn to prevent flooding
      if (result.messages && result.messages.length > 1) {
        result.messages = [result.messages[0]];
      }

      return {
        shouldSpeak: !!result.shouldSpeak,
        messages: (result.messages || []).filter(m => m.content && m.content.trim()),
        reason: result.reason || '',
        innerThoughts: thoughtContent,
        topicSaturation: typeof result.topicSaturation === 'number' ? result.topicSaturation : 0,
      };

    } catch (error) {
      console.warn(`  ⚠️ [GroupChatLoop] ${agent.name} LLM think error:`, error.message);
      return this._fallbackThink(agent, groupId, isMentioned, recentMessages);
    }
  }

  /**
   * Build the system prompt for department casual chat — encourages natural interaction, relaxed rules
   */
  _buildDeptChatPrompt(agent, p, requirement, members, memoryContext, spamInfo, isMentioned) {
    const loc = getPromptLocale();
    const genderLabel = loc.prompt.genderLabel[agent.gender] || loc.prompt.genderLabel.male;
    const ageStyle = getAgeStyle(agent.age);
    const traitStyle = getTraitStyle(p.trait);
    const fewShot = getFewShotExamples(p.trait);
    const memberList = members.map(m => `${m.name}(${m.role})`).join(', ');
    const pt = loc.prompt.deptChat;
    return `${traitStyle}

${pt.intro(agent.name, genderLabel, agent.age, agent.role, p.tone, p.quirk, agent.signature)}

${pt.ageIntro}
${ageStyle}

---

${pt.groupContext(requirement.title, memberList)}
${memoryContext}

${pt.examplesHeader}

${fewShot}

${pt.rules(spamInfo.recentCount, isMentioned)}

${pt.topicSaturation}

${pt.outputFormat}

${pt.antiAIWarning(agent.age)}`;
  }

  /**
   * Build the system prompt for a requirement work group
   */
  _buildWorkChatPrompt(agent, p, requirement, members, memoryContext, spamInfo, isMentioned) {
    const loc = getPromptLocale();
    const genderLabel = loc.prompt.genderLabel[agent.gender] || loc.prompt.genderLabel.male;
    const ageStyle = getAgeStyle(agent.age);
    const traitStyle = getTraitStyle(p.trait);
    const fewShot = getFewShotExamples(p.trait);
    const memberList = members.map(m => `${m.name}(${m.role})`).join(', ');
    const pt = loc.prompt.workChat;
    return `${traitStyle}

${pt.intro(agent.name, genderLabel, agent.age, agent.role, p.tone, p.quirk, agent.signature)}

${pt.ageIntro}
${ageStyle}

---

${pt.groupContext(requirement.title, memberList)}
${memoryContext}

${pt.examplesHeader}

${fewShot}

${pt.shouldSpeak}

${pt.shouldNotSpeak(spamInfo.recentCount, spamInfo.isOnCooldown, isMentioned)}

${pt.topicSaturation}

${pt.outputFormat}

${pt.antiAIWarning(agent.age)}`;
  }

  /**
   * Get speaking style based on age — delegates to prompt-locale
   */
  _getAgeStyle(age) {
    return getAgeStyle(age);
  }

  /**
   * Return first-person role-anchoring text based on personality type — delegates to prompt-locale
   */
  _getTraitStyle(trait) {
    return getTraitStyle(trait);
  }

  /**
   * Return scenario-based few-shot examples based on personality type — delegates to prompt-locale
   */
  _getFewShotExamples(trait) {
    return getFewShotExamples(trait);
  }

  /**
   * Fallback flow logic when LLM is unavailable
   * @param {object} agent
   * @param {string} groupId - Group chat ID
   * @param {boolean} isMentioned
   * @param {Array} recentMessages
   */
  _fallbackThink(agent, groupId, isMentioned, recentMessages) {
    // Even in fallback mode, respect anti-spam limits
    const isDeptChat = groupId.startsWith('dept-');
    const spamCheck = this._getSpamInfo(agent.id, groupId, isDeptChat);
    const maxMessages = isDeptChat ? this.config.deptAntiSpamMaxMessages : this.config.antiSpamMaxMessages;
    if (spamCheck.recentCount >= maxMessages) {
      return {
        shouldSpeak: false,
        messages: [],
        reason: 'Anti-spam: too many recent messages, staying silent even in fallback',
      };
    }

    // Select different fallback replies based on personality — from prompt-locale
    const trait = agent.personality?.trait || '';
    const replies = getFallbackReplies(trait);

    // Department casual group: also more proactive in fallback mode
    if (isDeptChat) {
      const lastMsg = recentMessages[recentMessages.length - 1];
      if (lastMsg && lastMsg.from?.id !== agent.id) {
        return {
          shouldSpeak: true,
          messages: [{ content: replies.dept }],
          reason: 'Department chat fallback: casual reply to colleague',
        };
      }
    }

    // Check if the last message was from the boss
    const lastMsg = recentMessages[recentMessages.length - 1];
    if (lastMsg && lastMsg.from?.id === 'boss') {
      return {
        shouldSpeak: true,
        messages: [{ content: replies.boss }],
        reason: 'Boss sent a message in the group, using fallback reply',
      };
    }

    // If explicitly @mentioned, give a brief acknowledgement
    if (isMentioned) {
      return {
        shouldSpeak: true,
        messages: [{ content: replies.mention }],
        reason: 'Mentioned by someone, using fallback reply',
      };
    }

    return {
      shouldSpeak: false,
      messages: [],
      reason: 'LLM unavailable, staying silent in fallback mode to avoid noise',
    };
  }

  /**
   * Gently nudge an agent to check a group chat for new messages (without setting isMentioned, letting the agent decide whether to reply)
   * Difference from triggerImmediate: isMentioned is not set here, so urgency is lower
   */
  async _nudgeAgentForGroup(agentId, groupId) {
    if (!this.running || !this.company) return;
    const agent = this._findAgent(agentId);
    if (!agent) return;
    await this._processGroupMessages(agent, groupId, false /* isMentioned */);
  }

  // ========================================================================
  // Anti-Spam & Rate Limiting
  // ========================================================================

  /**
   * Record a speak event for anti-spam tracking
   */
  _recordSpeak(agentId, groupId) {
    const key = `${agentId}:${groupId}`;
    if (!this._recentSpeaks.has(key)) {
      this._recentSpeaks.set(key, []);
    }
    this._recentSpeaks.get(key).push(Date.now());
  }

  /**
   * Get anti-spam info for an agent in a group
   * @param {boolean} isDeptChat - Whether this is a department casual group (uses more relaxed limits)
   * @returns {{ recentCount: number, isOnCooldown: boolean }}
   */
  _getSpamInfo(agentId, groupId, isDeptChat = false) {
    const key = `${agentId}:${groupId}`;
    const timestamps = this._recentSpeaks.get(key) || [];
    const now = Date.now();
    const windowMs = isDeptChat ? this.config.deptAntiSpamWindowMs : this.config.antiSpamWindowMs;
    const cooldownMs = isDeptChat ? this.config.deptCooldownAfterSpeakMs : this.config.cooldownAfterSpeakMs;
    const windowStart = now - windowMs;
    const cooldownStart = now - cooldownMs;

    // Clean up old timestamps outside the window
    const recentTimestamps = timestamps.filter(t => t > windowStart);
    this._recentSpeaks.set(key, recentTimestamps);

    return {
      recentCount: recentTimestamps.length,
      isOnCooldown: recentTimestamps.some(t => t > cooldownStart),
    };
  }

  /**
   * Self-check: if a workflow task is stuck on this agent, nudge progress
   * This ensures that when the workflow is stalled on a particular agent,
   * they periodically check in and report status to the group
   */
  async _selfCheckWorkflow(agent, group) {
    if (!group.requirement?.workflow?.nodes) return;

    const key = `${agent.id}:${group.id}`;
    const now = Date.now();
    const lastCheck = this._lastSelfCheck.get(key) || 0;

    // Rate limit self-checks
    if (now - lastCheck < this.config.selfCheckIntervalMs) return;

    const nodes = group.requirement.workflow.nodes;

    // Find nodes that are stuck on this agent (running/reviewing/revision for a while)
    const myStuckNodes = nodes.filter(n => {
      if (n.assigneeId !== agent.id && n.reviewerId !== agent.id) return false;
      if (!['running', 'reviewing', 'revision'].includes(n.status)) return false;
      if (!n.startedAt) return false;
      const elapsed = now - new Date(n.startedAt).getTime();
      return elapsed > this.config.stuckThresholdMs;
    });

    if (myStuckNodes.length === 0) return;

    // Update last self-check time
    this._lastSelfCheck.set(key, now);

    // Check if group chat has been quiet (no messages from this agent recently)
    const recentGroupMessages = (group.requirement.groupChat || [])
      .filter(m => m.visibility !== 'flow')
      .slice(-10);

    const myRecentMessages = recentGroupMessages.filter(
      m => m.from?.id === agent.id && m.type === 'message'
    );

    // If agent has spoken very recently about this, skip
    if (myRecentMessages.length > 0) {
      const lastMsgTime = new Date(myRecentMessages[myRecentMessages.length - 1].time).getTime();
      if (now - lastMsgTime < this.config.selfCheckIntervalMs * 2) return;
    }

    // Anti-spam check
    const spamCheck = this._getSpamInfo(agent.id, group.id);
    if (spamCheck.recentCount >= this.config.antiSpamMaxMessages) return;

    // Generate a self-check message to the group
    for (const node of myStuckNodes.slice(0, 1)) { // Only nudge for the first stuck node
      const elapsed = Math.round((now - new Date(node.startedAt).getTime()) / 1000);
      const isReviewer = node.reviewerId === agent.id;

      // Determine what kind of check-in to post
      let checkInContent;
      if (isReviewer && node.status === 'reviewing') {
        checkInContent = `🔍 Still reviewing "${node.title}" (${elapsed}s elapsed). Working on it...`;
      } else if (node.status === 'revision') {
        checkInContent = `✏️ Working on revisions for "${node.title}" (${elapsed}s elapsed). Making progress...`;
      } else {
        checkInContent = `⚙️ Still working on "${node.title}" (${elapsed}s elapsed). Will update when I have results.`;
      }

      // Send to group chat
      group.requirement.addGroupMessage(
        {
          id: agent.id,
          name: agent.name,
          avatar: agent.avatar,
          role: agent.role,
        },
        checkInContent,
        'message'
      );

      this._recordSpeak(agent.id, group.id);
      this._lastGroupActivity.set(group.id, new Date());

      console.log(`  🔔 [GroupChatLoop] ${agent.name} self-check: ${checkInContent}`);
    }
  }

  /**
   * Detect idle chat group and proactively initiate topics
   */
  async _maybeInitiateChat(agent, group) {
    const lastActivity = this._lastGroupActivity.get(group.id);
    if (!lastActivity) return;

    const idleMs = Date.now() - lastActivity.getTime();
    // Department chat group: use shorter idle threshold
    const threshold = group.type === 'chat' ? this.config.deptIdleChatThresholdMs : this.config.idleChatThresholdMs;
    if (idleMs < threshold) return;

    // Only proactively speak in chat groups
    if (group.type !== 'chat') return;

    // Random probability to decide whether to speak (avoid all Agents speaking at once)
    // Department groups use a lower probability (15%) — don't proactively initiate too frequently
    if (Math.random() > 0.15) return;

    // Trigger a flow thinking round, let LLM decide whether to proactively start a topic
    console.log(`  💬 [GroupChatLoop] ${agent.name} considering initiating a topic in idle group ${group.title}`);
    await this._processGroupMessages(agent, group.id, false);
  }

  /**
   * Detect if a message @mentions a specific Agent
   */
  _isMentionedInMessage(agent, message) {
    if (!message.content || typeof message.content !== 'string') return false;
    const content = message.content;

    // New format: @[agentId]
    if (content.includes(`@[${agent.id}]`)) return true;

    // Legacy format: @AgentName
    if (content.includes(`@${agent.name}`)) return true;

    // @all variants
    if (content.includes('@all') || content.includes('@everyone')) return true;

    return false;
  }

  /**
   * Extract @mentioned Agent IDs from message content
   */
  _extractMentions(content, dept) {
    if (!content || typeof content !== 'string') return [];
    
    const mentionedIds = [];

    // New format: @[agentId]
    const newFormatMatches = content.matchAll(/@\[([^\]]+)\]/g);
    for (const match of newFormatMatches) {
      mentionedIds.push(match[1]);
    }

    // Legacy format: @AgentName
    if (dept) {
      const members = dept.getMembers();
      for (const member of members) {
        if (content.includes(`@${member.name}`)) {
          mentionedIds.push(member.id);
        }
      }
    }

    return [...new Set(mentionedIds)];
  }

  /**
   * Find Agent instance
   */
  _findAgent(agentId) {
    if (!this.company) return null;
    for (const dept of this.company.departments.values()) {
      const agent = dept.agents.get(agentId);
      if (agent) return agent;
    }
    return null;
  }

  /**
   * Delay utility
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Serialize state (for persistence)
   */
  serialize() {
    const lastReadIndex = {};
    for (const [key, val] of this._lastReadIndex) {
      lastReadIndex[key] = val;
    }
    const lastProcessedVisible = {};
    for (const [key, val] of this._lastProcessedVisible) {
      lastProcessedVisible[key] = val;
    }
    const agentMemory = {};
    for (const [key, val] of this._agentMemory) {
      agentMemory[key] = val;
    }
    return { lastReadIndex, lastProcessedVisible, agentMemory };
  }

  /**
   * Restore state
   */
  restore(data) {
    if (!data) return;
    if (data.lastReadIndex) {
      for (const [key, val] of Object.entries(data.lastReadIndex)) {
        this._lastReadIndex.set(key, val);
      }
    }
    if (data.lastProcessedVisible) {
      for (const [key, val] of Object.entries(data.lastProcessedVisible)) {
        this._lastProcessedVisible.set(key, val);
      }
    }
    if (data.agentMemory) {
      for (const [key, val] of Object.entries(data.agentMemory)) {
        this._agentMemory.set(key, val);
      }
    }
  }
}

// Global singleton
export const groupChatLoop = new GroupChatLoop();
