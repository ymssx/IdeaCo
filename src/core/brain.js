/**
 * AgentBrain - Abstract base class for Agent execution backends.
 * 
 * Different employees use different "brains" to think and work:
 * - LLMBrain: API-based LLM models (OpenAI, Claude, DeepSeek, etc.)
 * - CLIBrain: Local CLI coding assistants (CodeBuddy CLI, Claude Code, Codex)
 * - Future: RemoteBrain, OpenClawBrain, etc.
 * 
 * All brains expose the same API so the business layer doesn't need to
 * know which type of brain an agent has.
 */

import { llmClient } from './llm-client.js';
import { cliBackendRegistry } from './cli-backends/index.js';
import { sessionManager } from './session.js';

// ============================================================================
// Abstract Base Class
// ============================================================================

export class AgentBrain {
  constructor(type) {
    if (new.target === AgentBrain) {
      throw new Error('AgentBrain is abstract and cannot be instantiated directly');
    }
    this.type = type; // 'llm' | 'cli' | 'remote' | ...
  }

  /**
   * Whether this brain is currently available for use.
   * @returns {boolean}
   */
  isAvailable() {
    throw new Error('Subclass must implement isAvailable()');
  }

  /**
   * Whether this brain can do lightweight LLM-style chat (review, discuss, etc.)
   * CLI brains cannot do this natively — they need a fallback LLM provider.
   * @returns {boolean}
   */
  canChat() {
    throw new Error('Subclass must implement canChat()');
  }

  /**
   * Send a chat request (for reviews, discussions, intros, message replies, etc.)
   * 
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [options] - { temperature, maxTokens }
   * @returns {Promise<{content: string, usage: object|null}>}
   */
  async chat(messages, options = {}) {
    throw new Error('Subclass must implement chat()');
  }

  /**
   * Send a chat request with tool calling support.
   * 
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} toolExecutor - AgentToolKit instance
   * @param {object} [options] - { maxIterations, temperature, onToolCall, onLLMCall }
   * @returns {Promise<{content: string, toolResults: Array, usage: object|null}>}
   */
  async chatWithTools(messages, toolExecutor, options = {}) {
    throw new Error('Subclass must implement chatWithTools()');
  }

  /**
   * Execute a full task (the heavy-duty work method).
   * For LLM brains this delegates to chat/chatWithTools.
   * For CLI brains this spawns the CLI process.
   * 
   * @param {object} agent - The Agent instance (for identity, memory, workspace)
   * @param {object} task - { title, description, context, requirements }
   * @param {object} [callbacks] - { onToolCall, onLLMCall, onOutput, onError }
   * @returns {Promise<object>} Task result
   */
  async executeTask(agent, task, callbacks = {}) {
    throw new Error('Subclass must implement executeTask()');
  }

  /**
   * Get display info about this brain (for UI and logging).
   * @returns {{ name: string, provider: string, model: string, type: string }}
   */
  getDisplayInfo() {
    throw new Error('Subclass must implement getDisplayInfo()');
  }

  /**
   * Serialize brain config for persistence.
   * @returns {object}
   */
  serialize() {
    throw new Error('Subclass must implement serialize()');
  }

  /**
   * Create a Brain instance from serialized data.
   * @param {object} data - Serialized brain data
   * @param {object} [providerRegistry] - For resolving provider references
   * @returns {AgentBrain}
   */
  static deserialize(data, providerRegistry) {
    if (!data || !data.type) {
      // Legacy fallback: if no brain data, return null (caller will handle)
      return null;
    }
    switch (data.type) {
      case 'llm':
        return LLMBrain.deserialize(data, providerRegistry);
      case 'cli':
        return CLIBrain.deserialize(data, providerRegistry);
      default:
        console.warn(`Unknown brain type: ${data.type}`);
        return null;
    }
  }
}

// ============================================================================
// LLMBrain - API-based LLM models
// ============================================================================

export class LLMBrain extends AgentBrain {
  /**
   * @param {object} provider - Provider config from ProviderRegistry
   */
  constructor(provider) {
    super('llm');
    this.provider = provider;
  }

  isAvailable() {
    return !!(this.provider && this.provider.enabled && this.provider.apiKey);
  }

