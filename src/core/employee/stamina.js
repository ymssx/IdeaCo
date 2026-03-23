/**
 * Stamina System — Fatigue & Comfort Tracking for Employees
 *
 * Gives agents an awareness of resource expenditure and emotional state.
 * Three base metrics (patience, fatigue, stress) combine into a single
 * comfort score that drives behavioural adaptations:
 *
 *   Comfort = patience - (fatigue * 0.4 + stress * 0.6)
 *
 * Zones:
 *   Green  (comfort > 70) — Normal operation
 *   Yellow (comfort 40-70) — Strategy adjustment, prompt injection
 *   Red    (comfort < 40)  — Forced reflection, escalation
 */

const CLAMP = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));

// ─── Event deltas ───────────────────────────────────────────────────────
const EVENTS = {
  // Chat / LLM interactions
  llmCall:           { patience: 0,   fatigue: 2,   stress: 0   },
  toolCall:          { patience: 0,   fatigue: 1,   stress: 0   },

  // Task lifecycle
  taskAssigned:      { patience: 10,  fatigue: 0,   stress: 0   },
  taskComplete:      { patience: 20,  fatigue: -15, stress: -15 },
  taskFail:          { patience: -10, fatigue: 10,  stress: 25  },

  // Review outcomes
  reviewPass:        { patience: 15,  fatigue: -10, stress: -20 },
  reviewReject1:     { patience: -10, fatigue: 5,   stress: 15  },
  reviewReject2:     { patience: -20, fatigue: 10,  stress: 20  },
  reviewReject3Plus: { patience: -30, fatigue: 15,  stress: 30  },

  // Rebuttal outcomes
  rebuttalAccepted:  { patience: 10,  fatigue: -5,  stress: -15 },
  rebuttalRejected:  { patience: -15, fatigue: 5,   stress: 20  },

  // Chat sentiment (from relationship affinity analysis)
  chatPositive:      { patience: 5,   fatigue: -3,  stress: -5  },
  chatNegative:      { patience: -8,  fatigue: 3,   stress: 10  },
  chatNeutral:       { patience: 0,   fatigue: 0,   stress: 0   },

  // Repetition detection (spinning on same issue)
  repetitionDetected:{ patience: -15, fatigue: 10,  stress: 10  },

  // Token budget pressure
  tokenThreshold:    { patience: 0,   fatigue: 20,  stress: 10  },

  // Natural recovery (applied on successful task transitions)
  naturalRecovery:   { patience: 5,   fatigue: -5,  stress: -5  },
};

export class StaminaSystem {
  constructor() {
    this.patience = 100;
    this.fatigue = 0;
    this.stress = 0;

    // Event history for display & debugging
    this.history = [];       // { event, deltas, timestamp, comfort }
    this.maxHistory = 50;

    // Repetition tracking: nodeId → [{ feedback, approachHash, timestamp }]
    this._repetitionTracker = new Map();
  }

  // ─── Core computed properties ──────────────────────────────────────

  /** Overall comfort score (0-100). Higher = better. */
  get comfort() {
    return CLAMP(this.patience - (this.fatigue * 0.4 + this.stress * 0.6));
  }

  /** Current zone: 'green' | 'yellow' | 'red' */
  get zone() {
    const c = this.comfort;
    if (c > 70) return 'green';
    if (c > 40) return 'yellow';
    return 'red';
  }

  // ─── Event handlers ────────────────────────────────────────────────

  /** Apply a named event. Returns the resulting zone. */
  _applyEvent(eventName, meta = {}) {
    const deltas = EVENTS[eventName];
    if (!deltas) return this.zone;

    const before = { patience: this.patience, fatigue: this.fatigue, stress: this.stress };
    this.patience = CLAMP(this.patience + deltas.patience);
    this.fatigue  = CLAMP(this.fatigue  + deltas.fatigue);
    this.stress   = CLAMP(this.stress   + deltas.stress);

    const entry = {
      event: eventName,
      deltas: { ...deltas },
      before,
      after: { patience: this.patience, fatigue: this.fatigue, stress: this.stress },
      comfort: this.comfort,
      zone: this.zone,
      timestamp: Date.now(),
      meta,
    };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    return this.zone;
  }

