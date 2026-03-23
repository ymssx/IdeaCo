/**
 * Skills System — Modern skill management framework
 *
 * Inspired by OpenClaw's Skills system with enterprise-grade enhancements:
 * - Progressive Disclosure: L1 (metadata only in prompt) → L2 (full SKILL.md body on demand) → L3 (references)
 * - Multiple sources: built-in, custom (user Markdown), marketplace (ClawHub)
 * - Per-employee skill assignment via EmployeeSkillSet
 * - XML-based prompt injection matching OpenClaw format
 * - SKILL.md parsing with YAML frontmatter
 */

import fs from 'fs';
import path from 'path';

// ======================== Enums ========================

/**
 * Skill states
 */
export const SkillState = {
  AVAILABLE: 'available',
  INSTALLED: 'installed',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
};

/**
 * Skill categories
 */
export const SkillCategory = {
  CODING: 'coding',
  ANALYSIS: 'analysis',
  CREATIVE: 'creative',
  COMMUNICATION: 'communication',
  AUTOMATION: 'automation',
  RESEARCH: 'research',
  DESIGN: 'design',
  DEVOPS: 'devops',
};

/**
 * Skill sources — where the skill came from
 */
export const SkillSource = {
  BUILTIN: 'builtin',
  CUSTOM: 'custom',
  MARKETPLACE: 'marketplace',
};

// ======================== Helpers ========================

const logInfo = (...args) => {
  if (process.env.IDEACO_SILENT_INIT === '1') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  console.log(...args);
};

/**
 * Escape XML special characters for safe prompt injection.
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Parse a SKILL.md file content into { frontmatter, body }.
 * Frontmatter is YAML between --- delimiters at the top.
 */
export function parseSkillMarkdown(content) {
  if (!content || typeof content !== 'string') {
    return { frontmatter: {}, body: '' };
  }

  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed };
  }

  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const yamlBlock = trimmed.substring(3, endIdx).trim();
  const body = trimmed.substring(endIdx + 3).trim();

  // Simple YAML key: value parser (no nested objects needed)
  const frontmatter = {};
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    let value = line.substring(colonIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) frontmatter[key] = value;
  }

  return { frontmatter, body };
}

// ======================== SkillDefinition ========================

/**
 * Skill definition — enhanced with progressive disclosure support
 */
export class SkillDefinition {
  constructor(config) {
    // Identity
    this.id = config.id;
    this.name = config.name;
    this.version = config.version || '1.0.0';

    // Classification
    this.category = config.category || SkillCategory.CODING;
    this.tags = config.tags || [];
    this.author = config.author || 'Built-in';
    this.icon = config.icon || '⚡';

    // L1: Metadata (always in context, ~100 tokens per skill)
    this.description = config.description || '';

    // L2: Full body (loaded on-demand via load_skill tool)
    this.body = config.body || '';

    // L3: References & assets (loaded as-needed)
    this.references = config.references || [];

    // Legacy: instructions field (mapped to body for backward compat)
    if (config.instructions && !config.body) {
      this.body = config.instructions;
    }

    // Source tracking
    this.source = config.source || SkillSource.BUILTIN;
    this.sourceUrl = config.sourceUrl || null;  // For marketplace skills

    // Dependencies
    this.requiredTools = config.requiredTools || [];
    this.requiredPlugins = config.requiredPlugins || [];

    // Configuration
    this.configSchema = config.configSchema || {};
    this.env = config.env || {};

    // File path (for custom/marketplace skills stored on disk)
    this.filePath = config.filePath || null;
  }

  /**
   * Get L1 metadata (compact, for prompt injection)
   */
  getMetadata() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      icon: this.icon,
      category: this.category,
      source: this.source,
    };
  }

  /**
   * Get L2 body content (full SKILL.md instructions)
   */
  getBody() {
    // If body is a file path, load from disk
    if (this.filePath && !this.body) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = parseSkillMarkdown(raw);
        this.body = parsed.body;
        return this.body;
      } catch {
        return `Error: Could not load skill body from ${this.filePath}`;
      }
    }
    return this.body || this.description;
  }
}

// ======================== SkillRegistry ========================

/**
 * Skill registry — manages all available skills from all sources
 */
