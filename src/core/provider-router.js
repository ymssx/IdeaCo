/**
 * Provider Router - Intelligent multi-provider routing with automatic fallback
 * 
 * Distilled from OpenClaw's routing system (vendor/openclaw/src/routing/)
 * Re-implemented with enterprise simulation context: providers as "outsourcing vendors"
 * 
 * Features:
 * - Automatic fallback when primary provider fails
 * - Round-robin / priority-based / cost-optimized routing strategies
 * - Health tracking per provider with cooldown on failures
 * - Rate limiting awareness
 */

/**
 * Routing strategy enum
 */
export const RoutingStrategy = {
  PRIORITY: 'priority',       // Use highest-priority provider first, fallback on failure
  ROUND_ROBIN: 'round-robin', // Distribute load evenly across providers
  COST_OPT: 'cost-optimized', // Prefer cheapest provider that can handle the task
  LATENCY: 'latency',         // Prefer provider with lowest recent latency
};

/**
 * Provider health status
 */
const ProviderHealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  DOWN: 'down',
  COOLDOWN: 'cooldown',
};

/**
 * Provider Router - Routes LLM requests to the best available provider
 */
export class ProviderRouter {
  /**
   * @param {object} options
   * @param {string} options.strategy - Routing strategy
   * @param {number} options.maxRetries - Max retry attempts across providers
   * @param {number} options.cooldownMs - Cooldown period after provider failure (ms)
   * @param {Function} options.onFallback - Callback when falling back to another provider
   */
  constructor(options = {}) {
    this.strategy = options.strategy || RoutingStrategy.PRIORITY;
    this.maxRetries = options.maxRetries ?? 3;
    this.cooldownMs = options.cooldownMs ?? 60000; // 1 minute cooldown
    this.onFallback = options.onFallback || null;

    // Health tracking per provider
    // { providerId: { status, failCount, lastFailure, avgLatency, totalCalls, totalFailures } }
    this.healthMap = new Map();

    // Round-robin index tracker
    this.rrIndex = new Map(); // category -> index
  }

  /**
   * Get or initialize health record for a provider
   * @param {string} providerId
   * @returns {object} Health record
   */
  _getHealth(providerId) {
    if (!this.healthMap.has(providerId)) {
      this.healthMap.set(providerId, {
        status: ProviderHealthStatus.HEALTHY,
        failCount: 0,
        lastFailure: null,
        avgLatency: 0,
        totalCalls: 0,
        totalFailures: 0,
        latencyHistory: [], // Recent latency samples
      });
    }
    return this.healthMap.get(providerId);
  }

  /**
   * Record a successful call
   * @param {string} providerId
   * @param {number} latencyMs - Call duration in milliseconds
   */
  recordSuccess(providerId, latencyMs = 0) {
    const health = this._getHealth(providerId);
    health.totalCalls++;
    health.failCount = 0;
    health.status = ProviderHealthStatus.HEALTHY;

    // Update latency tracking (keep last 10 samples)
    if (latencyMs > 0) {
      health.latencyHistory.push(latencyMs);
      if (health.latencyHistory.length > 10) health.latencyHistory.shift();
      health.avgLatency = health.latencyHistory.reduce((a, b) => a + b, 0) / health.latencyHistory.length;
    }
  }

  /**
   * Record a failed call
   * @param {string} providerId
   * @param {Error} error
   */
  recordFailure(providerId, error) {
    const health = this._getHealth(providerId);
    health.totalCalls++;
    health.totalFailures++;
    health.failCount++;
    health.lastFailure = Date.now();

    // Progressive degradation: 1 fail = degraded, 3+ fails = down/cooldown
    if (health.failCount >= 3) {
      health.status = ProviderHealthStatus.COOLDOWN;
    } else if (health.failCount >= 1) {
      health.status = ProviderHealthStatus.DEGRADED;
    }

    console.warn(`[ProviderRouter] Provider ${providerId} failed (${health.failCount}x): ${error.message}`);
  }