  // Convenience event methods
  onLLMCall()           { return this._applyEvent('llmCall'); }
  onToolCall()          { return this._applyEvent('toolCall'); }
  onTaskAssigned(title) { return this._applyEvent('taskAssigned', { title }); }
  onTaskComplete(title) { return this._applyEvent('taskComplete', { title }); }
  onTaskFail(title)     { return this._applyEvent('taskFail', { title }); }
  onReviewPass(title)   { return this._applyEvent('reviewPass', { title }); }
  onRebuttalAccepted()  { return this._applyEvent('rebuttalAccepted'); }
  onRebuttalRejected()  { return this._applyEvent('rebuttalRejected'); }
  onTokenThreshold()    { return this._applyEvent('tokenThreshold'); }
  onNaturalRecovery()   { return this._applyEvent('naturalRecovery'); }

  /**
   * Review rejection — escalating impact based on round number.
   * @param {number} round - Review round (1-based)
   * @param {string} [title]
   */
  onReviewReject(round, title) {
    const eventName = round <= 1 ? 'reviewReject1'
      : round === 2 ? 'reviewReject2'
      : 'reviewReject3Plus';
    return this._applyEvent(eventName, { round, title });
  }

  /**
   * Chat sentiment event — called after processing relationship impressions.
   * Analyses affinity change direction to determine sentiment.
   * @param {'positive'|'negative'|'neutral'} sentiment
   * @param {object} [meta] - e.g. { from, affinityDelta }
   */
  onChatSentiment(sentiment, meta = {}) {
    const eventName = sentiment === 'positive' ? 'chatPositive'
      : sentiment === 'negative' ? 'chatNegative'
      : 'chatNeutral';
    return this._applyEvent(eventName, meta);
  }

  // ─── Repetition detection ──────────────────────────────────────────

  /**
   * Track a revision attempt for a workflow node.
   * If the same approach is being repeated, flags it as spinning.
   * @param {string} nodeId
   * @param {string} feedback - Reviewer's feedback (truncated)
   * @param {string} approach - Brief description of the approach taken
   * @returns {boolean} true if spinning was detected
   */
  trackRevision(nodeId, feedback, approach) {
    if (!this._repetitionTracker.has(nodeId)) {
      this._repetitionTracker.set(nodeId, []);
    }
    const history = this._repetitionTracker.get(nodeId);

    // Simple keyword overlap detection
    const isSpinning = history.length >= 2 && this._isSimilar(
      history[history.length - 1].approach,
      approach
    );

    history.push({
      feedback: (feedback || '').slice(0, 200),
      approach: (approach || '').slice(0, 200),
      timestamp: Date.now(),
    });

    // Keep only last 5 attempts
    if (history.length > 5) {
      this._repetitionTracker.set(nodeId, history.slice(-5));
    }

    if (isSpinning) {
      this._applyEvent('repetitionDetected', { nodeId });
      return true;
    }
    return false;
  }

  /** Clear repetition tracking for a node (e.g. when review passes). */
  clearRepetition(nodeId) {
    this._repetitionTracker.delete(nodeId);
  }

