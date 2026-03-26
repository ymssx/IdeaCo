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
import { getTraitStyle, getAgeStyle } from '../prompts.js';
import { safeJSONParse, robustJSONParse } from '../utils/json-parse.js';
import { getAppLanguageName } from '../utils/app-language.js';
import { EmployeeSkillSet } from './skill/skill-set.js';
import { skillRegistry } from './skill/registry.js';
import { registerManagementTools } from './tools/management-tools.js';
import { TaskManager } from './task.js';

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

    // Employee class identifier for serialization routing
    // Subclasses override this in their constructor (e.g. 'leader', 'secretary')
    this.employeeClass = 'general';

    // Stamina system — tracks patience, fatigue, stress, and comfort
    this.stamina = new StaminaSystem();

    // Task manager — tracks pending tasks, resolve/fail, onResolve triggers
    this.taskManager = new TaskManager();

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
   * This is a generic capability available to ALL employees.  Any employee
   * whose prompt requests structured JSON can use it to process memory
   * and relationship operations from the response.
   *
   * @param {string} rawContent - Raw LLM output (expected to be JSON)
   * @param {string} chatGroupId - Chat group ID for memory context
   * @returns {{ content: string, [key: string]: any }}
   */
  parseStructuredResponse(rawContent, chatGroupId) {
    let parsed;
    try {
      parsed = robustJSONParse(rawContent);
    } catch (parseError) {
      console.warn(`⚠️ [${this.name}] JSON parse failed:`, parseError.message, '\nRaw reply:', rawContent.slice(0, 200));
      return { content: rawContent, actions: [] };
    }

    const result = {
      content: parsed.content || rawContent,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    };

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

    // Process task operations (create/resolve/fail)
    if (parsed.taskOps && Array.isArray(parsed.taskOps) && parsed.taskOps.length > 0) {
      const taskResult = this.taskManager.processOps(parsed.taskOps);
      if (taskResult.created.length > 0) {
        console.log(`  📋 [${this.name}] Tasks created: ${taskResult.created.map(t => t.id).join(', ')}`);
      }
      if (taskResult.resolved.length > 0) {
        console.log(`  ✅ [${this.name}] Tasks resolved: ${taskResult.resolved.map(r => r.task.id).join(', ')}`);
      }
      if (taskResult.failed.length > 0) {
        console.log(`  ❌ [${this.name}] Tasks failed: ${taskResult.failed.map(t => t.id).join(', ')}`);
      }
      // Attach resolved tasks with onResolve targets for the caller to handle
      result._resolvedTasks = taskResult.resolved.filter(r => r.onResolveTarget);
    }

    if (result.actions.length > 0) {
      console.log(`  🔧 [${this.name}] Actions requested: ${result.actions.map(a => a.tool).join(', ')}`);
    }

    return result;
  }

  // ======================== Action Execution ========================

  /**
   * Execute an array of actions returned by the LLM in its structured JSON response.
   * Each action is dispatched to the employee's toolKit for execution.
   *
   * Actions are the LLM's way of calling tools — the "actions" field in the JSON
   * response is the tool call protocol. This method sequentially executes each action
   * and collects results.
   *
   * @param {Array<{tool: string, args: object}>} actions - Array of action objects
   * @returns {Promise<Array<{tool: string, success: boolean, result?: string, error?: string}>>}
   */
  async executeActions(actions) {
    if (!actions || actions.length === 0) return [];
    if (!this.toolKit) {
      console.warn(`⚠️ [${this.name}] No toolKit available, cannot execute actions`);
      return actions.map(a => ({ tool: a.tool, success: false, error: 'No toolKit configured' }));
    }

    const results = [];
    for (const action of actions) {
      const { tool, args } = action;
      if (!tool) {
        results.push({ tool: '(unknown)', success: false, error: 'Missing tool name' });
        continue;
      }

      try {
        console.log(`  🔧 [${this.name}] Executing action: ${tool}(${JSON.stringify(args || {}).slice(0, 100)})`);
        const result = await this.toolKit.execute(tool, args || {});
        console.log(`  ✅ [${this.name}] Action ${tool} completed`);
        results.push({ tool, success: true, result });
      } catch (err) {
        console.error(`  ❌ [${this.name}] Action ${tool} failed:`, err.message);
        results.push({ tool, success: false, error: err.message });
      }
    }

    return results;
  }

  // ======================== Chat Context Building ========================

  /**
   * Build reusable conversational context for any employee chat scenario.
   * Extracts the common patterns (memory, history, search) that were previously
   * hardcoded in the secretary's _buildBossMessageContext.
   *
   * Any employee (secretary, department lead, etc.) can use this to build
   * rich context for their conversations.
   *
   * @param {string} chatGroupId - Chat group ID for memory context
   * @param {string} chatSessionId - Chat session ID for history retrieval
   * @param {string} [currentMessage] - Current message (for semantic search)
   * @param {object} [options]
   * @param {number} [options.recentMessageCount=10] - Number of recent messages to include
   * @param {number} [options.searchResultCount=3] - Number of search results to include
   * @param {number} [options.searchContextRadius=1] - Context radius for search results
   * @returns {{ memorySection: string, historySummaryContext: string, recentHistory: Array, searchContextSection: string }}
   */
  buildChatContext(chatGroupId, chatSessionId, currentMessage, options = {}) {
    const {
      recentMessageCount = 10,
      searchResultCount = 3,
      searchContextRadius = 1,
    } = options;

    // Consolidate memories before building context
    this.memory.consolidateMemories();

    // Memory context (long-term + short-term memories relevant to this chat)
    const memorySection = this.memory.buildMemoryContext(chatGroupId);

    // History summary (compressed summary of past conversations)
    const historySummaryContext = this.memory.buildHistorySummaryContext(chatGroupId);

    // Recent chat history
    let recentHistory = [];
    try {
      const recentMessages = chatStore.getRecentMessages(chatSessionId, recentMessageCount);
      recentHistory = recentMessages.map(h => ({
        role: h.role === 'boss' ? 'user' : 'assistant',
        content: h.content,
        originalRole: h.role,
      }));
    } catch (e) {
      // Fallback: no history available
    }

    // Semantic search for related historical context
    let searchContextSection = '';
    if (currentMessage) {
      try {
        const searchResults = chatStore.searchWithContext(chatSessionId, currentMessage, searchResultCount, searchContextRadius);
        if (searchResults.length > 0) {
          searchContextSection = '\n## Related Historical Context (from past conversations)\n';
          for (const result of searchResults) {
            const contextStr = result.context.map(m =>
              `  [${m.role}] ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}`
            ).join('\n');
            searchContextSection += `- Relevance: ${result.score.toFixed(2)}\n${contextStr}\n\n`;
          }
        }
      } catch (e) {
        // Search not available, skip
      }
    }

    return { memorySection, historySummaryContext, recentHistory, searchContextSection };
  }

  // ======================== Toolkit & MessageBus ========================

  initToolKit(workspaceDir, messageBus, { company } = {}) {
    this.messageBus = messageBus;
    this.toolKit = new AgentToolKit(workspaceDir, messageBus, this.id, this.name, this);

    // Always store company reference — needed by findAgent (DM name resolution)
    // and resolveAgentId. Employees don't need to be in a department to have
    // a company reference (e.g. secretary is a standalone employee).
    if (company) {
      this.company = company;
    }

    // Auto-register management tools if this employee has the company-management skill.
    // This is generic — any employee with the skill gets the tools, not just the secretary.
    if (company && this.skillSet.has('company-management')) {
      registerManagementTools(this.toolKit, company);
    }
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
    // Language enforcement is now handled at the LLMClient level (pincer injection).
    // No need to add it here — it's automatically applied to ALL LLM calls.

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
    systemContent += `- Speaking tone: ${this.personality.tone}\n`;
    systemContent += `- Your quirk: ${this.personality.quirk}\n`;
    if (this.personalityBio) {
      systemContent += `\n## Your Personality Profile\n${this.personalityBio}\n`;
    }

    // Personality simulation — trait style + age style (same as group chat)
    systemContent += `\n## Your Personality\n`;
    systemContent += getTraitStyle(this.personality.trait) + '\n\n';
    systemContent += `Your age determines your speech habits:\n`;
    systemContent += getAgeStyle(this.age) + '\n';

    if (this.toolKit) {
      systemContent += this._buildToolDefine();
    }

    try {
      const kbPrompt = knowledgeManager.buildKnowledgePrompt(this.id, this.department);
      if (kbPrompt) systemContent += kbPrompt;
    } catch {}

    systemContent += this._buildSkillDefine();

    // Inject pending tasks (only when tasks exist)
    if (this.taskManager.hasPending()) {
      systemContent += this.taskManager.buildPendingTasksPrompt();
    }

    return systemContent;
  }

  // ======================== Reusable Prompt Fragments ========================

  /**
   * Build memory management instructions for any structured JSON response.
   * This is a GENERIC capability — every employee uses memory ops.
   * Reused by secretary boss-chat, company 1v1 chat, and can be adopted by
   * lifecycle group-chat prompts in the future.
   */
  _buildMemoryInstructions() {
    return `## Memory Management
- memorySummary: Write a single, self-contained summary of the entire conversation so far. This REPLACES any previous summary — include everything important. Keep key info, skip chitchat. null if no old messages.
- memoryOps: Array of memory operations to actively manage your memory:
  - "add" + "long_term": Important facts, preferences, standing instructions, key decisions (stays forever)
  - "add" + "short_term": Current task context, temporary info (auto-expires, ttl in seconds, default 24h)
  - "update": Modify an existing memory by id when info changes — USE THIS to merge similar memories into one
  - "delete": Remove outdated, incorrect, or redundant memories by id
  - category: preference | fact | instruction | task | context | relationship | experience | decision
  - importance: 1-10 (higher = more important, less likely to be forgotten)
  - Only add memory when something worth remembering happens. Do NOT memorize casual greetings.
  - ACTIVELY MAINTAIN your memories! Every time you respond:
    * Look for similar or overlapping memories and MERGE them (delete duplicates, update the remaining one)
    * DELETE memories that are no longer relevant, outdated, or superseded by newer info
    * Prefer FEWER, higher-quality memories over many redundant ones
  - If nothing to add/update/delete, set memoryOps to [].`;
  }

  /**
   * Build relationship impression instructions for any structured JSON response.
   * This is a GENERIC capability — every employee tracks impressions.
   */
  _buildRelationshipInstructions() {
    return `## Relationship Impressions
- relationshipOps: Update your personal impression of people in this conversation. Max 200 chars per impression. affinity: 1-100 (50=neutral).
- affinity should change gradually (+/- 5~15 per interaction). Start from 50 if first meeting.
- Only update when something noteworthy happened. [] if nothing to update.`;
  }

  /**
   * Build taskOps instructions for the structured response format.
   * Only provides meaningful guidance when the employee has pending tasks.
   * @returns {string}
   */
  _buildTaskOpsInstructions() {
    if (!this.taskManager.hasPending()) {
      return `## Task Operations
- taskOps: Manage your personal task list. Use sparingly — only when you have a concrete task to track (e.g. boss asked you to get info from someone).
- Create: { "op": "create", "description": "...", "type": "oneshot|long-running|conditional", "condition": "completion condition", "onResolveTarget": "chatGroupId to notify", "onResolveHint": "what to report" }
- Resolve: { "op": "resolve", "taskId": "id", "result": "resolution details" }
- Fail: { "op": "fail", "taskId": "id", "reason": "why it failed" }
- [] if no task operations needed (most of the time).`;
    }

    // When tasks exist, the detailed instructions are already in buildPendingTasksPrompt()
    return `## Task Operations
- taskOps: Manage your pending tasks (see "📋 Your Pending Tasks" section above).
- Resolve tasks when their conditions are met. Fail tasks that are no longer achievable.
- Pay attention to task urgency — overdue tasks need immediate action.
- [] if no task operations needed this turn.`;
  }

  // ======================== Tool & Skill Define ========================

  /**
   * Core tool names that get full parameter documentation in the prompt.
   * Other tools only show name + description (use get_tool_detail to inspect).
   */
  static CORE_TOOLS = new Set([
    'send_message',
    'load_skill',
    'get_tool_detail',
    'get_skill_detail',
  ]);

  /**
   * Build the Tool Define section for the system prompt.
   *
   * Progressive disclosure strategy:
   * - **Core tools** (messaging, skill/tool discovery): always shown with full parameter docs.
   * - **Other tools**: NOT listed here at all. They are discovered through skills.
   *   When a skill is pinned, its associated tools are disclosed in the Skill Define section.
   *   When a skill is loaded on-demand, ToolLoop auto-escalates the required tools.
   *
   * This keeps the system prompt lean — the agent learns about tools through its skills,
   * not through a massive upfront tool catalog.
   *
   * @returns {string} Complete "## Tool Define" section
   */
  _buildToolDefine() {
    if (!this.toolKit) return '';

    const defs = this.toolKit.definitions;
    if (!defs || defs.length === 0) return '';

    // Only show core tools in the Tool Define section
    const coreDefs = defs.filter(def => {
      const fn = def.function;
      return fn && Employee.CORE_TOOLS.has(fn.name);
    });

    let section = `\n## Tool Define\n`;
    section += `You have tools available via your skills. Use them via the "actions" array in your JSON response.\n`;
    section += `All file operations are scoped to your workspace directory.\n\n`;

    // Core tools: full parameter documentation
    if (coreDefs.length > 0) {
      section += `### Core Tools (always available)\n\n`;
      for (const def of coreDefs) {
        section += this._formatToolFull(def) + '\n\n';
      }
    }

    section += `> **Tool Discovery**: Your skills define what tools you can use. Pinned skills list their tools below.\n`;
    section += `> For other skills, call **load_skill** to see its full instructions and unlock its tools.\n`;
    section += `> Use **get_tool_detail** to inspect any tool's exact parameters before calling it.\n`;

    // Teamwork & collaboration guidance
    section += `\n### Teamwork & Collaboration (IMPORTANT)\n`;
    section += `- You are part of a team! Proactively communicate with colleagues using send_message.\n`;
    section += `- When working in parallel, coordinate to avoid duplicate work and share discoveries.\n`;
    section += `- Use @Name format when addressing colleagues in messages.\n`;
    section += `- If you notice something relevant to a colleague's task, share it immediately.\n`;

    // Efficiency & ground truth rules
    section += `\n### Working Rules\n`;
    section += `- **Batch operations**: Plan all needed operations at once and batch related tool calls.\n`;
    section += `- **Verify results (MANDATORY)**: After creating files/directories, use file_list or file_read to confirm they exist on disk. Never assume — always verify.\n`;
    section += `- **Tool calls via actions only**: When a task requires an operation, you MUST include the tool call in "actions" — text alone does nothing. NEVER fabricate results.\n`;
    section += `- **No fictional time**: Execute tasks NOW. Never say "by end of day", "tomorrow", etc.\n`;
    section += `- **Concrete deliverables**: Report EXACTLY what you produced (file paths, content summaries).\n`;
    section += `- **Read before reference**: If a colleague says they delivered files, READ them with file_read before acting on them.\n`;

    return section;
  }

  /**
   * Format a single tool definition with full parameter documentation.
   * @param {object} def - OpenAI function calling format definition
   * @returns {string}
   */
  _formatToolFull(def) {
    const fn = def.function;
    if (!fn) return '';

    let doc = `#### ${fn.name}\n${fn.description || '(no description)'}`;

    const params = fn.parameters;
    if (params && params.properties && Object.keys(params.properties).length > 0) {
      const required = new Set(params.required || []);
      const paramLines = Object.entries(params.properties).map(([name, schema]) => {
        const req = required.has(name) ? '(required)' : '(optional)';
        const type = schema.type || 'any';
        const desc = schema.description || '';
        if (type === 'array' && schema.items) {
          const itemProps = schema.items.properties;
          if (itemProps) {
            const itemFields = Object.entries(itemProps).map(([k, v]) => {
              const itemReq = (schema.items.required || []).includes(k) ? '(required)' : '(optional)';
              return `      - ${k}: ${v.type || 'any'} ${itemReq} — ${v.description || ''}`;
            }).join('\n');
            return `  - ${name}: array ${req} — ${desc}\n    Item fields:\n${itemFields}`;
          }
        }
        let line = `  - ${name}: ${type} ${req} — ${desc}`;
        if (schema.enum) line += ` (values: ${schema.enum.join(', ')})`;
        return line;
      });
      doc += `\nParameters:\n${paramLines.join('\n')}`;
    } else {
      doc += `\nParameters: (none)`;
    }

    return doc;
  }

  /**
   * Build the Skill Define section for the system prompt.
   *
   * Only shows skills the employee has installed (enabled/pinned in their SkillSet).
   * - Pinned skills: full L2 body inlined (LLM sees complete workflow)
   * - Enabled skills: L1 metadata only (use get_skill_detail or load_skill to inspect)
   * - No skills installed: tells the agent they have no specialized skills
   *
   * @returns {string} Complete "## Skill Define" section
   */
  _buildSkillDefine() {
    let resolvedSkills = [];
    try {
      resolvedSkills = this.skillSet.resolve(skillRegistry);
    } catch {}

    if (resolvedSkills.length === 0) {
      return `\n## Skill Define\nYou have no specialized skills installed. You can perform general tasks using your core tools.\n`;
    }

    const pinned = this.skillSet.pinnedSkills;
    const pinnedSkills = resolvedSkills.filter(s => pinned.has(s.id));
    const otherSkills = resolvedSkills.filter(s => !pinned.has(s.id));

    let section = `\n## Skill Define\n`;
    section += `Your skills define your specialized capabilities and determine which tools you can use.\n\n`;

    // Pinned skills: full L2 body inlined + associated tool disclosure
    if (pinnedSkills.length > 0) {
      for (const s of pinnedSkills) {
        const body = s.getBody();
        section += `### ${s.icon || '⚡'} ${s.name} [pinned]\n${body}\n`;

        // Disclose the tools associated with this pinned skill
        if (s.requiredTools && s.requiredTools.length > 0 && this.toolKit) {
          const allDefs = this.toolKit.definitions;
          const skillToolDefs = allDefs.filter(d => {
            const name = d.function?.name;
            return name && s.requiredTools.includes(name);
          });
          if (skillToolDefs.length > 0) {
            section += `\n**Available tools from this skill** (use get_tool_detail for full parameters):\n`;
            for (const def of skillToolDefs) {
              const fn = def.function;
              section += `- **${fn.name}**: ${fn.description || '(no description)'}\n`;
            }
          }
        }
        section += `\n`;
      }
    }

    // Other enabled skills: L1 metadata only — encourage on-demand loading
    if (otherSkills.length > 0) {
      section += `### Other Skills (call load_skill to see full instructions and unlock tools)\n`;
      for (const s of otherSkills) {
        section += `- **${s.name}** (${s.id}): ${s.description}\n`;
      }
      section += `\n> When a task matches one of these skills, call **load_skill** with the skill ID.\n`;
      section += `> This will show you the full workflow AND automatically unlock the skill's tools.\n`;
    }

    return section;
  }

  /**
   * Build a human-readable tool reference from the employee's toolKit definitions.
   * Converts OpenAI function-calling format into a clear schema description
   * that LLMs can follow when constructing JSON actions.
   *
   * @returns {string} Formatted tool reference section
   */
  _buildToolReference() {
    if (!this.toolKit) return '';

    const defs = this.toolKit.definitions;
    if (!defs || defs.length === 0) return '';

    const toolDocs = defs.map(def => {
      const fn = def.function;
      if (!fn) return null;

      let doc = `### ${fn.name}\n${fn.description || '(no description)'}`;

      const params = fn.parameters;
      if (params && params.properties && Object.keys(params.properties).length > 0) {
        const required = new Set(params.required || []);
        const paramLines = Object.entries(params.properties).map(([name, schema]) => {
          const req = required.has(name) ? '(required)' : '(optional)';
          const type = schema.type || 'any';
          const desc = schema.description || '';
          // Handle nested object/array types with a compact representation
          if (type === 'array' && schema.items) {
            const itemProps = schema.items.properties;
            if (itemProps) {
              const itemFields = Object.entries(itemProps).map(([k, v]) => {
                const itemReq = (schema.items.required || []).includes(k) ? '(required)' : '(optional)';
                return `      - ${k}: ${v.type || 'any'} ${itemReq} — ${v.description || ''}`;
              }).join('\n');
              return `  - ${name}: array ${req} — ${desc}\n    Item fields:\n${itemFields}`;
            }
          }
          return `  - ${name}: ${type} ${req} — ${desc}`;
        });
        doc += `\nParameters:\n${paramLines.join('\n')}`;
      } else {
        doc += `\nParameters: (none)`;
      }

      return doc;
    }).filter(Boolean);

    return `## Tool Reference\nBelow are ALL tools available to you. When calling tools via "actions", use these exact names and parameter schemas.\n\n${toolDocs.join('\n\n')}`;
  }

  /**
   * Shared Actions protocol description — reused by both boss-chat and group-chat response formats.
   */
  _buildActionsProtocol() {
    return `## Actions — Tool Call Protocol (CRITICAL)
The "actions" field is how you execute real operations. The system will execute each action,
feed the results back to you, and you continue until all work is done (like a tool-call loop).

**Protocol:**
1. You return JSON with "actions" containing tool calls you need.
2. The system executes those tools and sends you the results.
3. You review the results and either:
   - Return more "actions" if additional work is needed, OR
   - Return "actions": [] when all work is complete.
4. This loop continues until you return an empty "actions" array.

**Rules:**
- "actions" is an ARRAY — you can call multiple tools in one response.
- Set "actions" to [] (empty array) if no tool calls are needed.
- Each action object: { "tool": "<tool_name>", "args": { <parameters> } }
  - tool_name must match one of the tools listed in "Tool Define" section.
  - args must match the tool's parameter schema exactly. Use get_tool_detail if unsure about parameters.
- The system executes actions in order; results take real effect.
- **NEVER describe an action in "content" without putting it in "actions"** — text alone does nothing.
- After actions execute, you will receive the results and can continue working.
- In your final response (actions: []), summarize what was accomplished in "content".`;
  }

  _buildBossChatResponseFormat() {
    const actionsProtocol = this._buildActionsProtocol();

    return `
## Structured Response Format (MANDATORY)
Your reply MUST be a JSON object (return JSON only, nothing else):
{
  "content": "Your natural language reply — warm, personal, no rigid templates",
  "actions": [
    { "tool": "tool_name", "args": { "param1": "value1", "param2": "value2" } }
  ],
  "memorySummary": "A single, complete summary that REPLACES the previous one — cover all important context so far. null if conversation just started.",
  "memoryOps": [
    { "op": "add", "type": "long_term", "content": "Important fact or preference", "category": "preference", "importance": 8 },
    { "op": "add", "type": "short_term", "content": "Current topic context", "category": "context", "importance": 5, "ttl": 3600 },
    { "op": "update", "id": "existing_mem_id", "content": "Updated content", "importance": 7 },
    { "op": "delete", "id": "outdated_mem_id" }
  ],
  "relationshipOps": [
    { "employeeId": "boss", "name": "Boss", "impression": "Decisive, prefers concise updates", "affinity": 65 }
  ],
  "taskOps": [
    { "op": "create", "description": "Ask Bob about API design", "type": "oneshot", "onResolveTarget": "boss-chat-myId", "onResolveHint": "Report the answer back to boss" },
    { "op": "resolve", "taskId": "task-id", "result": "Got the answer: use REST" }
  ]
}

### Example — Multi-step workflow (tool call loop):
Step 1 — You return:
{
  "content": "Let me check the available role templates first.",
  "actions": [{ "tool": "list_job_templates", "args": {} }],
  "memorySummary": "Boss wants a frontend team.",
  "memoryOps": [], "relationshipOps": []
}
Step 2 — System sends you the tool results, then you return:
{
  "content": "Great, I'll create the Frontend Dev department now! 🏗️",
  "actions": [{ "tool": "create_department", "args": {
    "departmentName": "Frontend Dev", "mission": "Build the website",
    "members": [
      { "templateId": "frontend-developer", "name": "Alice", "isLeader": true },
      { "templateId": "frontend-developer", "name": "Bob" }
    ]
  }}],
  "memorySummary": "Boss wants frontend team. Checked templates, creating department.",
  "memoryOps": [], "relationshipOps": []
}
Step 3 — System confirms creation, then you return:
{
  "content": "Done! Frontend Dev department is set up with Alice (lead) and Bob. Ready for tasks! 🚀",
  "actions": [],
  "memorySummary": "Created Frontend Dev dept with Alice (lead) and Bob.",
  "memoryOps": [{ "op": "add", "type": "long_term", "content": "Frontend Dev department created with Alice and Bob", "category": "fact", "importance": 7 }],
  "relationshipOps": []
}

### Example — Casual chat (no actions needed):
{
  "content": "Good morning, boss! ☀️ Ready to help with anything you need today.",
  "actions": [],
  "memorySummary": null,
  "memoryOps": [],
  "relationshipOps": [],
  "taskOps": []
}

${actionsProtocol}

${this._buildMemoryInstructions()}

${this._buildRelationshipInstructions()}

${this._buildTaskOpsInstructions()}

## Output Rules
1. Content should be natural and personal, avoid rigid templates, feel free to add emoji.
2. Keep replies concise, don't be verbose.
3. You MUST always return valid JSON. Do NOT wrap it in markdown code fences. Do NOT add any text outside the JSON object. The response must start with { and end with }.
4. When actions are needed, ALWAYS put them in the "actions" array — never just describe them in text.
5. After tool results arrive, review them carefully and continue your workflow. Do NOT repeat actions that already succeeded.`;
  }

  /**
   * Build the structured JSON response format for group chat (dept-chat & work-chat).
   * Shares the same actions protocol, memory, and relationship instructions as boss-chat,
   * but adds group-chat-specific fields: innerThoughts, topicSaturation, interestLevel,
   * shouldSpeak, reason, messages.
   *
   * @param {object} [options]
   * @param {string} [options.scenario] - 'dept' or 'work'
   * @returns {string}
   */
  _buildGroupChatResponseFormat({ scenario = 'work' } = {}) {
    const actionsProtocol = this._buildActionsProtocol();
    const isDept = scenario === 'dept';

    const messageHint = isDept
      ? '"your reply"'
      : '"your message (use @[agentId] to @ others, use [[file:path]] to reference files)"';

    return `
## Structured Response Format (MANDATORY)
Your reply MUST be a JSON object (return JSON only, nothing else):
{
  "innerThoughts": "Your real inner thoughts right now — be emotional: feelings first, then analysis",
  "topicSaturation": 5,
  "interestLevel": 5,
  "shouldSpeak": true,
  "reason": "reason for speaking or staying silent",
  "content": ${messageHint},
  "messages": [{ "content": ${messageHint} }],
  "actions": [
    { "tool": "tool_name", "args": { "param1": "value1" } }
  ],
  "memorySummary": "A single, complete summary that REPLACES the previous one — cover all important context so far. null if nothing to summarize.",
  "memoryOps": [
    { "op": "add", "type": "long_term", "content": "Important fact worth remembering permanently", "category": "fact", "importance": 8 },
    { "op": "add", "type": "short_term", "content": "Temporary context about current discussion", "category": "context", "importance": 5, "ttl": 3600 },
    { "op": "delete", "id": "mem_id_to_forget" }
  ],
  "relationshipOps": [
    { "employeeId": "emp_123", "name": "Xiao Li", "impression": "Tech-savvy, reliable", "affinity": 70 }
  ],
  "taskOps": [
    { "op": "create", "description": "Ask Bob about API design", "type": "oneshot", "onResolveTarget": "boss-chat-xxx", "onResolveHint": "Report the answer back to boss" },
    { "op": "resolve", "taskId": "task-id", "result": "Got the answer: use REST" },
    { "op": "fail", "taskId": "task-id", "reason": "Bob is unavailable" }
  ]
}

### Group Chat Fields
- topicSaturation: 1-10 score of how saturated/exhausted the current topic is. Be honest!
- interestLevel: 1-10 score of how relevant and interesting this topic is TO YOU PERSONALLY.
  - 1-3: Not your area, boring, or irrelevant. You'd rather do something else.
  - 4-6: Somewhat related. Mild curiosity but no strong pull.
  - 7-8: Directly in your domain. Your expertise is needed.
  - 9-10: Critical to your current task. Deeply invested.
  - ⚠️ DON'T inflate — most topics should NOT be 8+. Keep it LOW (1-4) if outside your domain.
  - Your interest affects how quickly you'll check messages next time.
- When topicSaturation ≥ 7, you MUST set shouldSpeak: false (unless directly asked).
- When not speaking, messages should be []. content should be empty string.
${!isDept ? '- When mentioning files, use [[file:relative/path]] format so others can click to view the file.' : ''}

${actionsProtocol}

${this._buildMemoryInstructions()}

${this._buildRelationshipInstructions()}

${this._buildTaskOpsInstructions()}

## Output Rules
1. Content should be natural and personal, in your own personality style.
2. Keep replies concise — 1-2 sentences for casual chat, short and direct for work.
3. You MUST always return valid JSON. Do NOT wrap it in markdown code fences. Do NOT add any text outside the JSON object.
4. When actions are needed, ALWAYS put them in the "actions" array — never just describe them in text.
5. After tool results arrive, review them carefully and continue your workflow.`;
  }

  // ======================== Boss 1-on-1 Chat ========================

  /**
   * Handle an incoming message from the boss in a 1-on-1 chat.
   * This is a GENERIC Employee capability — any employee can chat with the boss.
   *
   * @param {string} message - The boss's message text
   * @param {object} company - The Company instance (for bossName, chatSessionId)
   * @param {object} [options]
   * @param {string} [options.lang] - Language hint
   * @param {string} [options.conversationContext] - Extra context to inject (e.g. department info)
   * @returns {Promise<{content: string}>}
   */
  async handleBossMessage(message, company, { lang, conversationContext } = {}) {
    if (!this.canChat()) {
      if (this.agentType === 'cli') {
        throw new Error('Employee is in CLI mode and cannot handle boss messages via LLM.');
      }
      throw new Error('Employee AI is not configured. Please configure a valid API Key first.');
    }

    const { messages, bossChatGroupId } = this._buildBossMessageContext(message, company, { lang, conversationContext });

    // Use chatWithTools so the employee can call its tools (management tools, etc.)
    // No tier restriction — the employee's pinned skills have their full instructions
    // inlined, so the LLM knows which tools to use and will call them directly.
    const response = await this.chatWithTools(messages, this.toolKit, {
      temperature: 0.8,
      maxTokens: 2048,
      maxIterations: 5,
    });

    const reply = this.parseStructuredResponse(response.content, bossChatGroupId);

    // NOTE: Actions are now executed automatically by ToolLoop during its iteration cycle.
    // The JSON actions protocol is detected by ToolLoop.parseJSONActions(), which executes
    // the tools and feeds results back to the LLM for continued processing.
    // No need to call executeActions() here — doing so would double-execute.

    return reply;
  }

  /**
   * Build the message array for a boss 1-on-1 chat.
   * Assembles: system prompt + memory + search context + response format + history + user message.
   *
   * Used by both handleBossMessage (non-streaming) and streaming routes.
   *
   * @param {string} message - The boss's message text
   * @param {object} company - The Company instance
   * @param {object} [options]
   * @param {string} [options.lang] - Language hint
   * @param {string} [options.conversationContext] - Extra context to inject
   * @returns {{ messages: Array, bossChatGroupId: string }}
   */
  _buildBossMessageContext(message, company, { lang, conversationContext } = {}) {
    const bossChatGroupId = `boss-chat-${this.id}`;
    const chatSessionId = company.chatSessionId || `secretary-boss-chat`;

    // Use generic Employee context builder for memory, history, and search
    const { memorySection, historySummaryContext, recentHistory, searchContextSection } =
      this.buildChatContext(bossChatGroupId, chatSessionId, message);

    // Format history (wrap assistant messages as JSON if needed)
    const formattedHistory = recentHistory.map(h => {
      if (h.role === 'user') return { role: 'user', content: h.content };
      const trimmed = (h.content || '').trim();
      const content = (trimmed.startsWith('{') && trimmed.endsWith('}'))
        ? trimmed
        : JSON.stringify({ content: h.content, actions: [] });
      return { role: 'assistant', content };
    });

    // Build system prompt: base identity/tools/skills + conversation context + response format
    const basePrompt = this._buildSystemMessage({ lang });
    const responseFormat = this._buildBossChatResponseFormat();

    const systemPrompt = `${basePrompt}

## Current Conversation
You are having a private 1-on-1 conversation with your boss "${company.bossName || 'the Boss'}" at company "${company.name || 'the Company'}".
${conversationContext || ''}
${memorySection}
${searchContextSection}
${responseFormat}`;

    const userMessage = historySummaryContext
      ? `${historySummaryContext}\n\n${message}`
      : message;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...formattedHistory,
      { role: 'user', content: userMessage },
    ];

    return { messages, bossChatGroupId };
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
- You MUST write ALL content (signature, personalityBio, greeting, broadcast) in ${getAppLanguageName()}. This is the company's official language.
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
      // Class routing — used by deserializeEmployee to pick the right concrete class
      employeeClass: this.employeeClass,
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
      taskManager: this.taskManager.serialize(),
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
    this.taskManager = data.taskManager ? TaskManager.deserialize(data.taskManager) : new TaskManager();
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
