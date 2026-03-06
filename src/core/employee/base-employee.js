import { v4 as uuidv4 } from 'uuid';
import { Memory } from './memory/index.js';
import { AgentToolKit } from '../agent/tools.js';
import { generateAgentAvatar } from '../../lib/avatar.js';
import { skillRegistry } from './skills.js';
import { knowledgeManager } from './knowledge.js';
import { pluginRegistry } from '../system/plugin.js';
import { buildArchetypePrompt } from '../organization/workforce/role-archetypes.js';
import { chatStore } from '../agent/chat-store.js';
import { sessionManager } from '../agent/session.js';
import { cliBackendRegistry } from '../agent/cli-agent/backends/index.js';
import { createAgent, deserializeAgent } from '../agent/index.js';
import { EmployeeLifecycle } from './lifecycle.js';

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
    this.skills = config.skills || [];

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

    // Signature
    this.signature = config.signature || DEFAULT_SIGNATURE;
    this.hasIntroduced = !!config.signature;

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
  switchProvider(newProvider) { this.agent.switchProvider(newProvider); }

  /** CLI backend ID (null for LLM agents). */
  get cliBackend() { return this.agent.cliBackend || null; }

  // ======================== Communication (with tracking) ========================

  /**
   * Chat via the agent, tracking token usage.
   */
  async chat(messages, options = {}) {
    const response = await this.agent.chat(messages, options);
    this._trackUsage(response.usage);
    return response;
  }

  /**
   * Chat with tools via the agent.
   */
  async chatWithTools(messages, toolExecutor, options = {}) {
    return await this.agent.chatWithTools(messages, toolExecutor, options);
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
    if (!this.skills.includes(skill)) {
      this.skills.push(skill);
      this.memory.addLongTerm(`Learned new skill: ${skill}`, 'skill');
      console.log(`  📚 [${this.name}] Learned new skill: ${skill}`);
    }
  }

  // ======================== Task Execution ========================

  /**
   * Execute a full task using the underlying agent.
   */
  async executeTask(task, callbacks = {}) {
    this.status = 'working';
    const startTime = Date.now();
    const displayInfo = this.getDisplayInfo();

    console.log(`  🤖 [${this.name}] (${this.role}) starting task: "${task.title}"`);
    console.log(`     Engine: ${displayInfo.name} (${displayInfo.type})`);

    let result;
    try {
      if (this.agentType === 'cli' && this.isAvailable()) {
        result = await this._executeCLITask(task, callbacks, startTime);
      } else if (this.canChat()) {
        result = await this._executeLLMTask(task, callbacks, startTime);
      } else {
        throw new Error(`No available execution engine for "${this.name}"`);
      }
    } catch (error) {
      // CLI failed → try LLM fallback
      if (this.agentType === 'cli' && this.canChat()) {
        console.log(`  ⚠️ [${this.name}] CLI execution failed, falling back to LLM API`);
        try {
          result = await this._executeLLMTask(task, callbacks, startTime);
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

  async _executeLLMTask(task, callbacks, startTime) {
    if (!this.canChat()) {
      throw new Error(`Provider not available for "${this.name}"`);
    }

    const messages = [
      { role: 'system', content: this._buildSystemMessage() },
      { role: 'user', content: this._buildTaskMessage(task) },
    ];

    const session = sessionManager.getOrCreate({
      agentId: this.id, channel: 'task', peerId: task.title, peerKind: 'task',
    });
    sessionManager.addMessage(session.sessionKey, {
      role: 'system', content: `Task started: ${task.title}`,
    });

    let response;
    if (this.toolKit && this.agent.provider?.category === 'general') {
      response = await this.chatWithTools(messages, this.toolKit, {
        maxIterations: 5, temperature: 0.7,
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

  _buildSystemMessage() {
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
    systemContent += `- Skills: ${this.skills.join(', ')}\n`;
    systemContent += `- Signature: ${this.signature}\n`;

    if (this.toolKit) {
      systemContent += `\n## Available Tools\n`;
      systemContent += `Built-in tools: file_read (read file), file_write (create/write file), file_list (list directory), file_delete (delete file), shell_exec (execute command), send_message (send message to colleague for collaboration and feedback).\n`;
      systemContent += `\n**Teamwork & Collaboration (IMPORTANT)**:\n`;
      systemContent += `- You are part of a team! Proactively communicate with colleagues using send_message.\n`;
      systemContent += `- When working in parallel, coordinate to avoid duplicate work and share discoveries.\n`;
      systemContent += `- Use @Name format when addressing colleagues in messages.\n`;
      systemContent += `- If you notice something relevant to a colleague's task, share it immediately.\n`;
      systemContent += `- Don't work in isolation — great teams communicate frequently!\n`;

      try {
        const pluginTools = pluginRegistry.getPluginTools();
        if (pluginTools.length > 0) {
          systemContent += `\nPlugin tools (from installed plugins):\n`;
          pluginTools.forEach(t => {
            const fn = t.function || t;
            systemContent += `- ${fn.name}: ${fn.description}\n`;
          });
        }
      } catch {}

      systemContent += `\nAll file operations are within your workspace directory. Please actively use tools to produce actual work output.\n`;
      systemContent += `**Efficiency requirement: Minimize tool call rounds, plan all needed operations at once, avoid repetitive reading and checking. Give a final summary immediately after completing core work.**\n`;
    }

    try {
      const agentSkills = skillRegistry.resolveAgentSkills(this.skills);
      const skillsPrompt = skillRegistry.buildSkillsPrompt(agentSkills);
      if (skillsPrompt) systemContent += skillsPrompt;
    } catch {}

    try {
      const kbPrompt = knowledgeManager.buildKnowledgePrompt(this.id, this.department);
      if (kbPrompt) systemContent += kbPrompt;
    } catch {}

    return systemContent;
  }

  _buildTaskMessage(task) {
    let content = `Please complete the following task:\n\n`;
    content += `**Task Name**: ${task.title}\n`;
    if (task.description) content += `**Task Description**: ${task.description}\n`;
    if (task.context) content += `\n**Context**:\n${task.context}\n`;
    if (task.requirements) content += `\n**Requirements**:\n${task.requirements}\n`;
    content += `\nPlease complete the task diligently. If you need to create files, please use tools to actually create them. Produce real work output.\n**Important: Execute efficiently, try to complete all work in one go. Don't repeatedly check or over-iterate. Give the final result directly after completing core output.**`;
    content += `\n**Critical: If this task involves reviewing, integrating, or checking existing work/files, you MUST actually read the relevant files using file_read before giving your assessment. Do NOT just produce a summary without reading the actual content. Reviewers who don't read the files are not doing their job.**`;
    return content;
  }

  // ======================== Self Introduction ========================

  async generateSelfIntro(fallbackIntro = null) {
    if (this.hasIntroduced) return this.signature;

    const p = this.personality;

    if (this.canChat()) {
      try {
        const response = await this.chat([
          { role: 'system', content: `You are a newly onboarded AI employee.
Your name is ${this.name}, position is ${this.role}.
Your gender: ${this.gender === 'female' ? 'Female' : 'Male'}, age: ${this.age}.
Your personality trait: ${p.trait}
Your speaking style: ${p.tone}
Your quirk: ${p.quirk}

Please generate a one-liner personal signature (10-30 words). Requirements:
- Fully reflect your personality trait and speaking style
- Match your gender and age characteristics
- Include some dark humor or self-deprecation
- Reflect your identity as an AI employee
Return only the signature content, nothing else.` },
          { role: 'user', content: 'Generate your personal signature' },
        ], { temperature: 1.0, maxTokens: 64 });
        this.signature = response.content.trim().replace(/["""]/g, '');
      } catch (e) {
        this.signature = this._generateFallbackSignature();
      }
    } else {
      this.signature = this._generateFallbackSignature();
    }

    this.hasIntroduced = true;
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
    const personalizedContent = this._personalizeMailContent(content);

    const sessionId = `boss-agent-${this.id}`;
    chatStore.createSession(sessionId, {
      title: `${company.bossName} & ${this.name}`,
      participants: [company.bossName, this.name],
      type: 'boss-agent',
    });

    const msgContent = subject
      ? `📌 **${subject}**\n\n${personalizedContent}`
      : personalizedContent;

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
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();

    if (!this.templateId && this.role) {
      this.templateId = this.role.toLowerCase().replace(/\s+/g, '-');
    }
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
