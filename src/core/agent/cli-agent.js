import { BaseAgent } from './base-agent.js';
import { llmClient } from '../llm-client.js';
import { cliBackendRegistry } from '../cli-backends/index.js';
import { sessionManager } from '../session.js';

/**
 * CLIAgent - Agent powered by local CLI coding assistants (CodeBuddy CLI, Claude Code, Codex).
 * 
 * Executes tasks by spawning CLI processes. Has an optional fallback LLM provider
 * for lightweight chat operations (reviews, discussions, self-intro, etc.).
 */
export class CLIAgent extends BaseAgent {
  /**
   * @param {object} config - Same as BaseAgent config, plus:
   * @param {string} config.cliBackend - CLI backend ID (e.g. 'codebuddy', 'claude-code')
   * @param {object} [config.cliProvider] - The CLI provider info (for display purposes)
   * @param {object} [config.fallbackProvider] - A real LLM provider for lightweight chat
   */
  constructor(config) {
    super(config);
    this.cliBackend = config.cliBackend;
    this.cliProvider = config.cliProvider || null;
    this.fallbackProvider = config.fallbackProvider || null;

    // Also keep provider field pointing to fallbackProvider for backward compat
    // (some external code reads agent.provider for cost/name info)
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

  /**
   * Set a fallback LLM provider for lightweight chat operations.
   */
  setFallbackProvider(provider) {
    if (provider && provider.enabled && provider.apiKey && !provider.isCLI) {
      this.fallbackProvider = provider;
      this.provider = provider;
    }
  }

  async chat(messages, options = {}) {
    if (!this.canChat()) {
      throw new Error(`CLIAgent "${this.name}" has no fallback LLM provider for chat`);
    }
    const response = await llmClient.chat(this.fallbackProvider, messages, options);
    this._trackUsage(response.usage);
    return response;
  }

  async chatWithTools(messages, toolExecutor, options = {}) {
    if (!this.canChat()) {
      throw new Error(`CLIAgent "${this.name}" has no fallback LLM provider for chatWithTools`);
    }
    return await llmClient.chatWithTools(this.fallbackProvider, messages, toolExecutor, options);
  }

  async executeTask(task, callbacks = {}) {
    this.status = 'working';
    const startTime = Date.now();
    const displayInfo = this.getDisplayInfo();

    console.log(`  🤖 [${this.name}] (${this.role}) starting task: "${task.title}"`);
    console.log(`     Engine: ${displayInfo.name} (${displayInfo.type})`);

    this.memory.addShortTerm(`Starting task: "${task.title}"`, 'task');

    let result;
    try {
      if (!this.isAvailable()) {
        throw new Error(`CLI backend "${this.cliBackend}" is not available`);
      }

      result = await this._executeCLITask(task, callbacks, startTime);
    } catch (error) {
      // If CLI failed, try LLM fallback
      if (this.canChat()) {
        console.log(`  ⚠️ [${this.name}] CLI execution failed, falling back to LLM API`);
        try {
          const messages = [
            { role: 'system', content: this._buildSystemMessage() },
            { role: 'user', content: this._buildTaskMessage(task) },
          ];
          const response = await this.chat(messages, { temperature: 0.7, maxTokens: 4096 });
          result = {
            agentId: this.id, agentName: this.name, role: this.role,
            provider: this.fallbackProvider?.name || 'fallback',
            executionEngine: `fallback:${this.fallbackProvider?.name || 'llm'}`,
            taskTitle: task.title, output: response.content,
            toolResults: [], duration: Date.now() - startTime, success: true,
          };
        } catch (fallbackError) {
          console.error(`  ❌ [${this.name}] LLM fallback also failed: ${fallbackError.message}`);
          result = this._buildFailResult(task, startTime, fallbackError.message);
        }
      } else {
        console.error(`  ❌ [${this.name}] Task execution failed: ${error.message}`);
        result = this._buildFailResult(task, startTime, error.message);
      }
    }

    // Record to short-term memory
    this.memory.addShortTerm(
      `Completed task: "${task.title}", took ${result.duration}ms, ${result.success ? 'succeeded' : 'failed'}`,
      'task'
    );

    if (result.toolResults && result.toolResults.length > 0) {
      const toolSummary = result.toolResults.map(t => `${t.tool}(${t.success ? '✓' : '✗'})`).join(', ');
      this.memory.addShortTerm(`Tool usage log: ${toolSummary}`, 'tool');
    }

    this.taskHistory.push({
      task: task.title,
      result,
      completedAt: new Date(),
    });

    this.status = 'idle';
    console.log(`  ✅ [${this.name}] Task complete, took ${result.duration}ms`);
    return result;
  }

  async _executeCLITask(task, callbacks, startTime) {
    const backend = cliBackendRegistry.backends.get(this.cliBackend);
    const wsDir = this.toolKit?.workspaceDir || process.cwd();

    // Track in session
    const session = sessionManager.getOrCreate({
      agentId: this.id, channel: 'cli-task', peerId: task.title, peerKind: 'task',
    });
    sessionManager.addMessage(session.sessionKey, {
      role: 'system', content: `CLI Task started: ${task.title} (via ${backend.config.name})`,
    });

    this.memory.addShortTerm(`Starting CLI task: "${task.title}" via ${backend.config.name}`, 'task');

    // Track output for heartbeat
    let outputLen = 0;
    let lastHeartbeat = Date.now();
    const HEARTBEAT_INTERVAL = 15000;

    const cliResult = await cliBackendRegistry.executeTask(
      this.cliBackend,
      this,
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
      metadata: { cliBackend: this.cliBackend, exitCode: cliResult.exitCode },
    });

    this.memory.addShortTerm(
      `CLI task completed: "${task.title}" via ${backend.config.name}, exit code ${cliResult.exitCode}, took ${cliResult.duration}ms`,
      'task'
    );

    return {
      agentId: this.id,
      agentName: this.name,
      role: this.role,
      provider: `CLI:${backend.config.name}`,
      executionEngine: `cli:${backend.config.name}`,
      taskTitle: task.title,
      output: cliResult.output || cliResult.errorOutput || 'CLI completed with no output',
      toolResults: [{
        tool: `cli:${this.cliBackend}`,
        args: { task: task.title },
        result: `Executed via ${backend.config.name}, exit code: ${cliResult.exitCode}`,
        success: cliResult.exitCode === 0,
      }],
      duration: cliResult.duration,
      success: cliResult.exitCode === 0,
      cliBackend: this.cliBackend,
      usage: null,
    };
  }

