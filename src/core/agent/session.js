/**
 * Session Manager - Conversation context and state persistence
 *
 * Distilled from OpenClaw's session system (vendor/openclaw/src/sessions/
 * and vendor/openclaw/src/config/sessions/)
 * Re-implemented as an enterprise "engagement tracking / conversation memory" system
 *
 * Features:
 * - Session creation and lifecycle management
 * - Session key derivation (agent + channel + peer)
 * - Message transcript storage with configurable depth
 * - Session metadata and tagging
 * - Auto-pruning of stale sessions
 * - Send policy enforcement (allow/deny per session)
 * - Session serialization for persistence
 */
import { v4 as uuidv4 } from 'uuid';

/**
 * Session states
 */
export const SessionState = {
  ACTIVE: 'active',
  IDLE: 'idle',
  ARCHIVED: 'archived',
  EXPIRED: 'expired',
};

/**
 * Send policy decisions (controls whether agent can send in a session)
 */
export const SendPolicy = {
  ALLOW: 'allow',
  DENY: 'deny',
};

/**
 * Build a deterministic session key from components
 * Distilled from OpenClaw's session-key.ts pattern
 *
 * @param {object} params
 * @param {string} params.agentId - Agent identifier
 * @param {string} params.channel - Communication channel (e.g., 'web', 'chat', 'email')
 * @param {string} params.peerId - Peer identifier (user, group, etc.)
 * @param {string} params.peerKind - Peer type ('direct', 'group', 'channel')
 * @returns {string} Normalized session key
 */
export function buildSessionKey({ agentId, channel = 'default', peerId = '', peerKind = 'direct' }) {
  const parts = [
    agentId?.trim().toLowerCase() || 'default',
    channel.trim().toLowerCase(),
    peerKind.trim().toLowerCase(),
  ];
  if (peerId) {
    parts.push(peerId.trim().toLowerCase());
  }
  return parts.join(':');
}

/**
 * Session Entry - A single conversation session
 */
class Session {
  /**
   * @param {object} config
   * @param {string} config.sessionKey - Deterministic key
   * @param {string} config.agentId - Agent involved
   * @param {string} config.channel - Communication channel
   * @param {string} config.peerId - The other party
   * @param {string} config.peerKind - Type of peer
   * @param {number} config.maxTranscriptLength - Max messages in transcript
   */
  constructor(config) {
    this.id = uuidv4();
    this.sessionKey = config.sessionKey;
    this.agentId = config.agentId;
    this.channel = config.channel || 'default';
    this.peerId = config.peerId || '';
    this.peerKind = config.peerKind || 'direct';

    this.state = SessionState.ACTIVE;
    this.sendPolicy = SendPolicy.ALLOW;

    // Transcript: ordered list of messages
    this.transcript = [];
    this.maxTranscriptLength = config.maxTranscriptLength ?? 100;

    // Metadata
    this.metadata = {};
    this.tags = new Set();
    this.tokenUsage = { input: 0, output: 0 };
    this.messageCount = 0;
    this.toolCallCount = 0;

    // Timestamps
    this.createdAt = new Date();
    this.lastActiveAt = new Date();
    this.expiresAt = null;

    // Optional label for display
    this.label = '';
  }
}

/**
 * Session Manager - Manages all active sessions
 *
 * Distilled from OpenClaw's session store (vendor/openclaw/src/config/sessions/store.ts)
 * and session management patterns
 */
export class SessionManager {
  /**
   * @param {object} options
   * @param {number} options.maxSessions - Maximum concurrent sessions
   * @param {number} options.sessionTTL - Session time-to-live in ms (0 = no expiry)
   * @param {number} options.idleTimeout - Time before marking idle (ms)
   * @param {number} options.pruneInterval - Auto-prune check interval (ms)
   * @param {number} options.maxTranscriptLength - Default max transcript messages per session
   */
  constructor(options = {}) {
    this.maxSessions = options.maxSessions ?? 500;
    this.sessionTTL = options.sessionTTL ?? 0; // No expiry by default
    this.idleTimeout = options.idleTimeout ?? 30 * 60 * 1000; // 30 min
    this.pruneInterval = options.pruneInterval ?? 5 * 60 * 1000; // 5 min
    this.maxTranscriptLength = options.maxTranscriptLength ?? 100;

    /** @type {Map<string, Session>} sessionKey => Session */
    this.sessions = new Map();

    /** @type {Map<string, Set<string>>} agentId => Set<sessionKey> */
    this.sessionsByAgent = new Map();

    // Send policy rules
    this.sendPolicyRules = [];

    // Auto-prune timer
    this._pruneTimer = null;
  }

