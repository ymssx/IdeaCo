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
import { CHATS_DIR } from '../../lib/paths.js';

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
      actions: message.actions || null,
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
   * Paginated read: return `limit` messages whose time is strictly before `beforeTime`.
   * If `beforeTime` is null, returns the most recent `limit` messages (like getRecentMessages).
   * Returns { messages, hasMore } where hasMore indicates if there are older messages.
   * @param {string} sessionId
   * @param {object} opts - { before?: string (ISO time), limit?: number }
   * @returns {{ messages: Array, hasMore: boolean, total: number }}
   */
  getMessagesPage(sessionId, { before = null, limit = 30 } = {}) {
    const dir = getSessionDir(sessionId);
    if (!fs.existsSync(dir)) return { messages: [], hasMore: false, total: 0 };

    const chunks = listChunkFiles(dir);
    if (chunks.length === 0) return { messages: [], hasMore: false, total: 0 };

    // Read ALL messages (from all chunks) — we need them in chronological order
    // For very large histories this could be optimized, but secretary chat is capped ~50 in memory
    // and the chunk files keep things manageable
    const allMessages = [];
    for (const chunk of chunks) {
      const chunkPath = path.join(dir, chunk);
      allMessages.push(...readChunkFile(chunkPath));
    }

    const total = allMessages.length;

    if (!before) {
      // No cursor — return the last `limit` messages
      const start = Math.max(0, total - limit);
      return {
        messages: allMessages.slice(start),
        hasMore: start > 0,
        total,
      };
    }

    // Find the index of the first message with time >= beforeTime
    // Messages are chronological, so we find the cutoff point
    const beforeDate = new Date(before).getTime();
    let cutoff = total;
    for (let i = total - 1; i >= 0; i--) {
      const msgTime = allMessages[i].time ? new Date(allMessages[i].time).getTime() : 0;
      if (msgTime < beforeDate) {
        cutoff = i + 1;
        break;
      }
      if (i === 0) cutoff = 0;
    }

    const start = Math.max(0, cutoff - limit);
    return {
      messages: allMessages.slice(start, cutoff),
      hasMore: start > 0,
      total,
    };
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
        actions: msg.actions || null,
        time: msg.time,
      });
    }
    console.log(`📦 Migrated ${chatHistory.length} chat messages to file storage`);
  }

  // ========================================================================
  // Group Chat Storage (Requirement / Department / Sprint group chats)
  // ========================================================================

  /**
   * Append a group chat message to file storage.
   * The message is stored as-is (preserving from, type, visibility, etc.).
   * @param {string} groupId - Group identifier, e.g. "req-{id}", "dept-{id}", "sprint-{id}"
   * @param {object} message - Full group chat message object { id, from, content, type, visibility, time }
   */
  appendGroupMessage(groupId, message) {
    const sessionId = `group-${groupId}`;
    const dir = ensureSessionDir(sessionId);

    const cacheEntry = this._getOrInitCache(sessionId, dir);
    const chunkPath = path.join(dir, chunkFileName(cacheEntry.currentChunkIndex));

    // Store the message as-is, just ensure time is ISO string
    const record = {
      ...message,
      time: message.time ? new Date(message.time).toISOString() : new Date().toISOString(),
    };

    fs.appendFileSync(chunkPath, JSON.stringify(record) + '\n', 'utf-8');
    cacheEntry.currentChunkCount++;

    if (cacheEntry.currentChunkCount >= MESSAGES_PER_CHUNK) {
      cacheEntry.currentChunkIndex++;
      cacheEntry.currentChunkCount = 0;
    }

    // Skip meta update for group chats (high frequency, meta is not critical)
  }

  /**
   * Load group chat messages from file storage.
   * @param {string} groupId - Group identifier
   * @param {number} [limit=200] - Max messages to return (from tail)
   * @returns {Array} Message list (ascending time order)
   */
  getGroupMessages(groupId, limit = 200) {
    const sessionId = `group-${groupId}`;
    const dir = getSessionDir(sessionId);
    if (!fs.existsSync(dir)) return [];

    const chunks = listChunkFiles(dir);
    if (chunks.length === 0) return [];

    const messages = [];
    for (let i = chunks.length - 1; i >= 0 && messages.length < limit; i--) {
      const chunkPath = path.join(dir, chunks[i]);
      const chunkMessages = readChunkFile(chunkPath);
      messages.unshift(...chunkMessages);
    }

    return messages.slice(-limit);
  }

  /**
   * Migrate an in-memory groupChat array to file storage (one-time migration).
   * @param {string} groupId - Group identifier
   * @param {Array} groupChat - Legacy in-memory groupChat array
   */
  migrateGroupChat(groupId, groupChat) {
    if (!groupChat || groupChat.length === 0) return;
    const sessionId = `group-${groupId}`;
    // Skip if already migrated
    if (this.getGroupMessages(groupId, 1).length > 0) return;

    ensureSessionDir(sessionId);
    for (const msg of groupChat) {
      this.appendGroupMessage(groupId, msg);
    }
    console.log(`📦 Migrated ${groupChat.length} group chat messages for ${groupId} to file storage`);
  }

  /**
   * Delete group chat file storage
   * @param {string} groupId 
   */
  deleteGroupChat(groupId) {
    this.deleteSession(`group-${groupId}`);
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
   * Language-agnostic: splits on whitespace, keeps the full query as an
   * additional token so substring matches across word boundaries still work.
   * Single-char tokens are dropped to reduce noise.
   */
  _extractKeywords(query) {
    if (!query || !query.trim()) return [];

    const text = query.toLowerCase().trim();
    const tokens = text.split(/\s+/).filter(t => t.length > 1);

    // Also keep the full query itself when it differs from a single token,
    // so multi-word phrases can match as a whole.
    if (tokens.length > 1) {
      tokens.push(text);
    }

    return [...new Set(tokens)];
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
// Global singleton — use globalThis to survive Next.js HMR in dev mode
if (!globalThis.__chatStore) {
  globalThis.__chatStore = new ChatStore();
}
export const chatStore = globalThis.__chatStore;