  canChat() {
    return this.isAvailable();
  }

  async chat(messages, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(`LLMBrain provider "${this.provider?.name}" is not available`);
    }
    return await llmClient.chat(this.provider, messages, options);
  }

  async chatWithTools(messages, toolExecutor, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(`LLMBrain provider "${this.provider?.name}" is not available`);
    }
    return await llmClient.chatWithTools(this.provider, messages, toolExecutor, options);
  }

  async executeTask(agent, task, callbacks = {}) {
    const startTime = Date.now();
    const messages = [
      { role: 'system', content: agent._buildSystemMessage() },
      { role: 'user', content: agent._buildTaskMessage(task) },
    ];

    // Track in session
    const session = sessionManager.getOrCreate({
      agentId: agent.id, channel: 'task', peerId: task.title, peerKind: 'task',
    });
    sessionManager.addMessage(session.sessionKey, {
      role: 'system', content: `Task started: ${task.title}`,
    });

    let response;
    if (agent.toolKit && this.provider.category === 'general') {
      response = await this.chatWithTools(messages, agent.toolKit, {
        maxIterations: 5,
        temperature: 0.7,
        onToolCall: callbacks.onToolCall || null,
        onLLMCall: callbacks.onLLMCall || null,
      });
    } else {
      response = await this.chat(messages, { temperature: 0.7, maxTokens: 4096 });
    }

    // Track session
    sessionManager.addMessage(session.sessionKey, {
      role: 'assistant', content: response.content?.slice(0, 200) || '',
      metadata: { toolCount: response.toolResults?.length || 0 },
    });
    if (response.usage) {
      sessionManager.recordTokenUsage(session.sessionKey, response.usage.prompt_tokens || 0, response.usage.completion_tokens || 0);
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      provider: this.provider.name,
      executionEngine: this.provider.name,
      taskTitle: task.title,
      output: response.content,
      toolResults: response.toolResults || [],
      duration: Date.now() - startTime,
      success: true,
      usage: response.usage || null,
    };
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

  serialize() {
    return {
      type: 'llm',
      providerId: this.provider?.id,
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

  static deserialize(data, providerRegistry) {
    let provider = data.provider;
    if (providerRegistry && data.providerId) {
      provider = providerRegistry.getById(data.providerId) || provider;
    }
    return new LLMBrain(provider);
  }
}

// ============================================================================
// CLIBrain - Local CLI coding assistants
// ============================================================================

export class CLIBrain extends AgentBrain {
  /**
   * @param {string} backendId - CLI backend ID (e.g. 'codebuddy', 'claude-code')
   * @param {object} [cliProvider] - The CLI provider info (for display purposes)
   * @param {object} [fallbackProvider] - A real LLM provider for lightweight chat (reviews, etc.)
   */
  constructor(backendId, cliProvider = null, fallbackProvider = null) {
    super('cli');
    this.backendId = backendId;
    this.cliProvider = cliProvider;
    this.fallbackProvider = fallbackProvider; // For chat/review when no CLI needed
  }

  isAvailable() {
    const backend = cliBackendRegistry.backends.get(this.backendId);
    return !!(backend && (backend.state === 'detected' || backend.state === 'configured'));
  }

  canChat() {
    // CLI brains can chat if they have a fallback LLM provider
    return !!(this.fallbackProvider && this.fallbackProvider.enabled && this.fallbackProvider.apiKey && !this.fallbackProvider.isCLI);
  }

  /**
   * Set a fallback LLM provider for lightweight chat operations.
   * Called by the system when department peers are available.
   */
  setFallbackProvider(provider) {
    if (provider && provider.enabled && provider.apiKey && !provider.isCLI) {
      this.fallbackProvider = provider;
    }
  }

  async chat(messages, options = {}) {
    if (!this.canChat()) {
      throw new Error(`CLIBrain "${this.backendId}" has no fallback LLM provider for chat`);
    }
    return await llmClient.chat(this.fallbackProvider, messages, options);
  }

  async chatWithTools(messages, toolExecutor, options = {}) {
    if (!this.canChat()) {
      throw new Error(`CLIBrain "${this.backendId}" has no fallback LLM provider for chatWithTools`);
    }
    return await llmClient.chatWithTools(this.fallbackProvider, messages, toolExecutor, options);
  }

  async executeTask(agent, task, callbacks = {}) {
    if (!this.isAvailable()) {
      throw new Error(`CLI backend "${this.backendId}" is not available`);
    }

    const backend = cliBackendRegistry.backends.get(this.backendId);
    const startTime = Date.now();
    const wsDir = agent.toolKit?.workspaceDir || process.cwd();

    // Track in session
    const session = sessionManager.getOrCreate({
      agentId: agent.id, channel: 'cli-task', peerId: task.title, peerKind: 'task',
    });
    sessionManager.addMessage(session.sessionKey, {
      role: 'system', content: `CLI Task started: ${task.title} (via ${backend.config.name})`,
    });

    agent.memory.addShortTerm(`Starting CLI task: "${task.title}" via ${backend.config.name}`, 'task');

    // Track output for heartbeat
    let outputLen = 0;
    let lastHeartbeat = Date.now();
    const HEARTBEAT_INTERVAL = 15000;

    const cliResult = await cliBackendRegistry.executeTask(
      this.backendId,
      agent,
      task,
      wsDir,
      {
        onOutput: (chunk) => {
          outputLen += chunk.length;
          const now = Date.now();
          if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
            lastHeartbeat = now;
            const elapsed = Math.round((now - startTime) / 1000);
            if (callbacks.onToolCall) {
              try { callbacks.onToolCall({ tool: 'cli_progress', args: { elapsed, outputLen, backend: backend.config.name }, status: 'start' }); } catch {}
            }
          }
        },
        onError: (chunk) => {
          console.warn(`  [CLI stderr] ${chunk.slice(0, 200)}`);
        },
        onComplete: (result) => {
          if (callbacks.onToolCall) {
            try { callbacks.onToolCall({ tool: 'cli_complete', args: { backend: backend.config.name, exitCode: result.exitCode }, status: 'done', success: result.exitCode === 0 }); } catch {}
          }
        },
      }
    );

    // Track in session
    sessionManager.addMessage(session.sessionKey, {
      role: 'assistant', content: cliResult.output?.slice(0, 500) || '',
      metadata: { cliBackend: this.backendId, exitCode: cliResult.exitCode },
    });

    agent.memory.addShortTerm(
      `CLI task completed: "${task.title}" via ${backend.config.name}, exit code ${cliResult.exitCode}, took ${cliResult.duration}ms`,
      'task'
    );

    return {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      provider: `CLI:${backend.config.name}`,
      executionEngine: `cli:${backend.config.name}`,
      taskTitle: task.title,
      output: cliResult.output || cliResult.errorOutput || 'CLI completed with no output',
      toolResults: [{
        tool: `cli:${this.backendId}`,
        args: { task: task.title },
        result: `Executed via ${backend.config.name}, exit code: ${cliResult.exitCode}`,
        success: cliResult.exitCode === 0,
      }],
      duration: cliResult.duration,
      success: cliResult.exitCode === 0,
      cliBackend: this.backendId,
      usage: null,
    };
  }

  getDisplayInfo() {
    const backend = cliBackendRegistry.backends.get(this.backendId);
    return {
      name: this.cliProvider?.name || backend?.config?.name || this.backendId,
      provider: 'Local CLI',
      model: backend?.config?.execCommand || this.backendId,
      type: 'cli',
      category: 'cli',
      backendId: this.backendId,
    };
  }

  serialize() {
    return {
      type: 'cli',
      backendId: this.backendId,
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
    };
  }

  static deserialize(data, providerRegistry) {
    let cliProvider = data.cliProvider || null;
    if (cliProvider?.id && providerRegistry) {
      cliProvider = providerRegistry.getById(cliProvider.id) || cliProvider;
    }
    let fallbackProvider = data.fallbackProvider || null;
    if (fallbackProvider?.id && providerRegistry) {
      fallbackProvider = providerRegistry.getById(fallbackProvider.id) || fallbackProvider;
    }
    return new CLIBrain(data.backendId, cliProvider, fallbackProvider);
  }
}
