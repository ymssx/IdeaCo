/**
 * Knowledge Base System - Agent knowledge base management
 * 
 * Distilled from OpenClaw's Memory system (vendor/openclaw/docs/concepts/memory.md)
 * Re-implemented as an "enterprise knowledge base" management system
 *
 * Features:
 * - Knowledge base creation and management
 * - Document/entry CRUD operations
 * - Per-agent or global knowledge base assignment
 * - Keyword-based knowledge retrieval
 * - Knowledge base statistics and monitoring
 */
import { v4 as uuidv4 } from 'uuid';

/**
 * Knowledge base types
 */
export const KnowledgeType = {
  GLOBAL: 'global',       // Global knowledge base (accessible to all Agents)
  DEPARTMENT: 'department', // Department-level knowledge base
  AGENT: 'agent',         // Agent personal knowledge base
};

/**
 * Entry types
 */
export const EntryType = {
  FACT: 'fact',           // Factual information
  DECISION: 'decision',   // Decision records
  PROCEDURE: 'procedure', // Process/operation steps
  REFERENCE: 'reference', // Reference documents
  FAQ: 'faq',             // Frequently asked questions
  NOTE: 'note',           // Notes/memos
};

const logInfo = (...args) => {
  if (process.env.IDEACO_SILENT_INIT === '1') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  console.log(...args);
};

/**
 * Knowledge entry
 */
class KnowledgeEntry {
  constructor(config) {
    this.id = config.id || uuidv4();
    this.title = config.title;
    this.content = config.content;
    this.type = config.type || EntryType.NOTE;
    this.tags = config.tags || [];
    this.source = config.source || null;      // Source (file path, URL, etc.)
    this.importance = config.importance || 0.5; // Importance score 0-1
    this.createdAt = config.createdAt || new Date();
    this.updatedAt = config.updatedAt || new Date();
    this.createdBy = config.createdBy || null; // Agent ID
  }
}

/**
 * Knowledge base
 */
class KnowledgeBase {
  constructor(config) {
    this.id = config.id || uuidv4();
    this.name = config.name;
    this.description = config.description || '';
    this.type = config.type || KnowledgeType.GLOBAL;
    this.ownerId = config.ownerId || null;  // Agent ID or Department ID
    this.entries = new Map();
    this.createdAt = new Date();
    this.enabled = true;
  }

  addEntry(entry) {
    const e = entry instanceof KnowledgeEntry ? entry : new KnowledgeEntry(entry);
    this.entries.set(e.id, e);
    return e;
  }

  removeEntry(entryId) {
    return this.entries.delete(entryId);
  }

  updateEntry(entryId, updates) {
    const entry = this.entries.get(entryId);
    if (!entry) return null;
    Object.assign(entry, updates, { updatedAt: new Date() });
    return entry;
  }

  getEntry(entryId) {
    return this.entries.get(entryId) || null;
  }

  /**
   * Keyword search entries
   */
  search(query, limit = 10) {
    const q = query.toLowerCase();
    const results = [];
    for (const entry of this.entries.values()) {
      const titleMatch = entry.title.toLowerCase().includes(q);
      const contentMatch = entry.content.toLowerCase().includes(q);
      const tagMatch = entry.tags.some(t => t.toLowerCase().includes(q));

      if (titleMatch || contentMatch || tagMatch) {
        // Simple scoring: title match has highest weight
        let score = 0;
        if (titleMatch) score += 3;
        if (contentMatch) score += 1;
        if (tagMatch) score += 2;
        score += entry.importance;
        results.push({ entry, score });
      }
    }
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => ({
        ...r.entry,
        relevanceScore: r.score,
      }));
  }

  /**
   * Get statistics
   */
  getStats() {
    const entries = [...this.entries.values()];
    const typeCounts = {};
    entries.forEach(e => {
      typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    });
    return {
      totalEntries: entries.length,
      typeCounts,
      lastUpdated: entries.length > 0
        ? new Date(Math.max(...entries.map(e => new Date(e.updatedAt).getTime())))
        : null,
    };
  }

  listEntries(options = {}) {
    let entries = [...this.entries.values()];
    if (options.type) entries = entries.filter(e => e.type === options.type);
    if (options.tag) entries = entries.filter(e => e.tags.includes(options.tag));
    entries.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    if (options.limit) entries = entries.slice(0, options.limit);
    return entries;
  }
}

/**
 * Knowledge manager - manages all knowledge bases
 */
export class KnowledgeManager {
  constructor() {
    /** @type {Map<string, KnowledgeBase>} */
    this.bases = new Map();
  }

  /**
   * Create a knowledge base
   */
  create(config) {
    const kb = new KnowledgeBase(config);
    this.bases.set(kb.id, kb);
    logInfo(`📖 Knowledge base created: ${kb.name} (${kb.type})`);
    return kb;
  }

  /**
   * Get a knowledge base
   */
  get(kbId) {
    return this.bases.get(kbId) || null;
  }

  /**
   * Delete a knowledge base
   */
  delete(kbId) {
    return this.bases.delete(kbId);
  }

