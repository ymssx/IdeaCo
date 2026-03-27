/**
 * CustomSkillManager — CRUD for user-created Markdown skills.
 *
 * Users create skills via a Markdown editor in the UI. The skill is stored
 * as a SKILL.md file on disk under data/skills/custom/{id}/SKILL.md.
 * The YAML frontmatter provides metadata; the body is the actual instructions.
 *
 * Format:
 * ```markdown
 * ---
 * name: My Custom Skill
 * description: Short summary of what this skill does
 * category: coding
 * icon: 🔥
 * tags: tag1, tag2
 * ---
 *
 * # Skill Instructions
 * (full body here — loaded on demand by the agent)
 * ```
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SkillDefinition, parseSkillMarkdown, skillRegistry } from './registry.js';
import { SkillSource, SkillCategory } from './constants.js';

const CUSTOM_SKILLS_DIR = path.join(
  process.env.IDEACO_DATA_DIR || path.resolve(process.cwd(), 'data'),
  'skills',
  'custom'
);

// Ensure directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * CustomSkillManager
 */
export class CustomSkillManager {
  constructor(storePath = CUSTOM_SKILLS_DIR) {
    this.storePath = storePath;
    ensureDir(this.storePath);
  }

  /**
   * Create a new custom skill from Markdown content.
   * @param {string} markdown - Full SKILL.md content with YAML frontmatter
   * @returns {object} Created skill info
   */
  create(markdown) {
    const { frontmatter, body } = parseSkillMarkdown(markdown);

    if (!frontmatter.name) {
      throw new Error('Skill must have a "name" in the YAML frontmatter');
    }

    const id = frontmatter.id || `custom-${slugify(frontmatter.name)}-${uuidv4().slice(0, 8)}`;

    // Check for duplicates
    if (skillRegistry.get(id)) {
      throw new Error(`Skill with id "${id}" already exists`);
    }

    // Save to disk
    const skillDir = path.join(this.storePath, id);
    ensureDir(skillDir);
    const filePath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(filePath, markdown, 'utf-8');

    // Parse tags
    const tags = (frontmatter.tags || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    // Register in global registry
    const definition = new SkillDefinition({
      id,
      name: frontmatter.name,
      description: frontmatter.description || '',
      category: frontmatter.category || SkillCategory.CODING,
      icon: frontmatter.icon || '✨',
      tags,
      author: frontmatter.author || 'User',
      version: frontmatter.version || '1.0.0',
      body,
      source: SkillSource.CUSTOM,
      filePath,
    });

    skillRegistry.upsert(definition);
    skillRegistry.install(id);
    skillRegistry.enable(id);

    return {
      id,
      name: definition.name,
      description: definition.description,
      filePath,
    };
  }

  /**
   * Update an existing custom skill.
   * @param {string} skillId
   * @param {string} markdown - New SKILL.md content
   * @returns {object} Updated skill info
   */
  update(skillId, markdown) {
    const entry = skillRegistry.get(skillId);
    if (!entry) throw new Error(`Skill not found: ${skillId}`);
    if (entry.definition.source !== SkillSource.CUSTOM) {
      throw new Error(`Cannot edit non-custom skill: ${skillId}`);
    }

    const { frontmatter, body } = parseSkillMarkdown(markdown);

    // Save to disk
    const skillDir = path.join(this.storePath, skillId);
    ensureDir(skillDir);
    const filePath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(filePath, markdown, 'utf-8');

    // Parse tags
    const tags = (frontmatter.tags || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    // Update definition
    const definition = new SkillDefinition({
      id: skillId,
      name: frontmatter.name || entry.definition.name,
      description: frontmatter.description || entry.definition.description,
      category: frontmatter.category || entry.definition.category,
      icon: frontmatter.icon || entry.definition.icon,
      tags: tags.length > 0 ? tags : entry.definition.tags,
      author: frontmatter.author || entry.definition.author,
      version: frontmatter.version || entry.definition.version,
      body,
      source: SkillSource.CUSTOM,
      filePath,
    });

    skillRegistry.upsert(definition);

    return {
      id: skillId,
      name: definition.name,
      description: definition.description,
      filePath,
    };
  }

  /**
   * Delete a custom skill.
   * @param {string} skillId
   */
  delete(skillId) {
    const entry = skillRegistry.get(skillId);
    if (!entry) throw new Error(`Skill not found: ${skillId}`);
    if (entry.definition.source !== SkillSource.CUSTOM) {
      throw new Error(`Cannot delete non-custom skill: ${skillId}`);
    }

    // Remove from registry
    skillRegistry.unregister(skillId);

    // Remove from disk
    const skillDir = path.join(this.storePath, skillId);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
    }
  }

  /**
   * Get a custom skill's raw Markdown content.
   * @param {string} skillId
   * @returns {string} Raw SKILL.md content
   */
  getRaw(skillId) {
    const entry = skillRegistry.get(skillId);
    if (!entry) throw new Error(`Skill not found: ${skillId}`);
    if (entry.definition.source !== SkillSource.CUSTOM) {
      throw new Error(`Not a custom skill: ${skillId}`);
    }

    const filePath = entry.definition.filePath;
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Skill file not found on disk: ${filePath}`);
    }

    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * List all custom skills.
   * @returns {object[]}
   */
  list() {
    return skillRegistry.getBySource(SkillSource.CUSTOM).map(s => ({
      id: s.definition.id,
      name: s.definition.name,
      description: s.definition.description,
      category: s.definition.category,
      icon: s.definition.icon,
      state: s.state,
      tags: s.definition.tags,
      author: s.definition.author,
      hasBody: true,
    }));
  }

  /**
   * Load all custom skills from disk on startup.
   * Scans data/skills/custom/ for SKILL.md files and registers them.
   */
  loadFromDisk() {
    if (!fs.existsSync(this.storePath)) return;

    let loaded = 0;
    const entries = fs.readdirSync(this.storePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = path.join(this.storePath, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      try {
        const markdown = fs.readFileSync(skillFile, 'utf-8');
        const { frontmatter, body } = parseSkillMarkdown(markdown);

        const tags = (frontmatter.tags || '')
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);

        const definition = new SkillDefinition({
          id: entry.name,
          name: frontmatter.name || entry.name,
          description: frontmatter.description || '',
          category: frontmatter.category || SkillCategory.CODING,
          icon: frontmatter.icon || '✨',
          tags,
          author: frontmatter.author || 'User',
          version: frontmatter.version || '1.0.0',
          body,
          source: SkillSource.CUSTOM,
          filePath: skillFile,
        });

        skillRegistry.upsert(definition);
        skillRegistry.install(entry.name);
        skillRegistry.enable(entry.name);
        loaded++;
      } catch (e) {
        console.error(`Failed to load custom skill "${entry.name}":`, e.message);
      }
    }

    if (loaded > 0) {
      console.log(`📚 Loaded ${loaded} custom skill(s) from disk`);
    }
  }
}

// ======================== Helpers ========================

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 40);
}

// ======================== Singleton ========================

// Global singleton — use globalThis to survive Next.js HMR in dev mode
if (!globalThis.__customSkillManager) {
  globalThis.__customSkillManager = new CustomSkillManager();
}
export const customSkillManager = globalThis.__customSkillManager;

// Auto-load custom skills from disk on module import
try {
  customSkillManager.loadFromDisk();
} catch (e) {
  console.error('Failed to auto-load custom skills:', e.message);
}
