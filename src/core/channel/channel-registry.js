/**
 * ChannelRegistry - Channel Registration Center
 *
 * Manages installation, enabling, disabling, and configuration of all channel adapters.
 * Provides unified message routing: external messages → Secretary → reply.
 *
 * Design principles:
 * - Registry Pattern: centralized management of all channel instances
 * - Message Routing: unified inbound message dispatch to Company.chatWithSecretary()
 * - Persistence-friendly: serialize/deserialize channel config and state
 */
import { ChannelState } from './base-channel.js';

/**
 * Channel Registry
 */
export class ChannelRegistry {
  constructor() {
    /** @type {Map<string, import('./base-channel.js').BaseChannel>} */
    this.channels = new Map();

    /** @type {Map<string, typeof import('./base-channel.js').BaseChannel>} */
    this.adapters = new Map(); // Registered adapter classes: adapterId → ChannelClass

    /** @type {function|null} Message handler function, injected by Company */
    this._globalMessageHandler = null;
  }

  // ─── Adapter Registration ────────────────────────────────

  /**
   * Register a channel adapter class (declare an available channel type)
   * @param {string} adapterId - Adapter ID (e.g. 'weixin', 'telegram')
   * @param {typeof import('./base-channel.js').BaseChannel} AdapterClass - Adapter class
   */
  registerAdapter(adapterId, AdapterClass) {
    this.adapters.set(adapterId, AdapterClass);
  }

  /**
   * Get all available adapter types
   * @returns {Array<{id: string, name: string, description: string, icon: string}>}
   */
  listAdapters() {
    const result = [];
    for (const [id, AdapterClass] of this.adapters) {
      // Create temporary instance to get metadata
      try {
        const temp = new AdapterClass();
        result.push({
          id,
          name: temp.name,
          description: temp.description,
          icon: temp.icon,
          transport: temp.transport,
        });
      } catch {
        result.push({ id, name: id, description: '', icon: '📡', transport: 'unknown' });
      }
    }
    return result;
  }

  // ─── Channel Instance Management ─────────────────────────

  /**
   * Install (instantiate) a channel
   * @param {string} adapterId - Adapter type ID
   * @param {object} config - Initial configuration
   * @returns {import('./base-channel.js').BaseChannel}
   */
  install(adapterId, config = {}) {
    const AdapterClass = this.adapters.get(adapterId);
    if (!AdapterClass) {
      throw new Error(`Unknown channel adapter: ${adapterId}. Available adapters: ${[...this.adapters.keys()].join(', ')}`);
    }

    if (this.channels.has(adapterId)) {
      throw new Error(`Channel "${adapterId}" is already installed. Please uninstall first before reinstalling.`);
    }

    const channel = new AdapterClass();

    // Inject message handler
    if (this._globalMessageHandler) {
      channel.setMessageHandler(this._globalMessageHandler);
    }

    // Apply initial configuration
    if (Object.keys(config).length > 0) {
      channel.configure(config);
    }

    this.channels.set(adapterId, channel);
    console.log(`📡 [ChannelRegistry] Channel installed: ${channel.name} (${adapterId})`);
    return channel;
  }

  /**
   * Uninstall a channel
   * @param {string} channelId
   */
  async uninstall(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    // Disconnect first
    if (channel.state === ChannelState.CONNECTED || channel.state === ChannelState.CONNECTING) {
      try {
        await channel.disconnect();
      } catch (err) {
        console.warn(`[ChannelRegistry] Error disconnecting channel ${channelId}:`, err.message);
      }
    }

    this.channels.delete(channelId);
    console.log(`🗑️ [ChannelRegistry] Channel uninstalled: ${channelId}`);
  }

  /**
   * Enable (connect) a channel
   * @param {string} channelId
   */
  async enable(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Channel "${channelId}" is not installed`);

    if (channel.state === ChannelState.CONNECTED) {
      console.log(`[ChannelRegistry] Channel ${channelId} is already connected`);
      return;
    }

    // Always (re-)inject the message handler before connecting.
    // This ensures the handler is current even after HMR or module reloads.
    if (this._globalMessageHandler) {
      channel.setMessageHandler(this._globalMessageHandler);
    }

    try {
      channel.setState(ChannelState.CONNECTING);
      await channel.connect();
      // For non-blocking channels (like WeChat), connect() returns after QR generation
      // but before login completes. The channel will update its own state via _completeLoginInBackground.
      // Only set CONNECTED if the channel completed synchronously (e.g. session restore).
      if (channel.state === ChannelState.CONNECTING && channel._loginPromise) {
        // Non-blocking login in progress - stay in CONNECTING state
        console.log(`⏳ [ChannelRegistry] Channel ${channel.name} is awaiting login (QR scan)`);
      } else if (channel.state === ChannelState.CONNECTING) {
        // Synchronous connect completed (e.g. session restored)
        channel.setState(ChannelState.CONNECTED);
        channel.error = null;
        console.log(`✅ [ChannelRegistry] Channel connected: ${channel.name}`);
      }
      // If state is already CONNECTED (set during connect), skip
    } catch (err) {
      channel.setState(ChannelState.ERROR);
      channel.error = err.message;
      console.error(`❌ [ChannelRegistry] Channel connection failed (${channelId}):`, err.message);
      throw err;
    }
  }

  /**
   * Disable (disconnect) a channel
   * @param {string} channelId
   */
  async disable(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Channel "${channelId}" is not installed`);