  /**
   * List all knowledge bases
   */
  list() {
    return [...this.bases.values()].map(kb => ({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      type: kb.type,
      ownerId: kb.ownerId,
      enabled: kb.enabled,
      entryCount: kb.entries.size,
      stats: kb.getStats(),
      createdAt: kb.createdAt,
    }));
  }

  /**
   * Get all knowledge bases accessible to a specific Agent
   * @param {string} agentId
   * @param {string} departmentId
   */
  getAccessibleBases(agentId, departmentId = null) {
    return [...this.bases.values()].filter(kb => {
      if (!kb.enabled) return false;
      if (kb.type === KnowledgeType.GLOBAL) return true;
      if (kb.type === KnowledgeType.DEPARTMENT && kb.ownerId === departmentId) return true;
      if (kb.type === KnowledgeType.AGENT && kb.ownerId === agentId) return true;
      return false;
    });
  }

  /**
   * Search across knowledge bases
   */
  search(query, options = {}) {
    const { agentId, departmentId, limit = 10 } = options;
    const bases = agentId
      ? this.getAccessibleBases(agentId, departmentId)
      : [...this.bases.values()].filter(kb => kb.enabled);

    const allResults = [];
    for (const kb of bases) {
      const results = kb.search(query, limit);
      results.forEach(r => allResults.push({ ...r, knowledgeBaseId: kb.id, knowledgeBaseName: kb.name }));
    }
    return allResults
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  /**
   * Add an entry to a knowledge base
   */
  addEntry(kbId, entryConfig) {
    const kb = this.bases.get(kbId);
    if (!kb) throw new Error(`Knowledge base not found: ${kbId}`);
    return kb.addEntry(entryConfig);
  }

  /**
   * Remove an entry from a knowledge base
   */
  removeEntry(kbId, entryId) {
    const kb = this.bases.get(kbId);
    if (!kb) throw new Error(`Knowledge base not found: ${kbId}`);
    return kb.removeEntry(entryId);
  }

  /**
   * Build knowledge base prompt (injected into Agent system prompt)
   * @param {string} agentId
   * @param {string} departmentId
   * @returns {string}
   */
  buildKnowledgePrompt(agentId, departmentId = null) {
    const bases = this.getAccessibleBases(agentId, departmentId);
    if (bases.length === 0) return '';

    const sections = bases.map(kb => {
      const recent = kb.listEntries({ limit: 5 });
      if (recent.length === 0) return null;
      const items = recent.map(e =>
        `  - [${e.type}] ${e.title}: ${e.content.slice(0, 200)}${e.content.length > 200 ? '...' : ''}`
      ).join('\n');
      return `### ${kb.name}\n${items}`;
    }).filter(Boolean);

    if (sections.length === 0) return '';
    return `\n## Knowledge Base\nYou have access to the following knowledge:\n${sections.join('\n\n')}\n`;
  }

  /**
   * Get overall statistics
   */
  getOverallStats() {
    const bases = [...this.bases.values()];
    let totalEntries = 0;
    bases.forEach(kb => { totalEntries += kb.entries.size; });
    return {
      totalBases: bases.length,
      enabledBases: bases.filter(kb => kb.enabled).length,
      totalEntries,
      byType: {
        global: bases.filter(kb => kb.type === KnowledgeType.GLOBAL).length,
        department: bases.filter(kb => kb.type === KnowledgeType.DEPARTMENT).length,
        agent: bases.filter(kb => kb.type === KnowledgeType.AGENT).length,
      },
    };
  }
}

// Global singleton
// Global singleton — use globalThis to survive Next.js HMR in dev mode
if (!globalThis.__knowledgeManager) {
  globalThis.__knowledgeManager = new KnowledgeManager();

  // Create default global knowledge base (only once, inside the guard)
  const globalKb = globalThis.__knowledgeManager.create({
    name: 'Company Knowledge Base',
    description: 'Shared knowledge base for all agents in the company',
    type: KnowledgeType.GLOBAL,
  });

  // Add some example entries
  globalKb.addEntry({
    title: 'Code Review Standards',
    content: 'All code must pass code review before merging. Reviews should check: correctness, readability, security, performance, and test coverage.',
    type: EntryType.PROCEDURE,
    tags: ['coding', 'review', 'standards'],
    importance: 0.8,
  });

  globalKb.addEntry({
    title: 'API Design Guidelines',
    content: 'RESTful APIs should use proper HTTP methods (GET/POST/PUT/DELETE), return appropriate status codes, and include consistent error response formats.',
    type: EntryType.REFERENCE,
    tags: ['api', 'design', 'standards'],
    importance: 0.7,
  });

  globalKb.addEntry({
    title: 'Project File Structure',
    content: 'Projects should follow a standard directory structure: src/ for source code, tests/ for tests, docs/ for documentation, config/ for configurations.',
    type: EntryType.PROCEDURE,
    tags: ['structure', 'organization', 'standards'],
    importance: 0.6,
  });
}
export const knowledgeManager = globalThis.__knowledgeManager;
