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
import { builtinSkillConfigs } from './definitions/index.js';
import { SkillState, SkillCategory, SkillSource } from './constants.js';

// Re-export enums so existing consumers don't break
export { SkillState, SkillCategory, SkillSource };

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

    // Permission system
    // grantedPermissions: permissions granted to an employee when this skill is enabled
    // e.g. ['management.query_department', 'management.create_department']
    this.grantedPermissions = config.grantedPermissions || [];

    // restrictedTo: limit which roles can install this skill
    // e.g. ['secretary'] — only employees with role matching one of these can install
    // Empty array means no restriction (anyone can install)
    this.restrictedTo = config.restrictedTo || [];

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

  /**
   * Install a skill.
   * @param {string} skillId
   * @param {object} [config]
   * @param {object} [context] - Installation context for restriction checks
   * @param {string} [context.employeeRole] - The installing employee's role (for restrictedTo check)
   * @param {string} [context.employeeId] - The installing employee's ID
   */
  install(skillId, config = {}, context = {}) {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);

    // Check installation restrictions
    const restrictions = skill.definition.restrictedTo;
    if (restrictions && restrictions.length > 0 && context.employeeRole) {
      const roleLower = context.employeeRole.toLowerCase();
      const allowed = restrictions.some(r => roleLower.includes(r.toLowerCase()));
      if (!allowed) {
        throw new Error(`Skill "${skillId}" is restricted to roles: [${restrictions.join(', ')}]. Current role "${context.employeeRole}" is not authorized.`);
      }
    }

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
   * Build skills prompt with progressive disclosure.
   *
   * - **Pinned skills** (always-on for this employee): L2 body is inlined directly
   *   so the LLM sees the full workflow/tools without needing to call load_skill.
   * - **Other skills**: L1 metadata only (name + description + id in XML).
   *   The agent loads full instructions on-demand via load_skill tool.
   *
   * @param {SkillDefinition[]} skills - Resolved skill definitions for this employee
   * @param {Object} [options]
   * @param {Set<string>} [options.pinnedSkillIds] - IDs of pinned skills (get L2 inline)
   * @returns {string}
   */
  buildSkillsPrompt(skills, { pinnedSkillIds } = {}) {
    if (!skills || skills.length === 0) return '';

    const pinned = pinnedSkillIds || new Set();
    const pinnedSkills = skills.filter(s => pinned.has(s.id));
    const onDemandSkills = skills.filter(s => !pinned.has(s.id));

    let prompt = '';

    // Pinned skills: inject full L2 body directly into system prompt
    if (pinnedSkills.length > 0) {
      for (const s of pinnedSkills) {
        const body = s.getBody();
        prompt += `\n## Skill: ${s.name}\n${body}\n`;
      }
    }

    // On-demand skills: L1 metadata only, loaded via load_skill tool
    if (onDemandSkills.length > 0) {
      const skillEntries = onDemandSkills.map(s =>
        `  <skill>\n    <name>${escapeXml(s.name)}</name>\n    <description>${escapeXml(s.description)}</description>\n    <id>${escapeXml(s.id)}</id>\n  </skill>`
      ).join('\n');

      prompt += `\n## Skills (on-demand)\nBefore acting: scan <available_skills> <description> entries.\n- If exactly one skill clearly applies: load its full instructions via load_skill tool with the skill id, then follow them.\n- If multiple could apply: choose the most specific one, then load and follow it.\n- If none clearly apply: proceed without loading any skill.\nConstraints: never load more than one skill up front; only load after selecting.\n\n<available_skills>\n${skillEntries}\n</available_skills>\n`;
    }

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

// ======================== Global singleton ========================

export const skillRegistry = new SkillRegistry();

// Register and enable all built-in skills from definitions/
builtinSkillConfigs.forEach(config => {
  const skill = new SkillDefinition(config);
  skillRegistry.register(skill);
  skillRegistry.install(skill.id);
  skillRegistry.enable(skill.id);
});
