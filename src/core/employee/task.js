/**
 * Task Manager — Employee task tracking system
 *
 * Employees can create tasks (via LLM taskOps in structured response),
 * track their status, and resolve/fail them. When a task is resolved,
 * the onResolve callback triggers the target conversation's normal
 * chat flow (not a mechanical write).
 *
 * Task types:
 *   - oneshot:     Resolve once, then done
 *   - long-running: Stays active until explicitly resolved/failed
 *   - conditional:  Has a condition description; LLM decides when it's met
 *
 * Urgency levels (based on createdAt age):
 *   - normal:   < 5 min
 *   - aging:    5–15 min   ⏳
 *   - overdue:  15–30 min  ⚠️
 *   - critical: > 30 min   🚨
 */

import { v4 as uuidv4 } from 'uuid';

// ─── Urgency thresholds (ms) ──────────────────────────────────────────
const URGENCY_THRESHOLDS = {
  aging:    5 * 60 * 1000,   // 5 min
  overdue:  15 * 60 * 1000,  // 15 min
  critical: 30 * 60 * 1000,  // 30 min
};

/**
 * Compute urgency level based on task age.
 * @param {Date} createdAt
 * @returns {'normal'|'aging'|'overdue'|'critical'}
 */
function computeUrgency(createdAt) {
  const age = Date.now() - new Date(createdAt).getTime();
  if (age >= URGENCY_THRESHOLDS.critical) return 'critical';
  if (age >= URGENCY_THRESHOLDS.overdue) return 'overdue';
  if (age >= URGENCY_THRESHOLDS.aging) return 'aging';
  return 'normal';
}

/**
 * Format urgency for prompt injection.
 * @param {'normal'|'aging'|'overdue'|'critical'} urgency
 * @param {number} ageMs - age in milliseconds
 * @returns {string}
 */
function formatUrgency(urgency, ageMs) {
  const mins = Math.round(ageMs / 60000);
  switch (urgency) {
    case 'aging':    return `⏳ AGING (${mins}min) — Follow up soon`;
    case 'overdue':  return `⚠️ OVERDUE (${mins}min) — Needs immediate attention`;
    case 'critical': return `🚨 CRITICAL (${mins}min) — Escalate or resolve NOW`;
    default:         return `${mins}min`;
  }
}

// ─── AgentTask ─────────────────────────────────────────────────────────

export class AgentTask {
  /**
   * @param {object} opts
   * @param {string} opts.description - What needs to be done
   * @param {'oneshot'|'long-running'|'conditional'} [opts.type='oneshot']
   * @param {string} [opts.condition] - For conditional tasks: when is it done?
   * @param {string} [opts.onResolveTarget] - Target chatGroupId to notify on resolve
   * @param {string} [opts.onResolveHint] - Hint for the LLM about what to do on resolve
   */
  constructor(opts) {
    this.id = opts.id || uuidv4();
    this.description = opts.description;
    this.type = opts.type || 'oneshot';
    this.condition = opts.condition || null;
    this.status = opts.status || 'pending';  // pending | resolved | failed
    this.result = opts.result || null;       // Resolution result text
    this.onResolveTarget = opts.onResolveTarget || null;
    this.onResolveHint = opts.onResolveHint || null;
    this.createdAt = opts.createdAt ? new Date(opts.createdAt) : new Date();
    this.resolvedAt = opts.resolvedAt ? new Date(opts.resolvedAt) : null;
  }

  /** Get current urgency level. */
  get urgency() {
    if (this.status !== 'pending') return 'normal';
    return computeUrgency(this.createdAt);
  }

  /** Get age in milliseconds. */
  get ageMs() {
    return Date.now() - this.createdAt.getTime();
  }

  resolve(result) {
    this.status = 'resolved';
    this.result = result || null;
    this.resolvedAt = new Date();
  }

  fail(reason) {
    this.status = 'failed';
    this.result = reason || null;
    this.resolvedAt = new Date();
  }

  serialize() {
    return {
      id: this.id,
      description: this.description,
      type: this.type,
      condition: this.condition,
      status: this.status,
      result: this.result,
      onResolveTarget: this.onResolveTarget,
      onResolveHint: this.onResolveHint,
      createdAt: this.createdAt.toISOString(),
      resolvedAt: this.resolvedAt ? this.resolvedAt.toISOString() : null,
    };
  }

  static deserialize(data) {
    return new AgentTask(data);
  }
}

// ─── TaskManager ───────────────────────────────────────────────────────

export class TaskManager {
  constructor() {
    /** @type {Map<string, AgentTask>} */
    this._tasks = new Map();
  }

  /**
   * Create a new task.
   * @param {object} opts - Same as AgentTask constructor
   * @returns {AgentTask}
   */
  create(opts) {
    const task = new AgentTask(opts);
    this._tasks.set(task.id, task);
    console.log(`  📋 [TaskManager] Created task: ${task.id} — ${task.description.slice(0, 80)}`);
    return task;
  }

  /**
   * Resolve a task by ID.
   * @param {string} taskId
   * @param {string} [result] - Resolution result
   * @returns {{ task: AgentTask, onResolveTarget: string|null, onResolveHint: string|null }|null}
   */
  resolve(taskId, result) {
    const task = this._tasks.get(taskId);
    if (!task || task.status !== 'pending') return null;
    task.resolve(result);
    console.log(`  ✅ [TaskManager] Resolved task: ${task.id} — ${(result || '').slice(0, 80)}`);
    return {
      task,
      onResolveTarget: task.onResolveTarget,
      onResolveHint: task.onResolveHint,
    };
  }