  /**
   * Check if a provider is available (not in cooldown)
   * @param {string} providerId
   * @returns {boolean}
   */
  isAvailable(providerId) {
    const health = this._getHealth(providerId);

    if (health.status === ProviderHealthStatus.COOLDOWN) {
      // Check if cooldown period has elapsed
      if (health.lastFailure && (Date.now() - health.lastFailure) > this.cooldownMs) {
        // Reset to degraded for retry
        health.status = ProviderHealthStatus.DEGRADED;
        health.failCount = 0;
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Select the best provider based on current strategy
   * @param {Array} providers - Available provider configs (already filtered by category & enabled)
   * @param {string} category - Job category for round-robin tracking
   * @returns {Array} Ordered list of providers to try
   */
  route(providers, category = 'general') {
    if (!providers || providers.length === 0) return [];

    // Filter out providers in cooldown
    const available = providers.filter(p => this.isAvailable(p.id));
    if (available.length === 0) {
      // All in cooldown - reset the one with oldest failure to give it a chance
      const sorted = [...providers].sort((a, b) => {
        const ha = this._getHealth(a.id);
        const hb = this._getHealth(b.id);
        return (ha.lastFailure || 0) - (hb.lastFailure || 0);
      });
      sorted[0] && this._getHealth(sorted[0].id).status === ProviderHealthStatus.DEGRADED;
      return sorted;
    }

    switch (this.strategy) {
      case RoutingStrategy.PRIORITY:
        return this._routeByPriority(available);

      case RoutingStrategy.ROUND_ROBIN:
        return this._routeByRoundRobin(available, category);

      case RoutingStrategy.COST_OPT:
        return this._routeByCost(available);

      case RoutingStrategy.LATENCY:
        return this._routeByLatency(available);

      default:
        return available;
    }
  }

  /** Priority-based routing: highest rating first */
  _routeByPriority(providers) {
    return [...providers].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  /** Round-robin routing: distribute evenly */
  _routeByRoundRobin(providers, category) {
    const idx = (this.rrIndex.get(category) || 0) % providers.length;
    this.rrIndex.set(category, idx + 1);

    // Rotate the array so the next provider is first
    const rotated = [...providers.slice(idx), ...providers.slice(0, idx)];
    return rotated;
  }

  /** Cost-optimized routing: cheapest first */
  _routeByCost(providers) {
    return [...providers].sort((a, b) => (a.priceLevel || 2) - (b.priceLevel || 2));
  }

  /** Latency-based routing: lowest average latency first */
  _routeByLatency(providers) {
    return [...providers].sort((a, b) => {
      const ha = this._getHealth(a.id);
      const hb = this._getHealth(b.id);
      return (ha.avgLatency || 9999) - (hb.avgLatency || 9999);
    });
  }

  /**
   * Execute a request with automatic fallback across providers
   * @param {Array} providers - Candidate providers
   * @param {Function} executor - async (provider) => result - The actual LLM call
   * @param {string} category - Job category
   * @returns {Promise<{result: any, provider: object, attempts: number}>}
   */
  async executeWithFallback(providers, executor, category = 'general') {
    const ordered = this.route(providers, category);

    if (ordered.length === 0) {
      throw new Error('[ProviderRouter] No available providers for this request');
    }

    let lastError = null;
    let attempts = 0;

    for (const provider of ordered) {
      if (attempts >= this.maxRetries) break;
      attempts++;

      const startTime = Date.now();
      try {
        const result = await executor(provider);
        const latency = Date.now() - startTime;
        this.recordSuccess(provider.id, latency);

        return { result, provider, attempts };
      } catch (error) {
        this.recordFailure(provider.id, error);
        lastError = error;

        // Notify about fallback
        if (this.onFallback && attempts < ordered.length) {
          const nextProvider = ordered[attempts];
          try {
            this.onFallback({
              failedProvider: provider,
              nextProvider,
              error,
              attempt: attempts,
            });
          } catch {}
        }
      }
    }

    throw new Error(
      `[ProviderRouter] All providers failed after ${attempts} attempts. Last error: ${lastError?.message}`
    );
  }

  /**
   * Get health dashboard for all tracked providers
   * @returns {Array} Health status of all providers
   */
  getHealthDashboard() {
    const dashboard = [];
    for (const [providerId, health] of this.healthMap.entries()) {
      dashboard.push({
        providerId,
        status: health.status,
        avgLatency: Math.round(health.avgLatency),
        totalCalls: health.totalCalls,
        totalFailures: health.totalFailures,
        successRate: health.totalCalls > 0
          ? Math.round((1 - health.totalFailures / health.totalCalls) * 100)
          : 100,
        failCount: health.failCount,
        lastFailure: health.lastFailure,
      });
    }
    return dashboard;
  }

  /**
   * Reset health tracking for a provider
   * @param {string} providerId
   */
  resetHealth(providerId) {
    this.healthMap.delete(providerId);
  }

  /**
   * Reset all health tracking
   */
  resetAll() {
    this.healthMap.clear();
    this.rrIndex.clear();
  }
}

// Global singleton
export const providerRouter = new ProviderRouter();
