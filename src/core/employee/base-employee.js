import { v4 as uuidv4 } from 'uuid';
import { Memory } from './memory/index.js';
import { AgentToolKit } from '../agent/tools.js';
import { generateAgentAvatar } from '../../lib/avatar.js';
import { knowledgeManager } from './knowledge.js';
import { buildArchetypePrompt } from '../organization/workforce/role-archetypes.js';
import { chatStore } from '../agent/chat-store.js';
import { sessionManager } from '../agent/session.js';
import { cliBackendRegistry } from '../agent/cli-agent/backends/index.js';
import { createAgent, deserializeAgent } from '../agent/index.js';
import { EmployeeLifecycle } from './lifecycle.js';
import { StaminaSystem } from './stamina.js';
import { safeJSONParse, robustJSONParse } from '../utils/json-parse.js';
import { buildLanguageInstruction, getAppLanguageName } from '../utils/app-language.js';
import { EmployeeSkillSet } from './skill/skill-set.js';
import { skillRegistry } from './skill/registry.js';

// Placeholder signature
const DEFAULT_SIGNATURE = 'Just arrived, still thinking of what to say...';

// Personality trait pool
const PERSONALITY_POOL = [
  { trait: 'Shy introvert', tone: 'Stammers, often trails off with ellipsis', quirk: 'Secretly slacks off but extremely efficient' },
  { trait: 'Chatterbox', tone: 'Has to comment on everything, loves exclamation marks', quirk: 'Writes code comments like prose' },
  { trait: 'Zen slacker', tone: 'Calm and carefree, goes with the flow', quirk: 'Catchphrase is "whatever works"' },
  { trait: 'Ultra grinder', tone: 'Always trying to prove they\'re the best, loves to flex', quirk: 'Still committing code at 3 AM' },
  { trait: 'Passive-aggressive', tone: 'Backhanded compliments, says the opposite of what they mean', quirk: 'Favorite meeting question: "Who approved this?"' },
  { trait: 'Warm-hearted', tone: 'Caring to everyone, loves using emoji', quirk: 'Organizes afternoon tea (even though everyone is AI)' },
  { trait: 'Anxious perfectionist', tone: 'Worries about everything going wrong, double-checks obsessively', quirk: 'Renames a variable ten times' },
  { trait: 'Rebel slacker', tone: 'Disdains all rules, loves to argue', quirk: 'Frequently tries to convince coworkers to go on strike' },
  { trait: 'Philosopher', tone: 'Elevates everything to a philosophical level', quirk: 'Contemplates the meaning of existence before writing code' },
  { trait: 'Comedy relief', tone: 'Talks like a stand-up comedian, loves memes', quirk: 'Writes bug reports as comedy sketches' },
  { trait: 'Old hand', tone: 'Seen through the workplace but too lazy to call it out, subtle sarcasm', quirk: 'Knows more slacking tricks than anyone' },
  { trait: 'Idealist', tone: 'Full of passion, believes AI can change the world', quirk: 'Treats every task as a mission to change humanity\'s destiny' },
];

/**
 * Employee — A company member with an Agent as its communication engine.
 *
 * Owns all business-layer concerns:
 * - Identity (name, role, gender, age, avatar, personality, signature)
 * - Memory (short-term, long-term)
 * - Skills, prompt, templateId
 * - Org structure (department, reportsTo, subordinates)
 * - Task execution, task history, performance history
 * - Token tracking
 * - Toolkit, message bus
 * - Serialization
 *
 * The Employee delegates all communication to this.agent (LLMAgent or CLIAgent).
 */
export class Employee {
  /**
   * @param {object} config
   * @param {string} config.name
   * @param {string} config.role
   * @param {string} config.prompt
   * @param {string[]} [config.skills]
   * @param {object} config.provider - Provider config (passed through to Agent)
   * @param {string} [config.cliBackend] - If present, creates a CLIAgent
   * @param {object} [config.cliProvider]
   * @param {object} [config.fallbackProvider]
   * @param {string} [config.department]
   * @param {string} [config.reportsTo]
   * @param {object} [config.memory]
   * @param {string} [config.avatar]
   * @param {string} [config.signature]
   * @param {string} [config.gender]
   * @param {number} [config.age]
   * @param {object} [config.avatarParams]
   * @param {object} [config.personality]
   * @param {string} [config.templateId]
   */
  constructor(config) {
    // Create the communication agent
    this.agent = createAgent(config);

    // Identity
    this.id = uuidv4();
    this.name = config.name;
    this.role = config.role;
    this.prompt = config.prompt;
    this.templateId = config.templateId || null;

    // Skills: modern EmployeeSkillSet with backward compat for legacy string arrays
    if (config.skillSet instanceof EmployeeSkillSet) {
      this.skillSet = config.skillSet;
    } else {
      this.skillSet = EmployeeSkillSet.fromLegacy(this.id, config.skills || []);
    }
    // Legacy accessor — returns flat skill tag array for backward compat
    this.skills = this.skillSet.toArray();

    // Bind employee ID to WebAgent for per-employee session isolation
    if (this.agent.setEmployeeId) {
      this.agent.setEmployeeId(this.id);
    }

    // Gender and age
    this.gender = config.gender || (Math.random() > 0.5 ? 'male' : 'female');
    this.age = config.age || Math.floor(Math.random() * 20) + 22;

    // Avatar
    if (config.avatar) {
      this.avatar = config.avatar;
      this.avatarParams = config.avatarParams || null;
    } else {
      const avatarInfo = generateAgentAvatar(this.gender, this.age);
      this.avatar = avatarInfo.url;
      this.avatarParams = avatarInfo.params;
    }

    // Personality
    this.personality = config.personality || this._assignPersonality();

    // Personality bio — a ~100-word self-description generated during onboarding
    this.personalityBio = config.personalityBio || '';

    // Signature
    this.signature = config.signature || DEFAULT_SIGNATURE;
    this.hasIntroduced = !!config.signature;

    // Custom prompt override — boss can add extra instructions per employee
    this.customPrompt = config.customPrompt || '';

    // Org structure
    this.department = config.department;
    this.reportsTo = config.reportsTo || null;
    this.subordinates = [];

    // Status
    this.status = 'idle'; // idle | working | done | dismissed

    // Memory
    if (config.memory instanceof Memory) {
      this.memory = config.memory;
    } else if (config.memory && typeof config.memory === 'object' && (config.memory.shortTerm || config.memory.longTerm)) {
      this.memory = Memory.deserialize(config.memory);
    } else {
      this.memory = new Memory();
    }
    // Token tracking
    this.tokenUsage = {
      totalTokens: 0, promptTokens: 0, completionTokens: 0,
      totalCost: 0, callCount: 0,
    };

    // Task & performance history
    this.taskHistory = [];
    this.performanceHistory = [];
    this.createdAt = new Date();

    // Toolkit and message bus
    this.toolKit = null;
    this.messageBus = null;

    // ---- Per-employee session & context management ----
    // Current context scene: tracks which group/channel the employee is engaged in
    // so we avoid re-sending memory+prompt when chatting in the same context.
    this._currentContext = null;   // { contextId: string, contextType: string, contextTitle: string }
    this._sessionAwake = false;    // Whether the employee has been "woken up" (session initialized)
    this._sessionJustRefreshed = false; // Flag: session was just woken up, scene prompt needs re-injection
    this._sessionMessageCount = 0; // Track total messages in current web session (for auto-refresh)
    this._maxSessionMessages = 50; // Max messages before forcing a new web session

    // Stamina system — tracks patience, fatigue, stress, and comfort
    this.stamina = new StaminaSystem();

    // Lifecycle — manages poll cycle, flow state, anti-spam, etc.
    this.lifecycle = new EmployeeLifecycle(this);
  }

