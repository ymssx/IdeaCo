/**
 * Agent module — pure communication engine layer.
 *
 * Agents handle ONLY: LLM/CLI/Web communication, provider management, availability.
 * Business logic (identity, memory, tasks, org) lives in the Employee layer.
 *
 * Usage:
 *   import { createAgent, LLMAgent, CLIAgent, WebAgent } from './agent/index.js';
 */

import { BaseAgent } from './base-agent.js';
import { LLMAgent } from './llm-agent/index.js';
import { CLIAgent } from './cli-agent/index.js';
import { WebAgent } from './web-agent/index.js';

/**
 * Create an agent from config. Auto-picks LLMAgent, CLIAgent, or WebAgent.
 * @param {object} config
 * @returns {BaseAgent}
 */
export function createAgent(config) {
  if (config.cliBackend) {
    return new CLIAgent({
      ...config,
      fallbackProvider: config.provider,
    });
  }
  if (config.provider?.isWeb) {
    return new WebAgent(config);
  }
  return new LLMAgent(config);
}

/**
 * Deserialize an agent from saved data. Auto-detects type.
 * @param {object} data
 * @param {object} [providerRegistry]
 * @returns {BaseAgent}
 */
export function deserializeAgent(data, providerRegistry) {
  if (data.agentType === 'cli' || data.cliBackend || data.brain?.type === 'cli') {
    // Legacy brain data conversion
    if (!data.cliBackend && data.brain?.backendId) {
      data.cliBackend = data.brain.backendId;
    }
    if (!data.cliProvider && data.brain?.cliProvider) {
      data.cliProvider = data.brain.cliProvider;
    }
    if (!data.fallbackProvider && data.brain?.fallbackProvider) {
      data.fallbackProvider = data.brain.fallbackProvider;
    }
    return CLIAgent.deserialize(data, providerRegistry);
  }
  if (data.agentType === 'web' || data.provider?.isWeb) {
    return WebAgent.deserialize(data, providerRegistry);
  }
  return LLMAgent.deserialize(data, providerRegistry);
}

export { BaseAgent, LLMAgent, CLIAgent, WebAgent };