  /**
   * Get or create a session for the given parameters
   *
   * @param {object} params
   * @param {string} params.agentId
   * @param {string} params.channel
   * @param {string} params.peerId
   * @param {string} params.peerKind
   * @returns {Session}
   */
  getOrCreate(params) {
    const key = buildSessionKey(params);
    let session = this.sessions.get(key);

    if (session) {
      // Reactivate if expired or archived
      if (session.state === SessionState.EXPIRED || session.state === SessionState.ARCHIVED) {
        session.state = SessionState.ACTIVE;
      }
      session.lastActiveAt = new Date();
      return session;
    }

    // Create new session
    session = new Session({
      sessionKey: key,
      agentId: params.agentId,
      channel: params.channel || 'default',
      peerId: params.peerId || '',
      peerKind: params.peerKind || 'direct',
      maxTranscriptLength: this.maxTranscriptLength,
    });

    // Apply send policy
    session.sendPolicy = this._resolveSendPolicy(session);

    // Apply TTL
    if (this.sessionTTL > 0) {
      session.expiresAt = new Date(Date.now() + this.sessionTTL);
    }

    // Enforce session limit (evict oldest idle session)
    if (this.sessions.size >= this.maxSessions) {
      this._evictOldest();
    }

    this.sessions.set(key, session);

    // Track by agent
    if (!this.sessionsByAgent.has(params.agentId)) {
      this.sessionsByAgent.set(params.agentId, new Set());
    }
    this.sessionsByAgent.get(params.agentId).add(key);

    return session;
  }

  /**
   * Get session by key
   * @param {string} sessionKey
   * @returns {Session|null}
   */
  get(sessionKey) {
    return this.sessions.get(sessionKey) || null;
  }

  /**
   * Record a message in a session's transcript
   *
   * @param {string} sessionKey
   * @param {object} message
   * @param {string} message.role - 'user', 'assistant', 'system', 'tool'
   * @param {string} message.content - Message content
   * @param {object} message.metadata - Optional metadata
   * @returns {boolean} Whether the message was recorded
   */
  addMessage(sessionKey, message) {
    const session = this.sessions.get(sessionKey);
    if (!session) return false;

    const entry = {
      id: uuidv4(),
      role: message.role || 'user',
      content: message.content || '',
      metadata: message.metadata || {},
      timestamp: new Date(),
    };

    session.transcript.push(entry);
    session.messageCount++;
    session.lastActiveAt = new Date();

    // Enforce transcript limit
    if (session.transcript.length > session.maxTranscriptLength) {
      session.transcript.shift();
    }

    // Reactivate idle session
    if (session.state === SessionState.IDLE) {
      session.state = SessionState.ACTIVE;
    }

    return true;
  }

  /**
   * Record token usage in a session
   * @param {string} sessionKey
   * @param {number} inputTokens
   * @param {number} outputTokens
   */
  recordTokenUsage(sessionKey, inputTokens = 0, outputTokens = 0) {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    session.tokenUsage.input += inputTokens;
    session.tokenUsage.output += outputTokens;
  }

  /**
   * Record a tool call in a session
   * @param {string} sessionKey
   */
  recordToolCall(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (session) session.toolCallCount++;
  }

  /**
   * Get transcript for a session
   * @param {string} sessionKey
   * @param {number} limit - Max messages to return (most recent)
   * @returns {Array}
   */
  getTranscript(sessionKey, limit = 50) {
    const session = this.sessions.get(sessionKey);
    if (!session) return [];
    const transcript = session.transcript;
    return limit ? transcript.slice(-limit) : [...transcript];
  }

