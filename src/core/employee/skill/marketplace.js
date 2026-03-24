/**
 * SkillMarketplace — Client for the real ClawHub skill registry.
 *
 * ClawHub (https://clawhub.ai) is the public skill registry for OpenClaw.
 * Real API v1 endpoints:
 *   GET  /api/v1/search?q=...&limit=...          → { results: [{ slug, displayName, summary, score, updatedAt }] }
 *   GET  /api/v1/skills/{slug}                    → { skill, latestVersion, owner, moderation }
 *   GET  /api/v1/download?slug=...&version=...    → ZIP binary
 *   GET  /api/v1/skills?limit=...&sort=...        → { items: [...], nextCursor }
 *
 * Installed skills are saved to data/skills/marketplace/{slug}/
 * and registered in the global SkillRegistry with source: 'marketplace'.
 */

import fs from 'fs';
import path from 'path';
import { SkillDefinition, SkillSource, SkillCategory, parseSkillMarkdown, skillRegistry } from './registry.js';

const MARKETPLACE_SKILLS_DIR = path.join(
  process.env.IDEACO_DATA_DIR || path.resolve(process.cwd(), 'data'),
  'skills',
  'marketplace'
);

// Real ClawHub registry base URL
const CLAWHUB_BASE = 'https://clawhub.ai';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * SkillMarketplace — thin client over the real ClawHub v1 API.
 */
export class SkillMarketplace {
  constructor(opts = {}) {
    this.storePath = opts.storePath || MARKETPLACE_SKILLS_DIR;
    this.registryUrl = opts.registryUrl || CLAWHUB_BASE;
    this.timeout = opts.timeout || 15000;
    ensureDir(this.storePath);
  }

  // ---- Browse & Search ----

