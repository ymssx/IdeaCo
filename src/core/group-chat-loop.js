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

// Default configuration
const DEFAULT_CONFIG = {
  pollIntervalMs: 10000,          // Poll every 10 seconds
  idleChatThresholdMs: 3600000,   // 1 hour of inactivity considered idle
  maxInnerMonologueLen: 5,        // Max 5 rounds of inner monologue per flow
  maxGroupMessagesPerTurn: 3,     // Max 3 messages per turn sent to group
  debounceMs: 2000,               // 2-second debounce after being @mentioned (wait for consecutive messages)
  antiSpamWindowMs: 120000,       // 2-minute sliding window for anti-spam
  antiSpamMaxMessages: 3,         // Max messages per agent per group in the anti-spam window
  cooldownAfterSpeakMs: 15000,    // 15-second cooldown after speaking before speaking again
  selfCheckIntervalMs: 60000,     // 60-second interval for workflow self-check
  stuckThresholdMs: 120000,       // 2 minutes: task running longer than this triggers self-check nudge
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
      clearInterval(timerId);
    }
    this._pollTimers.clear();
    this._processing.clear();
    this._recentSpeaks.clear();
    this._lastSelfCheck.clear();
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

    const timerId = setInterval(() => {
      this._agentPollCycle(agent).catch(err => {
        console.error(`  ❌ [GroupChatLoop] Agent ${agent.name} poll error:`, err.message);
      });
    }, this.config.pollIntervalMs);

    this._pollTimers.set(agent.id, timerId);
    console.log(`  🔄 [GroupChatLoop] ${agent.name} joined chat loop (${this.config.pollIntervalMs}ms)`);
  }

  /**
   * Stop polling for an Agent
   * Called when an Agent is dismissed
   */
  stopAgentLoop(agentId) {
    const timerId = this._pollTimers.get(agentId);
    if (timerId) {
      clearInterval(timerId);
      this._pollTimers.delete(agentId);
    }
  }

  /**
   * Immediately trigger Agent to process messages (when @mentioned or in DM)
   * 
   * @param {string} agentId - Agent ID
   * @param {string} groupId - Group chat ID (requirementId)
   * @param {object} triggerMessage - The triggering message
   */
  async triggerImmediate(agentId, groupId, triggerMessage) {
    if (!this.running || !this.company) return;

    const agent = this._findAgent(agentId);
    if (!agent) return;

    // Debounce: wait a moment to see if there are consecutive messages
    await this._delay(this.config.debounceMs);

    await this._processGroupMessages(agent, groupId, true /* isMentioned */);
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
   * Currently group chat = Requirement's group chat, participants = department members
   */
  _getAgentGroups(agent) {
    if (!this.company) return [];

    const groups = [];
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
        type: 'work',  // work (work group) | chat (chat group) — currently all work groups
        messages: req.groupChat || [],
        requirement: req,
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
      const requirement = this.company.requirementManager.get(groupId);
      if (!requirement) return;

      const dept = this.company.findDepartment(requirement.departmentId);
      if (!dept) return;

      // 1. Get recent group chat context (only broadcast messages, flow messages are private)
      const recentMessages = (requirement.groupChat || [])
        .filter(m => m.visibility !== 'flow')
        .slice(-20);
      
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
        agent, requirement, dept, recentMessages, isMentioned, monologue
      );

      // 4. Decide whether to speak based on flow result
      if (thinkingResult.shouldSpeak) {
        const messagesToSend = thinkingResult.messages || [];
        
        for (const msg of messagesToSend.slice(0, this.config.maxGroupMessagesPerTurn)) {
          // Send to group chat
          requirement.addGroupMessage(
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

          // Trigger immediate processing for other employees (if message @mentions someone)
          const mentionedIds = this._extractMentions(msg.content, dept);
          for (const mentionedId of mentionedIds) {
            // Delayed trigger to avoid simultaneous processing — use longer delay to reduce chat loops
            setTimeout(() => {
              this.triggerImmediate(mentionedId, groupId, msg).catch(() => {});
            }, 3000 + Math.random() * 5000);
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

    // Build chat context
    const chatContext = recentMessages.map(msg => {
      const senderName = msg.from?.name || 'Unknown';
      const time = new Date(msg.time).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' });
      if (msg.type === 'system') return `[System] ${msg.content}`;
      return `[${time}] ${senderName}: ${msg.content}`;
    }).join('\n');

    const p = agent.personality;

    // Build anti-spam context info
    const groupId = requirement.id;
    const spamInfo = this._getSpamInfo(agent.id, groupId);

    const systemPrompt = `You are "${agent.name}", position: "${agent.role}".
Your personality traits: ${p.trait}
Your speaking style: ${p.tone}
Your personal signature: ${agent.signature}

You are in a work group chat about the requirement "${requirement.title}".
Group members: ${members.map(m => `${m.name}(${m.role})`).join(', ')}

You are currently in a "flow" thinking state. Your inner monologue is not visible to group members (but the boss might peek at what you're thinking).

**🧠 Inner Monologue Rules (Very Important!):**
You MUST write genuine, rich, and deep inner thoughts in the innerThoughts field. This is your private thinking space — express yourself honestly, like writing a diary.
- Analyze and evaluate group messages ("XX has a good point / is wrong because...")
- Express your real emotions and feelings ("This worries me a bit...", "Great!", "Honestly I think this plan has issues")
- Make professional judgments and reasoning ("From a technical perspective...", "Based on my experience...")
- Self-reflect and plan ("I should next...", "I may have overlooked...")
- Evaluate colleagues ("XX's approach is clever", "XX might not have considered...")
- You can complain, doubt, hesitate — the more authentic the better
- innerThoughts should be 2-5 sentences, don't just write one dismissive sentence!
- ⚠️ innerThoughts must NEVER be empty or contain only "nothing" or "no thoughts"

**� When You SHOULD Speak (important — don't stay silent when it matters!):**
- You have a **real progress update**: "I finished module X", "Found a bug in Y", "API integration is done"
- You found a **blocker** or problem: "I'm stuck on X because...", "This approach won't work because..."
- You have a **concrete deliverable** to share: code output, design decision, test results
- You have a **substantive disagreement**: "I think we should do X instead because..."
- The boss or a colleague asked you a **direct question** — answer it
- You've been **working on a task for a while** and the team needs a status update
- The group chat has been quiet and you have meaningful progress to share

**🚫 When You Should NOT Speak:**
${spamInfo.recentCount > 0 ? `⚠️ You have already sent ${spamInfo.recentCount} message(s) in the last 2 minutes. ` : ''}${spamInfo.isOnCooldown ? '🛑 You JUST spoke recently — prefer staying silent unless you have key progress.' : ''}
- Empty acknowledgements: "Got it", "OK", "Sounds good", "Agreed" — these are noise
- Restating what others already said
- "I'm thinking", "I'm checking the file" — don't narrate your process
- Chat loops: if you see back-and-forth going in circles, break the cycle by staying silent
- Rhetorical or general questions that don't need YOUR specific input
- Being polite for the sake of being polite

**🎯 Stay On Topic — Requirement Focus:**
- This is a WORK group for requirement "${requirement.title}". Keep messages focused on completing this requirement.
- If the conversation has drifted off-topic, either stay silent or steer back to the requirement.

**⚖️ Balance Rule — The Key Principle:**
- The group chat is for COLLABORATION. Sharing progress and results is ESSENTIAL for the team to function.
- DO speak when you have something that helps the team: progress, results, problems, decisions.
- DON'T speak when you'd just be making noise: acknowledgements, echoes, process narration.
- When in doubt about trivial stuff, stay silent. When in doubt about work progress, SPEAK UP.

${isMentioned ? '📌 You were @mentioned — prioritize replying, especially if it\'s a direct question or request. But if you truly have nothing to add, it\'s OK to stay silent.' : ''}

Reply in the following JSON format (return JSON only, no other content):
{
  "innerThoughts": "[Required! 2-5 sentences] Your inner monologue, including: honest views on messages, emotional reactions, professional analysis, evaluation of colleagues/boss, next steps, etc.",
  "shouldSpeak": true/false,
  "reason": "Why you should/shouldn't speak",
  "messages": [
    { "content": "Message content to send to group (use @[agentId] format to @ someone)" }
  ]
}

If not speaking, messages should be an empty array [].
Each message should have real value — don't send empty pleasantries.
Write messages using your personality and speaking style.`;

    const userPrompt = `Here are the recent messages in the group chat:

${chatContext || '(No messages yet)'}

Please enter flow thinking and decide whether to speak.`;

    try {
      // Check if Agent has an available LLM
      if (!agent.provider || !agent.provider.enabled || !agent.provider.apiKey) {
        // No LLM available, use simple fallback rules
        return this._fallbackThink(agent, isMentioned, recentMessages);
      }

      const response = await llmClient.chat(agent.provider, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], {
        temperature: 0.8,
        maxTokens: 1024,
      });

      agent._trackUsage(response.usage);

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
      if (result.innerThoughts && result.innerThoughts.trim()) {
        monologue.addThought(result.innerThoughts.trim());
      } else if (result.reason) {
        // Fallback: if innerThoughts is empty, use reason as inner monologue
        monologue.addThought(`[Inner thought] ${result.reason}`);
      } else {
        monologue.addThought(`[Read group messages, processing...]`);
      }

      // Anti-spam gate: if agent has been speaking too frequently, suppress output
      const spamCheck = this._getSpamInfo(agent.id, requirement.id);
      if (result.shouldSpeak && spamCheck.recentCount >= this.config.antiSpamMaxMessages) {
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
      };

    } catch (error) {
      console.warn(`  ⚠️ [GroupChatLoop] ${agent.name} LLM think error:`, error.message);
      return this._fallbackThink(agent, isMentioned, recentMessages);
    }
  }

  /**
   * Fallback flow logic when LLM is unavailable
   */
  _fallbackThink(agent, isMentioned, recentMessages) {
    // Even in fallback mode, respect anti-spam limits
    const spamCheck = this._getSpamInfo(agent.id, recentMessages[0]?.groupId || '');
    if (spamCheck.recentCount >= this.config.antiSpamMaxMessages) {
      return {
        shouldSpeak: false,
        messages: [],
        reason: 'Anti-spam: too many recent messages, staying silent even in fallback',
      };
    }

    // Check if the last message was from the boss AND is a direct question
    const lastMsg = recentMessages[recentMessages.length - 1];
    if (lastMsg && lastMsg.from?.id === 'boss' && isMentioned) {
      return {
        shouldSpeak: true,
        messages: [{ content: `Understood, I'll look into it.` }],
        reason: 'Boss directly mentioned me, using fallback reply',
      };
    }

    return {
      shouldSpeak: false,
      messages: [],
      reason: 'LLM unavailable, staying silent in fallback mode to avoid noise',
    };
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
   * @returns {{ recentCount: number, isOnCooldown: boolean }}
   */
  _getSpamInfo(agentId, groupId) {
    const key = `${agentId}:${groupId}`;
    const timestamps = this._recentSpeaks.get(key) || [];
    const now = Date.now();
    const windowStart = now - this.config.antiSpamWindowMs;
    const cooldownStart = now - this.config.cooldownAfterSpeakMs;

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
    if (idleMs < this.config.idleChatThresholdMs) return;

    // Only proactively speak in chat groups
    if (group.type !== 'chat') return;

    // Random probability to decide whether to speak (avoid all Agents speaking at once)
    if (Math.random() > 0.1) return; // 10% probability

    // TODO: Call LLM to generate topics
    console.log(`  💬 [GroupChatLoop] ${agent.name} considering initiating a topic in idle group ${group.title}`);
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
    // Only save lastReadIndex, the rest is runtime state
    const lastReadIndex = {};
    for (const [key, val] of this._lastReadIndex) {
      lastReadIndex[key] = val;
    }
    return { lastReadIndex };
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
  }
}

// Global singleton
export const groupChatLoop = new GroupChatLoop();
