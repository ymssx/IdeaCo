import { v4 as uuidv4 } from 'uuid';

/**
 * Memory System - Each Agent has independent long-term and short-term memory
 * 
 * Short-term memory: temporary info related to current task, may be forgotten or consolidated after task ends
 *   - 有失效时间（默认 24 小时），过期自动清理
 *   - 整理记忆时清理不需要的短期记忆
 * Long-term memory: lessons learned, skill growth, self-reflection and other persistent info, stays with Agent permanently
 */
export class Memory {
  constructor() {
    this.shortTerm = [];   // Short-term memory list
    this.longTerm = [];    // Long-term memory list
    this.maxShortTerm = 20; // Max short-term capacity, oldest auto-evicted when exceeded
    this.defaultShortTermTTL = 24 * 60 * 60 * 1000; // 默认短期记忆存活时间：24 小时
  }

  /**
   * Add short-term memory
   * @param {string} content - Memory content
   * @param {string} [category] - Category tag
   * @param {object} [options] - 额外选项
   * @param {number} [options.ttl] - 自定义存活时间（毫秒），不传则使用默认值
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
   * 清理过期的短期记忆
   * @returns {number} 清理掉的记忆数量
   */
  cleanExpiredShortTerm() {
    const now = Date.now();
    const before = this.shortTerm.length;
    this.shortTerm = this.shortTerm.filter(m => {
      if (!m.expiresAt) return true; // 没有失效时间的保留
      return new Date(m.expiresAt).getTime() > now;
    });
    const cleaned = before - this.shortTerm.length;
    if (cleaned > 0) {
      console.log(`🧹 清理了 ${cleaned} 条过期短期记忆`);
    }
    return cleaned;
  }

  /**
   * 整理记忆：清理过期短期记忆 + 去重 + 限制长期记忆总量
   * 应在 Agent 唤醒前调用
   * @returns {object} { expiredCleaned, duplicatesRemoved }
   */
  consolidateMemories() {
    // 1. 清理过期短期记忆
    const expiredCleaned = this.cleanExpiredShortTerm();

    // 2. 长期记忆去重（基于内容相似度的简单去重）
    const seen = new Map();
    const deduped = [];
    let duplicatesRemoved = 0;

    for (const mem of this.longTerm) {
      // 简单的内容指纹：取前 100 字符作为 key
      const key = mem.content.toLowerCase().trim().slice(0, 100);
      if (seen.has(key)) {
        duplicatesRemoved++;
        continue;
      }
      seen.set(key, true);
      deduped.push(mem);
    }
    this.longTerm = deduped;

    // 3. 如果长期记忆超过上限（200 条），保留最新的
    const MAX_LONG_TERM = 200;
    if (this.longTerm.length > MAX_LONG_TERM) {
      const trimmed = this.longTerm.length - MAX_LONG_TERM;
      this.longTerm = this.longTerm.slice(-MAX_LONG_TERM);
      console.log(`🧹 长期记忆超出上限，裁剪了 ${trimmed} 条最旧的记忆`);
    }

    if (expiredCleaned > 0 || duplicatesRemoved > 0) {
      console.log(`🧠 记忆整理完成: 清理过期短期 ${expiredCleaned} 条, 去重长期 ${duplicatesRemoved} 条`);
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
