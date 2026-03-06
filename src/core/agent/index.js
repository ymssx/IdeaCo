/**
 * Agent module — unified entry point.
 * 
 * External code imports from here and NEVER needs to know the concrete agent type.
 * 
 * Usage:
 *   import { Agent, createAgent } from './agent/index.js';
 *   const agent = createAgent(recruitConfig);   // auto-picks LLMAgent or CLIAgent
 *   const restored = Agent.deserialize(data, providerRegistry);  // auto-picks type
 * 
 * The exported `Agent` is a namespace object with a static `deserialize()` method,
 * keeping the same external API as before.
 */

import { BaseAgent } from './base-agent.js';
import { LLMAgent } from './llm-agent.js';
import { CLIAgent } from './cli-agent.js';

/**
 * Create an agent from a recruit config object.
 * Automatically picks the correct subclass based on config.
 * 
 * @param {object} config - Recruit config (from HR.recruit() or similar)
 * @returns {BaseAgent} An LLMAgent or CLIAgent instance
 */
export function createAgent(config) {
  if (config.cliBackend) {
    return new CLIAgent({
      ...config,
      fallbackProvider: config.provider, // HR sets provider to fallback for CLI agents
    });
  }
  return new LLMAgent(config);
}

/**
 * The `Agent` namespace — provides backward-compatible static methods.
 * 
 * External code that did `new Agent(config)` should migrate to `createAgent(config)`.
 * External code that did `Agent.deserialize(data, reg)` continues to work unchanged.
 */
export const Agent = {
  /**
   * Restore an agent from serialized data. Auto-detects type.
   * 
   * @param {object} data - Serialized agent data
   * @param {object} [providerRegistry] - For resolving provider references
   * @returns {BaseAgent}
   */
  deserialize(data, providerRegistry) {
    // New format: agentType field
    if (data.agentType === 'cli') {
      return CLIAgent.deserialize(data, providerRegistry);
    }
    if (data.agentType === 'llm') {
      return LLMAgent.deserialize(data, providerRegistry);
    }

    // Backward compat: no agentType field — infer from data shape
    if (data.cliBackend) {
      return CLIAgent.deserialize(data, providerRegistry);
    }

    // Also check legacy brain data
    if (data.brain?.type === 'cli') {
      // Convert legacy brain data to CLIAgent fields
      if (!data.cliBackend && data.brain.backendId) {
        data.cliBackend = data.brain.backendId;
      }
      if (!data.cliProvider && data.brain.cliProvider) {
        data.cliProvider = data.brain.cliProvider;
      }
      if (!data.fallbackProvider && data.brain.fallbackProvider) {
        data.fallbackProvider = data.brain.fallbackProvider;
      }
      return CLIAgent.deserialize(data, providerRegistry);
    }

    // Default: LLM agent
    return LLMAgent.deserialize(data, providerRegistry);
  },
};

// Re-export classes for advanced usage (type checking, instanceof, etc.)
export { BaseAgent, LLMAgent, CLIAgent };
