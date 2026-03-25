import { BaseAgent } from '../base-agent.js';
import { webClientRegistry } from './web-client.js';
import { ToolLoop } from '../tool-loop.js';

/**
 * WebAgent — Communication engine powered by browser DOM automation.
 *
 * Opens a hidden Electron BrowserWindow, lets the user log in once, then controls
 * the web chat interface (e.g. ChatGPT web, Claude web) via DOM scripting.
 * No API key required — uses the user's existing subscription.
 *
 * Limitations vs LLMAgent:
 * - No native tool calling (web UIs don't expose function calling)
 * - Simulates tool calls by embedding tool definitions in the system prompt
 * - Session may expire and need re-login
 */
export class WebAgent extends BaseAgent {
  /**
   * @param {object} config
   * @param {object} config.provider - Web provider config
   */
  constructor(config) {
    super();
    this.provider = config.provider;
    // Employee ID for per-employee session isolation (set by Employee layer)
    this._employeeId = null;
  }

  /**
   * Set the employee ID for session isolation.
   * Called by the Employee layer to bind this agent to a specific employee.
   * @param {string} employeeId
   */
  setEmployeeId(employeeId) {
    this._employeeId = employeeId;
  }

  get agentType() {
    return 'web';
  }

  isAvailable() {
    // DOM mode: Electron manages cookies via Chromium session, no explicit cookie field needed
    return !!(this.provider && this.provider.enabled);
  }

  canChat() {
    return this.isAvailable();
  }

  async chat(messages, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(`WebAgent provider "${this.provider?.name}" is not available`);
    }
    return await webClientRegistry.chat(this.provider.id, messages, {
      ...options,
      model: this.provider.webModel || this.provider.model,
      sessionId: this._employeeId || options.sessionId || null,
    });
  }

  /**
   * Reset the ChatGPT conversation for this employee's session.
   * Next chat will start a new conversation.
   */
  resetConversation() {
    if (this.provider?.id) {
      webClientRegistry.resetConversation(this.provider.id, this._employeeId || undefined);
    }
  }

  /**
   * Check if this employee's session needs a new conversation (too many messages).
   * @param {number} [maxMessages]
   * @returns {boolean}
   */
  needsNewSession(maxMessages) {
    if (!this.provider?.id || !this._employeeId) return false;
    return webClientRegistry.needsNewSession(this.provider.id, this._employeeId, maxMessages);
  }

  /**
   * WebAgent's chatWithTools implementation.
   * Since web APIs don't support native function calling, tool definitions are
   * embedded in the system prompt. The LLM responds with JSON actions, and
   * ToolLoop handles execution via the unified JSON actions protocol.
   */
  async chatWithTools(messages, toolExecutor, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(`WebAgent provider "${this.provider?.name}" is not available`);
    }

    // Web agents: inject tool definitions into the system prompt since
    // the web chat API doesn't support native tool_calls.
    const messagesWithTools = [...messages];
    const toolDefs = toolExecutor.definitions || [];
    if (toolDefs.length > 0) {
      const toolsPrompt = this._buildToolsPrompt(toolDefs);
      const sysIdx = messagesWithTools.findIndex(m => m.role === 'system');
      if (sysIdx >= 0) {
        messagesWithTools[sysIdx] = {
          ...messagesWithTools[sysIdx],
          content: messagesWithTools[sysIdx].content + '\n\n' + toolsPrompt,
        };
      } else {
        messagesWithTools.unshift({ role: 'system', content: toolsPrompt });
      }
    }

    // Track iteration for newConversation control
    let callCount = 0;
    const loop = new ToolLoop({
      chatFn: async (msgs, chatOpts) => {
        const iterOptions = callCount === 0 ? options : { ...options, newConversation: false };
        callCount++;
        const response = await this.chat(msgs, { ...chatOpts, ...iterOptions });
        // Web agents return plain text (no toolCalls field).
        // ToolLoop detects JSON actions in the response content.
        return { content: response.content, toolCalls: null, usage: response.usage };
      },
      toolExecutor,
      maxIterations: options.maxIterations || 5,
      taskContext: options.taskContext || null,
      activeTiers: options.activeTiers || null,
    });

    return loop.run(messagesWithTools, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      _agentId: options._agentId,
      _agentName: options._agentName,
      onToolCall: options.onToolCall || null,
      onLLMCall: options.onLLMCall || null,
    });
  }

  /**
   * Build a prompt section that describes available tools.
   */
  _buildToolsPrompt(toolDefs) {
    const toolDescriptions = toolDefs.map(t => {
      const params = t.function?.parameters?.properties || {};
      const required = t.function?.parameters?.required || [];
      const paramList = Object.entries(params).map(([name, schema]) => {
        const req = required.includes(name) ? ' (required)' : ' (optional)';
        return `  - ${name}${req}: ${schema.description || schema.type || ''}`;
      }).join('\n');
      return `### ${t.function.name}\n${t.function.description || ''}\nParameters:\n${paramList}`;
    }).join('\n\n');

    return `## Available Tools

You have access to the following tools. To use a tool, include it in the "actions" array of your JSON response:

{ "actions": [{ "tool": "tool_name", "args": { "param1": "value1" } }] }

You can call multiple tools in one response. After receiving tool results, continue your work.
Set "actions" to [] when no tool calls are needed.

${toolDescriptions}`;
  }

  // NOTE: All tool execution is now handled by ToolLoop via the unified JSON actions protocol.

  getDisplayInfo() {
    return {
      name: this.provider?.name || 'Unknown Web Provider',
      provider: this.provider?.provider || 'Web',
      model: this.provider?.webModel || this.provider?.model || 'unknown',
      type: 'web',
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
    return 0; // Web-based, no direct token cost
  }

  serializeAgent() {
    return {
      agentType: 'web',
      provider: this.provider ? {
        id: this.provider.id,
        name: this.provider.name,
        provider: this.provider.provider,
        model: this.provider.model,
        webModel: this.provider.webModel,
        category: this.provider.category,
        costPerToken: 0,
        enabled: this.provider.enabled,
        isWeb: true,
      } : null,
    };
  }

  /**
   * Restore WebAgent from serialized data.
   */
  static deserialize(data, providerRegistry) {
    let provider = data.provider;
    if (providerRegistry && data.provider?.id) {
      provider = providerRegistry.getById(data.provider.id) || data.provider;
    }
    return new WebAgent({ provider });
  }
}