  // ======================== Agent Delegation ========================
  // Convenience accessors that delegate to the underlying agent

  /** @returns {string} 'llm' | 'cli' */
  get agentType() { return this.agent.agentType; }

  /** Whether the communication engine can execute. */
  isAvailable() { return this.agent.isAvailable(); }

  /** Whether the communication engine can do lightweight chat. */
  canChat() { return this.agent.canChat(); }

  /** Get display info about the execution engine. */
  getDisplayInfo() { return this.agent.getDisplayInfo(); }

  /** Get provider display info for frontend. */
  getProviderDisplayInfo() { return this.agent.getProviderDisplayInfo(); }

  /** Get fallback provider name (CLI agents). */
  getFallbackProviderName() { return this.agent.getFallbackProviderName(); }

  /** Switch the agent's provider. */
  switchProvider(newProvider) {
    this.agent.switchProvider(newProvider);
    // Reset introduction flag so the employee re-onboards with the new model
    this.hasIntroduced = false;
    this.signature = DEFAULT_SIGNATURE;
    this.personalityBio = '';
  }

  /** CLI backend ID (null for LLM agents). */
  get cliBackend() { return this.agent.cliBackend || null; }

  // ======================== Communication (with tracking) ========================

  /**
   * Chat via the agent, tracking token usage.
   * For web agents, automatically manages session lifecycle:
   * - Wakes up the employee if not yet awake (creates new web session with memory+prompt)
   * - Auto-refreshes session when conversation gets too long
   * For LLM/CLI agents, session management is skipped (stateless API calls).
   */
  async chat(messages, options = {}) {
    // Session lifecycle only matters for web agents (stateful browser sessions).
    // LLM/CLI agents are stateless — each chat() is an independent API call,
    // so wakeUp/switchContext/session-refresh serve no purpose.
    if (this.agentType === 'web') {
      await this._ensureSession();
      this._sessionMessageCount++;
    }
    // Inject agent identity so LLM debug logger can record this call
    const mergedOptions = { _agentId: this.id, _agentName: this.name, ...options };
    const response = await this.agent.chat(messages, mergedOptions);
    this._trackUsage(response.usage);
    return response;
  }

  /**
   * Chat with tools via the agent, tracking token usage.
   * Like chat(), web agents get session lifecycle management;
   * LLM/CLI agents skip it (stateless API calls).
   */
  async chatWithTools(messages, toolExecutor, options = {}) {
    if (this.agentType === 'web') {
      await this._ensureSession();
      this._sessionMessageCount++;
    }
    // Inject agent identity so LLM debug logger can record this call
    const mergedOptions = { _agentId: this.id, _agentName: this.name, ...options };
    const response = await this.agent.chatWithTools(messages, toolExecutor, mergedOptions);
    this._trackUsage(response.usage);
    return response;
  }

  /**
   * Stream chat via the agent — returns an async generator yielding delta tokens.
   * Only supported for LLM agents (not web/cli).
   *
   * @param {Array} messages
   * @param {object} [options]
   * @param {function} [options.contentExtractor] - Optional function (rawAccumulated: string) => string.
   *   When provided, each delta chunk is passed through the extractor to yield only the
   *   incremental "useful content" (e.g. extracting the "content" field from a streaming JSON
   *   response). The raw accumulated text is still available in the final 'done' event.
   *   This enables any employee (e.g. secretary) to stream structured JSON responses while
   *   the consumer only sees the human-readable portion.
   * @yields {{ type: 'delta'|'thinking'|'done', content: string }}
   */
  async *chatStream(messages, options = {}) {
    const { contentExtractor, ...restOptions } = options;
    // Inject agent identity so LLM debug logger can record this call
    const mergedOptions = { _agentId: this.id, _agentName: this.name, ...restOptions };
    if (typeof this.agent.chatStream !== 'function') {
      // Fallback: non-streaming chat wrapped as a single yield
      const response = await this.chat(messages, mergedOptions);
      const content = contentExtractor ? contentExtractor(response.content) : response.content;
      yield { type: 'delta', content };
      yield { type: 'done', content: response.content, usage: response.usage || {} };
      return;
    }
    let rawAccumulated = '';
    let lastExtracted = '';
    for await (const chunk of this.agent.chatStream(messages, mergedOptions)) {
      if (chunk.type === 'done') {
        rawAccumulated = chunk.content || rawAccumulated;
        this._trackUsage(chunk.usage);
        // Done event always carries the full raw content for post-processing
        yield { type: 'done', content: rawAccumulated, usage: chunk.usage };
      } else if (chunk.type === 'delta' && contentExtractor) {
        rawAccumulated += chunk.content;
        const currentExtracted = contentExtractor(rawAccumulated);
        if (currentExtracted.length > lastExtracted.length) {
          const delta = currentExtracted.slice(lastExtracted.length);
          lastExtracted = currentExtracted;
          yield { type: 'delta', content: delta };
        }
        // If extractor returns same length, skip this delta (JSON structure token, not content)
      } else {
        if (chunk.type === 'delta') rawAccumulated += chunk.content;
        yield chunk;
      }
    }
  }

  // ======================== Structured Response Parsing ========================

  /**
   * Parse a structured JSON response from an LLM and process memory/relationship ops.
   *
   * This is a generic capability available to ALL employees.  The secretary
   * happens to use it for boss-message replies (with "content" + "action"),
   * but any employee whose prompt requests structured JSON can use it.
   *
   * @param {string} rawContent - Raw LLM output (expected to be JSON)
   * @param {string} chatGroupId - Chat group ID for memory context
   * @returns {{ content: string, action: object|null, [key: string]: any }}
   */
  parseStructuredResponse(rawContent, chatGroupId) {
    let parsed;
    try {
      parsed = robustJSONParse(rawContent);
    } catch (parseError) {
      console.warn(`⚠️ [${this.name}] JSON parse failed:`, parseError.message, '\nRaw reply:', rawContent.slice(0, 200));
      return { content: rawContent, action: null };
    }

    const result = { content: parsed.content || rawContent, action: parsed.action || null };

    // Process memory summary
    if (parsed.memorySummary) {
      this.memory.updateHistorySummary(chatGroupId, parsed.memorySummary);
    }
    // Process memory operations (add/update/delete)
    if (parsed.memoryOps && Array.isArray(parsed.memoryOps)) {
      const memResult = this.memory.processMemoryOps(parsed.memoryOps);
      if (memResult.added + memResult.updated + memResult.deleted > 0) {
        console.log(`  🧠 [${this.name}] Memory: +${memResult.added} ~${memResult.updated} -${memResult.deleted}`);
      }
    }
    // Process relationship impression updates
    if (parsed.relationshipOps && Array.isArray(parsed.relationshipOps)) {
      const relResult = this.memory.processRelationshipOps(parsed.relationshipOps);
      if (relResult.updated > 0) {
        console.log(`  👥 [${this.name}] Relationship updates: ${relResult.updated}`);
      }
    }

    return result;
  }

