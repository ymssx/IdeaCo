/**
 * Lifecycle Hook System - Event-driven extensibility framework
 *
 * Distilled from OpenClaw's hook system (vendor/openclaw/src/hooks/internal-hooks.ts)
 * Re-implemented as an enterprise "business process automation" hook system
 *
 * Features:
 * - Type-safe event registration and triggering
 * - Wildcard and specific event:action subscriptions
 * - Error isolation (one handler failure doesn't block others)
 * - Hook priority ordering
 * - Async handler support with timeout protection
 * - Debug introspection for registered hooks
 */

/**
 * Hook event types — the broad categories of lifecycle events
 */
export const HookEventType = {
  AGENT: 'agent',
  TASK: 'task',
  REQUIREMENT: 'requirement',
  DEPARTMENT: 'department',
  SYSTEM: 'system',
  MESSAGE: 'message',
  LLM: 'llm',
};

/**
 * Pre-defined hook event keys (type:action combinations)
 */
export const HookEvent = {
  // Agent lifecycle
  AGENT_CREATED: 'agent:created',
  AGENT_TASK_START: 'agent:task_start',
  AGENT_TASK_END: 'agent:task_end',
  AGENT_DISMISSED: 'agent:dismissed',
  AGENT_ERROR: 'agent:error',

  // Task lifecycle
  TASK_ASSIGNED: 'task:assigned',
  TASK_PROGRESS: 'task:progress',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  TASK_REVIEW: 'task:review',

  // Requirement lifecycle
  REQ_CREATED: 'requirement:created',
  REQ_TEAM_FORMED: 'requirement:team_formed',
  REQ_PHASE_START: 'requirement:phase_start',
  REQ_PHASE_END: 'requirement:phase_end',
  REQ_COMPLETED: 'requirement:completed',
  REQ_CANCELLED: 'requirement:cancelled',

  // Department lifecycle
  DEPT_CREATED: 'department:created',
  DEPT_MEMBER_ADDED: 'department:member_added',
  DEPT_MEMBER_REMOVED: 'department:member_removed',

  // System events
  SYSTEM_STARTUP: 'system:startup',
  SYSTEM_SHUTDOWN: 'system:shutdown',
  SYSTEM_HEALTH_CHECK: 'system:health_check',
  SYSTEM_CONFIG_CHANGE: 'system:config_change',

  // Message events
  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_SENT: 'message:sent',
  MESSAGE_BROADCAST: 'message:broadcast',

  // LLM interaction events
  LLM_REQUEST_START: 'llm:request_start',
  LLM_REQUEST_END: 'llm:request_end',
  LLM_TOKEN_USAGE: 'llm:token_usage',
  LLM_ERROR: 'llm:error',
};

/**
 * Default handler timeout (ms)
 */
const DEFAULT_TIMEOUT = 10000;

/**
 * Internal handler entry with metadata
 * @typedef {object} HandlerEntry
 * @property {string} id - Unique handler ID
 * @property {Function} handler - The actual handler function
 * @property {number} priority - Execution priority (lower = first)
 * @property {string} source - Who registered this handler (plugin ID, module name, etc.)
 * @property {number} timeout - Max execution time in ms
 * @property {Date} registeredAt - When this handler was registered
 */

/**
 * Hook Event Payload - passed to every handler
 * @typedef {object} HookEventPayload
 * @property {string} type - Event type (agent, task, etc.)
 * @property {string} action - Specific action (created, completed, etc.)
 * @property {string} eventKey - Full event key (type:action)
 * @property {object} context - Event-specific context data
 * @property {Date} timestamp - When the event occurred
 * @property {string[]} messages - Handlers can push messages here for feedback
 * @property {object} meta - Mutable metadata that handlers can enrich
 */

let handlerIdCounter = 0;

/**
 * Hook Registry - Manages all lifecycle hooks
 *
 * Uses a singleton pattern (similar to OpenClaw's globalThis approach)
 * to ensure hooks work across dynamic imports.
 */
class HookRegistry {
  constructor() {
    /** @type {Map<string, HandlerEntry[]>} */
    this.handlers = new Map();

    /** @type {Map<string, number>} - Track how many times each event has fired */
    this.eventCounts = new Map();

    /** @type {Array<{eventKey: string, timestamp: Date, handlerCount: number, errors: number}>} */
    this.recentFires = [];
    this.maxRecentFires = 100;
  }

  /**
   * Register a hook handler for a specific event key
   *
   * @param {string} eventKey - Event type (e.g., 'agent') or specific (e.g., 'agent:created')
   * @param {Function} handler - async (event: HookEventPayload) => void
   * @param {object} options
   * @param {number} options.priority - Execution priority (default: 100, lower = first)
   * @param {string} options.source - Who registered this (for debugging)
   * @param {number} options.timeout - Handler timeout in ms
   * @returns {string} Handler ID for later removal
   *
   * @example
   * // Listen to all agent events
   * hookRegistry.on('agent', async (event) => {
   *   console.log('Agent event:', event.action);
   * });
   *
   * // Listen to specific task completion
   * hookRegistry.on('task:completed', async (event) => {
   *   await notifyStakeholders(event.context);
   * });
   */
  on(eventKey, handler, options = {}) {
    const id = `hook_${++handlerIdCounter}`;
    const entry = {
      id,
      handler,
      priority: options.priority ?? 100,
      source: options.source || 'unknown',
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      registeredAt: new Date(),
    };

    if (!this.handlers.has(eventKey)) {
      this.handlers.set(eventKey, []);
    }

    const list = this.handlers.get(eventKey);
    list.push(entry);

    // Keep sorted by priority (lower first)
    list.sort((a, b) => a.priority - b.priority);

    return id;
  }