    if (channel.state === ChannelState.DISCONNECTED || channel.state === ChannelState.CONFIGURED) {
      return;
    }

    try {
      await channel.disconnect();
      channel.setState(ChannelState.DISCONNECTED);
      console.log(`⏸️ [ChannelRegistry] Channel disconnected: ${channel.name}`);
    } catch (err) {
      channel.setState(ChannelState.ERROR);
      channel.error = err.message;
      throw err;
    }
  }

  /**
   * Configure a channel
   * @param {string} channelId
   * @param {object} config
   */
  configure(channelId, config) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Channel "${channelId}" is not installed`);
    channel.configure(config);
  }

  /**
   * Get a single channel
   * @param {string} channelId
   * @returns {import('./base-channel.js').BaseChannel|null}
   */
  get(channelId) {
    return this.channels.get(channelId) || null;
  }

  // ─── Message Routing ─────────────────────────────────────

  /**
   * Set the global message handler function.
   * Called when any channel receives a message to get a reply.
   * @param {function(import('./base-channel.js').InboundMessage): Promise<string>} handler
   */
  setMessageHandler(handler) {
    this._globalMessageHandler = handler;
    // Sync to all installed channels (including already-running ones)
    for (const channel of this.channels.values()) {
      channel.setMessageHandler(handler);
    }
  }

  // ─── Query & Statistics ──────────────────────────────────

  /**
   * List the status of all installed channels
   * @returns {Array}
   */
  list() {
    return [...this.channels.values()].map(ch => ch.getStatus());
  }

  /**
   * Get aggregated statistics
   */
  getStats() {
    let totalIn = 0, totalOut = 0, totalErrors = 0;
    const connected = [];

    for (const ch of this.channels.values()) {
      totalIn += ch.stats.messagesIn;
      totalOut += ch.stats.messagesOut;
      totalErrors += ch.stats.errors;
      if (ch.state === ChannelState.CONNECTED) {
        connected.push(ch.id);
      }
    }

    return {
      totalChannels: this.channels.size,
      connectedChannels: connected.length,
      connected,
      totalMessagesIn: totalIn,
      totalMessagesOut: totalOut,
      totalErrors,
    };
  }

  // ─── Serialization / Deserialization ─────────────────────

  /**
   * Serialize all channel configs and state (for persistence)
   */
  serialize() {
    const data = {};
    for (const [id, ch] of this.channels) {
      data[id] = ch.toJSON();
    }
    return data;
  }

  /**
   * Restore channels from persisted data
   * @param {object} data - Output of serialize()
   */
  async restore(data) {
    if (!data || typeof data !== 'object') return;

    for (const [adapterId, saved] of Object.entries(data)) {
      if (!this.adapters.has(adapterId)) {
        console.warn(`[ChannelRegistry] Skipping unregistered adapter during restore: ${adapterId}`);
        continue;
      }

      try {
        // If channel is already installed (e.g. from a previous restore), skip install
        let channel = this.channels.get(adapterId);
        if (!channel) {
          channel = this.install(adapterId, saved.config || {});
        }

        // Restore statistics
        if (saved.stats) {
          channel.stats = { ...channel.stats, ...saved.stats, connectedAt: null };
        }

        // Auto-reconnect if previously connected or was in the middle of connecting
        if (saved.state === ChannelState.CONNECTED || saved.state === ChannelState.CONNECTING) {
          try {
            await this.enable(adapterId);
            console.log(`🔄 [ChannelRegistry] Channel ${adapterId} restored and reconnected`);
          } catch (err) {
            console.warn(`[ChannelRegistry] Auto-reconnect failed for channel ${adapterId}:`, err.message);
            // Channel remains installed — user can manually re-enable from UI
          }
        }
      } catch (err) {
        console.warn(`[ChannelRegistry] Failed to restore channel ${adapterId}:`, err.message);
      }
    }
  }
}

// Global singleton — protected via globalThis to survive Next.js HMR (hot module replacement)
// Without this, each HMR cycle creates a new empty ChannelRegistry, losing all installed
// channels and their message handlers while the old channel instances keep running orphaned.
if (!globalThis.__channelRegistry) {
  globalThis.__channelRegistry = new ChannelRegistry();
}
export const channelRegistry = globalThis.__channelRegistry;