  /**
   * Archive a session (keep data but mark inactive)
   * @param {string} sessionKey
   */
  archive(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.state = SessionState.ARCHIVED;
    }
  }

  /**
   * Delete a session permanently
   * @param {string} sessionKey
   * @returns {boolean}
   */
  delete(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (!session) return false;

    // Remove from agent index
    const agentSessions = this.sessionsByAgent.get(session.agentId);
    if (agentSessions) {
      agentSessions.delete(sessionKey);
      if (agentSessions.size === 0) {
        this.sessionsByAgent.delete(session.agentId);
      }
    }

    this.sessions.delete(sessionKey);
    return true;
  }

  /**
   * Reset a session (clear transcript, keep metadata)
   * @param {string} sessionKey
   */
  reset(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    session.transcript = [];
    session.messageCount = 0;
    session.toolCallCount = 0;
    session.tokenUsage = { input: 0, output: 0 };
    session.state = SessionState.ACTIVE;
    session.lastActiveAt = new Date();
  }

  /**
   * Get all sessions for an agent
   * @param {string} agentId
   * @returns {Session[]}
   */
  getAgentSessions(agentId) {
    const keys = this.sessionsByAgent.get(agentId);
    if (!keys) return [];
    return [...keys].map(k => this.sessions.get(k)).filter(Boolean);
  }

  // ========================================================================
  // Send Policy
  // ========================================================================

  /**
   * Add a send policy rule
   *
   * @param {object} rule
   * @param {string} rule.action - 'allow' or 'deny'
   * @param {object} rule.match - Matching criteria
   * @param {string} rule.match.channel - Match channel
   * @param {string} rule.match.peerKind - Match peer kind
   * @param {string} rule.match.agentId - Match agent
   */
  addSendPolicyRule(rule) {
    this.sendPolicyRules.push({
      action: rule.action === 'deny' ? SendPolicy.DENY : SendPolicy.ALLOW,
      match: rule.match || {},
    });
  }

  /**
   * Resolve send policy for a session
   * Distilled from OpenClaw's send-policy.ts pattern
   * @param {Session} session
   * @returns {string} 'allow' or 'deny'
   */
  _resolveSendPolicy(session) {
    for (const rule of this.sendPolicyRules) {
      const match = rule.match;
      if (match.channel && match.channel !== session.channel) continue;
      if (match.peerKind && match.peerKind !== session.peerKind) continue;
      if (match.agentId && match.agentId !== session.agentId) continue;
      return rule.action;
    }
    return SendPolicy.ALLOW;
  }

  // ========================================================================
  // Pruning & Eviction
  // ========================================================================

  /**
   * Start auto-pruning timer
   */
  startPruning() {
    if (this._pruneTimer) return;
    this._pruneTimer = setInterval(() => this.prune(), this.pruneInterval);
  }

  /**
   * Stop auto-pruning timer
   */
  stopPruning() {
    if (this._pruneTimer) {
      clearInterval(this._pruneTimer);
      this._pruneTimer = null;
    }
  }

  /**
   * Prune expired and stale sessions
   * @returns {number} Number of sessions pruned
   */
  prune() {
    const now = Date.now();
    let pruned = 0;

    for (const [key, session] of this.sessions) {
      // Check TTL expiry
      if (session.expiresAt && session.expiresAt.getTime() <= now) {
        this.delete(key);
        pruned++;
        continue;
      }

      // Check idle timeout
      if (
        session.state === SessionState.ACTIVE &&
        this.idleTimeout > 0 &&
        now - session.lastActiveAt.getTime() > this.idleTimeout
      ) {
        session.state = SessionState.IDLE;
      }
    }

    return pruned;
  }

  /**
   * Evict the oldest idle session to make room
   */
  _evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;

    // Prefer evicting idle/archived sessions
    for (const [key, session] of this.sessions) {
      if (
        (session.state === SessionState.IDLE || session.state === SessionState.ARCHIVED) &&
        session.lastActiveAt.getTime() < oldestTime
      ) {
        oldestKey = key;
        oldestTime = session.lastActiveAt.getTime();
      }
    }

    // If no idle sessions, evict oldest active
    if (!oldestKey) {
      for (const [key, session] of this.sessions) {
        if (session.lastActiveAt.getTime() < oldestTime) {
          oldestKey = key;
          oldestTime = session.lastActiveAt.getTime();
        }
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
    }
  }

  // ========================================================================
  // Query & Introspection
  // ========================================================================

  /**
   * List all sessions with optional filters
   * @param {object} filters
   * @param {string} filters.agentId
   * @param {string} filters.channel
   * @param {string} filters.state
   * @param {number} filters.limit
   * @returns {Array}
   */
  list(filters = {}) {
    let results = [...this.sessions.values()];

    if (filters.agentId) results = results.filter(s => s.agentId === filters.agentId);
    if (filters.channel) results = results.filter(s => s.channel === filters.channel);
    if (filters.state) results = results.filter(s => s.state === filters.state);

    // Sort by last active (most recent first)
    results.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());

    if (filters.limit) results = results.slice(0, filters.limit);

    return results.map(s => ({
      id: s.id,
      sessionKey: s.sessionKey,
      agentId: s.agentId,
      channel: s.channel,
      peerId: s.peerId,
      peerKind: s.peerKind,
      state: s.state,
      sendPolicy: s.sendPolicy,
      messageCount: s.messageCount,
      toolCallCount: s.toolCallCount,
      tokenUsage: { ...s.tokenUsage },
      label: s.label,
      tags: [...s.tags],
      createdAt: s.createdAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      expiresAt: s.expiresAt?.toISOString() || null,
    }));
  }

  /**
   * Get overall summary statistics
   * @returns {object}
   */
  getSummary() {
    const sessions = [...this.sessions.values()];
    const byState = {};
    const byChannel = {};
    let totalMessages = 0;
    let totalTokens = 0;

    for (const s of sessions) {
      byState[s.state] = (byState[s.state] || 0) + 1;
      byChannel[s.channel] = (byChannel[s.channel] || 0) + 1;
      totalMessages += s.messageCount;
      totalTokens += s.tokenUsage.input + s.tokenUsage.output;
    }

    return {
      totalSessions: sessions.length,
      byState,
      byChannel,
      totalMessages,
      totalTokens,
      agentCount: this.sessionsByAgent.size,
    };
  }

  /**
   * Serialize all sessions for persistence
   * @returns {object}
   */
  serialize() {
    const data = [];
    for (const [key, session] of this.sessions) {
      data.push({
        sessionKey: session.sessionKey,
        agentId: session.agentId,
        channel: session.channel,
        peerId: session.peerId,
        peerKind: session.peerKind,
        state: session.state,
        sendPolicy: session.sendPolicy,
        transcript: session.transcript,
        metadata: session.metadata,
        tags: [...session.tags],
        tokenUsage: session.tokenUsage,
        messageCount: session.messageCount,
        toolCallCount: session.toolCallCount,
        label: session.label,
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString(),
        expiresAt: session.expiresAt?.toISOString() || null,
      });
    }
    return { sessions: data, savedAt: new Date().toISOString() };
  }

  /**
   * Restore sessions from serialized data
   * @param {object} data
   */
  restore(data) {
    if (!data || !data.sessions) return;
    for (const entry of data.sessions) {
      try {
        const session = new Session({
          sessionKey: entry.sessionKey,
          agentId: entry.agentId,
          channel: entry.channel,
          peerId: entry.peerId,
          peerKind: entry.peerKind,
          maxTranscriptLength: this.maxTranscriptLength,
        });
        session.state = entry.state || SessionState.ACTIVE;
        session.sendPolicy = entry.sendPolicy || SendPolicy.ALLOW;
        session.transcript = entry.transcript || [];
        session.metadata = entry.metadata || {};
        session.tags = new Set(entry.tags || []);
        session.tokenUsage = entry.tokenUsage || { input: 0, output: 0 };
        session.messageCount = entry.messageCount || 0;
        session.toolCallCount = entry.toolCallCount || 0;
        session.label = entry.label || '';
        session.createdAt = new Date(entry.createdAt);
        session.lastActiveAt = new Date(entry.lastActiveAt);
        session.expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : null;

        this.sessions.set(session.sessionKey, session);

        // Rebuild agent index
        if (!this.sessionsByAgent.has(session.agentId)) {
          this.sessionsByAgent.set(session.agentId, new Set());
        }
        this.sessionsByAgent.get(session.agentId).add(session.sessionKey);
      } catch (err) {
        console.error(`[SessionManager] Failed to restore session "${entry.sessionKey}":`, err.message);
      }
    }
  }
}

// Global singleton — use globalThis to survive Next.js HMR in dev mode
if (!globalThis.__sessionManager) {
  globalThis.__sessionManager = new SessionManager();
}
export const sessionManager = globalThis.__sessionManager;