export class SkillRegistry {
  constructor() {
    /** @type {Map<string, {definition: SkillDefinition, state: string, config: object, installedAt: Date|null, enabledAt: Date|null}>} */
    this.skills = new Map();
  }

  // ---- Registration ----

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
   * Register or update a skill (for custom/marketplace where re-registration is expected)
   */
  upsert(definition) {
    const existing = this.skills.get(definition.id);
    if (existing) {
      existing.definition = definition;
      return existing;
    }
    this.register(definition);
    return this.skills.get(definition.id);
  }

  /**
   * Unregister a skill (remove from registry entirely)
   */
  unregister(skillId) {
    return this.skills.delete(skillId);
  }

  // ---- State management ----

  install(skillId, config = {}) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    skill.state = SkillState.INSTALLED;
    skill.config = { ...config };
    skill.installedAt = new Date();
    return skill;
  }

  enable(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    if (skill.state === SkillState.AVAILABLE) {
      this.install(skillId);
    }
    skill.state = SkillState.ENABLED;
    skill.enabledAt = new Date();
  }

  disable(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    skill.state = SkillState.DISABLED;
  }

  // ---- Query ----

  get(skillId) {
    return this.skills.get(skillId) || null;
  }

  getEnabledSkills() {
    return [...this.skills.values()]
      .filter(s => s.state === SkillState.ENABLED)
      .map(s => s.definition);
  }

  getByCategory(category) {
    return [...this.skills.values()]
      .filter(s => s.definition.category === category);
  }

  getBySource(source) {
    return [...this.skills.values()]
      .filter(s => s.definition.source === source);
  }

  search(query) {
    const q = query.toLowerCase();
    return [...this.skills.values()].filter(s => {
      const d = s.definition;
      return d.name.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.tags.some(t => t.toLowerCase().includes(q));
    });
  }

  // ---- Skill resolution for agents ----

  /**
   * Resolve skills for a specific agent.
   * If agentSkillIds is empty, returns all enabled skills.
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

  // ---- Progressive Disclosure Prompt Building ----

  /**
   * Build L1 skills prompt — compact XML metadata injected into system prompt.
   * Follows OpenClaw's format: only name + description + id.
   * The agent reads the full SKILL.md via load_skill tool when needed.
   *
   * @param {SkillDefinition[]} skills
   * @returns {string}
   */
  buildSkillsPrompt(skills) {
    if (!skills || skills.length === 0) return '';

    const skillEntries = skills.map(s =>
      `  <skill>\n    <name>${escapeXml(s.name)}</name>\n    <description>${escapeXml(s.description)}</description>\n    <id>${escapeXml(s.id)}</id>\n  </skill>`
    ).join('\n');

    const prompt = `\n## Skills (mandatory)\nBefore acting: scan <available_skills> <description> entries.\n- If exactly one skill clearly applies: load its full instructions via load_skill tool with the skill id, then follow them.\n- If multiple could apply: choose the most specific one, then load and follow it.\n- If none clearly apply: proceed without loading any skill.\nConstraints: never load more than one skill up front; only load after selecting.\n\n<available_skills>\n${skillEntries}\n</available_skills>\n`;

    return prompt;
  }

  /**
   * Load a skill's L2 body content (called by the load_skill agent tool).
   * @param {string} skillId
   * @returns {string} Full SKILL.md body content
   */
  loadSkillBody(skillId) {
    const entry = this.skills.get(skillId);
    if (!entry) return `Error: Skill "${skillId}" not found.`;
    if (entry.state !== SkillState.ENABLED) return `Error: Skill "${skillId}" is not enabled.`;
    return entry.definition.getBody();
  }

  // ---- Listing ----

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
      source: s.definition.source,
      sourceUrl: s.definition.sourceUrl,
      hasBody: !!(s.definition.body || s.definition.filePath),
      toolCount: s.definition.requiredTools.length,
      installedAt: s.installedAt,
      enabledAt: s.enabledAt,
    }));
  }

  configure(skillId, config) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    skill.config = { ...skill.config, ...config };
  }
}

// ====================================================================
// Built-in skill definitions
// ====================================================================

