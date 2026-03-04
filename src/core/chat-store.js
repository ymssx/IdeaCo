/**
 * Chat Store - 聊天记录文件存储模块
 * 
 * 将聊天记录从内存/company-state.json 中抽离出来，
 * 使用单独的文件夹存储，按会话切片。
 * 
 * 存储结构：
 *   data/chats/{sessionId}/
 *     ├── meta.json           # 会话元信息
 *     ├── chunk-0001.jsonl    # 聊天切片文件（每片最多 50 条消息）
 *     ├── chunk-0002.jsonl
 *     └── ...
 * 
 * 功能：
 * 1. 切片存储：每 50 条消息一个文件，避免单文件过大
 * 2. 追加写入：新消息 append 到当前切片，无需重写整个文件
 * 3. 最近消息快速读取：只读最新切片的尾部
 * 4. 关键词搜索：搜索历史消息中的上下文
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CHATS_DIR = path.join(DATA_DIR, 'chats');

// 每个切片最多存储的消息数
const MESSAGES_PER_CHUNK = 50;

// 确保目录存在
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR, { recursive: true });
}

/**
 * 获取会话目录路径
 */
function getSessionDir(sessionId) {
  return path.join(CHATS_DIR, sessionId);
}

/**
 * 确保会话目录存在
 */
