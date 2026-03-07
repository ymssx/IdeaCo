import { v4 as uuidv4 } from 'uuid';

/**
 * Memory System - Each Employee has independent long-term and short-term memory
 * 
 * Short-term memory: temporary info related to current task, may be forgotten or consolidated after task ends
 *   - Has expiration time (default 24 hours), expired entries are auto-cleaned
 *   - Unnecessary short-term memories are cleaned during consolidation
 * Long-term memory: lessons learned, skill growth, self-reflection and other persistent info, stays with Employee permanently
 * 
 * Rolling Context System:
 *   - historySummary: per-group rolling summary of old messages (compressed by AI)
 *   - AI manages its own memory via memoryOps in chat responses
 */
export class Memory {
  constructor() {
    this.shortTerm = [];   // Short-term memory list
    this.longTerm = [];    // Long-term memory list
    this.maxShortTerm = 20; // Max short-term capacity, oldest auto-evicted when exceeded
    this.maxLongTerm = 50;  // Max long-term capacity for active use (pruned by importance)
    this.defaultShortTermTTL = 24 * 60 * 60 * 1000; // Default short-term memory TTL: 24 hours

    // Per-group rolling history summary (compressed old messages)
    // key: groupId, value: string (compressed summary text)
    this.historySummary = new Map();
    this.maxSummaryLength = 2000; // Max chars for a single group's summary
  }

  // ======================== Short-term Memory ========================

  /**
   * Add short-term memory
   * @param {string} content - Memory content
   * @param {string} [category] - Category tag
   * @param {object} [options] - Additional options
   * @param {number} [options.ttl] - Custom TTL in milliseconds
   * @param {number} [options.importance] - Importance score 1-10 (default 5)
   */
  addShortTerm(content, category = 'task', options = {}) {
    const ttl = options.ttl || this.defaultShortTermTTL;
    const memory = {
      id: uuidv4(),
      content,
      category,
      type: 'short-term',
      importance: options.importance || 5,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttl),
    };
    this.shortTerm.push(memory);

    // Evict oldest when capacity exceeded
    if (this.shortTerm.length > this.maxShortTerm) {
      const evicted = this.shortTerm.shift();
      // Auto-archive evicted short-term memory as long-term summary
      this.addLongTerm(
        `[Auto-archived] ${evicted.content}`,
        'archived',
        { importance: Math.max(1, (evicted.importance || 5) - 2) }
      );
    }