const builtinSkills = [
  // === Coding ===
  new SkillDefinition({
    id: 'web-development',
    name: 'Web Development',
    category: SkillCategory.CODING,
    description: 'Full-stack web development with modern frameworks (React, Vue, Next.js, Node.js)',
    body: `# Web Development Skill

## Workflow
1. Analyze the requirements and identify the tech stack
2. Set up project structure with proper folder hierarchy
3. Implement backend APIs with proper error handling and validation
4. Build frontend components with responsive design
5. Write tests for critical paths
6. Verify all files exist using file_list before reporting completion

## Best Practices
- Follow modern React/Vue patterns (hooks, composition API)
- Use TypeScript when possible for type safety
- Implement proper error boundaries and loading states
- Ensure responsive design across breakpoints
- Write semantic HTML with accessibility in mind`,
    requiredTools: ['file_write', 'file_read', 'shell_exec'],
    tags: ['react', 'vue', 'nextjs', 'nodejs', 'html', 'css', 'javascript'],
    icon: '🌐',
  }),

  new SkillDefinition({
    id: 'api-development',
    name: 'API Development',
    category: SkillCategory.CODING,
    description: 'Design and build RESTful and GraphQL APIs with authentication and documentation',
    body: `# API Development Skill

## Workflow
1. Design API endpoints following REST conventions
2. Define request/response schemas
3. Implement proper HTTP methods and status codes
4. Add authentication and authorization middleware
5. Write OpenAPI/Swagger documentation
6. Implement rate limiting and input validation

## Best Practices
- Use proper HTTP status codes (200, 201, 400, 401, 403, 404, 500)
- Implement pagination for list endpoints
- Version your API (v1, v2)
- Add request validation and sanitization
- Return consistent error response format`,
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['rest', 'graphql', 'api', 'swagger', 'openapi'],
    icon: '🔌',
  }),

  new SkillDefinition({
    id: 'testing',
    name: 'Testing & QA',
    category: SkillCategory.CODING,
    description: 'Write unit tests, integration tests, and end-to-end tests',
    body: `# Testing & QA Skill

## Workflow
1. Analyze code under test — identify critical paths and edge cases
2. Choose appropriate testing framework (Jest, Mocha, Cypress, Playwright)
3. Write unit tests for individual functions/components
4. Write integration tests for API endpoints and data flows
5. Add edge case coverage (null inputs, boundary values, error states)
6. Run tests and verify coverage

## Best Practices
- Aim for >80% code coverage on critical paths
- Use descriptive test names that explain the expected behavior
- Follow AAA pattern: Arrange, Act, Assert
- Mock external dependencies properly
- Test both success and failure scenarios`,
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['jest', 'mocha', 'cypress', 'testing', 'qa'],
    icon: '🧪',
  }),

  new SkillDefinition({
    id: 'code-refactoring',
    name: 'Code Refactoring',
    category: SkillCategory.CODING,
    description: 'Improve code quality, reduce complexity, and optimize performance',
    body: `# Code Refactoring Skill

## Workflow
1. Read and understand the existing codebase
2. Identify code smells (long methods, duplicated code, god classes)
3. Plan refactoring steps — small, incremental changes
4. Apply SOLID principles and design patterns
5. Verify behavior is preserved after each change
6. Run existing tests to ensure no regressions

## Best Practices
- Refactor in small steps, verifying after each
- Extract methods/classes when functions exceed ~50 lines
- Replace magic numbers with named constants
- Reduce nesting depth (early returns, guard clauses)
- Improve naming for clarity`,
    requiredTools: ['file_read', 'file_write'],
    tags: ['refactoring', 'optimization', 'clean-code', 'solid'],
    icon: '🔧',
  }),

  new SkillDefinition({
    id: 'database-design',
    name: 'Database Design',
    category: SkillCategory.CODING,
    description: 'Design database schemas, write migrations, optimize queries',
    body: `# Database Design Skill

## Workflow
1. Analyze data requirements and relationships
2. Design normalized schema (3NF minimum)
3. Define indexes for common query patterns
4. Write migration scripts
5. Implement data access layer with proper connection pooling
6. Test query performance

## Best Practices
- Normalize to 3NF, denormalize only with clear performance justification
- Always add indexes on foreign keys and frequently queried columns
- Use transactions for multi-table operations
- Implement soft deletes for audit trails
- Write idempotent migrations`,
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['sql', 'mongodb', 'postgresql', 'mysql', 'redis'],
    icon: '🗄️',
  }),

  // === Analysis ===
  new SkillDefinition({
    id: 'data-analysis',
    name: 'Data Analysis',
    category: SkillCategory.ANALYSIS,
    description: 'Analyze datasets, find patterns, generate insights and reports',
    body: `# Data Analysis Skill

## Workflow
1. Load and inspect the dataset — understand columns, types, distributions
2. Clean data: handle missing values, remove duplicates, fix types
3. Perform exploratory analysis: statistics, correlations, outliers
4. Generate visualizations to support findings
5. Synthesize insights into a clear, actionable report

## Best Practices
- Always start with data profiling before analysis
- Handle missing data explicitly (drop, impute, flag)
- Use appropriate statistical tests for your data type
- Present findings with clear visualizations
- Distinguish correlation from causation`,
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
    body: `# Web Research Skill

## Workflow
1. Understand the research question — define scope and key terms
2. Search multiple sources for diverse perspectives
3. Cross-reference findings for accuracy
4. Synthesize information into structured findings
5. Cite sources and note confidence levels

## Best Practices
- Use multiple search queries with different phrasings
- Prioritize authoritative and recent sources
- Note when information conflicts across sources
- Distinguish facts from opinions
- Provide source URLs for all key claims`,
    requiredTools: [],
    requiredPlugins: ['builtin-web-search', 'builtin-web-fetch'],
    tags: ['research', 'web', 'search', 'information-gathering'],
    icon: '🔍',
  }),

  // === Creative ===
  new SkillDefinition({
    id: 'content-writing',
    name: 'Content Writing',
    category: SkillCategory.CREATIVE,
    description: 'Write articles, blog posts, documentation, and marketing copy',
    body: `# Content Writing Skill

## Workflow
1. Understand the audience and purpose
2. Research the topic thoroughly
3. Create an outline with clear structure
4. Write compelling content with proper formatting
5. Edit for clarity, grammar, and tone consistency

## Best Practices
- Lead with value — hook the reader in the first paragraph
- Use clear headings and subheadings for scanability
- Write in active voice
- Keep paragraphs short (3-5 sentences)
- End with a clear call-to-action or conclusion`,
    requiredTools: ['file_write'],
    tags: ['writing', 'blog', 'documentation', 'copywriting'],
    icon: '✍️',
  }),

  new SkillDefinition({
    id: 'image-generation',
    name: 'Image Generation',
    category: SkillCategory.CREATIVE,
    description: 'Generate images using AI from text descriptions',
    body: `# Image Generation Skill

## Workflow
1. Understand the visual concept needed
2. Write a detailed, descriptive prompt
3. Specify style, mood, composition, and technical parameters
4. Generate and iterate on results
5. Deliver final images with appropriate naming

## Best Practices
- Be specific about composition, lighting, and style
- Include negative prompts to avoid unwanted elements
- Specify aspect ratio and resolution
- Iterate with variations for best results`,
    requiredPlugins: ['builtin-image'],
    tags: ['image', 'art', 'visual', 'generation'],
    icon: '🎨',
  }),

  // === Communication ===
  new SkillDefinition({
    id: 'project-management',
    name: 'Project Management',
    category: SkillCategory.COMMUNICATION,
    description: 'Plan, track, and coordinate project tasks and timelines',
    body: `# Project Management Skill

## Workflow
1. Break down project into workstreams and tasks
2. Define dependencies and critical path
3. Assign tasks based on team skills and capacity
4. Track progress with evidence-based status updates
5. Identify and mitigate risks proactively
6. Coordinate cross-functional communication

## Best Practices
- Define clear acceptance criteria for each task
- Maximize parallel execution — do not serialize independent tasks
- Demand evidence of completion, not just verbal status
- Escalate blockers early with proposed solutions
- Run retrospectives after milestones`,
    requiredTools: ['send_message'],
    tags: ['planning', 'tracking', 'coordination', 'agile'],
    icon: '📋',
  }),

  new SkillDefinition({
    id: 'team-collaboration',
    name: 'Team Collaboration',
    category: SkillCategory.COMMUNICATION,
    description: 'Communicate effectively with team members, review work, provide feedback',
    body: `# Team Collaboration Skill

## Workflow
1. Use @Name format when addressing specific colleagues
2. Share relevant discoveries proactively
3. When reviewing work, read the actual files first
4. Give constructive, specific feedback
5. Coordinate to avoid duplicate effort

## Best Practices
- Communicate frequently — don't work in isolation
- Be specific in feedback: reference exact lines/files
- Acknowledge good work alongside suggestions for improvement
- Share context that might help colleagues' tasks
- Respond promptly to questions and requests`,
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
    body: `# Task Automation Skill

## Workflow
1. Identify repetitive manual processes
2. Design automation workflow with clear triggers and actions
3. Write scripts with proper error handling and logging
4. Test with edge cases and failure scenarios
5. Document how to run and maintain the automation

## Best Practices
- Make scripts idempotent (safe to re-run)
- Add comprehensive error handling and logging
- Use cron expressions for scheduling
- Include a dry-run mode for safe testing
- Document all dependencies and environment requirements`,
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['automation', 'scripts', 'cron', 'workflow'],
    icon: '🤖',
  }),

  new SkillDefinition({
    id: 'web-scraping',
    name: 'Web Scraping',
    category: SkillCategory.AUTOMATION,
    description: 'Extract and process data from websites',
    body: `# Web Scraping Skill

## Workflow
1. Analyze target website structure
2. Choose appropriate extraction method (API, HTML parsing, browser automation)
3. Implement data extraction with proper selectors
4. Handle pagination, rate limiting, and error recovery
5. Structure and validate extracted data
6. Export in requested format (JSON, CSV, etc.)

## Best Practices
- Check for an official API before scraping HTML
- Respect robots.txt and rate limits
- Handle dynamic content with browser automation when needed
- Validate extracted data against expected schema
- Implement retry logic for transient failures`,
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
    body: `# UI/UX Design Skill

## Workflow
1. Understand user needs and use cases
2. Create information architecture and user flows
3. Design wireframes with clear layout hierarchy
4. Apply visual design: typography, color, spacing
5. Ensure accessibility (WCAG 2.1 AA)
6. Create responsive layouts for all breakpoints

## Best Practices
- Follow established design system conventions
- Maintain visual hierarchy with consistent spacing scale
- Use 8px grid for alignment
- Ensure sufficient color contrast (4.5:1 minimum)
- Design for touch targets (44px minimum)`,
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
    body: `# DevOps & Deployment Skill

## Workflow
1. Define infrastructure requirements
2. Write Dockerfiles with minimal, secure base images
3. Create CI/CD pipeline configuration
4. Set up deployment scripts with rollback capability
5. Configure monitoring and alerting
6. Document deployment procedures

## Best Practices
- Use multi-stage Docker builds to minimize image size
- Pin dependency versions in Dockerfiles
- Implement health checks and readiness probes
- Use environment variables for configuration
- Automate everything — manual deployment is a bug`,
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['docker', 'ci-cd', 'kubernetes', 'aws', 'deployment'],
    icon: '🚀',
  }),

  new SkillDefinition({
    id: 'monitoring',
    name: 'Monitoring & Logging',
    category: SkillCategory.DEVOPS,
    description: 'Set up monitoring, alerting, and log analysis',
    body: `# Monitoring & Logging Skill

## Workflow
1. Define key metrics and SLOs
2. Instrument code with structured logging
3. Set up metric collection and dashboards
4. Configure alerting thresholds and escalation
5. Implement log aggregation and search

## Best Practices
- Use structured logging (JSON) with consistent fields
- Define SLOs before choosing what to monitor
- Alert on symptoms (latency, errors), not causes
- Include correlation IDs across services
- Set up on-call rotation and runbooks`,
    requiredTools: ['shell_exec', 'file_read'],
    tags: ['monitoring', 'logging', 'alerting', 'observability'],
    icon: '📡',
  }),
];

// ======================== Global singleton ========================

export const skillRegistry = new SkillRegistry();

// Register and enable all built-in skills
builtinSkills.forEach(skill => {
  skillRegistry.register(skill);
  skillRegistry.install(skill.id);
  skillRegistry.enable(skill.id);
});
