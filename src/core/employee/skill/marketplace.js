/**
 * SkillMarketplace — Client for the open-source ClawHub skill marketplace.
 *
 * Allows browsing, searching, and installing skills from the public registry.
 * Installed skills are saved to data/skills/marketplace/{slug}/SKILL.md
 * and registered in the global SkillRegistry with source: 'marketplace'.
 *
 * ClawHub API: https://clawhub.com (public registry for OpenClaw skills)
 */

import fs from 'fs';
import path from 'path';
import { SkillDefinition, SkillSource, SkillCategory, parseSkillMarkdown, skillRegistry } from './registry.js';

const MARKETPLACE_SKILLS_DIR = path.join(
  process.env.IDEACO_DATA_DIR || path.resolve(process.cwd(), 'data'),
  'skills',
  'marketplace'
);

const CLAWHUB_API = 'https://clawhub.com/api';

// Ensure directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * SkillMarketplace
 */
export class SkillMarketplace {
  constructor(opts = {}) {
    this.storePath = opts.storePath || MARKETPLACE_SKILLS_DIR;
    this.registryUrl = opts.registryUrl || CLAWHUB_API;
    this.timeout = opts.timeout || 15000;
    ensureDir(this.storePath);
  }

  // ---- Browse & Search ----

  /**
   * Search the ClawHub marketplace.
   * @param {string} query - Search query
   * @param {object} [opts] - { page, limit, category }
   * @returns {object} { skills, total, page }
   */
  async search(query = '', opts = {}) {
    const { page = 1, limit = 20, category } = opts;
    try {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        limit: String(limit),
      });
      if (category) params.set('category', category);

      const response = await fetch(`${this.registryUrl}/skills/search?${params}`, {
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`ClawHub API returned ${response.status}`);
      }