  /**
   * Search the ClawHub marketplace using the real /api/v1/search endpoint.
   * @param {string} query - Search query
   * @param {object} [opts] - { page, limit, category }
   * @returns {object} { skills, total, page }
   */
  async search(query = '', opts = {}) {
    const { page = 1, limit = 20 } = opts;
    try {
      const params = new URLSearchParams({ q: query || 'openclaw', limit: String(limit) });

      const response = await fetch(`${this.registryUrl}/api/v1/search?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`ClawHub API returned ${response.status}`);
      }

      const data = await response.json();
      const results = (data.results || []).map(s => this._normalizeSearchResult(s));

      return {
        skills: results,
        total: results.length,
        page,
      };
    } catch (e) {
      console.warn(`ClawHub search failed: ${e.message}`);
      return { skills: [], total: 0, page };
    }
  }

  /**
   * Get popular/featured skills from the marketplace.
   * ClawHub has no dedicated "featured" endpoint, so we search with a broad
   * query and rely on the default relevance ranking.
   * @returns {object[]}
   */
  async featured() {
    try {
      const response = await fetch(
        `${this.registryUrl}/api/v1/search?q=openclaw+skill&limit=12`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeout),
        }
      );

      if (!response.ok) {
        throw new Error(`ClawHub API returned ${response.status}`);
      }

      const data = await response.json();
      return (data.results || []).map(s => this._normalizeSearchResult(s));
    } catch (e) {
      console.warn(`ClawHub featured fetch failed: ${e.message}`);
      return [];
    }
  }

  // ---- Skill Detail ----

  /**
   * Fetch full skill metadata from ClawHub.
   * GET /api/v1/skills/{slug}
   * @param {string} slug
   * @returns {object|null}
   */
  async getSkillDetail(slug) {
    try {
      const response = await fetch(
        `${this.registryUrl}/api/v1/skills/${encodeURIComponent(slug)}`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeout),
        }
      );
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  // ---- Install & Update ----

  /**
   * Install a skill from the marketplace.
   *
   * Flow:
   * 1. GET /api/v1/skills/{slug}  → metadata + latestVersion
   * 2. GET /api/v1/download?slug=...&version=...  → ZIP containing SKILL.md + files
   * 3. Extract ZIP to disk, parse SKILL.md, register in SkillRegistry
   *
   * @param {string} slug - Skill slug from ClawHub
   * @param {string} [version='latest']
   * @returns {object} Installed skill info
   */
  async install(slug, version = 'latest') {
    // Step 1: fetch metadata
    const detail = await this.getSkillDetail(slug);
    if (!detail) {
      throw new Error(`Skill "${slug}" not found on ClawHub`);
    }

    const skillMeta = detail.skill || {};
    const latestVersion = detail.latestVersion || {};
    const owner = detail.owner || {};
    const moderation = detail.moderation || {};

    // Block malware-flagged skills
    if (moderation.isMalwareBlocked) {
      throw new Error(`Skill "${slug}" is blocked as malicious and cannot be installed`);
    }

    const resolvedVersion = version === 'latest'
      ? (latestVersion.version || '1.0.0')
      : version;

    // Step 2: download ZIP
    let zipBuffer;
    try {
      const dlUrl = `${this.registryUrl}/api/v1/download?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(resolvedVersion)}`;
      const response = await fetch(dlUrl, {
        signal: AbortSignal.timeout(this.timeout * 2), // longer timeout for downloads
      });
      if (!response.ok) {
        throw new Error(`Download returned ${response.status}`);
      }
      zipBuffer = Buffer.from(await response.arrayBuffer());
    } catch (e) {
      throw new Error(`Failed to download skill "${slug}": ${e.message}`);
    }

    // Step 3: extract ZIP to disk
    const id = `marketplace-${slug}`;
    const skillDir = path.join(this.storePath, id);
    ensureDir(skillDir);

    // Use fflate for ZIP extraction (lightweight, no native deps)
    let extracted = false;
    try {
      const { unzipSync } = await import('fflate');
      const files = unzipSync(new Uint8Array(zipBuffer));
      for (const [name, content] of Object.entries(files)) {
        // Skip directories and hidden files
        if (name.endsWith('/') || name.startsWith('.') || name.startsWith('__')) continue;
        const targetPath = path.join(skillDir, name);
        ensureDir(path.dirname(targetPath));
        fs.writeFileSync(targetPath, Buffer.from(content));
      }
      extracted = true;
    } catch (e) {
      // Fallback: save raw zip and try to extract SKILL.md manually
      console.warn(`ZIP extraction failed for "${slug}", saving raw: ${e.message}`);
    }

    // If ZIP extraction failed, check if it's actually raw markdown
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!extracted || !fs.existsSync(skillFile)) {
      // Maybe the download returned raw content, not a ZIP
      const content = zipBuffer.toString('utf-8');
      if (content.includes('---') || content.includes('#')) {
        fs.writeFileSync(skillFile, content, 'utf-8');
      } else {
        throw new Error(`Skill "${slug}" has no extractable SKILL.md content`);
      }
    }

    // Step 4: parse SKILL.md and register
    const markdown = fs.readFileSync(skillFile, 'utf-8');
    const { frontmatter, body } = parseSkillMarkdown(markdown);

    // Normalize tags — ClawHub returns tags as { tagName: version } object
    const rawTags = skillMeta.tags || frontmatter.tags || {};
    let tags;
    if (typeof rawTags === 'object' && !Array.isArray(rawTags)) {
      tags = Object.keys(rawTags);
    } else if (typeof rawTags === 'string') {
      tags = rawTags.split(',').map(t => t.trim()).filter(Boolean);
    } else {
      tags = Array.isArray(rawTags) ? rawTags : [];
    }

    // Save metadata alongside
    const metaPath = path.join(skillDir, 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      slug,
      version: resolvedVersion,
      installedAt: new Date().toISOString(),
      sourceUrl: `${this.registryUrl}/skills/${slug}`,
      author: owner.displayName || owner.handle || 'Unknown',
      downloads: skillMeta.stats?.downloads || 0,
      stars: skillMeta.stats?.stars || 0,
      moderation: moderation.verdict || 'unknown',
    }, null, 2), 'utf-8');

    const definition = new SkillDefinition({
      id,
      name: frontmatter.name || skillMeta.displayName || slug,
      description: frontmatter.description || skillMeta.summary || '',
      category: frontmatter.category || SkillCategory.CODING,
      icon: frontmatter.icon || '📦',
      tags,
      author: owner.displayName || owner.handle || frontmatter.author || 'ClawHub',
      version: resolvedVersion,
      body,
      source: SkillSource.MARKETPLACE,
      sourceUrl: `${this.registryUrl}/skills/${slug}`,
      filePath: skillFile,
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

    skillRegistry.unregister(skillId);

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
        stars: meta.stars || 0,
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

        let meta = {};
        const metaPath = path.join(this.storePath, entry.name, 'metadata.json');
        try {
          if (fs.existsSync(metaPath)) {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          }
        } catch {}

        const rawTags = frontmatter.tags || '';
        let tags;
        if (typeof rawTags === 'object' && !Array.isArray(rawTags)) {
          tags = Object.keys(rawTags);
        } else if (typeof rawTags === 'string') {
          tags = rawTags.split(',').map(t => t.trim()).filter(Boolean);
        } else {
          tags = Array.isArray(rawTags) ? rawTags : [];
        }

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
      console.log(`Loaded ${loaded} marketplace skill(s) from disk`);
    }
  }

  // ---- Private helpers ----

  /**
   * Normalize a ClawHub /api/v1/search result entry into our UI format.
   * Real shape: { slug, displayName, summary, score, updatedAt }
   */
  _normalizeSearchResult(raw) {
    const slug = raw.slug || raw.id || '';
    return {
      slug,
      name: raw.displayName || raw.name || slug,
      description: raw.summary || raw.description || '',
      category: raw.category || 'coding',
      icon: raw.icon || '📦',
      author: raw.author || raw.owner?.handle || 'Unknown',
      version: raw.version || '',
      downloads: raw.stats?.downloads || raw.downloads || 0,
      stars: raw.stats?.stars || raw.stars || 0,
      tags: this._extractTags(raw.tags),
      url: `${this.registryUrl}/skills/${slug}`,
      installed: !!skillRegistry.get(`marketplace-${slug}`),
    };
  }

  /**
   * Extract tags from ClawHub format.
   * ClawHub tags can be: { tagName: version } object, comma-separated string, or array.
   */
  _extractTags(rawTags) {
    if (!rawTags) return [];
    if (typeof rawTags === 'object' && !Array.isArray(rawTags)) {
      return Object.keys(rawTags);
    }
    if (typeof rawTags === 'string') {
      return rawTags.split(',').map(t => t.trim()).filter(Boolean);
    }
    return Array.isArray(rawTags) ? rawTags : [];
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