  /** Simple keyword overlap similarity check. */
  _isSimilar(a, b) {
    if (!a || !b) return false;
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return false;
    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }
    return overlap / Math.max(wordsA.size, wordsB.size) > 0.6;
  }

  // ─── Behavioural queries ───────────────────────────────────────────

  /** Whether the agent should escalate (ask for help). */
  shouldEscalate()     { return this.comfort < 30; }

  /** Whether the agent should be forced to reflect before continuing. */
  shouldForceReflect() { return this.comfort < 40; }

  /** Whether the agent should reduce iteration scope. */
  shouldReduceScope()  { return this.comfort < 60; }

  /**
   * Get prompt injection text based on current zone.
   * Injected into revision/rebuttal prompts to guide agent behaviour.
   * Always includes long-term cost awareness; yellow/red zones add tactical guidance.
   * @returns {string} Prompt text or empty string (green zone, high comfort)
   */
  getPromptInjection() {
    const c = this.comfort;

    // Long-term cost awareness is ALWAYS injected (even in green zone)
    // — the agent must internalize that every action has a cost.
    const costAwareness = `\n\n[COST AWARENESS — Comfort: ${c}/100]
Every action you take has a cost — LLM calls, tool invocations, revision rounds, and cognitive load all accumulate.
Before choosing an approach, evaluate its LONG-TERM MAINTENANCE COST:
- Will this solution require frequent adjustments later? If yes, find a more robust alternative now.
- Are you choosing the quick fix that will cause repeated work, or the right fix that solves it once?
- If the current path will lead to more review rounds, more stress, and more token spend downstream, it is NOT the optimal path — even if it looks easier right now.
- Think in terms of TOTAL LIFETIME COST, not just immediate effort. A slightly harder approach now that prevents 5 future revision cycles is the better investment.
Always choose the path that minimizes your future fatigue and maximizes long-term throughput.`;

    if (c > 70) return costAwareness;

    if (c > 40) {
      // Yellow zone — add tactical adjustment guidance
      return `${costAwareness}\n\n[STAMINA WARNING — Yellow Zone]
You have been spending significant resources on this task. Before continuing:
1. Is your current approach fundamentally flawed? Consider trying something completely different.
2. Are you repeating the same fix that keeps getting rejected? If so, STOP and rethink from scratch.
3. Focus on the ROOT CAUSE, not surface symptoms.
4. If the reviewer keeps rejecting correct work, push back with evidence instead of making unnecessary changes.
5. Ask yourself: will my next action REDUCE or INCREASE my future workload? Only proceed if it reduces it.`;
    }

    // Red zone — forced reflection + escalation
    return `${costAwareness}\n\n[STAMINA CRITICAL — Red Zone]
You are approaching burnout on this task. MANDATORY before proceeding:

[REFLECTION REQUIRED]
1. What have I been doing that is not working?
2. Why is it not working — what is the fundamental issue?
3. What completely different approach should I try?
4. Should I escalate this to someone else or request help?
5. Am I trapped in a local minimum — doing the same type of work expecting different results?

Rules in this state:
- Do NOT repeat any approach you have already tried.
- Do NOT apologize — verify independently and defend correct work.
- If you have been rejected 3+ times for the same issue, the reviewer may be wrong. Verify and push back.
- Consider asking a colleague for a second opinion.
- Refuse to continue a path that has proven costly. Pivot or escalate.`;
  }

  /**
   * Get the suggested maxIterations for tool-use tasks based on zone.
   * Green = 5, Yellow = 3, Red = 2
   */
  getMaxIterations() {
    if (this.comfort > 70) return 5;
    if (this.comfort > 40) return 3;
    return 2;
  }

  /**
   * Get a cost-aware summary string for inclusion in task planning prompts.
   * Gives the agent a sense of accumulated cost so far.
   */
  getCostSummary() {
    const recentEvents = this.history.slice(-10);
    const llmCalls = recentEvents.filter(e => e.event === 'llmCall').length;
    const toolCalls = recentEvents.filter(e => e.event === 'toolCall').length;
    const rejections = recentEvents.filter(e => e.event.startsWith('reviewReject')).length;
    const repetitions = recentEvents.filter(e => e.event === 'repetitionDetected').length;
    return {
      recentLLMCalls: llmCalls,
      recentToolCalls: toolCalls,
      recentRejections: rejections,
      recentRepetitions: repetitions,
      comfort: this.comfort,
      zone: this.zone,
      message: this.comfort < 40
        ? 'High accumulated cost. Strongly consider changing approach or escalating.'
        : this.comfort < 70
          ? 'Moderate cost accumulation. Evaluate whether current approach is optimal.'
          : 'Cost levels normal. Proceed with awareness.',
    };
  }

  // ─── Summary for display ───────────────────────────────────────────

  /** Return a snapshot for API / frontend display. */
  getSummary() {
    return {
      patience: this.patience,
      fatigue: this.fatigue,
      stress: this.stress,
      comfort: this.comfort,
      zone: this.zone,
      history: this.history.slice(-20).map(h => ({
        event: h.event,
        deltas: h.deltas,
        comfort: h.comfort,
        zone: h.zone,
        timestamp: h.timestamp,
        meta: h.meta,
      })),
    };
  }

  // ─── Serialization ─────────────────────────────────────────────────

  serialize() {
    return {
      patience: this.patience,
      fatigue: this.fatigue,
      stress: this.stress,
      history: this.history.slice(-30),
      repetitionTracker: Object.fromEntries(this._repetitionTracker),
    };
  }

  static deserialize(data) {
    const s = new StaminaSystem();
    if (!data) return s;
    s.patience = typeof data.patience === 'number' ? CLAMP(data.patience) : 100;
    s.fatigue  = typeof data.fatigue  === 'number' ? CLAMP(data.fatigue)  : 0;
    s.stress   = typeof data.stress   === 'number' ? CLAMP(data.stress)   : 0;
    s.history  = Array.isArray(data.history) ? data.history.slice(-50) : [];
    if (data.repetitionTracker && typeof data.repetitionTracker === 'object') {
      for (const [k, v] of Object.entries(data.repetitionTracker)) {
        s._repetitionTracker.set(k, v);
      }
    }
    return s;
  }
}
