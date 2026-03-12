/**
 * Unified LLM Client - Makes real API calls to various model providers
 * 
 * Supports: OpenAI/GPT, Anthropic/Claude, DeepSeek, and other OpenAI-compatible APIs
 * as well as image models like DALL-E, Midjourney
 */
import OpenAI from 'openai';
import { auditLogger, AuditCategory, AuditLevel } from '../../system/audit.js';
import { hookRegistry, HookEvent } from '../../../lib/hooks.js';

/**
 * Create an API client based on provider configuration
 * @param {object} provider - Provider config object
 * @returns {object} API client instance
 */
function createClient(provider) {
  const { id, apiKey, baseURL, isCustomOpenAI } = provider;

  // Custom OpenAI-compatible provider with custom baseURL
  if (isCustomOpenAI && baseURL) {
    return new OpenAI({
      apiKey: apiKey || 'not-needed', // Some private models may not need API key
      baseURL,
    });
  }

  // OpenAI series (GPT, DALL-E)
  if (id.startsWith('openai-')) {
    return new OpenAI({ apiKey });
  }

  // Anthropic Claude - via OpenAI-compatible interface
  if (id.startsWith('anthropic-')) {
    return new OpenAI({
      apiKey,
      baseURL: 'https://api.anthropic.com/v1',
      defaultHeaders: {
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
    });
  }

  // DeepSeek - OpenAI-compatible interface
  if (id.startsWith('deepseek-')) {
    return new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com',
    });
  }

  // Qwen (Tongyi Qianwen) - Alibaba Cloud DashScope OpenAI-compatible interface
  if (id.startsWith('qwen-')) {
    return new OpenAI({
      apiKey,
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  }

  // Default: use OpenAI-compatible interface
  return new OpenAI({ apiKey });
}

/**
 * Get model name for a given provider
 */
function getModelName(provider) {
  const modelMap = {
    'openai-gpt4': 'gpt-4-turbo',
    'openai-gpt35': 'gpt-3.5-turbo',
    'anthropic-claude': 'claude-3-5-sonnet-20241022',
    'deepseek-v3': 'deepseek-chat',
    'qwen-max': 'qwen-max',
  };
  return modelMap[provider.id] || provider.model || 'gpt-4-turbo';
}

/**
 * Unified LLM communication client
 */
export class LLMClient {
  constructor() {
    // Cache created client instances
    this.clients = new Map();
  }

  /**
   * Get or create an API client
   */
  _getClient(provider) {
    // Custom OpenAI-compatible providers can have just baseURL without API key
    if (provider.isCustomOpenAI) {
      if (!provider.apiKey && !provider.baseURL) {
        throw new Error(`Provider ${provider.name} has neither API Key nor baseURL configured`);
      }
    } else if (!provider.apiKey) {
      throw new Error(`Provider ${provider.name} has no API Key configured`);
    }
    
    if (!this.clients.has(provider.id)) {
      this.clients.set(provider.id, createClient(provider));
    }
    return this.clients.get(provider.id);
  }

  /**
   * Send chat messages (general text models)
   * 
   * @param {object} provider - Provider config
   * @param {Array<{role: string, content: string}>} messages - Message list
   * @param {object} [options] - Extra options
   * @param {string[]} [options.tools] - Available tool definitions
   * @param {number} [options.temperature] - Temperature
   * @param {number} [options.maxTokens] - Max tokens
   * @returns {Promise<{content: string, toolCalls: Array|null, usage: object}>}
   */
  async chat(provider, messages, options = {}) {
    const client = this._getClient(provider);
    const model = getModelName(provider);

    const requestParams = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    };

    // Add tool definitions to request if provided
    if (options.tools && options.tools.length > 0) {
      requestParams.tools = options.tools;
      requestParams.tool_choice = 'auto';
    }

    const startTime = Date.now();
    try {
      // Fire hook: LLM request start
      hookRegistry.trigger(HookEvent.LLM_REQUEST_START, {
        providerId: provider.id, model, agentId: options._agentId,
      });

      const response = await client.chat.completions.create(requestParams);
      const choice = response.choices[0];
      const latency = Date.now() - startTime;

      // Audit log the LLM request
      auditLogger.log({
        category: AuditCategory.LLM_REQUEST,
        level: AuditLevel.INFO,
        agentId: options._agentId || 'system',
        agentName: options._agentName || '',
        action: `LLM call: ${provider.name} (${model}) - ${latency}ms`,
        details: { providerId: provider.id, model, latency, usage: response.usage },
      });

      // Fire hook: LLM request end + token usage
      hookRegistry.trigger(HookEvent.LLM_REQUEST_END, {
        providerId: provider.id, model, latency,
        usage: response.usage, agentId: options._agentId,
      });
      if (response.usage) {
        hookRegistry.trigger(HookEvent.LLM_TOKEN_USAGE, {
          providerId: provider.id, model,
          promptTokens: response.usage.prompt_tokens || 0,
          completionTokens: response.usage.completion_tokens || 0,
          totalTokens: response.usage.total_tokens || 0,
        });
      }

      return {
        content: choice.message.content || '',
        toolCalls: choice.message.tool_calls || null,
        finishReason: choice.finish_reason,
        usage: response.usage || {},
      };
    } catch (error) {
      // Fire hook: LLM error
      hookRegistry.trigger(HookEvent.LLM_ERROR, {
        providerId: provider.id, model, error: error.message,
        agentId: options._agentId,
      });
      console.error(`[LLMClient] Call to ${provider.name} failed:`, error.message);
      throw new Error(`LLM call failed (${provider.name}): ${error.message}`);
    }
  }

  /**
   * Multi-turn conversation (with tool call loop)
   * Core method for Agent task execution: send message -> model may call tools -> execute tools -> continue conversation
   * 
   * @param {object} provider - Provider config
   * @param {Array} messages - Initial messages
   * @param {object} toolExecutor - Tool executor { definitions, execute(name, args) }
   * @param {object} [options] - Options
   * @param {number} [options.maxIterations] - Max tool call loop iterations
   * @returns {Promise<{content: string, toolResults: Array, messages: Array}>}
   */
  async chatWithTools(provider, messages, toolExecutor, options = {}) {
    const maxIterations = options.maxIterations || 5;    const onToolCall = options.onToolCall || null;  // Callback: notify on tool call
    const onLLMCall = options.onLLMCall || null;    // Callback: notify on each LLM call
    const conversationMessages = [...messages];
    const toolResults = [];

    for (let i = 0; i < maxIterations; i++) {
      // Notify: about to call LLM
      if (onLLMCall) {
        try { onLLMCall({ iteration: i + 1, maxIterations }); } catch {}
      }

      const response = await this.chat(provider, conversationMessages, {
        tools: toolExecutor.definitions,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      });

      // If no tool calls, return final result
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          content: response.content,
          toolResults,
          messages: conversationMessages,
          usage: response.usage,
        };
      }

      // Process tool calls
      conversationMessages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        const { name, arguments: argsStr } = toolCall.function;
        let args;
        try {
          args = JSON.parse(argsStr);
        } catch (parseErr) {
          console.warn(`  ⚠️ [Tool Call] Failed to parse arguments for ${name}: ${argsStr?.slice(0, 200)}`);
          try {
            const cleaned = (argsStr || '{}').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/'/g, '"');
            args = JSON.parse(cleaned);
          } catch {
            args = {};
          }
        }

        console.log(`  🔧 [Tool Call] ${name}(${JSON.stringify(args).slice(0, 100)}...)`);

        // Notify: calling tool
        if (onToolCall) {
          try { onToolCall({ tool: name, args, status: 'start' }); } catch {}
        }

        let result;
        try {
          result = await toolExecutor.execute(name, args);
          toolResults.push({ tool: name, args, result, success: true });
          if (onToolCall) {
            try { onToolCall({ tool: name, args, status: 'done', success: true }); } catch {}
          }
        } catch (error) {
          result = `Tool execution error: ${error.message}`;
          toolResults.push({ tool: name, args, error: error.message, success: false });
          if (onToolCall) {
            try { onToolCall({ tool: name, args, status: 'error', error: error.message }); } catch {}
          }
        }

        conversationMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
    }

    // Exceeded max iterations, make one final call without tools
    const finalResponse = await this.chat(provider, conversationMessages, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });

    return {
      content: finalResponse.content,
      toolResults,
      messages: conversationMessages,
      usage: finalResponse.usage,
    };
  }

  /**
   * Generate image (image models)
   * 
   * @param {object} provider - Provider config
   * @param {string} prompt - Image description
   * @param {object} [options] - Options
   * @returns {Promise<{url: string, revisedPrompt: string}>}
   */
  async generateImage(provider, prompt, options = {}) {
    const client = this._getClient(provider);

    try {
      const response = await client.images.generate({
        model: provider.model || 'dall-e-3',
        prompt,
        n: 1,
        size: options.size || '1024x1024',
        quality: options.quality || 'standard',
      });

      return {
        url: response.data[0].url,
        revisedPrompt: response.data[0].revised_prompt || prompt,
      };
    } catch (error) {
      console.error(`[LLMClient] Image generation failed (${provider.name}):`, error.message);
      throw new Error(`Image generation failed (${provider.name}): ${error.message}`);
    }
  }

  /**
   * Clear cached client (call when provider API Key is updated)
   */
  clearClient(providerId) {
    this.clients.delete(providerId);
  }

  clearAll() {
    this.clients.clear();
  }
}

// Global singleton
export const llmClient = new LLMClient();
