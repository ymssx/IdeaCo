import { BaseAgent } from './base-agent.js';
import { llmClient } from '../llm-client.js';
import { sessionManager } from '../session.js';

/**
 * LLMAgent - Agent powered by API-based LLM models (OpenAI, Claude, DeepSeek, etc.)
 * 
 * Uses a cloud LLM provider to execute tasks via chat completions with optional tool calling.
 */
export class LLMAgent extends BaseAgent {
  /**
   * @param {object} config - Same as BaseAgent config, plus:
   * @param {object} config.provider - Provider config from ProviderRegistry
   */
  constructor(config) {
    super(config);
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
      throw new Error(`LLMAgent "${this.name}" provider "${this.provider?.name}" is not available`);
    }
    const response = await llmClient.chat(this.provider, messages, options);
    this._trackUsage(response.usage);
    return response;
  }

  async chatWithTools(messages, toolExecutor, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(`LLMAgent "${this.name}" provider "${this.provider?.name}" is not available`);
    }
    return await llmClient.chatWithTools(this.provider, messages, toolExecutor, options);
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
        throw new Error(`Provider not available for agent "${this.name}"`);
      }

      const messages = [
        { role: 'system', content: this._buildSystemMessage() },
        { role: 'user', content: this._buildTaskMessage(task) },
      ];

      // Track in session
      const session = sessionManager.getOrCreate({
        agentId: this.id, channel: 'task', peerId: task.title, peerKind: 'task',
      });
      sessionManager.addMessage(session.sessionKey, {
        role: 'system', content: `Task started: ${task.title}`,
      });

      let response;
      if (this.toolKit && this.provider.category === 'general') {
        response = await this.chatWithTools(messages, this.toolKit, {
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

      result = {
        agentId: this.id,
        agentName: this.name,
        role: this.role,
        provider: this.provider.name,
        executionEngine: this.provider.name,
        taskTitle: task.title,
        output: response.content,
        toolResults: response.toolResults || [],
        duration: Date.now() - startTime,
        success: true,
        usage: response.usage || null,
      };

      if (result.usage) {
        this._trackUsage(result.usage);
      }
    } catch (error) {
      console.error(`  ❌ [${this.name}] Task execution failed: ${error.message}`);
      result = {
        agentId: this.id, agentName: this.name, role: this.role,
        provider: this.provider?.name || 'unknown',
        executionEngine: this.provider?.name || 'unknown',
        taskTitle: task.title,
        output: `Task execution failed: ${error.message}`,
        toolResults: [], duration: Date.now() - startTime,
        success: false, error: error.message,
      };
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

  _getCostPerToken() {
    return this.provider?.costPerToken || 0.001;
  }

  _serializeTypeFields() {
    return {
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
   * Restore LLMAgent from serialized data
   */
  static deserialize(data, providerRegistry) {
    // Get full provider object from registry
    let provider = data.provider;
    if (providerRegistry && data.provider?.id) {
      provider = providerRegistry.getById(data.provider.id) || data.provider;
    }

    const agent = new LLMAgent({
      name: data.name,
      role: data.role,
      prompt: data.prompt,
      skills: data.skills,
      provider,
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