  /**
   * Fail a task by ID.
   * @param {string} taskId
   * @param {string} [reason]
   * @returns {AgentTask|null}
   */
  fail(taskId, reason) {
    const task = this._tasks.get(taskId);
    if (!task || task.status !== 'pending') return null;
    task.fail(reason);
    console.log(`  ❌ [TaskManager] Failed task: ${task.id} — ${(reason || '').slice(0, 80)}`);
    return task;
  }

  /**
   * Get all pending tasks.
   * @returns {AgentTask[]}
   */
  getPending() {
    return [...this._tasks.values()].filter(t => t.status === 'pending');
  }

  /**
   * Get a task by ID.
   * @param {string} taskId
   * @returns {AgentTask|null}
   */
  get(taskId) {
    return this._tasks.get(taskId) || null;
  }

  /**
   * Check if there are any pending tasks.
   * @returns {boolean}
   */
  hasPending() {
    for (const t of this._tasks.values()) {
      if (t.status === 'pending') return true;
    }
    return false;
  }

  /**
   * Build the prompt section for pending tasks (only injected when tasks exist).
   * Includes urgency escalation based on task age.
   * @returns {string} Prompt section or empty string
   */
  buildPendingTasksPrompt() {
    const pending = this.getPending();
    if (pending.length === 0) return '';

    let prompt = '\n## 📋 Your Pending Tasks\n';
    prompt += 'You have active tasks that need attention. Track their progress and resolve them when conditions are met.\n\n';

    for (const task of pending) {
      const urgency = task.urgency;
      const urgencyLabel = formatUrgency(urgency, task.ageMs);

      prompt += `### Task: ${task.id}\n`;
      prompt += `- **Description**: ${task.description}\n`;
      prompt += `- **Type**: ${task.type}\n`;
      prompt += `- **Age**: ${urgencyLabel}\n`;
      if (task.condition) {
        prompt += `- **Completion condition**: ${task.condition}\n`;
      }
      if (task.onResolveTarget) {
        prompt += `- **On resolve**: Notify conversation \`${task.onResolveTarget}\``;
        if (task.onResolveHint) prompt += ` — ${task.onResolveHint}`;
        prompt += '\n';
      }

      // Urgency-specific instructions
      if (urgency === 'aging') {
        prompt += `- ⏳ **This task has been pending for a while. Actively follow up or ask for updates.**\n`;
      } else if (urgency === 'overdue') {
        prompt += `- ⚠️ **This task is overdue! Prioritize resolving it. Ask directly if blocked.**\n`;
      } else if (urgency === 'critical') {
        prompt += `- 🚨 **CRITICAL: This task has been unresolved for too long! Take immediate action — escalate, ask again, or resolve/fail it now.**\n`;
      }
      prompt += '\n';
    }

    prompt += `To manage tasks, use the "taskOps" field in your response:\n`;
    prompt += `- Create: { "op": "create", "description": "...", "type": "oneshot|long-running|conditional", "condition": "...", "onResolveTarget": "chatGroupId", "onResolveHint": "what to tell them" }\n`;
    prompt += `- Resolve: { "op": "resolve", "taskId": "task-id", "result": "resolution details" }\n`;
    prompt += `- Fail: { "op": "fail", "taskId": "task-id", "reason": "why it failed" }\n`;

    return prompt;
  }

  /**
   * Process taskOps from LLM structured response.
   * @param {Array} ops - Array of task operations
   * @returns {{ created: AgentTask[], resolved: Array<{task: AgentTask, onResolveTarget: string|null, onResolveHint: string|null}>, failed: AgentTask[] }}
   */
  processOps(ops) {
    const result = { created: [], resolved: [], failed: [] };
    if (!Array.isArray(ops)) return result;

    for (const op of ops) {
      switch (op.op) {
        case 'create': {
          const task = this.create({
            description: op.description || 'Unnamed task',
            type: op.type || 'oneshot',
            condition: op.condition || null,
            onResolveTarget: op.onResolveTarget || null,
            onResolveHint: op.onResolveHint || null,
          });
          result.created.push(task);
          break;
        }
        case 'resolve': {
          if (!op.taskId) break;
          const resolved = this.resolve(op.taskId, op.result);
          if (resolved) result.resolved.push(resolved);
          break;
        }
        case 'fail': {
          if (!op.taskId) break;
          const failed = this.fail(op.taskId, op.reason);
          if (failed) result.failed.push(failed);
          break;
        }
        default:
          console.warn(`  ⚠️ [TaskManager] Unknown op: ${op.op}`);
      }
    }

    return result;
  }

  /**
   * Clean up old resolved/failed tasks (keep last N).
   * @param {number} [keepCount=20]
   */
  cleanup(keepCount = 20) {
    const done = [...this._tasks.values()]
      .filter(t => t.status !== 'pending')
      .sort((a, b) => (b.resolvedAt?.getTime() || 0) - (a.resolvedAt?.getTime() || 0));

    if (done.length > keepCount) {
      for (const task of done.slice(keepCount)) {
        this._tasks.delete(task.id);
      }
    }
  }

  // ─── Serialization ──────────────────────────────────────────────────

  serialize() {
    const tasks = [];
    for (const task of this._tasks.values()) {
      tasks.push(task.serialize());
    }
    return { tasks };
  }

  static deserialize(data) {
    const manager = new TaskManager();
    if (data?.tasks && Array.isArray(data.tasks)) {
      for (const taskData of data.tasks) {
        const task = AgentTask.deserialize(taskData);
        manager._tasks.set(task.id, task);
      }
    }
    return manager;
  }
}
