/**
 * Chat Store - Chat history file storage module
 * 
 * Extracts chat history out of memory/company-state.json,
 * storing it in a dedicated folder, partitioned by session chunks.
 * 
 * Storage layout:
 *   data/chats/{sessionId}/
 *     ├── meta.json           # Session metadata
 *     ├── chunk-0001.jsonl    # Chat chunk file (max 50 messages per chunk)
 *     ├── chunk-0002.jsonl
 *     └── ...
 * 
 * Features:
 * 1. Chunk storage: one file per 50 messages to avoid single large files
 * 2. Append writes: new messages are appended to the current chunk, no full rewrites
 * 3. Fast recent message reads: only read the tail of the latest chunk
 * 4. Keyword search: search historical messages for context
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CHATS_DIR = path.join(DATA_DIR, 'chats');

// Max messages per chunk
const MESSAGES_PER_CHUNK = 50;

// Ensure the directory exists
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR, { recursive: true });
}

/**
 * Get the session directory path
 */
function getSessionDir(sessionId) {
  return path.join(CHATS_DIR, sessionId);
}

/**
 * Ensure the session directory exists
 */
function ensureSessionDir(sessionId) {
  const dir = getSessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Generate a chunk file name
 */
function chunkFileName(index) {
  return `chunk-${String(index).padStart(4, '0')}.jsonl`;
}

/**
 * Get all chunk files for a session (in order)
 */
function listChunkFiles(sessionDir) {
  if (!fs.existsSync(sessionDir)) return [];
  return fs.readdirSync(sessionDir)
    .filter(f => f.startsWith('chunk-') && f.endsWith('.jsonl'))
    .sort();
}

/**
 * Read all messages from a JSONL file
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
 * Count messages in a JSONL file
 */
function countMessagesInChunk(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return 0;
  return content.split('\n').length;
}

/**
 * ChatStore - Chat history management
 */
export class ChatStore {
  constructor() {
    // Cache: sessionId -> { currentChunkIndex, currentChunkCount }
    this._cache = new Map();
  }

  /**
   * Create a new session
   * @param {string} sessionId - Session ID
   * @param {object} meta - Session metadata { participants, type, title }
   * @returns {string} sessionId
   */
  createSession(sessionId, meta = {}) {
    const dir = ensureSessionDir(sessionId);
    const metaPath = path.join(dir, 'meta.json');
    
    if (!fs.existsSync(metaPath)) {
      const metaData = {
        sessionId,
        title: meta.title || 'Conversation',
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
   * Append a message to a session
   * @param {string} sessionId - Session ID
   * @param {object} message - Message object { role, content, action?, time? }
   */
  appendMessage(sessionId, message) {
    const dir = ensureSessionDir(sessionId);
    
    // Determine the current write chunk
    const cacheEntry = this._getOrInitCache(sessionId, dir);
    const chunkPath = path.join(dir, chunkFileName(cacheEntry.currentChunkIndex));
    
    // Build the message record (preserving extended fields like fromAgentId, toAgentId, etc.)
    const record = {
      id: uuidv4(),
      role: message.role,
      content: message.content,
      action: message.action || null,
      time: message.time ? new Date(message.time).toISOString() : new Date().toISOString(),
    };
    // Preserve extended fields for agent-to-agent chat
    if (message.fromAgentId) record.fromAgentId = message.fromAgentId;
    if (message.fromAgentName) record.fromAgentName = message.fromAgentName;
    if (message.toAgentId) record.toAgentId = message.toAgentId;
    if (message.toAgentName) record.toAgentName = message.toAgentName;

    // Append to the chunk file
    fs.appendFileSync(chunkPath, JSON.stringify(record) + '\n', 'utf-8');
    cacheEntry.currentChunkCount++;

    // If the current chunk is full, advance to the next one
    if (cacheEntry.currentChunkCount >= MESSAGES_PER_CHUNK) {
      cacheEntry.currentChunkIndex++;
      cacheEntry.currentChunkCount = 0;
    }

    // Update metadata
    this._updateMeta(sessionId, dir);

    return record;
  }

  /**
   * Get the most recent N messages (used when an Agent wakes up to load context)
   * @param {string} sessionId - Session ID
   * @param {number} limit - Max messages to return
   * @returns {Array} Message list (in ascending time order)
   */
  getRecentMessages(sessionId, limit = 10) {
    const dir = getSessionDir(sessionId);
    if (!fs.existsSync(dir)) return [];

    const chunks = listChunkFiles(dir);
    if (chunks.length === 0) return [];

    const messages = [];
    // Read backwards from the most recent chunk
    for (let i = chunks.length - 1; i >= 0 && messages.length < limit; i--) {
      const chunkPath = path.join(dir, chunks[i]);
      const chunkMessages = readChunkFile(chunkPath);
      // Take from the tail of the chunk
      messages.unshift(...chunkMessages);
    }

    // Return only the most recent `limit` messages
    return messages.slice(-limit);
  }

  /**
   * Get the total message count for a session
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
   * Keyword search over historical messages
   * Searches all chunks for messages containing the keywords, for providing Agent context
   * 
   * @param {string} sessionId - Session ID
   * @param {string} query - Search keywords
   * @param {number} limit - Max messages to return
   * @returns {Array} Matching messages (sorted by relevance)
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

    // Sort by relevance and take the top N
    scoredMessages.sort((a, b) => b._relevanceScore - a._relevanceScore);
    return scoredMessages.slice(0, limit);
  }

  /**
   * Search and return matching messages with surrounding context (window context)
   * @param {string} sessionId 
   * @param {string} query 
   * @param {number} limit - Number of match groups to return
   * @param {number} windowSize - How many messages to include before/after each match
   * @returns {Array} List of message contexts
   */
  searchWithContext(sessionId, query, limit = 5, windowSize = 2) {
    const dir = getSessionDir(sessionId);
    if (!fs.existsSync(dir)) return [];

    const keywords = this._extractKeywords(query);
    if (keywords.length === 0) return [];

    // Read all messages (with global index)
    const chunks = listChunkFiles(dir);
    const allMessages = [];
    for (const chunk of chunks) {
      const chunkPath = path.join(dir, chunk);
      allMessages.push(...readChunkFile(chunkPath));
    }

    // Find matching message indices and scores
    const matches = [];
    for (let i = 0; i < allMessages.length; i++) {
      const score = this._calculateRelevance(allMessages[i], keywords);
      if (score > 0) {
        matches.push({ index: i, score });
      }
    }

    // Sort by score
    matches.sort((a, b) => b.score - a.score);

    // Take the top N matches and return their window context
    const contexts = [];
    const usedIndices = new Set();
    for (const match of matches.slice(0, limit)) {
      const start = Math.max(0, match.index - windowSize);
      const end = Math.min(allMessages.length - 1, match.index + windowSize);
      
      // Deduplicate
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
   * List all sessions
   * @returns {Array} Session list
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
   * Mark a session as read (updates bossLastReadAt)
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
   * Get session metadata
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
   * Delete a session
   * @param {string} sessionId 
   */
  deleteSession(sessionId) {
    const dir = getSessionDir(sessionId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      this._cache.delete(sessionId);
      console.log(`🗑️ Deleted session record: ${sessionId}`);
    }
  }

  /**
   * Migrate from a legacy chatHistory array to file storage
   * @param {string} sessionId - Session ID
   * @param {Array} chatHistory - Legacy chat history array
   */
  migrateFromArray(sessionId, chatHistory) {
    if (!chatHistory || chatHistory.length === 0) return;
    
    this.createSession(sessionId, {
      title: 'Migrated session',
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
    console.log(`📦 Migrated ${chatHistory.length} chat messages to file storage`);
  }

  // ========================================================================
  // Internal Methods
  // ========================================================================

  /**
   * Get or initialize a cache entry
   */
  _getOrInitCache(sessionId, dir) {
    if (this._cache.has(sessionId)) {
      return this._cache.get(sessionId);
    }

    const chunks = listChunkFiles(dir);
    let currentChunkIndex = 1;
    let currentChunkCount = 0;

    if (chunks.length > 0) {
      // Take the last chunk
      const lastChunk = chunks[chunks.length - 1];
      const match = lastChunk.match(/chunk-(\d+)\.jsonl/);
      if (match) {
        currentChunkIndex = parseInt(match[1], 10);
        currentChunkCount = countMessagesInChunk(path.join(dir, lastChunk));
        // If full, advance to the next
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
   * Update session metadata
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
      // Metadata update failure does not affect the main flow
    }
  }

  /**
   * Extract search keywords
   * Tokenization (supports mixed Chinese/English)
   */
  _extractKeywords(query) {
    if (!query || !query.trim()) return [];
    
    const text = query.toLowerCase().trim();
    
    // English word tokenization
    const englishWords = text.match(/[a-zA-Z0-9]+/g) || [];
    
    // Chinese character extraction (groups of 2-3 chars, also keep single chars)
    const chineseChars = text.match(/[\u4e00-\u9fff]+/g) || [];
    const chineseTokens = [];
    for (const segment of chineseChars) {
      // Keep the full Chinese segment as a keyword
      chineseTokens.push(segment);
      // If the segment is long, also split into 2-char tokens
      if (segment.length > 2) {
        for (let i = 0; i < segment.length - 1; i++) {
          chineseTokens.push(segment.slice(i, i + 2));
        }
      }
    }

    // Filter stop words
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
    
    // Deduplicate
    return [...new Set(allTokens)];
  }

  /**
   * Calculate relevance score between a message and keywords
   * Simple BM25-style scoring
   */
  _calculateRelevance(message, keywords) {
    if (!message.content) return 0;
    
    const content = message.content.toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      // Exact match count
      const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = content.match(regex);
      if (matches) {
        // TF (term frequency) — more occurrences = higher score, with decay
        const tf = Math.log(1 + matches.length);
        // Length weighting (longer keywords are more meaningful)
        const lengthBonus = Math.min(keyword.length / 3, 2);
        score += tf * lengthBonus;
      }
    }

    // Role weighting: boss messages are more important (contain instructions/preferences)
    if (message.role === 'boss') {
      score *= 1.2;
    }

    // Time decay (optional: more recent messages get a slight boost)
    if (message.time) {
      const ageHours = (Date.now() - new Date(message.time).getTime()) / (1000 * 60 * 60);
      const freshness = Math.max(0.5, 1 - ageHours / (24 * 30)); // Linear decay to 0.5 over 30 days
      score *= freshness;
    }

    return score;
  }
}

// Global singleton
export const chatStore = new ChatStore();