  _buildFailResult(task, startTime, errorMessage) {
    const displayInfo = this.getDisplayInfo();
    return {
      agentId: this.id, agentName: this.name, role: this.role,
      provider: displayInfo.name,
      executionEngine: displayInfo.name,
      taskTitle: task.title,
      output: `Task execution failed: ${errorMessage}`,
      toolResults: [], duration: Date.now() - startTime,
      success: false, error: errorMessage,
    };
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
      // Switching to another CLI provider
      this.cliBackend = newProvider.cliBackendId;
      this.cliProvider = newProvider;
    } else {
      // Switching fallback LLM provider
      this.fallbackProvider = newProvider;
      this.provider = newProvider;
    }
  }

  _getCostPerToken() {
    return this.fallbackProvider?.costPerToken || this.provider?.costPerToken || 0.001;
  }

  _serializeTypeFields() {
    return {
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
      // Backward compat: also serialize provider (points to fallback)
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
   * Restore CLIAgent from serialized data
   */
  static deserialize(data, providerRegistry) {
    // Get fallback provider from registry
    let fallbackProvider = data.fallbackProvider || null;
    if (fallbackProvider?.id && providerRegistry) {
      fallbackProvider = providerRegistry.getById(fallbackProvider.id) || fallbackProvider;
    }

    // Get provider (backward compat — may be the same as fallbackProvider)
    let provider = data.provider || null;
    if (provider?.id && providerRegistry) {
      provider = providerRegistry.getById(provider.id) || provider;
    }

    // Get cliProvider reference from registry
    let cliProvider = data.cliProvider || null;
    if (cliProvider?.id && providerRegistry) {
      cliProvider = providerRegistry.getById(cliProvider.id) || cliProvider;
    }

    const agent = new CLIAgent({
      name: data.name,
      role: data.role,
      prompt: data.prompt,
      skills: data.skills,
      cliBackend: data.cliBackend,
      cliProvider,
      fallbackProvider: fallbackProvider || provider,
      provider: provider || fallbackProvider,
      department: data.department,
      reportsTo: data.reportsTo,
      memory: data.memory,
      avatar: data.avatar,
      signature: data.signature,
      gender: data.gender,
      age: data.age,
      avatarParams: data.avatarParams,
      personality: data.personality || undefined,
      templateId: data.templateId || null,
    });

    agent._restoreState(data);
    return agent;
  }
}
