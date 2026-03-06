import { BaseAgent } from '../base-agent.js';
import { llmClient } from './client.js';

/**
 * LLMAgent — Communication engine powered by API-based LLM models.
 *
 * Pure communication layer: handles chat, tool-calling, provider management.
 * No business logic (identity, memory, tasks) — that's the Employee layer.
 */
export class LLMAgent extends BaseAgent {
  /**
   * @param {object} config
   * @param {object} config.provider - Provider config from ProviderRegistry
   */
  constructor(config) {
    super();
    this.provider = config.provider;
  }

  get agentType() {
    return 'llm';
  }

  isAvailable() {
    return !!(this.provider && this.provider.enabled && this.provider.apiKey);
  }

  canChat() {
    return this.isAvailable();
  }

  async chat(messages, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(`LLMAgent provider "${this.provider?.name}" is not available`);
    }
    return await llmClient.chat(this.provider, messages, options);
  }

  async chatWithTools(messages, toolExecutor, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(`LLMAgent provider "${this.provider?.name}" is not available`);
    }
    return await llmClient.chatWithTools(this.provider, messages, toolExecutor, options);
  }

  getDisplayInfo() {
    return {
      name: this.provider?.name || 'Unknown LLM',
      provider: this.provider?.provider || 'Unknown',
      model: this.provider?.model || 'unknown',
      type: 'llm',
      category: this.provider?.category || 'general',
    };
  }

  getProviderDisplayInfo() {
    return {
      id: this.provider?.id,
      name: this.provider?.name,
      provider: this.provider?.provider,
    };
  }

  switchProvider(newProvider) {
    this.provider = newProvider;
  }

  getCostPerToken() {
    return this.provider?.costPerToken || 0.001;
  }

  serializeAgent() {
    return {
      agentType: 'llm',
      provider: this.provider ? {
        id: this.provider.id,
        name: this.provider.name,
        provider: this.provider.provider,
        model: this.provider.model,
        category: this.provider.category,
        costPerToken: this.provider.costPerToken,
        enabled: this.provider.enabled,
      } : null,
    };
  }

  /**
   * Restore LLMAgent from serialized data.
   */
  static deserialize(data, providerRegistry) {
    let provider = data.provider;
    if (providerRegistry && data.provider?.id) {
      provider = providerRegistry.getById(data.provider.id) || data.provider;
    }
    return new LLMAgent({ provider });
  }
}
