import { v4 as uuidv4 } from 'uuid';

/**
 * 记忆系统 - 每个Agent拥有独立的长期记忆和短期记忆
 * 
 * 短期记忆：当前任务相关的临时信息，任务结束后可能被遗忘或提炼为长期记忆
 * 长期记忆：经验教训、技能成长、自我反思等持久信息，跟随Agent终身
 */
export class Memory {
  constructor() {
    this.shortTerm = [];   // 短期记忆列表
    this.longTerm = [];    // 长期记忆列表
    this.maxShortTerm = 10; // 短期记忆最大容量，超出后自动淘汰最旧的
  }

  /**
   * 添加短期记忆
   * @param {string} content - 记忆内容
   * @param {string} [category] - 分类标签
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

    // 超出容量时淘汰最旧的
    if (this.shortTerm.length > this.maxShortTerm) {
      const evicted = this.shortTerm.shift();
      // 被淘汰的短期记忆自动提炼为长期记忆摘要
      this.addLongTerm(
        `[自动归档] ${evicted.content}`,
        'archived'
      );
    }

    return memory;
  }

  /**
   * 添加长期记忆
   * @param {string} content - 记忆内容
   * @param {string} [category] - 分类: experience | reflection | skill | feedback | archived
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
   * 将短期记忆提炼为长期记忆
   * @param {string} shortTermId - 短期记忆ID
   * @param {string} [refinedContent] - 提炼后的内容（不传则使用原内容）
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
   * 清空短期记忆（比如换部门/换项目时）
   */
  clearShortTerm() {
    this.shortTerm = [];
  }

  /**
   * 按分类检索长期记忆
   */
  searchLongTerm(category = null) {
    if (!category) return [...this.longTerm];
    return this.longTerm.filter(m => m.category === category);
  }

  /**
   * 按关键词搜索所有记忆
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
   * 获取记忆摘要
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
   * 序列化（用于持久化/人才市场保存）
   */
  serialize() {
    return {
      shortTerm: [...this.shortTerm],
      longTerm: [...this.longTerm],
    };
  }

  /**
   * 从序列化数据恢复
   */
  static deserialize(data) {
    const memory = new Memory();
    if (data.shortTerm) memory.shortTerm = data.shortTerm;
    if (data.longTerm) memory.longTerm = data.longTerm;
    return memory;
  }

  /**
   * 打印记忆内容
   */
  print(agentName = '') {
    const prefix = agentName ? `[${agentName}]` : '';
    console.log(`\n🧠 ${prefix} 记忆系统:`);
    console.log(`   短期记忆 (${this.shortTerm.length}条):`);
    this.shortTerm.forEach(m => {
      console.log(`     📝 [${m.category}] ${m.content}`);
    });
    console.log(`   长期记忆 (${this.longTerm.length}条):`);
    this.longTerm.forEach(m => {
      console.log(`     💾 [${m.category}] ${m.content}`);
    });
  }
}