      const data = await response.json();
      return {
        skills: (data.skills || data.results || []).map(s => this._normalizeMarketplaceEntry(s)),
        total: data.total || 0,
        page: data.page || page,
      };
    } catch (e) {
      // If API is unreachable, return empty results instead of crashing
      console.warn(`ClawHub search failed: ${e.message}`);
      return { skills: [], total: 0, page };
    }
  }

  /**
   * Get featured/popular skills from the marketplace.
   * @returns {object[]}
   */
  async featured() {
    try {
      const response = await fetch(`${this.registryUrl}/skills/featured`, {
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`ClawHub API returned ${response.status}`);
      }

      const data = await response.json();
      return (data.skills || data.results || []).map(s => this._normalizeMarketplaceEntry(s));
    } catch (e) {
      console.warn(`ClawHub featured fetch failed: ${e.message}`);
      return [];
    }
  }

  // ---- Install & Update ----

  /**
   * Install a skill from the marketplace.
   * @param {string} slug - Skill slug/ID from ClawHub
   * @param {string} [version='latest']
   * @returns {object} Installed skill info
   */
  async install(slug, version = 'latest') {
    // Fetch skill content from ClawHub
    let skillData;
    try {
      const response = await fetch(`${this.registryUrl}/skills/${slug}?version=${version}`, {
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`ClawHub API returned ${response.status} for skill "${slug}"`);
      }

      skillData = await response.json();
    } catch (e) {
      throw new Error(`Failed to fetch skill "${slug}" from marketplace: ${e.message}`);
    }

    // Extract SKILL.md content
    const markdown = skillData.content || skillData.skillMd || '';
    if (!markdown) {
      throw new Error(`Skill "${slug}" has no SKILL.md content`);
    }

    const id = `marketplace-${slug}`;

    // Save to disk
    const skillDir = path.join(this.storePath, id);
    ensureDir(skillDir);
    const filePath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(filePath, markdown, 'utf-8');

    // Save metadata alongside
    const metaPath = path.join(skillDir, 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      slug,
      version: skillData.version || version,
      installedAt: new Date().toISOString(),
      sourceUrl: `https://clawhub.com/skills/${slug}`,
      author: skillData.author || 'Unknown',
      downloads: skillData.downloads || 0,
    }, null, 2), 'utf-8');

    // Parse and register
    const { frontmatter, body } = parseSkillMarkdown(markdown);
    const tags = (frontmatter.tags || skillData.tags || '')
      .toString()
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    const definition = new SkillDefinition({
      id,
      name: frontmatter.name || skillData.name || slug,
      description: frontmatter.description || skillData.description || '',
      category: frontmatter.category || skillData.category || SkillCategory.CODING,
      icon: frontmatter.icon || skillData.icon || '📦',
      tags,
      author: frontmatter.author || skillData.author || 'ClawHub',
      version: skillData.version || frontmatter.version || '1.0.0',
      body,
      source: SkillSource.MARKETPLACE,
      sourceUrl: `https://clawhub.com/skills/${slug}`,
      filePath,
    });

    skillRegistry.upsert(definition);
    skillRegistry.install(id);
    skillRegistry.enable(id);

    return {
      id,
      name: definition.name,
      description: definition.description,
      version: definition.version,
      sourceUrl: definition.sourceUrl,
    };
  }

  /**
   * Uninstall a marketplace skill.
   * @param {string} skillId
   */
  uninstall(skillId) {
    const entry = skillRegistry.get(skillId);
    if (!entry) throw new Error(`Skill not found: ${skillId}`);
    if (entry.definition.source !== SkillSource.MARKETPLACE) {
      throw new Error(`Not a marketplace skill: ${skillId}`);
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
   * Update a marketplace skill to the latest version.
   * @param {string} skillId
   * @returns {object} Updated skill info
   */
  async update(skillId) {
    const entry = skillRegistry.get(skillId);
    if (!entry) throw new Error(`Skill not found: ${skillId}`);
    if (entry.definition.source !== SkillSource.MARKETPLACE) {
      throw new Error(`Not a marketplace skill: ${skillId}`);
    }

    // Extract original slug from id (strip 'marketplace-' prefix)
    const slug = skillId.replace(/^marketplace-/, '');
    return this.install(slug, 'latest');
  }

  // ---- List installed ----

  /**
   * List all installed marketplace skills.
   * @returns {object[]}
   */
  listInstalled() {
    return skillRegistry.getBySource(SkillSource.MARKETPLACE).map(s => {
      // Try to read metadata
      let meta = {};
      const metaPath = path.join(this.storePath, s.definition.id, 'metadata.json');
      try {
        if (fs.existsSync(metaPath)) {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        }
      } catch {}

      return {
        id: s.definition.id,
        name: s.definition.name,
        description: s.definition.description,
        category: s.definition.category,
        icon: s.definition.icon,
        state: s.state,
        tags: s.definition.tags,
        author: s.definition.author,
        version: s.definition.version,
        sourceUrl: s.definition.sourceUrl,
        downloads: meta.downloads || 0,
        installedAt: meta.installedAt || null,
      };
    });
  }

  // ---- Load from disk on startup ----

  /**
   * Load all marketplace skills from disk.
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

        // Read metadata if available
        let meta = {};
        const metaPath = path.join(this.storePath, entry.name, 'metadata.json');
        try {
          if (fs.existsSync(metaPath)) {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          }
        } catch {}

        const tags = (frontmatter.tags || '')
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);

        const definition = new SkillDefinition({
          id: entry.name,
          name: frontmatter.name || meta.slug || entry.name,
          description: frontmatter.description || '',
          category: frontmatter.category || SkillCategory.CODING,
          icon: frontmatter.icon || '📦',
          tags,
          author: frontmatter.author || meta.author || 'ClawHub',
          version: meta.version || frontmatter.version || '1.0.0',
          body,
          source: SkillSource.MARKETPLACE,
          sourceUrl: meta.sourceUrl || null,
          filePath: skillFile,
        });

        skillRegistry.upsert(definition);
        skillRegistry.install(entry.name);
        skillRegistry.enable(entry.name);
        loaded++;
      } catch (e) {
        console.error(`Failed to load marketplace skill "${entry.name}":`, e.message);
      }
    }

    if (loaded > 0) {
      console.log(`📦 Loaded ${loaded} marketplace skill(s) from disk`);
    }
  }

  // ---- Private helpers ----

  /**
   * Normalize a marketplace API response entry into a consistent format.
   */
  _normalizeMarketplaceEntry(raw) {
    return {
      slug: raw.slug || raw.id || raw.name,
      name: raw.name || raw.slug,
      description: raw.description || '',
      category: raw.category || 'coding',
      icon: raw.icon || raw.emoji || '📦',
      author: raw.author || raw.owner || 'Unknown',
      version: raw.version || '1.0.0',
      downloads: raw.downloads || raw.installs || 0,
      stars: raw.stars || raw.likes || 0,
      tags: Array.isArray(raw.tags) ? raw.tags : (raw.tags || '').split(',').map(t => t.trim()).filter(Boolean),
      url: raw.url || `https://clawhub.com/skills/${raw.slug || raw.id}`,
      installed: !!skillRegistry.get(`marketplace-${raw.slug || raw.id}`),
    };
  }
}

// ======================== Singleton ========================

export const skillMarketplace = new SkillMarketplace();

// Auto-load marketplace skills from disk on module import
try {
  skillMarketplace.loadFromDisk();
} catch (e) {
  console.error('Failed to auto-load marketplace skills:', e.message);
}
