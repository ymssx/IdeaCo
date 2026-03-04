/**
 * Knowledge Base System - Agent 知识库管理
 * 
 * 蒸馏自 OpenClaw 的 Memory 系统 (vendor/openclaw/docs/concepts/memory.md)
 * 重新实现为「企业知识库」管理体系
 *
 * 功能：
 * - 知识库创建与管理
 * - 文档/条目的增删改查
 * - 按 Agent 或全局分配知识库
 * - 基于关键词的知识检索
 * - 知识库统计与监控
 */
import { v4 as uuidv4 } from 'uuid';

/**
 * 知识库类型
 */
export const KnowledgeType = {
  GLOBAL: 'global',       // 全局知识库（所有 Agent 可访问）
  DEPARTMENT: 'department', // 部门级知识库
  AGENT: 'agent',         // Agent 个人知识库
};

/**
 * 条目类型
 */
export const EntryType = {
  FACT: 'fact',           // 事实信息
  DECISION: 'decision',   // 决策记录
  PROCEDURE: 'procedure', // 流程/操作步骤
  REFERENCE: 'reference', // 参考文档
  FAQ: 'faq',             // 常见问答
  NOTE: 'note',           // 备忘录
};

/**
 * 知识条目
 */
class KnowledgeEntry {
  constructor(config) {
    this.id = config.id || uuidv4();
    this.title = config.title;
    this.content = config.content;
    this.type = config.type || EntryType.NOTE;
    this.tags = config.tags || [];
    this.source = config.source || null;      // 来源（文件路径、URL等）
    this.importance = config.importance || 0.5; // 重要性 0-1
    this.createdAt = config.createdAt || new Date();
    this.updatedAt = config.updatedAt || new Date();
    this.createdBy = config.createdBy || null; // Agent ID
  }
}

/**
 * 知识库
 */
class KnowledgeBase {
  constructor(config) {
    this.id = config.id || uuidv4();
    this.name = config.name;
    this.description = config.description || '';
    this.type = config.type || KnowledgeType.GLOBAL;
    this.ownerId = config.ownerId || null;  // Agent ID 或 Department ID
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
   * 关键词搜索条目
   */
  search(query, limit = 10) {
    const q = query.toLowerCase();
    const results = [];
    for (const entry of this.entries.values()) {
      const titleMatch = entry.title.toLowerCase().includes(q);
      const contentMatch = entry.content.toLowerCase().includes(q);
      const tagMatch = entry.tags.some(t => t.toLowerCase().includes(q));

      if (titleMatch || contentMatch || tagMatch) {
        // 简单评分：标题匹配权重最高
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
   * 获取统计信息
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
 * 知识库管理器 - 管理所有知识库
 */
export class KnowledgeManager {
  constructor() {
    /** @type {Map<string, KnowledgeBase>} */
    this.bases = new Map();
  }

  /**
   * 创建知识库
   */
  create(config) {
    const kb = new KnowledgeBase(config);
    this.bases.set(kb.id, kb);
    console.log(`📖 Knowledge base created: ${kb.name} (${kb.type})`);
    return kb;
  }

  /**
   * 获取知识库
   */
  get(kbId) {
    return this.bases.get(kbId) || null;
  }

  /**
   * 删除知识库
   */
  delete(kbId) {
    return this.bases.delete(kbId);
  }

  /**
   * 列出所有知识库
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
   * 获取指定 Agent 可访问的所有知识库
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
   * 跨知识库搜索
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
   * 向知识库添加条目
   */
  addEntry(kbId, entryConfig) {
    const kb = this.bases.get(kbId);
    if (!kb) throw new Error(`Knowledge base not found: ${kbId}`);
    return kb.addEntry(entryConfig);
  }

  /**
   * 从知识库删除条目
   */
  removeEntry(kbId, entryId) {
    const kb = this.bases.get(kbId);
    if (!kb) throw new Error(`Knowledge base not found: ${kbId}`);
    return kb.removeEntry(entryId);
  }

  /**
   * 构建知识库 prompt（注入到 Agent 系统提示词）
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
   * 获取汇总统计
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

// 全局单例
export const knowledgeManager = new KnowledgeManager();

// 创建默认全局知识库
const globalKb = knowledgeManager.create({
  name: 'Company Knowledge Base',
  description: 'Shared knowledge base for all agents in the company',
  type: KnowledgeType.GLOBAL,
});

// 添加一些示例条目
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