  /**
   * Remove a specific handler by its ID
   * @param {string} handlerId
   * @returns {boolean} Whether the handler was found and removed
   */
  off(handlerId) {
    for (const [eventKey, entries] of this.handlers) {
      const index = entries.findIndex(e => e.id === handlerId);
      if (index !== -1) {
        entries.splice(index, 1);
        if (entries.length === 0) {
          this.handlers.delete(eventKey);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Remove all handlers for an event key
   * @param {string} eventKey
   */
  offAll(eventKey) {
    this.handlers.delete(eventKey);
  }

  /**
   * Remove all handlers from a specific source
   * @param {string} source
   * @returns {number} Number of handlers removed
   */
  offBySource(source) {
    let removed = 0;
    for (const [eventKey, entries] of this.handlers) {
      const before = entries.length;
      const filtered = entries.filter(e => e.source !== source);
      if (filtered.length !== before) {
        removed += before - filtered.length;
        if (filtered.length === 0) {
          this.handlers.delete(eventKey);
        } else {
          this.handlers.set(eventKey, filtered);
        }
      }
    }
    return removed;
  }

  /**
   * Trigger a hook event
   *
   * Calls all handlers registered for:
   * 1. The general event type (e.g., 'agent')
   * 2. The specific event:action combination (e.g., 'agent:created')
   *
   * Handlers execute in priority order. Errors are caught and logged
   * but don't prevent other handlers from running.
   *
   * @param {string} eventKey - The event key (e.g., 'agent:created')
   * @param {object} context - Event-specific context data
   * @returns {Promise<{messages: string[], errors: Array<{handlerId: string, source: string, error: string}>, meta: object}>}
   */
  async trigger(eventKey, context = {}) {
    const [type, action] = eventKey.includes(':')
      ? eventKey.split(':', 2)
      : [eventKey, 'unknown'];

    const event = {
      type,
      action,
      eventKey,
      context,
      timestamp: new Date(),
      messages: [],
      meta: {},
    };

    // Collect handlers: type-level + specific event key
    const typeHandlers = this.handlers.get(type) || [];
    const specificHandlers = eventKey !== type
      ? (this.handlers.get(eventKey) || [])
      : [];

    // Merge and sort by priority
    const allHandlers = [...typeHandlers, ...specificHandlers]
      .sort((a, b) => a.priority - b.priority);

    // Track event firing
    this.eventCounts.set(eventKey, (this.eventCounts.get(eventKey) || 0) + 1);

    const errors = [];

    if (allHandlers.length === 0) {
      this._recordFire(eventKey, 0, 0);
      return { messages: event.messages, errors, meta: event.meta };
    }

    // Execute handlers sequentially (in priority order)
    for (const entry of allHandlers) {
      try {
        const result = await this._executeWithTimeout(
          entry.handler,
          event,
          entry.timeout,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Hooks] Error in handler "${entry.id}" (${entry.source}) for ${eventKey}: ${message}`);
        errors.push({
          handlerId: entry.id,
          source: entry.source,
          error: message,
        });
      }
    }

    this._recordFire(eventKey, allHandlers.length, errors.length);

    return { messages: event.messages, errors, meta: event.meta };
  }

  /**
   * Execute a handler with timeout protection
   * @param {Function} handler
   * @param {object} event
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  async _executeWithTimeout(handler, event, timeoutMs) {
    return Promise.race([
      handler(event),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Hook handler timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  /**
   * Record a fire event for introspection
   */
  _recordFire(eventKey, handlerCount, errors) {
    this.recentFires.push({
      eventKey,
      timestamp: new Date(),
      handlerCount,
      errors,
    });
    if (this.recentFires.length > this.maxRecentFires) {
      this.recentFires.shift();
    }
  }

  /**
   * Clear all registered hooks (useful for testing)
   */
  clear() {
    this.handlers.clear();
    this.eventCounts.clear();
    this.recentFires = [];
  }

  /**
   * Get all registered event keys (for debugging)
   * @returns {string[]}
   */
  getRegisteredKeys() {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get handler count for a specific event key
   * @param {string} eventKey
   * @returns {number}
   */
  getHandlerCount(eventKey) {
    return (this.handlers.get(eventKey) || []).length;
  }

  /**
   * Get full diagnostic summary
   * @returns {object}
   */
  getSummary() {
    const keys = this.getRegisteredKeys();
    const handlersByKey = {};
    let totalHandlers = 0;

    for (const key of keys) {
      const entries = this.handlers.get(key) || [];
      handlersByKey[key] = entries.map(e => ({
        id: e.id,
        source: e.source,
        priority: e.priority,
      }));
      totalHandlers += entries.length;
    }

    return {
      totalHandlers,
      registeredKeys: keys.length,
      handlersByKey,
      eventCounts: Object.fromEntries(this.eventCounts),
      recentFires: this.recentFires.slice(-20),
    };
  }
}

// ============================================================================
// Convenience factory for creating hook event payloads
// ============================================================================

/**
 * Create a hook event payload with common fields filled in
 *
 * @param {string} type - Event type
 * @param {string} action - Action within that type
 * @param {object} context - Additional context
 * @returns {HookEventPayload}
 */
export function createHookEvent(type, action, context = {}) {
  return {
    type,
    action,
    eventKey: `${type}:${action}`,
    context,
    timestamp: new Date(),
    messages: [],
    meta: {},
  };
}

// ============================================================================
// Global singleton
// ============================================================================

export const hookRegistry = new HookRegistry();

export { HookRegistry };