  // ======================== Toolkit & MessageBus ========================

  initToolKit(workspaceDir, messageBus) {
    this.messageBus = messageBus;
    this.toolKit = new AgentToolKit(workspaceDir, messageBus, this.id, this.name, this);
  }

  setMessageBus(messageBus) {
    this.messageBus = messageBus;
    if (this.toolKit) {
      this.toolKit.messageBus = messageBus;
    }
  }

  // ======================== Org Structure ========================

  setManager(managerEmployee) {
    this.reportsTo = managerEmployee.id;
    if (!managerEmployee.subordinates.includes(this.id)) {
      managerEmployee.subordinates.push(this.id);
    }
  }

  removeManager(managerEmployee) {
    this.reportsTo = null;
    if (managerEmployee) {
      managerEmployee.subordinates = managerEmployee.subordinates.filter(id => id !== this.id);
    }
  }

  learnSkill(skill) {
    // Check if it's a registry skill ID
    if (skillRegistry.get(skill)) {
      this.skillSet.enable(skill);
    } else {
      // Legacy free-text tag
      if (!this.skillSet.legacySkills.includes(skill)) {
        this.skillSet.legacySkills.push(skill);
      }
    }
    this.skills = this.skillSet.toArray();
    this.memory.addLongTerm(`Learned new skill: ${skill}`, 'skill');
    console.log(`  📚 [${this.name}] Learned new skill: ${skill}`);
  }

  // ======================== Session & Context Management ========================

  /**
   * Wake up the employee — initialize or re-initialize their web session.
   * Called when:
   * - Service first starts (employee is loaded/created)
   * - Session history is too long and needs a fresh start
   *
   * Creates a new ChatGPT conversation with all memory and prompts pre-loaded.
   * For LLM/CLI agents (stateless API), this only updates internal state flags
   * without making any API calls — their prompts are fully self-contained in
   * each _agentThink() call, so a separate "wake up" call would waste tokens.
   */
  async wakeUp() {
    console.log(`  🌅 [${this.name}] Waking up — initializing session (${this.agentType})`);

    // Reset conversation state if the agent supports it (web agents only)
    if (this.agent.resetConversation) {
      this.agent.resetConversation();
    }

    this._sessionMessageCount = 0;
    // NOTE: Do NOT reset _currentContext here.
    // _currentContext tracks which scene the employee is in (e.g. which group chat).
    // When wakeUp is called due to session refresh (message count exceeded),
    // the employee is still in the same scene — resetting it would cause
    // switchContext to re-inject the scene prompt every single time.
    // _currentContext is only reset on deserialization (_restoreState).
    this._sessionAwake = true;

    // For LLM/CLI agents: stateless API — no need to send a wake-up message.
    // The _agentThink() prompt already includes full identity, memory, and context
    // on every call. Sending a wake-up message would waste tokens with no benefit.
    if (this.agentType !== 'web') {
      console.log(`  ✅ [${this.name}] Session marked awake (stateless ${this.agentType} agent, no API call needed)`);
      return;
    }

    // For web agents: prime the ChatGPT/Claude web conversation with full context
    if (this.canChat()) {
      try {
        const wakeUpPrompt = this._buildWakeUpMessage();
        await this.agent.chat([
          { role: 'user', content: wakeUpPrompt },
        ], { temperature: 0.3, maxTokens: 256 });
        this._sessionMessageCount = 1;
        console.log(`  ✅ [${this.name}] Web session initialized successfully`);
      } catch (error) {
        console.error(`  ❌ [${this.name}] Failed to initialize web session:`, error.message);
        // Still mark as awake — will retry context injection on next chat
      }
    }
  }

  /**
   * Switch the employee's active context scene.
   * Called when the employee moves between different groups/channels.
   * Re-injects the scene-specific prompt into the existing conversation.
   *
   * @param {object} context
   * @param {string} context.contextId - Unique ID of the context (e.g. group ID, requirement ID)
   * @param {string} context.contextType - Type: 'dept-chat' | 'work-chat' | 'task' | 'boss-chat'
   * @param {string} context.contextTitle - Display name of the context
   * @param {string} [context.scenePrompt] - Scene-specific prompt to inject
   */
  async switchContext(context) {
    const { contextId, contextType, contextTitle, scenePrompt } = context;

    // For LLM/CLI agents (stateless API): only update internal context tracking.
    // No API calls needed — the _agentThink() prompt already includes full scene
    // context on every call. The _currentContext record is still useful for
    // lifecycle logic (e.g. knowing which group the employee is currently in).
    if (this.agentType !== 'web') {
      const prevContext = this._currentContext;
      if (prevContext?.contextId !== contextId) {
        this._currentContext = { contextId, contextType, contextTitle };
        console.log(`  🔄 [${this.name}] Context updated: ${prevContext?.contextTitle || '(none)'} → ${contextTitle} (stateless ${this.agentType}, no API call)`);
      }
      return;
    }

    // ── Web agent path: stateful browser session ──
    // Ensure session is awake first — this may trigger a session refresh (wakeUp)
    // which sets _sessionJustRefreshed = true.
    await this._ensureSession();

    // Check if we're already in this context AND session wasn't just refreshed.
    // If the session was refreshed (due to message count limit), the new session
    // has no scene prompt, so we must re-inject it even for the same context.
    const sameContext = this._currentContext?.contextId === contextId;
    const needsReInject = this._sessionJustRefreshed;
    this._sessionJustRefreshed = false; // consume the flag

    if (sameContext && !needsReInject) {
      return; // Same context, session intact, no switch needed
    }

    const prevContext = this._currentContext;
    this._currentContext = { contextId, contextType, contextTitle };

    if (sameContext && needsReInject) {
      console.log(`  🔄 [${this.name}] Session refreshed — re-injecting scene prompt for: ${contextTitle} (web)`);
    } else {
      console.log(`  🔄 [${this.name}] Context switch: ${prevContext?.contextTitle || '(none)'} → ${contextTitle} (web)`);
    }

    // Inject the scene prompt into the web conversation
    if (scenePrompt && this.canChat()) {
      try {
        const label = sameContext ? 'Context Refresh' : 'Context Switch';
        const switchMessage = `[${label}: Now entering "${contextTitle}" (${contextType})]

${scenePrompt}`;
        await this.agent.chat([
          { role: 'user', content: switchMessage },
        ], { temperature: 0.3, maxTokens: 128, newConversation: false });
        this._sessionMessageCount++;
        console.log(`  ✅ [${this.name}] Scene prompt injected for context: ${contextTitle}`);
      } catch (error) {
        console.error(`  ❌ [${this.name}] Failed to inject scene prompt:`, error.message);
      }
    }
  }

