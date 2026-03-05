import { v4 as uuidv4 } from 'uuid';

/**
 * Memory System - Each Agent has independent long-term and short-term memory
 * 
 * Short-term memory: temporary info related to current task, may be forgotten or consolidated after task ends
 *   - Has expiration time (default 24 hours), expired entries are auto-cleaned
 *   - Unnecessary short-term memories are cleaned during consolidation
 * Long-term memory: lessons learned, skill growth, self-reflection and other persistent info, stays with Agent permanently
 */
export class Memory {
  constructor() {
    this.shortTerm = [];   // Short-term memory list
    this.longTerm = [];    // Long-term memory list
    this.maxShortTerm = 20; // Max short-term capacity, oldest auto-evicted when exceeded
    this.defaultShortTermTTL = 24 * 60 * 60 * 1000; // Default short-term memory TTL: 24 hours
  }

  /**
   * Add short-term memory
   * @param {string} content - Memory content
   * @param {string} [category] - Category tag
   * @param {object} [options] - Additional options
   * @param {number} [options.ttl] - Custom TTL in milliseconds, defaults to the default value if not provided
   */
  addShortTerm(content, category = 'task', options = {}) {
    const ttl = options.ttl || this.defaultShortTermTTL;
    const memory = {
      id: uuidv4(),
      content,
      category,
      type: 'short-term',
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
        'archived'
      );
    }

    return memory;
  }

  /**
   * Add long-term memory
   * @param {string} content - Memory content
   * @param {string} [category] - Category: experience | reflection | skill | feedback | archived | preference | fact | instruction
   */
  addLongTerm(content, category = 'experience') {
    const memory = {
      id: uuidv4(),
      content,
      category,
      type: 'long-term',
      createdAt: new Date(),
    };
    this.longTerm.push(memory);
    return memory;
  }

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
      if (!m.expiresAt) return true; // Keep entries with no expiration time
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
   * Should be called before waking up an Agent
   * @returns {object} { expiredCleaned, duplicatesRemoved }
   */
  consolidateMemories() {
    // 1. Clean expired short-term memories
    const expiredCleaned = this.cleanExpiredShortTerm();

    // 2. Deduplicate long-term memories (simple deduplication based on content similarity)
    const seen = new Map();
    const deduped = [];
    let duplicatesRemoved = 0;

    for (const mem of this.longTerm) {
      // Simple content fingerprint: use first 100 chars as key
      const key = mem.content.toLowerCase().trim().slice(0, 100);
      if (seen.has(key)) {
        duplicatesRemoved++;
        continue;
      }
      seen.set(key, true);
      deduped.push(mem);
    }
    this.longTerm = deduped;

    // 3. If long-term memory exceeds limit (200 entries), keep the most recent
    const MAX_LONG_TERM = 200;
    if (this.longTerm.length > MAX_LONG_TERM) {
      const trimmed = this.longTerm.length - MAX_LONG_TERM;
      this.longTerm = this.longTerm.slice(-MAX_LONG_TERM);
      console.log(`🧹 Long-term memory exceeded limit, trimmed ${trimmed} oldest memories`);
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
      shortTerm: this.shortTerm.map(m => ({
        id: m.id,
        content: m.content,
        category: m.category,
        expiresAt: m.expiresAt,
      })),
      longTerm: this.longTerm.map(m => ({
        id: m.id,
        content: m.content,
        category: m.category,
      })),
    };
  }

  /**
   * Serialize (for persistence / talent market storage)
   */
  serialize() {
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
    return memory;
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
      console.log(`     📝 [${m.category}] ${m.content}${expires}`);
    });
    console.log(`   Long-term (${this.longTerm.length} items):`);
    this.longTerm.forEach(m => {
      console.log(`     💾 [${m.category}] ${m.content}`);
    });
  }
}