function ensureSessionDir(sessionId) {
  const dir = getSessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 生成切片文件名
 */
function chunkFileName(index) {
  return `chunk-${String(index).padStart(4, '0')}.jsonl`;
}

/**
 * 获取会话的所有切片文件（按序）
 */
function listChunkFiles(sessionDir) {
  if (!fs.existsSync(sessionDir)) return [];
  return fs.readdirSync(sessionDir)
    .filter(f => f.startsWith('chunk-') && f.endsWith('.jsonl'))
    .sort();
}

/**
 * 读取一个 JSONL 文件中的所有消息
 */
function readChunkFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * 统计一个 JSONL 文件中的消息数
 */
function countMessagesInChunk(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return 0;
  return content.split('\n').length;
}

/**
 * ChatStore - 聊天记录管理
 */
export class ChatStore {
  constructor() {
    // 缓存：sessionId -> { currentChunkIndex, currentChunkCount }
    this._cache = new Map();
  }

  /**
   * 创建新会话
   * @param {string} sessionId - 会话 ID
   * @param {object} meta - 会话元信息 { participants, type, title }
   * @returns {string} sessionId
   */
  createSession(sessionId, meta = {}) {
    const dir = ensureSessionDir(sessionId);
    const metaPath = path.join(dir, 'meta.json');
    
    if (!fs.existsSync(metaPath)) {
      const metaData = {
        sessionId,
        title: meta.title || '对话',
        participants: meta.participants || [],
        type: meta.type || 'boss-secretary',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        totalMessages: 0,
      };
      fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), 'utf-8');
    }

    return sessionId;
  }

  /**
   * 追加一条消息到会话
   * @param {string} sessionId - 会话 ID
   * @param {object} message - 消息对象 { role, content, action?, time? }
   */
  appendMessage(sessionId, message) {
    const dir = ensureSessionDir(sessionId);
    
    // 确定当前写入的切片
    const cacheEntry = this._getOrInitCache(sessionId, dir);
    const chunkPath = path.join(dir, chunkFileName(cacheEntry.currentChunkIndex));
    
    // 构造消息记录（保留扩展字段如 fromAgentId、toAgentId 等）
    const record = {
      id: uuidv4(),
      role: message.role,
      content: message.content,
      action: message.action || null,
      time: message.time ? new Date(message.time).toISOString() : new Date().toISOString(),
    };
    // 保留 agent-agent 聊天的扩展字段
    if (message.fromAgentId) record.fromAgentId = message.fromAgentId;
    if (message.fromAgentName) record.fromAgentName = message.fromAgentName;
    if (message.toAgentId) record.toAgentId = message.toAgentId;
    if (message.toAgentName) record.toAgentName = message.toAgentName;

    // 追加到切片文件
    fs.appendFileSync(chunkPath, JSON.stringify(record) + '\n', 'utf-8');
    cacheEntry.currentChunkCount++;

    // 如果当前切片满了，准备下一个切片
    if (cacheEntry.currentChunkCount >= MESSAGES_PER_CHUNK) {
      cacheEntry.currentChunkIndex++;
      cacheEntry.currentChunkCount = 0;
    }

    // 更新元信息
    this._updateMeta(sessionId, dir);

    return record;
  }

  /**
   * 获取最近 N 条消息（用于 Agent 唤醒时读取上下文）
   * @param {string} sessionId - 会话 ID
   * @param {number} limit - 最多返回的消息数
   * @returns {Array} 消息列表（按时间升序）
   */
  getRecentMessages(sessionId, limit = 10) {
    const dir = getSessionDir(sessionId);
    if (!fs.existsSync(dir)) return [];

    const chunks = listChunkFiles(dir);
    if (chunks.length === 0) return [];

    const messages = [];
    // 从最新的切片开始往回读
    for (let i = chunks.length - 1; i >= 0 && messages.length < limit; i--) {
      const chunkPath = path.join(dir, chunks[i]);
      const chunkMessages = readChunkFile(chunkPath);
      // 从切片尾部取
      messages.unshift(...chunkMessages);
    }

    // 只返回最近的 limit 条
    return messages.slice(-limit);
  }

  /**
   * 获取会话的全部消息数量
   * @param {string} sessionId 
   * @returns {number}
   */
  getMessageCount(sessionId) {
    const dir = getSessionDir(sessionId);
    if (!fs.existsSync(dir)) return 0;

    const chunks = listChunkFiles(dir);
    let total = 0;
    for (const chunk of chunks) {
      total += countMessagesInChunk(path.join(dir, chunk));
    }
    return total;
  }

  /**
   * 关键词搜索历史消息
   * 在所有切片中搜索包含关键词的消息，用于提供给 Agent 上下文
   * 
   * @param {string} sessionId - 会话 ID
   * @param {string} query - 搜索关键词
   * @param {number} limit - 最多返回的消息数
   * @returns {Array} 匹配的消息（按相关性排序）
   */
  searchMessages(sessionId, query, limit = 10) {
    const dir = getSessionDir(sessionId);
    if (!fs.existsSync(dir)) return [];

    const keywords = this._extractKeywords(query);
    if (keywords.length === 0) return [];

    const chunks = listChunkFiles(dir);
    const scoredMessages = [];

    for (const chunk of chunks) {
      const chunkPath = path.join(dir, chunk);
      const messages = readChunkFile(chunkPath);
      
      for (const msg of messages) {
        const score = this._calculateRelevance(msg, keywords);
        if (score > 0) {
          scoredMessages.push({ ...msg, _relevanceScore: score });
        }
      }
    }

    // 按相关性排序，取 top N
    scoredMessages.sort((a, b) => b._relevanceScore - a._relevanceScore);
    return scoredMessages.slice(0, limit);
  }

  /**
   * 搜索并返回匹配消息及其前后文（窗口上下文）
   * @param {string} sessionId 
   * @param {string} query 
   * @param {number} limit - 返回的匹配组数
   * @param {number} windowSize - 每个匹配点前后各取多少条消息
   * @returns {Array} 消息上下文列表
   */
  searchWithContext(sessionId, query, limit = 5, windowSize = 2) {
    const dir = getSessionDir(sessionId);
    if (!fs.existsSync(dir)) return [];

    const keywords = this._extractKeywords(query);
    if (keywords.length === 0) return [];

    // 读取所有消息（带全局索引）
    const chunks = listChunkFiles(dir);
    const allMessages = [];
    for (const chunk of chunks) {
      const chunkPath = path.join(dir, chunk);
      allMessages.push(...readChunkFile(chunkPath));
    }

    // 找到匹配的消息索引和得分
    const matches = [];
    for (let i = 0; i < allMessages.length; i++) {
      const score = this._calculateRelevance(allMessages[i], keywords);
      if (score > 0) {
        matches.push({ index: i, score });
      }
    }

    // 按得分排序
    matches.sort((a, b) => b.score - a.score);

    // 取 top N 个匹配点，返回窗口上下文
    const contexts = [];
    const usedIndices = new Set();
    for (const match of matches.slice(0, limit)) {
      const start = Math.max(0, match.index - windowSize);
      const end = Math.min(allMessages.length - 1, match.index + windowSize);
      
      // 去重
      if (usedIndices.has(match.index)) continue;
      
      const contextMessages = [];
      for (let i = start; i <= end; i++) {
        usedIndices.add(i);
        contextMessages.push(allMessages[i]);
      }
      contexts.push({
        matchedMessage: allMessages[match.index],
        score: match.score,
        context: contextMessages,
      });
    }

    return contexts;
  }

  /**
   * 列出所有会话
   * @returns {Array} 会话列表
   */
  listSessions() {
    if (!fs.existsSync(CHATS_DIR)) return [];
    
    const dirs = fs.readdirSync(CHATS_DIR).filter(d => {
      const fullPath = path.join(CHATS_DIR, d);
      return fs.statSync(fullPath).isDirectory();
    });

    return dirs.map(d => {
      const metaPath = path.join(CHATS_DIR, d, 'meta.json');
      if (!fs.existsSync(metaPath)) return null;
      try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * 标记会话为已读（更新 bossLastReadAt）
   * @param {string} sessionId
   */
  markSessionRead(sessionId) {
    const dir = getSessionDir(sessionId);
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) return;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.bossLastReadAt = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    } catch (e) {
      // ignore
    }
  }

  /**
   * 获取会话元信息
   * @param {string} sessionId
   * @returns {object|null}
   */
  getSessionMeta(sessionId) {
    const dir = getSessionDir(sessionId);
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * 删除会话
   * @param {string} sessionId 
   */
  deleteSession(sessionId) {
    const dir = getSessionDir(sessionId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      this._cache.delete(sessionId);
      console.log(`🗑️ 已删除会话记录: ${sessionId}`);
    }
  }

  /**
   * 从旧版 chatHistory 数组迁移到文件存储
   * @param {string} sessionId - 会话 ID
   * @param {Array} chatHistory - 旧版聊天记录数组
   */
  migrateFromArray(sessionId, chatHistory) {
    if (!chatHistory || chatHistory.length === 0) return;
    
    this.createSession(sessionId, {
      title: '迁移的会话',
      type: 'boss-secretary',
    });

    for (const msg of chatHistory) {
      this.appendMessage(sessionId, {
        role: msg.role,
        content: msg.content,
        action: msg.action || null,
        time: msg.time,
      });
    }
    console.log(`📦 已迁移 ${chatHistory.length} 条聊天记录到文件存储`);
  }

  // ========================================================================
  // 内部方法
  // ========================================================================

  /**
   * 获取或初始化缓存条目
   */
  _getOrInitCache(sessionId, dir) {
    if (this._cache.has(sessionId)) {
      return this._cache.get(sessionId);
    }

    const chunks = listChunkFiles(dir);
    let currentChunkIndex = 1;
    let currentChunkCount = 0;

    if (chunks.length > 0) {
      // 取最后一个切片
      const lastChunk = chunks[chunks.length - 1];
      const match = lastChunk.match(/chunk-(\d+)\.jsonl/);
      if (match) {
        currentChunkIndex = parseInt(match[1], 10);
        currentChunkCount = countMessagesInChunk(path.join(dir, lastChunk));
        // 如果已满，移到下一个
        if (currentChunkCount >= MESSAGES_PER_CHUNK) {
          currentChunkIndex++;
          currentChunkCount = 0;
        }
      }
    }

    const entry = { currentChunkIndex, currentChunkCount };
    this._cache.set(sessionId, entry);
    return entry;
  }

  /**
   * 更新会话元信息
   */
  _updateMeta(sessionId, dir) {
    const metaPath = path.join(dir, 'meta.json');
    try {
      let meta = {};
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      }
      meta.lastActiveAt = new Date().toISOString();
      meta.totalMessages = this.getMessageCount(sessionId);
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    } catch (e) {
      // 元信息更新失败不影响主流程
    }
  }

  /**
   * 提取搜索关键词
   * 分词处理（支持中英文混合）
   */
  _extractKeywords(query) {
    if (!query || !query.trim()) return [];
    
    const text = query.toLowerCase().trim();
    
    // 英文单词分词
    const englishWords = text.match(/[a-zA-Z0-9]+/g) || [];
    
    // 中文字符提取（每 2-3 个字符为一组，也保留单字）
    const chineseChars = text.match(/[\u4e00-\u9fff]+/g) || [];
    const chineseTokens = [];
    for (const segment of chineseChars) {
      // 保留完整中文片段作为关键词
      chineseTokens.push(segment);
      // 如果片段较长，也按 2 字切分
      if (segment.length > 2) {
        for (let i = 0; i < segment.length - 1; i++) {
          chineseTokens.push(segment.slice(i, i + 2));
        }
      }
    }

    // 过滤停用词
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with',
      'at', 'by', 'from', 'as', 'into', 'through', 'and', 'or', 'but', 'not', 'so',
      'if', 'that', 'this', 'it', 'he', 'she', 'we', 'they', 'i', 'you', 'me',
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
      '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看',
      '好', '自己', '这', '他', '吗', '吧', '啊', '呢', '嗯', '哦']);

    const allTokens = [...englishWords, ...chineseTokens]
      .filter(w => w.length > 0 && !stopWords.has(w));
    
    // 去重
    return [...new Set(allTokens)];
  }

  /**
   * 计算消息与关键词的相关性得分
   * 简单 BM25 风格的得分
   */
  _calculateRelevance(message, keywords) {
    if (!message.content) return 0;
    
    const content = message.content.toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      // 精确匹配计数
      const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = content.match(regex);
      if (matches) {
        // TF（词频）—— 出现次数越多得分越高，但有衰减
        const tf = Math.log(1 + matches.length);
        // 关键词长度加权（长关键词更有意义）
        const lengthBonus = Math.min(keyword.length / 3, 2);
        score += tf * lengthBonus;
      }
    }

    // 角色加权：boss 的消息更重要（因为包含指令/偏好）
    if (message.role === 'boss') {
      score *= 1.2;
    }

    // 时间衰减（可选：更近的消息略有加分）
    if (message.time) {
      const ageHours = (Date.now() - new Date(message.time).getTime()) / (1000 * 60 * 60);
      const freshness = Math.max(0.5, 1 - ageHours / (24 * 30)); // 30 天内线性衰减到 0.5
      score *= freshness;
    }

    return score;
  }
}

// 全局单例
export const chatStore = new ChatStore();