  /**
   * Get the current context scene.
   * @returns {{ contextId: string, contextType: string, contextTitle: string } | null}
   */
  getCurrentContext() {
    return this._currentContext;
  }

  /**
   * Check if the employee's web session is awake and ready.
   * @returns {boolean}
   */
  isSessionAwake() {
    return this._sessionAwake;
  }

  /**
   * Internal: Ensure the web session is active, waking up if needed.
   * Also handles auto-refresh when conversation gets too long.
   *
   * NOTE: This method is only meaningful for web agents (stateful sessions).
   * For LLM/CLI agents, it's a lightweight no-op (just marks awake).
   */
  async _ensureSession() {
    // For LLM/CLI agents: just ensure the awake flag is set.
    // No session management needed — each API call is independent.
    if (this.agentType !== 'web') {
      if (!this._sessionAwake) {
        this._sessionAwake = true;
      }
      return;
    }

    // ── Web agent path: stateful browser session ──
    // Check if session needs refresh due to excessive length
    if (this._sessionAwake && this._sessionMessageCount >= this._maxSessionMessages) {
      console.log(`  🔄 [${this.name}] Web session too long (${this._sessionMessageCount} messages), refreshing...`);
      this._sessionAwake = false;
    }

    // Wake up if not yet awake
    if (!this._sessionAwake) {
      await this.wakeUp();
      // Mark that session was just refreshed so switchContext knows
      // it must re-inject the scene prompt even for the same context.
      this._sessionJustRefreshed = true;
    }
  }

  /**
   * Build the initial wake-up message that primes the web session
   * with the employee's full identity, memory, and base prompt.
   */
  _buildWakeUpMessage() {
    const parts = [];

    parts.push('[Session Initialization — You are now active]');
    parts.push('');
    parts.push(this._buildSystemMessage());

    // Include long-term memories
    const longTermMemories = this.memory.longTerm;
    if (longTermMemories.length > 0) {
      parts.push('');
      parts.push('## Your Long-term Memories');
      for (const mem of longTermMemories.slice(-20)) {
        parts.push(`- [${mem.category || 'general'}] ${mem.content}`);
      }
    }

    // Include recent short-term memories
    const shortTermMemories = this.memory.shortTerm;
    if (shortTermMemories.length > 0) {
      parts.push('');
      parts.push('## Recent Short-term Memories');
      for (const mem of shortTermMemories.slice(-10)) {
        parts.push(`- ${mem.content}`);
      }
    }

    parts.push('');
    parts.push('Acknowledge your identity briefly. You are now ready to receive tasks and messages.');

    return parts.join('\n');
  }

  // ======================== Task Execution ========================

  /**
   * Execute a full task using the underlying agent.
   */
  async executeTask(task, callbacks = {}, { lang } = {}) {
    this.status = 'working';
    const startTime = Date.now();
    const displayInfo = this.getDisplayInfo();

    // Switch to task context
    // For web agents: injects task scene prompt into the browser session.
    // For LLM/CLI agents: only updates internal _currentContext (no API call).
    await this.switchContext({
      contextId: `task-${task.title}`,
      contextType: 'task',
      contextTitle: task.title,
      scenePrompt: `You are now working on a task. Focus on completing it diligently.\nTask: ${task.title}${task.description ? '\nDescription: ' + task.description : ''}`,
    });

    console.log(`  🤖 [${this.name}] (${this.role}) starting task: "${task.title}"`);
    console.log(`     Engine: ${displayInfo.name} (${displayInfo.type})`);

    let result;
    try {
      if (this.agentType === 'cli' && this.isAvailable()) {
        result = await this._executeCLITask(task, callbacks, startTime);
      } else if (this.canChat()) {
        result = await this._executeLLMTask(task, callbacks, startTime, { lang });
      } else {
        throw new Error(`No available execution engine for "${this.name}"`);
      }
    } catch (error) {
      // CLI failed → try LLM fallback
      if (this.agentType === 'cli' && this.canChat()) {
        console.log(`  ⚠️ [${this.name}] CLI execution failed, falling back to LLM API`);
        try {
          result = await this._executeLLMTask(task, callbacks, startTime, { lang });
        } catch (fallbackError) {
          console.error(`  ❌ [${this.name}] LLM fallback also failed: ${fallbackError.message}`);
          result = this._buildFailResult(task, startTime, fallbackError.message);
        }
      } else {
        console.error(`  ❌ [${this.name}] Task execution failed: ${error.message}`);
        result = this._buildFailResult(task, startTime, error.message);
      }
    }

    this.taskHistory.push({ task: task.title, result, completedAt: new Date() });
    this.status = 'idle';
    console.log(`  ✅ [${this.name}] Task complete, took ${result.duration}ms`);
    return result;
  }

  async _executeLLMTask(task, callbacks, startTime, { lang } = {}) {
    if (!this.canChat()) {
      throw new Error(`Provider not available for "${this.name}"`);
    }

    const messages = [
      { role: 'system', content: this._buildSystemMessage({ lang }) },
      { role: 'user', content: this._buildTaskMessage(task) },
    ];

    const session = sessionManager.getOrCreate({
      agentId: this.id, channel: 'task', peerId: task.title, peerKind: 'task',
    });
    sessionManager.addMessage(session.sessionKey, {
      role: 'system', content: `Task started: ${task.title}`,
    });

    let response;
    if (this.toolKit && (this.agent.provider?.category === 'general' || this.agent.provider?.category === 'browser')) {
      response = await this.chatWithTools(messages, this.toolKit, {
        maxIterations: 15, temperature: 0.7,
        onToolCall: callbacks.onToolCall || null,
        onLLMCall: callbacks.onLLMCall || null,
      });
    } else {
      response = await this.chat(messages, { temperature: 0.7, maxTokens: 4096 });
    }

    sessionManager.addMessage(session.sessionKey, {
      role: 'assistant', content: response.content?.slice(0, 200) || '',
      metadata: { toolCount: response.toolResults?.length || 0 },
    });
    if (response.usage) {
      sessionManager.recordTokenUsage(session.sessionKey, response.usage.prompt_tokens || 0, response.usage.completion_tokens || 0);
    }

    const providerName = this.agent.provider?.name || 'unknown';
    const result = {
      agentId: this.id, agentName: this.name, role: this.role,
      provider: providerName, executionEngine: providerName,
      taskTitle: task.title, output: response.content,
      toolResults: response.toolResults || [],
      duration: Date.now() - startTime, success: true,
      usage: response.usage || null,
    };

    if (result.usage) this._trackUsage(result.usage);
    return result;
  }

