/**
 * Skills System - 技能管理框架
 * 
 * 蒸馏自 OpenClaw 的 Skills 系统 (vendor/openclaw/src/config/types.skills.ts)
 * 重新实现为「员工培训认证」体系
 *
 * 功能：
 * - 技能注册与发现
 * - 技能安装/启用/禁用
 * - 按 Agent 分配技能
 * - 技能分类与搜索
 * - 技能配置与环境变量
 */

/**
 * 技能状态
 */
export const SkillState = {
  AVAILABLE: 'available',   // 可用（未安装）
  INSTALLED: 'installed',   // 已安装
  ENABLED: 'enabled',       // 已启用
  DISABLED: 'disabled',     // 已禁用
};

/**
 * 技能分类
 */
export const SkillCategory = {
  CODING: 'coding',           // 编程开发
  ANALYSIS: 'analysis',       // 数据分析
  CREATIVE: 'creative',       // 创意内容
  COMMUNICATION: 'communication', // 沟通协作
  AUTOMATION: 'automation',   // 自动化
  RESEARCH: 'research',       // 研究调查
  DESIGN: 'design',           // 设计
  DEVOPS: 'devops',           // 运维部署
};

/**
 * 技能定义
 */
export class SkillDefinition {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.version = config.version || '1.0.0';
    this.category = config.category || SkillCategory.CODING;
    this.description = config.description || '';
    this.instructions = config.instructions || '';  // Agent 使用技能的指引 (类似 SKILL.md)
    this.requiredTools = config.requiredTools || []; // 依赖哪些工具
    this.requiredPlugins = config.requiredPlugins || []; // 依赖哪些插件
    this.configSchema = config.configSchema || {};
    this.env = config.env || {};  // 环境变量
    this.tags = config.tags || [];
    this.author = config.author || 'Built-in';
    this.icon = config.icon || '⚡';
  }
}

/**
 * 技能注册表 - 管理所有可用技能
 */
export class SkillRegistry {
  constructor() {
    /** @type {Map<string, {definition: SkillDefinition, state: string, config: object, installedAt: Date|null}>} */
    this.skills = new Map();
  }

  /**
   * 注册技能
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
   * 安装技能
   */
  install(skillId, config = {}) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    skill.state = SkillState.INSTALLED;
    skill.config = { ...config };
    skill.installedAt = new Date();
    console.log(`📚 Skill installed: ${skill.definition.name}`);
    return skill;
  }

  /**
   * 启用技能
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
   * 禁用技能
   */
  disable(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    skill.state = SkillState.DISABLED;
  }

  /**
   * 获取技能
   */
  get(skillId) {
    return this.skills.get(skillId) || null;
  }

  /**
   * 获取所有启用的技能
   */
  getEnabledSkills() {
    return [...this.skills.values()]
      .filter(s => s.state === SkillState.ENABLED)
      .map(s => s.definition);
  }

  /**
   * 为指定 Agent 解析可用技能（根据 Agent 的 skills 列表过滤）
   * @param {string[]} agentSkillIds - Agent 配置的技能ID列表
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
   * 构建技能 prompt 块（注入到 Agent 系统提示词）
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
   * 按分类获取技能
   */
  getByCategory(category) {
    return [...this.skills.values()]
      .filter(s => s.definition.category === category);
  }

  /**
   * 搜索技能
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
   * 列出所有技能及其状态
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
   * 配置技能
   */
  configure(skillId, config) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    skill.config = { ...skill.config, ...config };
  }
}

// ====================================================================
// 内置技能定义（对齐 OpenClaw 的 bundled skills）
// ====================================================================

const builtinSkills = [
  // === 编程开发 ===
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
  // === 数据分析 ===
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
  // === 创意内容 ===
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
  // === 沟通协作 ===
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
  // === 自动化 ===
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
  // === 设计 ===
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
  // === 运维 ===
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

// 全局单例
export const skillRegistry = new SkillRegistry();

// 注册所有内置技能并默认启用
builtinSkills.forEach(skill => {
  skillRegistry.register(skill);
  skillRegistry.install(skill.id);
  skillRegistry.enable(skill.id);
});
