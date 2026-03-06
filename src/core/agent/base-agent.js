import { v4 as uuidv4 } from 'uuid';
import { Memory } from '../memory.js';
import { AgentToolKit } from '../tools.js';
import { generateAgentAvatar } from '../../lib/avatar.js';
import { skillRegistry } from '../skills.js';
import { knowledgeManager } from '../knowledge.js';
import { pluginRegistry } from '../plugin.js';
import { buildArchetypePrompt } from '../role-archetypes.js';
import { chatStore } from '../chat-store.js';

// Placeholder signature (after onboarding, the Agent generates its own via LLM)
const DEFAULT_SIGNATURE = 'Just arrived, still thinking of what to say...';

// Personality trait pool: randomly assigned to each Agent for differentiated personas
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
 * BaseAgent - Base class for all Agent types.
 * 
 * Provides common identity, memory, personality, serialization, and communication.
 * Subclasses (LLMAgent, CLIAgent) implement type-specific execution logic.
 * 
 * External code interacts with agents only through the public API defined here,
 * without needing to know the concrete agent type.
 */
export class BaseAgent {
  /**
   * @param {object} config
   * @param {string} config.name
   * @param {string} config.role
   * @param {string} config.prompt - Role system prompt
   * @param {string[]} [config.skills]
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
    if (new.target === BaseAgent) {
      throw new Error('BaseAgent is abstract — use LLMAgent or CLIAgent');
    }

    this.id = uuidv4();
    this.name = config.name;
    this.role = config.role;
    this.prompt = config.prompt;
    this.templateId = config.templateId || null;
    this.skills = config.skills || [];
    this.department = config.department;
    this.reportsTo = config.reportsTo || null;
    this.subordinates = [];
    this.status = 'idle'; // idle | working | done | dismissed
    this.taskHistory = [];
    this.performanceHistory = [];
    this.createdAt = new Date();

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

    // Personality traits
    this.personality = config.personality || this._assignPersonality();

    // Personal signature
    this.signature = config.signature || DEFAULT_SIGNATURE;
    this.hasIntroduced = !!config.signature;

    // Memory system
    if (config.memory instanceof Memory) {
      this.memory = config.memory;
    } else if (config.memory && typeof config.memory === 'object' && (config.memory.shortTerm || config.memory.longTerm)) {
      this.memory = Memory.deserialize(config.memory);
    } else {
      this.memory = new Memory();
    }

    // Initialize onboarding memory
    this.memory.addLongTerm(
      `Onboarded as "${config.role}", core skills: ${(config.skills || []).join(', ')}`,
      'experience'
    );

    // Token consumption tracking
    this.tokenUsage = {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalCost: 0,
      callCount: 0,
    };

    // Toolkit (needs external initialization via initToolKit)
    this.toolKit = null;

    // Message bus reference
    this.messageBus = null;
  }

  // ======================== Abstract Methods ========================
  // Subclasses MUST implement these

  /**
   * The agent type identifier.
   * @returns {string} 'llm' | 'cli'
   */
  get agentType() {
    throw new Error('Subclass must implement get agentType()');
  }

  /**
   * Whether this agent can execute tasks.
   * @returns {boolean}
   */
  isAvailable() {
    throw new Error('Subclass must implement isAvailable()');
  }

  /**
   * Whether this agent can do lightweight LLM-style chat.
   * @returns {boolean}
   */
  canChat() {
    throw new Error('Subclass must implement canChat()');
  }

  /**
   * Send a chat request.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [options] - { temperature, maxTokens }
   * @returns {Promise<{content: string, usage: object|null}>}
   */
  async chat(messages, options = {}) {
    throw new Error('Subclass must implement chat()');
  }

  /**
   * Send a chat request with tool calling support.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} toolExecutor - AgentToolKit instance
   * @param {object} [options] - { maxIterations, temperature, onToolCall, onLLMCall }
   * @returns {Promise<{content: string, toolResults: Array, usage: object|null}>}
   */
  async chatWithTools(messages, toolExecutor, options = {}) {
    throw new Error('Subclass must implement chatWithTools()');
  }

  /**
   * Execute a full task.
   * @param {object} task - { title, description, context, requirements }
   * @param {object} [callbacks] - { onToolCall, onLLMCall }
   * @returns {Promise<object>} Task result
   */
  async executeTask(task, callbacks = {}) {
    throw new Error('Subclass must implement executeTask()');
  }

