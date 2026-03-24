/**
 * BaseChannel - Abstract base class for all channel adapters
 *
 * Every channel (WeChat, Telegram, Slack, Discord, etc.) must extend this class
 * and implement the abstract methods.
 *
 * Lifecycle: install → configure → connect → (onMessage ↔ sendMessage) → disconnect → uninstall
 *
 * Design principles:
 * - Strategy Pattern: each channel is a strategy
 * - Protocol Agnostic: unified interface, varying underlying protocols
 * - Event-Driven: decoupled from core modules via event system
 */
import EventEmitter from 'eventemitter3';

/**
 * Channel state enum
 */
export const ChannelState = {
  INSTALLED: 'installed',       // Installed, not configured
  CONFIGURED: 'configured',     // Configured, not connected
  CONNECTING: 'connecting',     // Connecting
  CONNECTED: 'connected',       // Connected and working
  DISCONNECTED: 'disconnected', // Disconnected
  ERROR: 'error',               // Error state
};

/**
 * Standardized inbound message format
 * All channel adapters must convert platform-specific messages to this format
 */
export class InboundMessage {
  constructor({ channelId, platformUserId, platformUserName, content, messageId, raw = null, timestamp = new Date() }) {
    this.channelId = channelId;           // Channel ID
    this.platformUserId = platformUserId; // Platform user identifier
    this.platformUserName = platformUserName || platformUserId; // User display name
    this.content = content;               // Message text content
    this.messageId = messageId;           // Platform message ID
    this.raw = raw;                       // Raw platform message (for debugging)
    this.timestamp = timestamp;
  }
}

/**
 * Standardized outbound message format
 */
export class OutboundMessage {
  constructor({ channelId, platformUserId, content, replyToMessageId = null, metadata = {} }) {
    this.channelId = channelId;
    this.platformUserId = platformUserId;
    this.content = content;
    this.replyToMessageId = replyToMessageId;
    this.metadata = metadata;
    this.timestamp = new Date();
  }
}

/**
 * Abstract base class - all channel adapters must extend this
 */
export class BaseChannel extends EventEmitter {
  /**
   * @param {object} manifest - Channel manifest
   * @param {string} manifest.id - Unique identifier (e.g. 'weixin', 'telegram', 'slack')
   * @param {string} manifest.name - Display name
   * @param {string} manifest.description - Channel description
   * @param {string} manifest.version - Version number
   * @param {string} manifest.icon - Icon emoji or URL
   * @param {object} manifest.configSchema - Config JSON Schema
   * @param {string} manifest.transport - Transport method: 'gateway' | 'webhook' | 'websocket' | 'polling'
   */
  constructor(manifest) {
    super();
    if (new.target === BaseChannel) {
      throw new Error('BaseChannel is abstract and cannot be instantiated directly');
    }
    this.id = manifest.id;
    this.name = manifest.name;
    this.description = manifest.description || '';
    this.version = manifest.version || '1.0.0';
    this.icon = manifest.icon || '📡';
    this.configSchema = manifest.configSchema || {};
    this.transport = manifest.transport || 'webhook';

    this.state = ChannelState.INSTALLED;
    this.config = {};
    this.error = null;
    this.stats = { messagesIn: 0, messagesOut: 0, errors: 0, connectedAt: null };

    // Message handler (injected by ChannelRegistry)
    this._messageHandler = null;
  }

  /**
   * Set message handler (called when external messages are received)
   * @param {function(InboundMessage): Promise<string>} handler - Returns reply text
   */
  setMessageHandler(handler) {
    this._messageHandler = handler;
  }

  // --- Abstract methods that subclasses must implement ---

  /**
   * Connect to platform (start webhook listener, establish WebSocket, start polling, etc.)
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error(`${this.constructor.name} must implement connect() method`);
  }

  /**
   * Disconnect from platform
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error(`${this.constructor.name} must implement disconnect() method`);
  }

  /**
   * Send message to platform
   * @param {OutboundMessage} message - Standardized outbound message
   * @returns {Promise<void>}
   */
  async sendMessage(message) {
    throw new Error(`${this.constructor.name} must implement sendMessage() method`);
  }

  /**
   * Validate config
   * @param {object} config - Channel config
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateConfig(config) {
    return { valid: true, errors: [] };
  }

  // --- Protected helper methods (subclasses may call) ---

  /**
   * Handle received inbound message (subclasses call this after receiving platform messages)
   * @param {InboundMessage} inbound - Standardized inbound message
   */
  async handleInbound(inbound) {
    this.stats.messagesIn++;
    this.emit('message:in', inbound);

    if (!this._messageHandler) {
      console.warn(`[Channel:${this.id}] No message handler set, ignoring message`);
      return;
    }

    try {
      const replyText = await this._messageHandler(inbound);
      if (replyText) {
        const outbound = new OutboundMessage({
          channelId: this.id,
          platformUserId: inbound.platformUserId,
          content: replyText,
          replyToMessageId: inbound.messageId,
        });
        await this.sendMessage(outbound);
        this.stats.messagesOut++;
        this.emit('message:out', outbound);
      }
    } catch (err) {
      this.stats.errors++;
      this.error = err.message;
      this.emit('error', err);
      console.error(`[Channel:${this.id}] Error processing message:`, err.message);
    }
  }

  /**
   * Update channel state
   * @param {string} newState - ChannelState enum value
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    if (newState === ChannelState.CONNECTED) {
      this.stats.connectedAt = new Date();
    }
    this.emit('state:change', { from: oldState, to: newState });
  }

  // --- Public methods ---

  /**
   * Configure channel
   * @param {object} config - Config items
   */
  configure(config) {
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid channel config: ${validation.errors.join(', ')}`);
    }
    this.config = { ...this.config, ...config };
    if (this.state === ChannelState.INSTALLED) {
      this.setState(ChannelState.CONFIGURED);
    }
  }

  /**
   * Get channel status summary (for API/UI display)
   */
  getStatus() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      version: this.version,
      icon: this.icon,
      transport: this.transport,
      state: this.state,
      error: this.error,
      config: this._getSafeConfig(),
      stats: { ...this.stats },
    };
  }

  /**
   * Return config without sensitive information (subclasses may override to hide keys, etc.)
   */
  _getSafeConfig() {
    const safe = { ...this.config };
    // Default to hide fields containing key/token/secret
    for (const key of Object.keys(safe)) {
      if (/key|token|secret|password/i.test(key) && typeof safe[key] === 'string') {
        safe[key] = safe[key].slice(0, 4) + '****';
      }
    }
    return safe;
  }

  /**
   * Serialize (for persistence)
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      state: this.state,
      config: this.config,
      stats: this.stats,
      error: this.error,
    };
  }
}
