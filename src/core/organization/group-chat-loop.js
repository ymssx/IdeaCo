/**
 * Group Chat Loop — Thin Global Coordinator
 *
 * This module is now a lightweight shell that:
 *  - Holds the company reference and running state
 *  - Registers / unregisters employees
 *  - Delegates all per-employee behaviour to EmployeeLifecycle
 *  - Emits events for the frontend (monologue:start, monologue:end, etc.)
 *  - Provides aggregate queries (all active thinkers, etc.)
 *  - Handles serialization/deserialization of all lifecycle states
 *
 * All the heavy logic (poll cycles, flow thinking, anti-spam, prompt building,
 * fallback, self-check, idle-chat) now lives in employee/lifecycle.js.
 */

import EventEmitter from 'eventemitter3';

/**
 * GroupChatLoop — Global Chat Loop Coordinator
 */
export class GroupChatLoop extends EventEmitter {
  constructor() {
    super();
    this.company = null;
    this.running = false;

    // agentId → EmployeeLifecycle (populated when employees join)
    this._lifecycles = new Map();
  }

  // ========================================================================
  // Lifecycle management
  // ========================================================================

  /**
   * Start the coordinator.
   * @param {object} company
   */
  start(company) {
    if (this.running) return;
    this.company = company;
    this.running = true;
    console.log('🔄 GroupChatLoop: Chat loop engine started');
    this.emit('started');
  }

  /**
   * Stop the coordinator and all employee lifecycles.
   */
  stop() {
    this.running = false;
    for (const [, lifecycle] of this._lifecycles) {
      lifecycle.stop();
    }
    console.log('⏹️ GroupChatLoop: Chat loop engine stopped');
    this.emit('stopped');
  }

  // ========================================================================
  // Agent registration
  // ========================================================================

  /**
   * Start the poll loop for an employee.
   * The employee is expected to have a `.lifecycle` (EmployeeLifecycle) property.
   */
  startAgentLoop(agent) {
    if (!this.running) return;
    if (this._lifecycles.has(agent.id)) return; // already registered

    const lifecycle = agent.lifecycle;
    if (!lifecycle) {
      console.warn(`  ⚠️ [GroupChatLoop] ${agent.name} has no lifecycle, skipping`);
      return;
    }

    lifecycle.setCoordinator(this);

    // Restore any pending state from persistence
    if (this._pendingRestore?.has(agent.id)) {
      lifecycle.restore(this._pendingRestore.get(agent.id));
      this._pendingRestore.delete(agent.id);
    }

    lifecycle.start();
    this._lifecycles.set(agent.id, lifecycle);

    // NOTE: wakeUp() follows lazy-loading principle.
    // Employees are NOT woken up here — they will be automatically
    // woken up on their first chat() call via _ensureSession().
    // This avoids unnecessary session initialization for idle employees.

    console.log(`  🔄 [GroupChatLoop] ${agent.name} joined chat loop`);
  }

  /**
   * Stop the poll loop for an employee.
   */
  stopAgentLoop(agentId) {
    const lifecycle = this._lifecycles.get(agentId);
    if (lifecycle) {
      lifecycle.stop();
      this._lifecycles.delete(agentId);
    }
  }

  // ========================================================================
  // Triggering
  // ========================================================================

  /**
   * Trigger an employee to check a group (e.g. on @mention).
   * The employee will be lazily woken up via _ensureSession() when they chat().
   */
  async triggerImmediate(agentId, groupId, _triggerMessage) {
    if (!this.running || !this.company) return;
    const lifecycle = this._lifecycles.get(agentId);
    if (!lifecycle) return;
    await lifecycle.triggerCheck(groupId);
  }

  /**
   * Nudge an employee to check a group (lower urgency, used internally by lifecycles).
   * The employee will be lazily woken up via _ensureSession() when they chat().
   */
  async nudgeAgent(agentId, groupId) {
    if (!this.running || !this.company) return;
    const lifecycle = this._lifecycles.get(agentId);
    if (!lifecycle) {
      // Agent might not have a lifecycle yet (e.g. hasn't joined loop)
      // Try to find the employee and trigger directly
      const agent = this._findAgent(agentId);
      if (agent?.lifecycle) {
        agent.lifecycle.setCoordinator(this);
        await agent.lifecycle._processGroupMessages(groupId, false);
      }
      return;
    }
    // Use processGroupMessages directly (no mention flag)
    await lifecycle._processGroupMessages(groupId, false).catch(() => {});
  }