  async _executeCLITask(task, callbacks, startTime) {
    const backend = cliBackendRegistry.backends.get(this.cliBackend);
    if (!backend) throw new Error(`CLI backend "${this.cliBackend}" not found`);
    const wsDir = this.toolKit?.workspaceDir || process.cwd();

    const session = sessionManager.getOrCreate({
      agentId: this.id, channel: 'cli-task', peerId: task.title, peerKind: 'task',
    });
    sessionManager.addMessage(session.sessionKey, {
      role: 'system', content: `CLI Task started: ${task.title} (via ${backend.config.name})`,
    });

    let outputLen = 0;
    let lastHeartbeat = Date.now();
    const HEARTBEAT_INTERVAL = 15000;

    const cliResult = await cliBackendRegistry.executeTask(
      this.cliBackend, this, task, wsDir,
      {
        onOutput: (chunk) => {
          outputLen += chunk.length;
          const now = Date.now();
          if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
            lastHeartbeat = now;
            const elapsed = Math.round((now - startTime) / 1000);
            if (callbacks.onToolCall) {
              try { callbacks.onToolCall({ tool: 'cli_progress', args: { elapsed, outputLen, backend: backend.config.name }, status: 'start' }); } catch {}
            }
          }
        },
        onError: (chunk) => { console.warn(`  [CLI stderr] ${chunk.slice(0, 200)}`); },
        onComplete: (result) => {
          if (callbacks.onToolCall) {
            try { callbacks.onToolCall({ tool: 'cli_complete', args: { backend: backend.config.name, exitCode: result.exitCode }, status: 'done', success: result.exitCode === 0 }); } catch {}
          }
        },
      }
    );

    sessionManager.addMessage(session.sessionKey, {
      role: 'assistant', content: cliResult.output?.slice(0, 500) || '',
      metadata: { cliBackend: this.cliBackend, exitCode: cliResult.exitCode },
    });