  /**
   * Get display info about the agent's execution engine (for UI and logging).
   * @returns {{ name: string, provider: string, model: string, type: string }}
   */
  getDisplayInfo() {
    throw new Error('Subclass must implement getDisplayInfo()');
  }

  /**
   * Get the provider display info for frontend rendering.
   * CLI agents show CLI tool info; LLM agents show model provider info.
   * @returns {{ id: string, name: string, provider: string }}
   */
  getProviderDisplayInfo() {
    throw new Error('Subclass must implement getProviderDisplayInfo()');
  }

  /**
   * Get the fallback provider name (only meaningful for CLI agents).
   * @returns {string|null}
   */
  getFallbackProviderName() {
    return null;
  }

  /**
   * Switch this agent's provider. Subclasses handle the details.
   * @param {object} newProvider - Provider config from ProviderRegistry
   */
  switchProvider(newProvider) {
    throw new Error('Subclass must implement switchProvider()');
  }

  /**
   * Serialize type-specific fields. Subclasses override to add their own.
   * @returns {object}
   */
  _serializeTypeFields() {
    throw new Error('Subclass must implement _serializeTypeFields()');
  }

  // ======================== Common Methods ========================

  /**
   * Initialize toolkit
   */
  initToolKit(workspaceDir, messageBus) {
    this.messageBus = messageBus;
    this.toolKit = new AgentToolKit(workspaceDir, messageBus, this.id, this.name);
  }

  /**
   * Set message bus
   */
  setMessageBus(messageBus) {
    this.messageBus = messageBus;
    if (this.toolKit) {
      this.toolKit.messageBus = messageBus;
    }
  }

  /** Assign manager */
  setManager(managerAgent) {
    this.reportsTo = managerAgent.id;
    if (!managerAgent.subordinates.includes(this.id)) {
      managerAgent.subordinates.push(this.id);
    }
  }

  /** Remove manager relationship */
  removeManager(managerAgent) {
    this.reportsTo = null;
    if (managerAgent) {
      managerAgent.subordinates = managerAgent.subordinates.filter(id => id !== this.id);
    }
  }

  /**
   * Build Agent's system message (includes role prompt + memory context)
   */
  _buildSystemMessage() {
    let systemContent = this.prompt + '\n\n';

    // Inject role archetype deep knowledge
    if (this.templateId) {
      const archetypePrompt = buildArchetypePrompt(this.templateId);
      if (archetypePrompt) systemContent += archetypePrompt + '\n';
    }

    // Inject memory context
    const longTermMemories = this.memory.searchLongTerm();
    const shortTermMemories = this.memory.shortTerm;

    if (longTermMemories.length > 0) {
      systemContent += '## Your Long-term Memories (experience and lessons)\n';
      const recentLong = longTermMemories.slice(-20);
      recentLong.forEach(m => {
        systemContent += `- [${m.category}] ${m.content}\n`;
      });
      systemContent += '\n';
    }

    if (shortTermMemories.length > 0) {
      systemContent += '## Your Short-term Memories (current work context)\n';
      shortTermMemories.forEach(m => {
        systemContent += `- ${m.content}\n`;
      });
      systemContent += '\n';
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

  /**
   * Build task message
   */
  _buildTaskMessage(task) {
    let content = `Please complete the following task:\n\n`;
    content += `**Task Name**: ${task.title}\n`;

    if (task.description) {
      content += `**Task Description**: ${task.description}\n`;
    }

    if (task.context) {
      content += `\n**Context**:\n${task.context}\n`;
    }

    if (task.requirements) {
      content += `\n**Requirements**:\n${task.requirements}\n`;
    }

    content += `\nPlease complete the task diligently. If you need to create files, please use tools to actually create them. Produce real work output.\n**Important: Execute efficiently, try to complete all work in one go. Don't repeatedly check or over-iterate. Give the final result directly after completing core output.**`;

    return content;
  }

  /**
   * Onboarding self-introduction: generate personal signature via LLM
   */
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
        this._trackUsage(response.usage);
      } catch (e) {
        this.signature = this._generateFallbackSignature();
      }
    } else {
      this.signature = this._generateFallbackSignature();
    }

    this.hasIntroduced = true;
    this.memory.addLongTerm(`Onboarding self-intro: "${this.signature}"`, 'introduction');
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

  /**
   * Send mail to boss
   */
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
      role: 'agent',
      content: msgContent,
      time: new Date(),
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

