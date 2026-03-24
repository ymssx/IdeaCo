import { BaseAgent } from '../base-agent.js';
import { webClientRegistry } from './web-client.js';

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
   * Since web APIs don't support native function calling, we simulate it
   * by embedding tool definitions in the prompt and parsing structured output.
   */
  async chatWithTools(messages, toolExecutor, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(`WebAgent provider "${this.provider?.name}" is not available`);
    }

    const maxIterations = options.maxIterations || 5;
    const onToolCall = options.onToolCall || null;
    const conversationMessages = [...messages];
    const toolResults = [];

    // Inject tool definitions into system message
    const toolDefs = toolExecutor.definitions || [];
    if (toolDefs.length > 0) {
      const toolsPrompt = this._buildToolsPrompt(toolDefs);
      // Prepend to first system message or add new one
      const sysIdx = conversationMessages.findIndex(m => m.role === 'system');
      if (sysIdx >= 0) {
        conversationMessages[sysIdx] = {
          ...conversationMessages[sysIdx],
          content: conversationMessages[sysIdx].content + '\n\n' + toolsPrompt,
        };
      } else {
        conversationMessages.unshift({ role: 'system', content: toolsPrompt });
      }
    }

    for (let i = 0; i < maxIterations; i++) {
      // Only force new conversation on the first iteration; subsequent iterations reuse
      const iterOptions = i === 0 ? options : { ...options, newConversation: false };
      const response = await this.chat(conversationMessages, iterOptions);

      // Try to parse tool calls from the response
      const parsedCalls = this._parseToolCalls(response.content);

      if (!parsedCalls || parsedCalls.length === 0) {
        // No tool calls found — this is the final response
        return {
          content: response.content,
          toolResults,
          messages: conversationMessages,
          usage: response.usage,
        };
      }

      // Process extracted tool calls
      conversationMessages.push({ role: 'assistant', content: response.content });

      const callResultTexts = [];
      for (const call of parsedCalls) {
        if (onToolCall) {
          try { onToolCall({ tool: call.name, args: call.args, status: 'start' }); } catch {}
        }

        let result;
        try {
          result = await toolExecutor.execute(call.name, call.args);
          toolResults.push({ tool: call.name, args: call.args, result, success: true });
          if (onToolCall) {
            try { onToolCall({ tool: call.name, args: call.args, status: 'done', success: true }); } catch {}
          }
        } catch (error) {
          result = `Tool execution error: ${error.message}`;
          toolResults.push({ tool: call.name, args: call.args, error: error.message, success: false });
          if (onToolCall) {
            try { onToolCall({ tool: call.name, args: call.args, status: 'error', error: error.message }); } catch {}
          }
        }

        callResultTexts.push(
          `[Tool Result: ${call.name}]\n${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`
        );
      }

      // Feed tool results back with clear instruction to summarize
      const resultsPayload = callResultTexts.join('\n\n');
      conversationMessages.push({
        role: 'user',
        content: `The tool(s) you requested have been executed. Here are the results:\n\n${resultsPayload}\n\nPlease review the tool results above. If you need more information or need to run additional tools to complete the task, go ahead and call them. If you have enough information, provide a complete, helpful answer to the user's original question.`,
      });
    }

    // Exceeded max iterations — one final call without tool prompt (reuse conversation)
    const finalResponse = await this.chat(conversationMessages, { ...options, newConversation: false });
    return {
      content: finalResponse.content,
      toolResults,
      messages: conversationMessages,
      usage: finalResponse.usage,
    };
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

You have access to the following tools. To use a tool, include a tool call block in your response using this exact format:

\`\`\`tool_call
{"name": "tool_name", "args": {"param1": "value1"}}
\`\`\`

You can make multiple tool calls in a single response. After receiving tool results, continue your work.

${toolDescriptions}`;
  }

  /**
   * Parse tool calls from LLM text response.
   * Looks for ```tool_call blocks, DSML-style blocks, and other XML tool call formats.
   */
  _parseToolCalls(content) {
    if (!content) return null;
    const calls = [];

    // 1. Standard ```tool_call blocks
    const regex = /```tool_call\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.name) {
          calls.push({ name: parsed.name, args: parsed.args || {} });
        }
      } catch {
        // Skip malformed tool calls
      }
    }

    // 2. DSML format: <｜DSML｜function_calls> ... </｜DSML｜function_calls>
    const dsmlBlockRegex = /<[｜|]DSML[｜|]function_calls>([\s\S]*?)(?:<\/[｜|]DSML[｜|]function_calls>|$)/g;
    let blockMatch;
    while ((blockMatch = dsmlBlockRegex.exec(content)) !== null) {
      const block = blockMatch[1];
      const invokeRegex = /<[｜|]DSML[｜|]invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)(?:<\/[｜|]DSML[｜|]invoke>|$)/g;
      let invokeMatch;
      while ((invokeMatch = invokeRegex.exec(block)) !== null) {
        const toolName = invokeMatch[1];
        const paramsBlock = invokeMatch[2];
        const args = {};
        const paramRegex = /<[｜|]DSML[｜|]parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)(?:<\/[｜|]DSML[｜|]parameter>|$)/g;
        let paramMatch;
        while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
          const paramValue = paramMatch[2].trim();
          try { args[paramMatch[1]] = JSON.parse(paramValue); } catch { args[paramMatch[1]] = paramValue; }
        }
        if (toolName) calls.push({ name: toolName, args });
      }
    }

    // 3. XML <function_call>JSON</function_call> and <tool_call>JSON</tool_call>
    for (const tag of ['function_call', 'tool_call']) {
      const xmlRegex = new RegExp(`<${tag}>([\\s\\S]*?)(?:<\\/${tag}>|$)`, 'g');
      let xmlMatch;
      while ((xmlMatch = xmlRegex.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(xmlMatch[1].trim());
          if (parsed.name) calls.push({ name: parsed.name, args: parsed.arguments || parsed.args || {} });
        } catch { /* skip */ }
      }
    }

    return calls.length > 0 ? calls : null;
  }

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