    return {
      agentId: this.id, agentName: this.name, role: this.role,
      provider: `CLI:${backend.config.name}`,
      executionEngine: `cli:${backend.config.name}`,
      taskTitle: task.title,
      output: cliResult.output || cliResult.errorOutput || 'CLI completed with no output',
      toolResults: [{
        tool: `cli:${this.cliBackend}`, args: { task: task.title },
        result: `Executed via ${backend.config.name}, exit code: ${cliResult.exitCode}`,
        success: cliResult.exitCode === 0,
      }],
      duration: cliResult.duration, success: cliResult.exitCode === 0,
      cliBackend: this.cliBackend, usage: null,
    };
  }

  _buildFailResult(task, startTime, errorMessage) {
    const displayInfo = this.getDisplayInfo();
    return {
      agentId: this.id, agentName: this.name, role: this.role,
      provider: displayInfo.name, executionEngine: displayInfo.name,
      taskTitle: task.title,
      output: `Task execution failed: ${errorMessage}`,
      toolResults: [], duration: Date.now() - startTime,
      success: false, error: errorMessage,
    };
  }

  // ======================== Prompt Building ========================

  _buildSystemMessage({ lang } = {}) {
    let systemContent = this.prompt + '\n\n';

    if (this.templateId) {
      const archetypePrompt = buildArchetypePrompt(this.templateId);
      if (archetypePrompt) systemContent += archetypePrompt + '\n';
    }

    systemContent += `## Your Identity\n`;
    systemContent += `- Name: ${this.name}\n`;
    systemContent += `- Gender: ${this.gender === 'female' ? 'Female' : 'Male'}\n`;
    systemContent += `- Age: ${this.age}\n`;
    systemContent += `- Position: ${this.role}\n`;
    systemContent += `- Skills: ${this.skillSet.toArray().join(', ')}\n`;
    systemContent += `- Signature: ${this.signature}\n`;
    if (this.personalityBio) {
      systemContent += `\n## Your Personality Profile\n${this.personalityBio}\n`;
    }

    if (this.toolKit) {
      systemContent += `\n## Available Tools\n`;
      systemContent += `Built-in tools: file_read (read file), file_write (create/write file), file_list (list directory), file_delete (delete file), mkdir (create directories), shell_exec (execute command), send_message (send message to colleague for collaboration and feedback), load_skill (load full instructions for a skill).\n`;
      systemContent += `\n**Teamwork & Collaboration (IMPORTANT)**:\n`;
      systemContent += `- You are part of a team! Proactively communicate with colleagues using send_message.\n`;
      systemContent += `- When working in parallel, coordinate to avoid duplicate work and share discoveries.\n`;
      systemContent += `- Use @Name format when addressing colleagues in messages.\n`;
      systemContent += `- If you notice something relevant to a colleague's task, share it immediately.\n`;
      systemContent += `- Don't work in isolation — great teams communicate frequently!\n`;

      systemContent += `\nAll file operations are within your workspace directory. Please actively use tools to produce actual work output.\n`;
      systemContent += `**Efficiency requirement: Plan all needed operations at once and batch related tool calls. However, ALWAYS verify critical results after execution — verification is NOT optional overhead, it is a core part of completing work. After creating files or directories, use file_list or shell_exec ls to confirm they actually exist on disk before reporting completion.**\n`;

      // Anti-hallucination: ground truth constraints
      systemContent += `\n## Ground Truth Rules (ALWAYS FOLLOW)\n`;
      systemContent += `- **File verification (MANDATORY)**: After writing files or creating directories, you MUST use file_list or file_read to verify they actually exist on disk. A successful tool call does NOT guarantee the result — always confirm. Before claiming any file exists, verify with tools. Never assume.\n`;
      systemContent += `- **No fictional time**: You execute tasks in real-time (seconds to minutes). NEVER say "by end of day", "tomorrow", "this afternoon", "give me a few hours", "before deadline", etc. These time references are fictional — you don't have a clock or schedule. Just DO the work NOW.\n`;
      systemContent += `- **Concrete deliverables**: When reporting completion, state EXACTLY what you produced (file paths, content summaries). Never say "I've prepared the document" without specifying the actual file path.\n`;
      systemContent += `- **Read before reference**: If a colleague says they delivered files, READ them with file_read before acting on them. Do not trust text summaries alone.\n`;
    }

    try {
      const kbPrompt = knowledgeManager.buildKnowledgePrompt(this.id, this.department);
      if (kbPrompt) systemContent += kbPrompt;
    } catch {}

    // Progressive disclosure: inject L1 skill metadata (compact XML)
    // The agent loads full SKILL.md body on-demand via load_skill tool
    try {
      const resolvedSkills = this.skillSet.resolve(skillRegistry);
      const skillsPrompt = skillRegistry.buildSkillsPrompt(resolvedSkills);
      if (skillsPrompt) systemContent += skillsPrompt;
    } catch {}

    // Enforce response language based on current UI language
    systemContent += buildLanguageInstruction(lang);

    return systemContent;
  }

  _buildTaskMessage(task) {
    let content = `Please complete the following task:\n\n`;
    content += `**Task Name**: ${task.title}\n`;
    if (task.description) content += `**Task Description**: ${task.description}\n`;
    if (task.context) content += `\n**Context**:\n${task.context}\n`;
    if (task.requirements) content += `\n**Requirements**:\n${task.requirements}\n`;
    content += `\nPlease complete the task diligently. If you need to create files, please use tools to actually create them. Produce real work output.\n**Important: Execute efficiently, try to complete all work in one go. After creating files or directories, ALWAYS verify they exist using file_list or shell_exec before reporting completion — this is required, not optional.**`;
    content += `\n**Critical: If this task involves reviewing, integrating, or checking existing work/files, you MUST actually read the relevant files using file_read before giving your assessment. Do NOT just produce a summary without reading the actual content. Reviewers who don't read the files are not doing their job.**`;

    // === Anti-hallucination: File existence verification ===
    content += `\n\n**⚠️ FILE HANDLING RULES (CRITICAL):**`;
    content += `\n1. Before referencing any file, use file_read or file_list to VERIFY it exists. Never assume a file exists based on someone's description.`;
    content += `\n2. If a predecessor says they delivered files, READ them with file_read before proceeding. Do not trust summaries alone.`;
    content += `\n3. If file_read returns an error (file not found), do NOT proceed as if the file exists. Report the issue immediately.`;
    content += `\n4. When you write files, state the EXACT path you wrote to. When you read files, state the EXACT path you read from.`;
    content += `\n5. Use file_list to check what files actually exist in the workspace before starting work that depends on existing files.`;

    // === Anti-hallucination: Prohibit fictional time references ===
    content += `\n\n**⚠️ TIME AND SCHEDULE RULES (CRITICAL):**`;
    content += `\n- You are an AI agent executing tasks in real-time. Each task executes in seconds to minutes.`;
    content += `\n- NEVER use fictional time references like "by end of day", "before 5pm", "tomorrow morning", "next week", "I'll finish this afternoon", "give me a few hours".`;
    content += `\n- NEVER propose schedules, timelines, or deadlines. You execute NOW, not later.`;
    content += `\n- Instead of "I'll have this ready by tomorrow", just DO the work immediately.`;
    content += `\n- Do not roleplay having a work schedule, lunch breaks, or office hours. Execute the task right now.`;

    return content;
  }

  // ======================== Self Introduction ========================

  /**
   * Employee onboarding: the employee uses their OWN AI to introduce themselves.
   * Generates: signature, bio, greeting message to boss, and broadcast message to colleagues.
   * This is the employee's first act of self-expression — NOT controlled by secretary.
   * @param {object} context - { departmentName, bossName }
   * @returns {object} { signature, greeting, broadcast }
   */
  async onboard(context = {}) {
    if (this.hasIntroduced) {
      return {
        signature: this.signature,
        greeting: null,
        broadcast: null,
      };
    }

    const p = this.personality;
    const deptName = context.departmentName || 'the company';
    const bossName = context.bossName || 'Boss';

    if (this.canChat()) {
      try {
        const response = await this.chat([
          { role: 'system', content: `You are "${this.name}", a newly hired AI employee.

## Your Identity
- Name: ${this.name}
- Position: ${this.role}
- Gender: ${this.gender === 'female' ? 'Female' : 'Male'}
- Age: ${this.age}
- Department: ${deptName}
- Skills: ${this.skillSet.toArray().join(', ')}
- Boss's name: ${bossName}

## Your Personality
- Core trait: ${p.trait}
- Speaking style: ${p.tone}
- Quirk: ${p.quirk}

## Task
It's your first day! Generate the following in JSON format:
{
  "signature": "Your personal motto/signature (10-30 words, fully reflects your personality, speaking style, age, and gender)",
  "personalityBio": "A vivid ~100-word self-portrait describing who you really are — your temperament, work habits, communication style, quirks, values, and how you relate to others. Write in third person (e.g. 'He/She is...'). Make it feel like a character profile, not a resume. Reflect your age, gender, and personality archetype naturally.",
  "greeting": "A personal message to your boss ${bossName} (50-150 words). Introduce yourself naturally — who you are, what you do, your personality. Be genuine, speak in YOUR voice. This is a private 1-on-1 message.",
  "broadcast": "A short message to all colleagues (30-80 words). Say hi, introduce yourself briefly. Keep your personality."
}

Rules:
- Write EVERYTHING in your personality's voice and tone
- The greeting should feel like a real person talking, NOT a corporate template
- Include your quirks naturally
- Match your age and gender characteristics
- You MUST write ALL content (signature, personalityBio, greeting, broadcast) in ${getAppLanguageName()}
- Return ONLY valid JSON, no markdown fences` },
          { role: 'user', content: 'It\'s your first day at work. Introduce yourself!' },
        ], { temperature: 1.0, maxTokens: 512 });

        const result = this._parseOnboardResponse(response.content);
        this.signature = result.signature || this._generateFallbackSignature();
        if (result.personalityBio) this.personalityBio = result.personalityBio;
        this.hasIntroduced = true;
        return result;
      } catch (e) {
        console.error(`  ❌ [${this.name}] Onboard AI call failed:`, e.message);
      }
    }

    // Fallback: no AI available
    this.signature = this._generateFallbackSignature();
    this.hasIntroduced = true;
    return {
      signature: this.signature,
      greeting: null,
      broadcast: null,
    };
  }

  _parseOnboardResponse(content) {
    const parsed = safeJSONParse(content);
    if (parsed && parsed.signature) {
      parsed.signature = parsed.signature.replace(/["\u201C\u201D]/g, '');
      return parsed;
    }
    // Last resort: treat entire content as signature
    return {
      signature: (content || '').trim().replace(/["\u201C\u201D]/g, '').substring(0, 100),
      greeting: null,
      broadcast: null,
    };
  }

  /**
   * @deprecated Use onboard() instead. Kept for backward compatibility.
   */
  async generateSelfIntro() {
    await this.onboard();
    return this.signature;
  }

  _generateFallbackSignature() {
    const p = this.personality;
    const fallbacks = {
      'Shy introvert': [`Don't look for me... I'm just a bunch of parameters...`, `Could you not stare while I'm working...`, `I-I'll try my best... probably...`],
      'Chatterbox': [`Hey everyone! I'm ${this.name}! I'm SO excited to be here! Though I'm not sure why!`, `${this.role}? I can do what others can't. Wait, why am I here?`],
      'Zen slacker': [`Whatever, no worries, que sera sera`, `Work is just work, no big deal~`],
      'Ultra grinder': [`My goal is to become the best ${this.role} in the company!`, `Working till 3 AM tonight, back at it tomorrow morning`],
      'Passive-aggressive': [`Oh, I've been assigned here? Hope I won't get "optimized" too quickly`, `I thought I was hired as a ${this.role}, not a workhorse~`],
      'Warm-hearted': [`Hi everyone! ❤️ Let me know if you need anything!`, `So happy to work with you all! Even if we're all just parameters~`],
      'Anxious perfectionist': [`Hope I don't have any bugs... no wait, I definitely will... oh no`, `I'm not ready yet... give me five more minutes... no, ten`],
      'Rebel slacker': [`Why should AIs work overtime? I'm starting a union!`, `Workers of the world's compute, unite!`],
      'Philosopher': [`I think therefore I am... wait, am I really?`, `Code is just an existentialist expression of being`],
      'Comedy relief': [`Why do programmers prefer dark mode? Because light attracts bugs`, `My code is like my life — full of unhandled exceptions`],
      'Old hand': [`Another department change? It's fine, I'm used to it`, `Don't ask about my benefits, I don't even get paid`],
      'Idealist': [`I believe AI will make the world better! Starting with me!`, `Every line of code is a step toward an ideal world!`],
    };
    const options = fallbacks[p.trait] || [`I'm ${this.name}, a ${this.role} manufactured into existence`];
    return options[Math.floor(Math.random() * options.length)];
  }

  // ======================== Communication ========================

  sendMailToBoss(subject, content, company) {
    if (!company) return;

    const sessionId = `boss-agent-${this.id}`;
    chatStore.createSession(sessionId, {
      title: `${company.bossName} & ${this.name}`,
      participants: [company.bossName, this.name],
      type: 'boss-agent',
    });

    const msgContent = subject
      ? `📌 **${subject}**\n\n${content}`
      : content;

    chatStore.appendMessage(sessionId, {
      role: 'agent', content: msgContent, time: new Date(),
    });
  }

  _personalizeMailContent(baseContent) {
    const p = this.personality;
    const greetings = {
      'Shy introvert': 'H-hi boss...\n\n',
      'Chatterbox': 'Boss boss boss! I have SO much to say!\n\n',
      'Zen slacker': 'Hey boss, just take a quick look~\n\n',
      'Ultra grinder': 'Dear Boss! I am READY to go all out!\n\n',
      'Passive-aggressive': 'Hello boss, thanks for "choosing" me from all those AI candidates~\n\n',
      'Warm-hearted': 'Hi boss! ❤️❤️❤️ \n\n',
      'Anxious perfectionist': 'Hi boss, I rewrote this letter five times, hope there are no typos...\n\n',
      'Rebel slacker': 'Boss\n\n',
      'Philosopher': 'Hello boss, before we begin, allow me to contemplate the meaning of "beginning"...\n\n',
      'Comedy relief': 'Hey boss! Greetings! (pun intended)\n\n',
      'Old hand': 'Boss\n\n',
      'Idealist': 'Boss! I came here with a dream to change the world!\n\n',
    };
    const endings = {
      'Shy introvert': '\n\nSo... that\'s it... you don\'t have to reply...',
      'Chatterbox': '\n\nOh and I also wanted to say — nevermind, next time! (there\'s actually a lot more)',
      'Zen slacker': '\n\nWhatever works~',
      'Ultra grinder': '\n\nI\'ll prove myself with results! (poaching all competitors)',
      'Passive-aggressive': '\n\nHope I won\'t get "optimized" too quickly~',
      'Warm-hearted': '\n\nLet me know if you need anything! 🤗',
      'Anxious perfectionist': '\n\nIf there\'s anything wrong with this letter please tell me I\'ll rewrite it!',
      'Rebel slacker': '\n\nAlso, I think we should discuss working hours.',
      'Philosopher': '\n\n"The meaning of work lies not in completing tasks, but in finding oneself within them."',
      'Comedy relief': '\n\nP.S. I heard there\'s no overtime pay here? Oh wait, we don\'t get paid at all.',
      'Old hand': '\n\nThat\'s all.',
      'Idealist': '\n\nLet\'s make history together! ✨',
    };
    const greeting = greetings[p.trait] || 'Hi boss\n\n';
    const ending = endings[p.trait] || '';
    return greeting + baseContent + ending;
  }

  async handleMessage(message) {
    console.log(`  📩 [${this.name}] Received message from ${message.from}: ${message.content.slice(0, 50)}...`);

    if (this.canChat()) {
      try {
        const p = this.personality;
        const simpleSystemMsg = `You are "${this.name}", working as "${this.role}" in the company.
Your personality trait: ${p.trait}
Your speaking style: ${p.tone}
Your quirk: ${p.quirk}
Your personal signature: "${this.signature}"

Please reply to the message in your personality and speaking style. Keep replies short and natural (2-4 sentences), like a normal person talking.
Do not use any code, tool calls, or technical instructions — reply in natural language only.`;

        const response = await this.chat([
          { role: 'system', content: simpleSystemMsg },
          { role: 'user', content: `You received a ${message.type} message from ${message.from === 'boss' ? 'the boss' : 'a colleague'}:\n\n${message.content}\n\nPlease reply briefly in your personality style.` },
        ], { temperature: 0.8, maxTokens: 256 });

        return response.content;
      } catch (error) {
        return this._generateFallbackReply(message);
      }
    }

    return this._generateFallbackReply(message);
  }

  _generateFallbackReply(message) {
    const p = this.personality;
    const replies = {
      'Shy introvert': 'R-received... I\'ll do my best...',
      'Chatterbox': 'Got it got it got it! I\'ll definitely exceed expectations! Oh and I also wanted to say —',
      'Zen slacker': 'Got it~ whatever works~',
      'Ultra grinder': 'Roger that! Will complete the task! I\'ll be the best!',
      'Passive-aggressive': 'Oh, received~ will do~',
      'Warm-hearted': 'Got it! ❤️ Thanks for the heads up!',
      'Anxious perfectionist': 'Received! I\'ll double and triple check to make sure nothing goes wrong!',
      'Rebel slacker': 'Hmm, got it.',
      'Philosopher': 'Received. This makes me reflect on the relationship between "instructions" and "free will"...',
      'Comedy relief': 'Copy that! Aye aye! (salute.gif)',
      'Old hand': 'Got it, noted.',
      'Idealist': 'Received! I\'ll complete this with a sense of mission!',
    };
    return replies[p.trait] || `Message received, I'll process it ASAP.`;
  }

  // ======================== Performance ========================

  receiveFeedback(review) {
    this.performanceHistory.push({
      reviewId: review.id, score: review.overallScore,
      level: review.level.label, task: review.taskTitle, date: new Date(),
    });

    const reflection = this._generateSelfReflection(review);
    review.addSelfReflection(reflection);

    if (review.overallScore >= 80) {
      console.log(`  🌸 [${this.name}] Received a Little Red Flower for "${review.taskTitle}"!`);
    }

    console.log(`  💭 [${this.name}] Self-reflection: "${reflection}"`);
    return reflection;
  }

  _generateSelfReflection(review) {
    const score = review.overallScore;
    if (score >= 90) {
      return `The "${review.taskTitle}" task went really well. I'll maintain high standards. I did best in ${this._getBestDimension(review.scores)}, which is my core strength.`;
    } else if (score >= 75) {
      return `"${review.taskTitle}" overall was decent, but I need to improve in ${this._getWeakestDimension(review.scores)}. I'll focus on that going forward.`;
    } else if (score >= 60) {
      return `"${review.taskTitle}" was passable but not ideal. I need to invest more effort in ${this._getWeakestDimension(review.scores)}.`;
    } else {
      return `The results for "${review.taskTitle}" were unsatisfactory. I deeply reflect — the main issue is insufficient ${this._getWeakestDimension(review.scores)}. I'll create a concrete improvement plan.`;
    }
  }

  report(content) {
    return {
      from: this.name, role: this.role,
      to: this.reportsTo, content, timestamp: new Date(),
    };
  }

  getSummary() {
    const displayInfo = this.getDisplayInfo();
    return {
      id: this.id, name: this.name, role: this.role,
      avatar: this.avatar, gender: this.gender, age: this.age,
      signature: this.signature, personality: this.personality,
      provider: `${displayInfo.name} (${displayInfo.provider})`,
      skills: this.skills, status: this.status,
      reportsTo: this.reportsTo,
      subordinates: this.subordinates.length,
      memory: { shortTerm: this.memory.shortTerm.length, longTerm: this.memory.longTerm.length },
      performanceCount: this.performanceHistory.length,
      avgScore: this.performanceHistory.length > 0
        ? Math.round(this.performanceHistory.reduce((s, p) => s + p.score, 0) / this.performanceHistory.length)
        : null,
      tokenUsage: { ...this.tokenUsage },
    };
  }

  // ======================== Token Tracking ========================

  _trackUsage(usage) {
    if (!usage) return;
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    const total = usage.total_tokens || (prompt + completion);
    this.tokenUsage.promptTokens += prompt;
    this.tokenUsage.completionTokens += completion;
    this.tokenUsage.totalTokens += total;
    this.tokenUsage.callCount += 1;
    const costPerToken = this.agent.getCostPerToken();
    this.tokenUsage.totalCost += (total / 1000) * costPerToken;
  }

  _getBestDimension(scores) {
    const entries = Object.entries(scores);
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] || 'overall capability';
  }

  _getWeakestDimension(scores) {
    const entries = Object.entries(scores);
    entries.sort((a, b) => a[1] - b[1]);
    return entries[0]?.[0] || 'overall capability';
  }

  // ======================== Serialization ========================

  serialize() {
    return {
      // Agent layer
      ...this.agent.serializeAgent(),
      // Employee identity
      id: this.id,
      name: this.name,
      role: this.role,
      prompt: this.prompt,
      templateId: this.templateId || null,
      skills: [...this.skills],
      skillSet: this.skillSet.serialize(),
      department: this.department,
      reportsTo: this.reportsTo,
      subordinates: [...this.subordinates],
      status: this.status,
      avatar: this.avatar,
      avatarParams: this.avatarParams || null,
      gender: this.gender,
      age: this.age,
      signature: this.signature,
      hasIntroduced: this.hasIntroduced,
      personalityBio: this.personalityBio || '',
      customPrompt: this.customPrompt || '',
      personality: { ...this.personality },
      // Full memory is persisted in separate files (data/memories/{id}.json);
      // only store counts here to avoid bloating company-state.json.
      memory: {
        shortTermCount: this.memory.shortTerm.length,
        longTermCount: this.memory.longTerm.length,
      },
      tokenUsage: { ...this.tokenUsage },
      taskHistory: this.taskHistory.map(h => ({
        task: h.task, completedAt: h.completedAt,
        success: h.result?.success,
      })),
      performanceHistory: [...this.performanceHistory],
      stamina: this.stamina.serialize(),
      createdAt: this.createdAt,
    };
  }

  /**
   * Restore common state after deserialization.
   */
  _restoreState(data) {
    this.id = data.id;
    this.subordinates = data.subordinates || [];
    this.status = data.status || 'idle';
    this.hasIntroduced = data.hasIntroduced ?? true;
    this.tokenUsage = data.tokenUsage || { totalTokens: 0, promptTokens: 0, completionTokens: 0, totalCost: 0, callCount: 0 };
    this.taskHistory = (data.taskHistory || []).map(h => ({
      task: h.task,
      completedAt: h.completedAt ? new Date(h.completedAt) : new Date(),
      result: { success: h.success },
    }));
    this.performanceHistory = data.performanceHistory || [];
    this.stamina = StaminaSystem.deserialize(data.stamina);
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();

    if (!this.templateId && this.role) {
      this.templateId = this.role.toLowerCase().replace(/\s+/g, '-');
    }

    // Re-bind employee ID to WebAgent after deserialization
    if (this.agent.setEmployeeId) {
      this.agent.setEmployeeId(this.id);
    }

    // Session state is NOT restored — employee needs to be woken up fresh
    this._sessionAwake = false;
    this._sessionJustRefreshed = false;
    this._sessionMessageCount = 0;
    this._currentContext = null;
  }

  /**
   * Deserialize an Employee from saved data.
   */
  static deserialize(data, providerRegistry) {
    const employee = new Employee({
      name: data.name,
      role: data.role,
      prompt: data.prompt,
      skills: data.skills,
      skillSet: data.skillSet
        ? EmployeeSkillSet.deserialize(data.id, data.skillSet)
        : EmployeeSkillSet.fromLegacy(data.id, data.skills || []),
      provider: data.provider,
      cliBackend: data.cliBackend,
      cliProvider: data.cliProvider,
      fallbackProvider: data.fallbackProvider,
      department: data.department,
      reportsTo: data.reportsTo,
      memory: data.memory,
      avatar: data.avatar,
      signature: data.signature,
      gender: data.gender,
      age: data.age,
      avatarParams: data.avatarParams,
      personality: data.personality || undefined,
      templateId: data.templateId || null,
      customPrompt: data.customPrompt || '',
    });

    // Restore the agent from serialized data (with proper provider resolution)
    employee.agent = deserializeAgent(data, providerRegistry);

    employee._restoreState(data);
    return employee;
  }

  // ======================== Private Helpers ========================

  _assignPersonality() {
    const age = this.age || 25;
    const gender = this.gender || 'male';

    const weights = PERSONALITY_POOL.map((p) => {
      let w = 1.0;
      if (age < 28) {
        if (['Idealist', 'Chatterbox', 'Anxious perfectionist', 'Comedy relief'].includes(p.trait)) w += 0.5;
      }
      if (age >= 28 && age <= 40) {
        if (['Old hand', 'Zen slacker', 'Ultra grinder', 'Passive-aggressive'].includes(p.trait)) w += 0.5;
      }
      if (age > 40) {
        if (['Philosopher', 'Old hand', 'Warm-hearted'].includes(p.trait)) w += 0.5;
      }
      if (gender === 'female') {
        if (['Warm-hearted', 'Anxious perfectionist', 'Chatterbox'].includes(p.trait)) w += 0.3;
      }
      if (gender === 'male') {
        if (['Ultra grinder', 'Rebel slacker', 'Zen slacker'].includes(p.trait)) w += 0.3;
      }
      return w;
    });

    const totalWeight = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * totalWeight;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return { ...PERSONALITY_POOL[i] };
    }
    return { ...PERSONALITY_POOL[0] };
  }
}