  // ========================================================================
  // Queries
  // ========================================================================

  /**
   * Get an employee's active monologue for a group.
   */
  getActiveMonologue(agentId, groupId) {
    const lifecycle = this._lifecycles.get(agentId);
    return lifecycle?.getActiveMonologue(groupId) || null;
  }

  /**
   * Get an employee's monologue history for a group.
   */
  getMonologueHistory(agentId, groupId, limit = 10) {
    const lifecycle = this._lifecycles.get(agentId);
    return lifecycle?.getMonologueHistory(groupId, limit) || [];
  }

  /**
   * Get all employees currently in flow state across all groups.
   */
  getActiveThinkingAgents() {
    const result = [];
    for (const [, lifecycle] of this._lifecycles) {
      result.push(...lifecycle.getActiveThinking());
    }
    return result;
  }

  // ========================================================================
  // Serialization
  // ========================================================================

  /**
   * Serialize all lifecycle states for persistence.
   */
  serialize() {
    // Aggregate all lifecycle states keyed by agentId
    // But we need backward-compatible format: flat maps keyed by `${agentId}:${groupId}`
    const lastReadIndex = {};
    const lastProcessedVisible = {};
    const agentMemory = {};

    for (const [agentId, lifecycle] of this._lifecycles) {
      const state = lifecycle.serialize();
      // Re-key from groupId to `${agentId}:${groupId}` for backward compat
      for (const [groupId, val] of Object.entries(state.lastReadIndex)) {
        lastReadIndex[`${agentId}:${groupId}`] = val;
      }
      for (const [groupId, val] of Object.entries(state.lastProcessedVisible)) {
        lastProcessedVisible[`${agentId}:${groupId}`] = val;
      }
      for (const [groupId, val] of Object.entries(state.agentMemory)) {
        agentMemory[`${agentId}:${groupId}`] = val;
      }
    }

    return { lastReadIndex, lastProcessedVisible, agentMemory };
  }

  /**
   * Restore lifecycle states from persistence data.
   * Called after employees are loaded — distributes state to each lifecycle.
   */
  restore(data) {
    if (!data) return;

    // Parse the flat `${agentId}:${groupId}` keys back into per-agent maps
    const perAgent = new Map(); // agentId → { lastReadIndex, lastProcessedVisible, agentMemory }

    const distribute = (flatMap, field) => {
      if (!flatMap) return;
      for (const [compositeKey, val] of Object.entries(flatMap)) {
        const sepIdx = compositeKey.indexOf(':');
        if (sepIdx === -1) continue;
        const agentId = compositeKey.slice(0, sepIdx);
        const groupId = compositeKey.slice(sepIdx + 1);
        if (!perAgent.has(agentId)) {
          perAgent.set(agentId, { lastReadIndex: {}, lastProcessedVisible: {}, agentMemory: {} });
        }
        perAgent.get(agentId)[field][groupId] = val;
      }
    };

    distribute(data.lastReadIndex, 'lastReadIndex');
    distribute(data.lastProcessedVisible, 'lastProcessedVisible');
    distribute(data.agentMemory, 'agentMemory');

    // Now distribute to lifecycles that are already registered
    for (const [agentId, agentData] of perAgent) {
      const lifecycle = this._lifecycles.get(agentId);
      if (lifecycle) {
        lifecycle.restore(agentData);
      } else {
        // Store for later — when the agent joins, we'll restore then
        if (!this._pendingRestore) this._pendingRestore = new Map();
        this._pendingRestore.set(agentId, agentData);
      }
    }
  }

  // ========================================================================
  // Internal helpers
  // ========================================================================

  /**
   * Find an employee by ID across all departments.
   */
  _findAgent(agentId) {
    if (!this.company) return null;
    for (const dept of this.company.departments.values()) {
      const agent = dept.agents.get(agentId);
      if (agent) return agent;
    }
    return null;
  }
}

// Global singleton
export const groupChatLoop = new GroupChatLoop();
