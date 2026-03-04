import { v4 as uuidv4 } from 'uuid';

/**
 * Memory System - Each Agent has independent long-term and short-term memory
 * 
 * Short-term memory: temporary info related to current task, may be forgotten or consolidated after task ends
 * Long-term memory: lessons learned, skill growth, self-reflection and other persistent info, stays with Agent permanently
 */
export class Memory {
  constructor() {
    this.shortTerm = [];   // Short-term memory list
    this.longTerm = [];    // Long-term memory list
    this.maxShortTerm = 10; // Max short-term capacity, oldest auto-evicted when exceeded
  }

  /**
   * Add short-term memory
   * @param {string} content - Memory content
   * @param {string} [category] - Category tag
   */
  addShortTerm(content, category = 'task') {
    const memory = {
      id: uuidv4(),
      content,
      category,
      type: 'short-term',
      createdAt: new Date(),
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
   * @param {string} [category] - Category: experience | reflection | skill | feedback | archived
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
      shortTerm: [...this.shortTerm],
      longTerm: [...this.longTerm],
    };
  }

  /**
   * Restore from serialized data
   */
  static deserialize(data) {
    const memory = new Memory();
    if (data.shortTerm) memory.shortTerm = data.shortTerm;
    if (data.longTerm) memory.longTerm = data.longTerm;
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
      console.log(`     📝 [${m.category}] ${m.content}`);
    });
    console.log(`   Long-term (${this.longTerm.length} items):`);
    this.longTerm.forEach(m => {
      console.log(`     💾 [${m.category}] ${m.content}`);
    });
  }
}
