/**
 * Skills System - Skill management framework
 * 
 * Distilled from OpenClaw's Skills system (vendor/openclaw/src/config/types.skills.ts)
 * Re-implemented as an "employee training & certification" system
 *
 * Features:
 * - Skill registration and discovery
 * - Skill installation/enabling/disabling
 * - Per-agent skill assignment
 * - Skill categorization and search
 * - Skill configuration and environment variables
 */

/**
 * Skill states
 */
export const SkillState = {
  AVAILABLE: 'available',   // Available (not installed)
  INSTALLED: 'installed',   // Installed
  ENABLED: 'enabled',       // Enabled
  DISABLED: 'disabled',     // Disabled
};

/**
 * Skill categories
 */
export const SkillCategory = {
  CODING: 'coding',           // Programming/development
  ANALYSIS: 'analysis',       // Data analysis
  CREATIVE: 'creative',       // Creative content
  COMMUNICATION: 'communication', // Communication/collaboration
  AUTOMATION: 'automation',   // Automation
  RESEARCH: 'research',       // Research/investigation
  DESIGN: 'design',           // Design
  DEVOPS: 'devops',           // DevOps/deployment
};

const logInfo = (...args) => {
  if (process.env.IDEACO_SILENT_INIT === '1') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  console.log(...args);
};

/**
 * Skill definition
 */
export class SkillDefinition {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.version = config.version || '1.0.0';
    this.category = config.category || SkillCategory.CODING;
    this.description = config.description || '';
    this.instructions = config.instructions || '';  // Usage instructions for the Agent (like SKILL.md)
    this.requiredTools = config.requiredTools || []; // Required tool dependencies
    this.requiredPlugins = config.requiredPlugins || []; // Required plugin dependencies
    this.configSchema = config.configSchema || {};
    this.env = config.env || {};  // Environment variables
    this.tags = config.tags || [];
    this.author = config.author || 'Built-in';
    this.icon = config.icon || '⚡';
  }
}

/**
 * Skill registry - manages all available skills
 */
export class SkillRegistry {
  constructor() {
    /** @type {Map<string, {definition: SkillDefinition, state: string, config: object, installedAt: Date|null}>} */
    this.skills = new Map();
  }

  /**
   * Register a skill
   * @param {SkillDefinition} definition
   */
  register(definition) {
    if (this.skills.has(definition.id)) return;
    this.skills.set(definition.id, {
      definition,
      state: SkillState.AVAILABLE,
      config: {},
      installedAt: null,
      enabledAt: null,
    });
  }

  /**
   * Install a skill
   */
  install(skillId, config = {}) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    skill.state = SkillState.INSTALLED;
    skill.config = { ...config };
    skill.installedAt = new Date();
    logInfo(`📚 Skill installed: ${skill.definition.name}`);
    return skill;
  }

  /**
   * Enable a skill
   */
  enable(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    if (skill.state === SkillState.AVAILABLE) {
      this.install(skillId);
    }
    skill.state = SkillState.ENABLED;
    skill.enabledAt = new Date();
  }

  /**
   * Disable a skill
   */
  disable(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    skill.state = SkillState.DISABLED;
  }

  /**
   * Get a skill
   */
  get(skillId) {
    return this.skills.get(skillId) || null;
  }

  /**
   * Get all enabled skills
   */
  getEnabledSkills() {
    return [...this.skills.values()]
      .filter(s => s.state === SkillState.ENABLED)
      .map(s => s.definition);
  }

  /**
   * Resolve available skills for a specific Agent (filtered by Agent's skills list)
   * @param {string[]} agentSkillIds - Skill ID list configured for the Agent
   * @returns {SkillDefinition[]}
   */
  resolveAgentSkills(agentSkillIds = []) {
    if (!agentSkillIds || agentSkillIds.length === 0) {
      return this.getEnabledSkills();
    }
    return agentSkillIds
      .map(id => this.skills.get(id))
      .filter(s => s && s.state === SkillState.ENABLED)
      .map(s => s.definition);
  }

  /**
   * Build skills prompt block (injected into Agent system prompt)
   * @param {SkillDefinition[]} skills
   * @returns {string}
   */
  buildSkillsPrompt(skills) {
    if (!skills || skills.length === 0) return '';
    const lines = skills.map(s =>
      `- **${s.name}**: ${s.description}${s.instructions ? `\n  Instructions: ${s.instructions}` : ''}`
    );
    return `\n## Available Skills\nYou have the following trained skills:\n${lines.join('\n')}\n`;
  }

  /**
   * Get skills by category
   */
  getByCategory(category) {
    return [...this.skills.values()]
      .filter(s => s.definition.category === category);
  }

  /**
   * Search skills
   */
  search(query) {
    const q = query.toLowerCase();
    return [...this.skills.values()].filter(s => {
      const d = s.definition;
      return d.name.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.tags.some(t => t.toLowerCase().includes(q));
    });
  }

  /**
   * List all skills and their states
   */
  list() {
    return [...this.skills.values()].map(s => ({
      id: s.definition.id,
      name: s.definition.name,
      version: s.definition.version,
      category: s.definition.category,
      description: s.definition.description,
      icon: s.definition.icon,
      state: s.state,
      tags: s.definition.tags,
      author: s.definition.author,
      toolCount: s.definition.requiredTools.length,
      installedAt: s.installedAt,
      enabledAt: s.enabledAt,
    }));
  }

  /**
   * Configure a skill
   */
  configure(skillId, config) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    skill.config = { ...skill.config, ...config };
  }
}