    return memory;
  }

  // ======================== Long-term Memory ========================

  /**
   * Add long-term memory
   * @param {string} content - Memory content
   * @param {string} [category] - Category: experience | reflection | skill | feedback | archived | preference | fact | instruction
   * @param {object} [options]
   * @param {number} [options.importance] - Importance score 1-10 (default 5)
   */
  addLongTerm(content, category = 'experience', options = {}) {
    const memory = {
      id: uuidv4(),
      content,
      category,
      type: 'long-term',
      importance: options.importance || 5,
      createdAt: new Date(),
    };
    this.longTerm.push(memory);

    // Auto-prune if exceeds hard limit
    if (this.longTerm.length > 200) {
      this._pruneByImportance();
    }

    return memory;
  }

  // ======================== Memory Operations (AI-driven) ========================

  /**
   * Process memory operations returned by AI in chat response.
   * This is the core of the AI-driven memory management system.
   * 
   * @param {Array} memoryOps - Array of memory operations from AI
   *   Each op: { op: 'add'|'update'|'delete', type: 'long_term'|'short_term', 
   *              content, importance, ttl, id, category }
   * @returns {{ added: number, updated: number, deleted: number }}
   */
  processMemoryOps(memoryOps) {
    if (!Array.isArray(memoryOps) || memoryOps.length === 0) {
      return { added: 0, updated: 0, deleted: 0 };
    }

    let added = 0, updated = 0, deleted = 0;

    for (const op of memoryOps) {
      try {
        switch (op.op) {
          case 'add': {
            if (!op.content) continue;
            // Dedupe: skip if very similar content already exists
            if (this._isDuplicate(op.content)) continue;

            if (op.type === 'long_term') {
              this.addLongTerm(op.content, op.category || 'experience', {
                importance: op.importance || 5,
              });
            } else {
              this.addShortTerm(op.content, op.category || 'context', {
                importance: op.importance || 5,
                ttl: op.ttl ? op.ttl * 1000 : undefined, // AI sends ttl in seconds
              });
            }
            added++;
            break;
          }
          case 'update': {
            if (!op.id || !op.content) continue;
            const mem = this._findById(op.id);
            if (mem) {
              mem.content = op.content;
              if (op.importance !== undefined) mem.importance = op.importance;
              updated++;
            }
            break;
          }
          case 'delete': {
            if (!op.id) continue;
            const stIdx = this.shortTerm.findIndex(m => m.id === op.id);
            if (stIdx !== -1) {
              this.shortTerm.splice(stIdx, 1);
              deleted++;
              continue;
            }
            const ltIdx = this.longTerm.findIndex(m => m.id === op.id);
            if (ltIdx !== -1) {
              this.longTerm.splice(ltIdx, 1);
              deleted++;
            }
            break;
          }
        }
      } catch (e) {
        console.warn(`  ⚠️ [Memory] Failed to process memoryOp:`, op, e.message);
      }
    }

    if (added + updated + deleted > 0) {
      console.log(`  🧠 [Memory] Processed ${added} adds, ${updated} updates, ${deleted} deletes`);
    }

    return { added, updated, deleted };
  }

  // ======================== Rolling History Summary ========================

  /**
   * Update the rolling history summary for a group.
   * Called when AI returns a summary of old messages.
   * 
   * @param {string} groupId
   * @param {string} newSummary - AI-generated summary of old messages
   */
  updateHistorySummary(groupId, newSummary) {
    if (!newSummary || !newSummary.trim()) return;

    const existing = this.historySummary.get(groupId) || '';
    let combined;

    if (existing) {
      combined = `${existing}\n---\n${newSummary.trim()}`;
    } else {
      combined = newSummary.trim();
    }

    // Truncate if too long — keep the most recent part
    if (combined.length > this.maxSummaryLength) {
      // Find a good split point (after a "---" separator)
      const parts = combined.split('\n---\n');
      while (parts.join('\n---\n').length > this.maxSummaryLength && parts.length > 1) {
        parts.shift(); // Drop oldest summary chunk
      }
      combined = parts.join('\n---\n');
      // If still too long, hard truncate
      if (combined.length > this.maxSummaryLength) {
        combined = combined.slice(-this.maxSummaryLength);
      }
    }

    this.historySummary.set(groupId, combined);
  }

  /**
   * Get the rolling history summary for a group.
   * @param {string} groupId
   * @returns {string}
   */
  getHistorySummary(groupId) {
    return this.historySummary.get(groupId) || '';
  }

  // ======================== Context Builder ========================

  /**
   * Build a compact memory context string for inclusion in prompts.
   * This replaces the old agentMemory approach with structured memory.
   * 
   * @param {string} groupId - Current group context
   * @returns {string} Formatted memory context for prompt injection
   */
  buildMemoryContext(groupId) {
    const parts = [];

    // 1. Rolling history summary
    const summary = this.getHistorySummary(groupId);
    if (summary) {
      parts.push(`**📜 Conversation History Summary:**\n${summary}`);
    }

    // 2. Long-term memories (sorted by importance, top items)
    const activeLongTerm = this.longTerm
      .sort((a, b) => (b.importance || 5) - (a.importance || 5))
      .slice(0, 15);
    if (activeLongTerm.length > 0) {
      parts.push(`**💾 Your Long-term Memories:**\n${activeLongTerm.map(m => 
        `- [${m.category}] ${m.content} (id:${m.id})`
      ).join('\n')}`);
    }

    // 3. Short-term memories (filtered for active, not expired)
    this.cleanExpiredShortTerm();
    const activeShortTerm = this.shortTerm
      .sort((a, b) => (b.importance || 5) - (a.importance || 5))
      .slice(0, 10);
    if (activeShortTerm.length > 0) {
      parts.push(`**⚡ Your Short-term Memories:**\n${activeShortTerm.map(m => 
        `- [${m.category}] ${m.content} (id:${m.id})`
      ).join('\n')}`);
    }

    return parts.length > 0 ? '\n\n' + parts.join('\n\n') : '';
  }

  // ======================== Existing Methods (preserved) ========================

  /**
   * Consolidate short-term memory into long-term
   * @param {string} shortTermId - Short-term memory ID
   * @param {string} [refinedContent] - Refined content (uses original if not provided)
   */
  consolidate(shortTermId, refinedContent = null) {
    const idx = this.shortTerm.findIndex(m => m.id === shortTermId);
    if (idx === -1) return null;

    const original = this.shortTerm.splice(idx, 1)[0];
    const longMemory = this.addLongTerm(
      refinedContent || original.content,
      'experience'
    );

    return longMemory;
  }

  /**
   * Clean up expired short-term memories
   * @returns {number} Number of cleaned memories
   */
  cleanExpiredShortTerm() {
    const now = Date.now();
    const before = this.shortTerm.length;
    this.shortTerm = this.shortTerm.filter(m => {
      if (!m.expiresAt) return true;
      return new Date(m.expiresAt).getTime() > now;
    });
    const cleaned = before - this.shortTerm.length;
    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} expired short-term memories`);
    }
    return cleaned;
  }

  /**
   * Consolidate memories: clean expired short-term, deduplicate, and limit total long-term count
   * Should be called before waking up an Employee
   * @returns {object} { expiredCleaned, duplicatesRemoved }
   */
  consolidateMemories() {
    // 1. Clean expired short-term memories
    const expiredCleaned = this.cleanExpiredShortTerm();

    // 2. Deduplicate long-term memories
    const seen = new Map();
    const deduped = [];
    let duplicatesRemoved = 0;

    for (const mem of this.longTerm) {
      const key = mem.content.toLowerCase().trim().slice(0, 100);
      if (seen.has(key)) {
        duplicatesRemoved++;
        continue;
      }
      seen.set(key, true);
      deduped.push(mem);
    }
    this.longTerm = deduped;

    // 3. If long-term memory exceeds limit, prune by importance
    if (this.longTerm.length > 200) {
      this._pruneByImportance();
    }

    if (expiredCleaned > 0 || duplicatesRemoved > 0) {
      console.log(`🧠 Memory consolidation complete: cleaned ${expiredCleaned} expired short-term, deduplicated ${duplicatesRemoved} long-term`);
    }

    return { expiredCleaned, duplicatesRemoved };
  }

  /**
   * Clear short-term memory (e.g. when switching department/project)
   */
  clearShortTerm() {
    this.shortTerm = [];
  }

  /**
   * Search long-term memory by category
   */
  searchLongTerm(category = null) {
    if (!category) return [...this.longTerm];
    return this.longTerm.filter(m => m.category === category);
  }

  /**
   * Search all memory by keyword
   */
  search(keyword) {
    const kw = keyword.toLowerCase();
    const results = [];
    [...this.shortTerm, ...this.longTerm].forEach(m => {
      if (m.content.toLowerCase().includes(kw)) {
        results.push(m);
      }
    });
    return results;
  }

  /**
   * Get memory summary
   */
  getSummary() {
    return {
      shortTermCount: this.shortTerm.length,
      longTermCount: this.longTerm.length,
      historySummaryGroups: this.historySummary.size,
      shortTerm: this.shortTerm.map(m => ({
        id: m.id,
        content: m.content,
        category: m.category,
        importance: m.importance || 5,
        expiresAt: m.expiresAt,
      })),
      longTerm: this.longTerm.map(m => ({
        id: m.id,
        content: m.content,
        category: m.category,
        importance: m.importance || 5,
      })),
    };
  }

  // ======================== Serialization ========================

  /**
   * Serialize (for persistence / talent market storage)
   */
  serialize() {
    // Serialize historySummary Map → plain object
    const summaryObj = {};
    for (const [k, v] of this.historySummary) {
      summaryObj[k] = v;
    }

    return {
      shortTerm: this.shortTerm.map(m => ({
        ...m,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
        expiresAt: m.expiresAt ? (m.expiresAt instanceof Date ? m.expiresAt.toISOString() : m.expiresAt) : null,
      })),
      longTerm: this.longTerm.map(m => ({
        ...m,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
      })),
      historySummary: summaryObj,
    };
  }

  /**
   * Restore from serialized data
   */
  static deserialize(data) {
    const memory = new Memory();
    if (data.shortTerm) {
      memory.shortTerm = data.shortTerm.map(m => ({
        ...m,
        createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
        expiresAt: m.expiresAt ? new Date(m.expiresAt) : new Date(Date.now() + memory.defaultShortTermTTL),
      }));
    }
    if (data.longTerm) {
      memory.longTerm = data.longTerm.map(m => ({
        ...m,
        createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
      }));
    }
    // Restore historySummary
    if (data.historySummary && typeof data.historySummary === 'object') {
      for (const [k, v] of Object.entries(data.historySummary)) {
        memory.historySummary.set(k, v);
      }
    }
    return memory;
  }

  // ======================== Private Helpers ========================

  /**
   * Find a memory by ID across both short-term and long-term.
   */
  _findById(id) {
    return this.shortTerm.find(m => m.id === id) || this.longTerm.find(m => m.id === id) || null;
  }

  /**
   * Check if content is a duplicate of existing memory.
   * Uses first 80 chars as fingerprint.
   */
  _isDuplicate(content) {
    const key = content.toLowerCase().trim().slice(0, 80);
    return [...this.shortTerm, ...this.longTerm].some(m => 
      m.content.toLowerCase().trim().slice(0, 80) === key
    );
  }

  /**
   * Prune long-term memory by importance when over capacity.
   * Keeps the highest-importance and most-recent entries.
   */
  _pruneByImportance() {
    const MAX = 200;
    if (this.longTerm.length <= MAX) return;

    // Sort by importance (desc), then by creation time (desc)
    this.longTerm.sort((a, b) => {
      const impDiff = (b.importance || 5) - (a.importance || 5);
      if (impDiff !== 0) return impDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const trimmed = this.longTerm.length - MAX;
    this.longTerm = this.longTerm.slice(0, MAX);
    console.log(`🧹 Long-term memory pruned by importance: removed ${trimmed} lowest-importance entries`);
  }

  /**
   * Print memory contents (debug)
   */
  print(agentName = '') {
    const prefix = agentName ? `[${agentName}]` : '';
    console.log(`\n🧠 ${prefix} Memory System:`);
    console.log(`   Short-term (${this.shortTerm.length} items):`);
    this.shortTerm.forEach(m => {
      const expires = m.expiresAt ? ` [expires: ${new Date(m.expiresAt).toLocaleString()}]` : '';
      const imp = m.importance ? ` [imp:${m.importance}]` : '';
      console.log(`     📝 [${m.category}] ${m.content}${expires}${imp}`);
    });
    console.log(`   Long-term (${this.longTerm.length} items):`);
    this.longTerm.forEach(m => {
      const imp = m.importance ? ` [imp:${m.importance}]` : '';
      console.log(`     💾 [${m.category}] ${m.content}${imp}`);
    });
    console.log(`   History Summaries: ${this.historySummary.size} groups`);
  }
}