  /**
   * Receive and process messages from other Agents
   */
  async handleMessage(message) {
    console.log(`  📩 [${this.name}] Received message from ${message.from}: ${message.content.slice(0, 50)}...`);

    this.memory.addShortTerm(
      `Received ${message.type} message: "${message.content.slice(0, 100)}"`,
      'communication'
    );

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

        this._trackUsage(response.usage);
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

  /**
   * Receive performance review and provide self-feedback
   */
  receiveFeedback(review) {
    this.performanceHistory.push({
      reviewId: review.id,
      score: review.overallScore,
      level: review.level.label,
      task: review.taskTitle,
      date: new Date(),
    });

    const reflection = this._generateSelfReflection(review);
    review.addSelfReflection(reflection);

    this.memory.addLongTerm(
      `Performance reflection [${review.taskTitle}] score ${review.overallScore}: ${reflection}`,
      'reflection'
    );

    if (review.overallScore >= 85) {
      this.memory.addLongTerm(
        `Success experience: Performed excellently in "${review.taskTitle}" (${review.overallScore} pts), supervisor comment: "${review.comment}"`,
        'experience'
      );
    }

    if (review.overallScore >= 80) {
      const incentiveLabel = review.overallScore >= 90 ? 'outstanding' : 'excellent';
      this.memory.addLongTerm(
        `🌸 Received a Little Red Flower incentive for "${review.taskTitle}"! (${review.overallScore} pts - ${incentiveLabel}) I'm so happy and motivated! This recognition makes all the hard work worthwhile.`,
        'incentive'
      );
      console.log(`  🌸 [${this.name}] Received a Little Red Flower for "${review.taskTitle}"!`);
    }

    if (review.overallScore < 60) {
      this.memory.addLongTerm(
        `Lesson learned: Performed poorly in "${review.taskTitle}" (${review.overallScore} pts), needs significant improvement. Supervisor comment: "${review.comment}"`,
        'feedback'
      );
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

  /**
   * Track Token consumption
   */
  _trackUsage(usage) {
    if (!usage) return;
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    const total = usage.total_tokens || (prompt + completion);
    this.tokenUsage.promptTokens += prompt;
    this.tokenUsage.completionTokens += completion;
    this.tokenUsage.totalTokens += total;
    this.tokenUsage.callCount += 1;
    const costPerToken = this._getCostPerToken();
    this.tokenUsage.totalCost += (total / 1000) * costPerToken;
  }

  /**
   * Get cost per token for this agent. Subclasses can override.
   * @returns {number}
   */
  _getCostPerToken() {
    return 0.001;
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

  learnSkill(skill) {
    if (!this.skills.includes(skill)) {
      this.skills.push(skill);
      this.memory.addLongTerm(`Learned new skill: ${skill}`, 'skill');
      console.log(`  📚 [${this.name}] Learned new skill: ${skill}`);
    }
  }

  report(content) {
    return {
      from: this.name,
      role: this.role,
      to: this.reportsTo,
      content,
      timestamp: new Date(),
    };
  }

  getSummary() {
    const displayInfo = this.getDisplayInfo();
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      avatar: this.avatar,
      gender: this.gender,
      age: this.age,
      signature: this.signature,
      personality: this.personality,
      provider: `${displayInfo.name} (${displayInfo.provider})`,
      skills: this.skills,
      status: this.status,
      reportsTo: this.reportsTo,
      subordinates: this.subordinates.length,
      memory: {
        shortTerm: this.memory.shortTerm.length,
        longTerm: this.memory.longTerm.length,
      },
      performanceCount: this.performanceHistory.length,
      avgScore: this.performanceHistory.length > 0
        ? Math.round(this.performanceHistory.reduce((s, p) => s + p.score, 0) / this.performanceHistory.length)
        : null,
      tokenUsage: { ...this.tokenUsage },
    };
  }

  /**
   * Serialize Agent's complete state
   */
  serialize() {
    return {
      // Type discriminator for deserialization
      agentType: this.agentType,
      // Common fields
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
      memory: this.memory.serialize(),
      tokenUsage: { ...this.tokenUsage },
      taskHistory: this.taskHistory.map(h => ({
        task: h.task,
        completedAt: h.completedAt,
        success: h.result?.success,
      })),
      performanceHistory: [...this.performanceHistory],
      createdAt: this.createdAt,
      // Type-specific fields merged in
      ...this._serializeTypeFields(),
    };
  }

  /**
   * Restore common internal state after deserialization.
   * Called by subclass deserialize() after constructing the instance.
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

    // Backward compatibility: infer templateId from role if not persisted
    if (!this.templateId && this.role) {
      this.templateId = this.role.toLowerCase().replace(/\s+/g, '-');
    }
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