// ====================================================================
// Built-in skill definitions (aligned with OpenClaw bundled skills)
// ====================================================================

const builtinSkills = [
  // === Programming/Development ===
  new SkillDefinition({
    id: 'web-development',
    name: 'Web Development',
    category: SkillCategory.CODING,
    description: 'Full-stack web development with modern frameworks (React, Vue, Next.js, Node.js)',
    instructions: 'Use file_write to create web application files. Follow modern best practices.',
    requiredTools: ['file_write', 'file_read', 'shell_exec'],
    tags: ['react', 'vue', 'nextjs', 'nodejs', 'html', 'css', 'javascript'],
    icon: '🌐',
  }),
  new SkillDefinition({
    id: 'api-development',
    name: 'API Development',
    category: SkillCategory.CODING,
    description: 'Design and build RESTful and GraphQL APIs with authentication and documentation',
    instructions: 'Design clean API interfaces. Use proper HTTP methods and status codes.',
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['rest', 'graphql', 'api', 'swagger', 'openapi'],
    icon: '🔌',
  }),
  new SkillDefinition({
    id: 'testing',
    name: 'Testing & QA',
    category: SkillCategory.CODING,
    description: 'Write unit tests, integration tests, and end-to-end tests',
    instructions: 'Write comprehensive tests with good coverage. Use common testing frameworks.',
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['jest', 'mocha', 'cypress', 'testing', 'qa'],
    icon: '🧪',
  }),
  new SkillDefinition({
    id: 'code-refactoring',
    name: 'Code Refactoring',
    category: SkillCategory.CODING,
    description: 'Improve code quality, reduce complexity, and optimize performance',
    instructions: 'Analyze code for improvement opportunities. Apply SOLID principles.',
    requiredTools: ['file_read', 'file_write'],
    tags: ['refactoring', 'optimization', 'clean-code', 'solid'],
    icon: '🔧',
  }),
  new SkillDefinition({
    id: 'database-design',
    name: 'Database Design',
    category: SkillCategory.CODING,
    description: 'Design database schemas, write migrations, optimize queries',
    instructions: 'Design normalized schemas. Write efficient queries. Consider indexing.',
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['sql', 'mongodb', 'postgresql', 'mysql', 'redis'],
    icon: '🗄️',
  }),
  // === Data Analysis ===
  new SkillDefinition({
    id: 'data-analysis',
    name: 'Data Analysis',
    category: SkillCategory.ANALYSIS,
    description: 'Analyze datasets, find patterns, generate insights and reports',
    instructions: 'Use data_parse tool when available. Present findings clearly with charts.',
    requiredTools: ['file_read'],
    requiredPlugins: ['builtin-data-processing'],
    tags: ['analytics', 'statistics', 'insights', 'reports'],
    icon: '📊',
  }),
  new SkillDefinition({
    id: 'web-research',
    name: 'Web Research',
    category: SkillCategory.RESEARCH,
    description: 'Search the web, gather information, and synthesize findings',
    instructions: 'Use web_search and web_fetch tools to gather information from multiple sources.',
    requiredTools: [],
    requiredPlugins: ['builtin-web-search', 'builtin-web-fetch'],
    tags: ['research', 'web', 'search', 'information-gathering'],
    icon: '🔍',
  }),
  // === Creative Content ===
  new SkillDefinition({
    id: 'content-writing',
    name: 'Content Writing',
    category: SkillCategory.CREATIVE,
    description: 'Write articles, blog posts, documentation, and marketing copy',
    instructions: 'Produce clear, engaging content. Adapt tone to audience.',
    requiredTools: ['file_write'],
    tags: ['writing', 'blog', 'documentation', 'copywriting'],
    icon: '✍️',
  }),
  new SkillDefinition({
    id: 'image-generation',
    name: 'Image Generation',
    category: SkillCategory.CREATIVE,
    description: 'Generate images using AI from text descriptions',
    instructions: 'Use image_generate tool to create images. Write descriptive prompts.',
    requiredPlugins: ['builtin-image'],
    tags: ['image', 'art', 'visual', 'generation'],
    icon: '🎨',
  }),
  // === Communication/Collaboration ===
  new SkillDefinition({
    id: 'project-management',
    name: 'Project Management',
    category: SkillCategory.COMMUNICATION,
    description: 'Plan, track, and coordinate project tasks and timelines',
    instructions: 'Break down projects into tasks. Track progress and coordinate team.',
    requiredTools: ['send_message'],
    tags: ['planning', 'tracking', 'coordination', 'agile'],
    icon: '📋',
  }),
  new SkillDefinition({
    id: 'team-collaboration',
    name: 'Team Collaboration',
    category: SkillCategory.COMMUNICATION,
    description: 'Communicate effectively with team members, review work, provide feedback',
    instructions: 'Use send_message to coordinate. Give constructive feedback.',
    requiredTools: ['send_message'],
    tags: ['teamwork', 'review', 'feedback', 'communication'],
    icon: '🤝',
  }),
  // === Automation ===
  new SkillDefinition({
    id: 'task-automation',
    name: 'Task Automation',
    category: SkillCategory.AUTOMATION,
    description: 'Create automated workflows, scripts, and scheduled tasks',
    instructions: 'Write automation scripts. Use cron for scheduling when available.',
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['automation', 'scripts', 'cron', 'workflow'],
    icon: '🤖',
  }),
  new SkillDefinition({
    id: 'web-scraping',
    name: 'Web Scraping',
    category: SkillCategory.AUTOMATION,
    description: 'Extract and process data from websites',
    instructions: 'Use browser tools and web_fetch to extract structured data.',
    requiredPlugins: ['builtin-browser', 'builtin-web-fetch'],
    tags: ['scraping', 'extraction', 'crawling'],
    icon: '🕷️',
  }),
  // === Design ===
  new SkillDefinition({
    id: 'ui-design',
    name: 'UI/UX Design',
    category: SkillCategory.DESIGN,
    description: 'Design user interfaces, wireframes, and interactive prototypes',
    instructions: 'Focus on usability and visual hierarchy. Follow design system conventions.',
    requiredTools: ['file_write'],
    tags: ['ui', 'ux', 'wireframe', 'prototype', 'design-system'],
    icon: '🎨',
  }),
  // === DevOps ===
  new SkillDefinition({
    id: 'devops',
    name: 'DevOps & Deployment',
    category: SkillCategory.DEVOPS,
    description: 'CI/CD pipelines, Docker, cloud deployment, infrastructure management',
    instructions: 'Write Dockerfiles, CI configs, and deployment scripts.',
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['docker', 'ci-cd', 'kubernetes', 'aws', 'deployment'],
    icon: '🚀',
  }),
  new SkillDefinition({
    id: 'monitoring',
    name: 'Monitoring & Logging',
    category: SkillCategory.DEVOPS,
    description: 'Set up monitoring, alerting, and log analysis',
    instructions: 'Configure monitoring tools and analyze logs for issues.',
    requiredTools: ['shell_exec', 'file_read'],
    tags: ['monitoring', 'logging', 'alerting', 'observability'],
    icon: '📡',
  }),
];

// Global singleton
export const skillRegistry = new SkillRegistry();

// Register all built-in skills and enable them by default
builtinSkills.forEach(skill => {
  skillRegistry.register(skill);
  skillRegistry.install(skill.id);
  skillRegistry.enable(skill.id);
});
