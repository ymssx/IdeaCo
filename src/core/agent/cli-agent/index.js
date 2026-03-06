import { BaseAgent } from '../base-agent.js';
import { llmClient } from '../llm-agent/client.js';
import { cliBackendRegistry } from './backends/index.js';

/**
 * CLIAgent — Communication engine powered by local CLI coding assistants.
 *
 * Pure communication layer: handles CLI execution, fallback LLM chat, provider management.
 * No business logic (identity, memory, tasks) — that's the Employee layer.
 */
export class CLIAgent extends BaseAgent {
  /**
   * @param {object} config
   * @param {string} config.cliBackend - CLI backend ID
   * @param {object} [config.cliProvider] - CLI provider info (for display)
   * @param {object} [config.fallbackProvider] - LLM provider for lightweight chat
   */
  constructor(config) {
    super();
    this.cliBackend = config.cliBackend;
    this.cliProvider = config.cliProvider || null;
    this.fallbackProvider = config.fallbackProvider || null;
    // Backward compat: some external code reads agent.provider
    this.provider = config.fallbackProvider || config.provider || null;
  }

  get agentType() {
    return 'cli';
  }

  isAvailable() {
    const backend = cliBackendRegistry.backends.get(this.cliBackend);
    return !!(backend && (backend.state === 'detected' || backend.state === 'configured'));
  }

  canChat() {
    return !!(this.fallbackProvider && this.fallbackProvider.enabled && this.fallbackProvider.apiKey && !this.fallbackProvider.isCLI);
  }

  setFallbackProvider(provider) {
    if (provider && provider.enabled && provider.apiKey && !provider.isCLI) {
      this.fallbackProvider = provider;
      this.provider = provider;
    }
  }

  async chat(messages, options = {}) {
    if (!this.canChat()) {
      throw new Error(`CLIAgent has no fallback LLM provider for chat`);
    }
    return await llmClient.chat(this.fallbackProvider, messages, options);
  }

  async chatWithTools(messages, toolExecutor, options = {}) {
    if (!this.canChat()) {
      throw new Error(`CLIAgent has no fallback LLM provider for chatWithTools`);
    }
    return await llmClient.chatWithTools(this.fallbackProvider, messages, toolExecutor, options);
  }

  getDisplayInfo() {
    const backend = cliBackendRegistry.backends.get(this.cliBackend);
    return {
      name: this.cliProvider?.name || backend?.config?.name || this.cliBackend,
      provider: 'Local CLI',
      model: backend?.config?.execCommand || this.cliBackend,
      type: 'cli',
      category: 'cli',
      backendId: this.cliBackend,
    };
  }

  getProviderDisplayInfo() {
    return {
      id: this.cliProvider?.id,
      name: this.cliProvider?.name,
      provider: this.cliProvider?.provider || 'Local CLI',
    };
  }

  getFallbackProviderName() {
    return this.fallbackProvider?.name || this.provider?.name || null;
  }

  switchProvider(newProvider) {
    if (newProvider.isCLI && newProvider.cliBackendId) {
      this.cliBackend = newProvider.cliBackendId;
      this.cliProvider = newProvider;
    } else {
      this.fallbackProvider = newProvider;
      this.provider = newProvider;
    }
  }

  getCostPerToken() {
    return this.fallbackProvider?.costPerToken || this.provider?.costPerToken || 0.001;
  }

  serializeAgent() {
    return {
      agentType: 'cli',
      cliBackend: this.cliBackend,
      cliProvider: this.cliProvider ? {
        id: this.cliProvider.id,
        name: this.cliProvider.name,
        provider: this.cliProvider.provider,
        model: this.cliProvider.model,
      } : null,
      fallbackProvider: this.fallbackProvider ? {
        id: this.fallbackProvider.id,
        name: this.fallbackProvider.name,
        provider: this.fallbackProvider.provider,
        model: this.fallbackProvider.model,
        category: this.fallbackProvider.category,
        costPerToken: this.fallbackProvider.costPerToken,
        enabled: this.fallbackProvider.enabled,
      } : null,
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
   * Restore CLIAgent from serialized data.
   */
  static deserialize(data, providerRegistry) {
    let fallbackProvider = data.fallbackProvider || null;
    if (fallbackProvider?.id && providerRegistry) {
      fallbackProvider = providerRegistry.getById(fallbackProvider.id) || fallbackProvider;
    }
    let provider = data.provider || null;
    if (provider?.id && providerRegistry) {
      provider = providerRegistry.getById(provider.id) || provider;
    }
    let cliProvider = data.cliProvider || null;
    if (cliProvider?.id && providerRegistry) {
      cliProvider = providerRegistry.getById(cliProvider.id) || cliProvider;
    }

    return new CLIAgent({
      cliBackend: data.cliBackend,
      cliProvider,
      fallbackProvider: fallbackProvider || provider,
      provider: provider || fallbackProvider,
    });
  }
}
