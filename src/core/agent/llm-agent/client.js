/**
 * Unified LLM Client - Makes real API calls to various model providers
 * 
 * Supports: OpenAI/GPT, Anthropic/Claude, DeepSeek, and other OpenAI-compatible APIs
 * as well as image models like DALL-E, Midjourney
 */
import OpenAI from 'openai';
import { auditLogger, AuditCategory, AuditLevel } from '../../system/audit.js';
import { hookRegistry, HookEvent } from '../../../lib/hooks.js';
import { logLLMCall } from '../../system/llm-debug-logger.js';
import { ToolLoop, stripToolCallMarkup as _stripToolCallMarkup } from '../tool-loop.js';
import { buildLanguageInstruction } from '../../utils/app-language.js';

// NOTE: Embedded tool call parsing, markup stripping, and tool result summarization
// are now handled by the shared ToolLoop module (../tool-loop.js).

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
   * Clean any residual tool-call markup from final LLM output.
   * Also used by chatWithTools to sanitize the final response.
   */
  static stripToolCallMarkup(text) {
    return _stripToolCallMarkup(text);
  }

  /**
   * Inject language enforcement instructions into messages.
   *
   * Strategy ("pincer" — opening + closing):
   * - Prepend the opening instruction to the FIRST system message's content.
   * - Append the closing instruction to the LAST system message's content.
   *   If there's only one system message, both wrap that single message.
   * - If there is no system message at all, insert one at position 0.
   *
   * This ensures that no matter which module constructed the messages,
   * the language requirement is always enforced at both the top and bottom.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Array<{role: string, content: string}>} A shallow-copied array with language injected
   */
  _injectLanguageInstruction(messages) {
    const { opening, closing } = buildLanguageInstruction();
    // Shallow copy to avoid mutating the caller's array
    const msgs = messages.map(m => ({ ...m }));

    // Find first and last system message indices
    let firstSysIdx = -1;
    let lastSysIdx = -1;
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role === 'system') {
        if (firstSysIdx === -1) firstSysIdx = i;
        lastSysIdx = i;
      }
    }

    if (firstSysIdx === -1) {
      // No system message — insert one
      msgs.unshift({ role: 'system', content: opening + closing });
    } else {
      // Prepend opening to first system message
      msgs[firstSysIdx] = {
        ...msgs[firstSysIdx],
        content: opening + msgs[firstSysIdx].content,
      };
      // Append closing to last system message
      msgs[lastSysIdx] = {
        ...msgs[lastSysIdx],
        content: msgs[lastSysIdx].content + closing,
      };
    }

    return msgs;
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

    // Inject language enforcement into system messages (pincer)
    const langMessages = this._injectLanguageInstruction(messages);

    const requestParams = {
      model,
      messages: langMessages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    };

    // NOTE: We no longer pass tool definitions to the API.
    // All tool execution is done via the unified JSON actions protocol.
    // The LLM returns a structured JSON with "actions" array, and ToolLoop handles it.

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

      const result = {
        content: choice.message.content || '',
        toolCalls: choice.message.tool_calls || null,
        finishReason: choice.finish_reason,
        usage: response.usage || {},
      };

      // Dev模式: 记录完整的LLM输入输出
      logLLMCall({
        agentId: options._agentId,
        agentName: options._agentName,
        providerId: provider.id,
        model,
        messages,
        response: result,
        options,
        latency,
        usage: response.usage,
        streamed: false,
      });

      return result;
    } catch (error) {
      // Fire hook: LLM error
      hookRegistry.trigger(HookEvent.LLM_ERROR, {
        providerId: provider.id, model, error: error.message,
        agentId: options._agentId,
      });

      // Dev模式: 记录错误
      logLLMCall({
        agentId: options._agentId,
        agentName: options._agentName,
        providerId: provider.id,
        model,
        messages,
        response: null,
        options,
        latency: Date.now() - startTime,
        error: error.message,
      });

      console.error(`[LLMClient] Call to ${provider.name} failed:`, error.message);
      throw new Error(`LLM call failed (${provider.name}): ${error.message}`);
    }
  }

  /**
   * Stream chat messages — returns an async generator that yields delta tokens.
   *
   * @param {object} provider - Provider config
   * @param {Array<{role: string, content: string}>} messages - Message list
   * @param {object} [options] - Extra options (temperature, maxTokens)
   * @yields {{ type: 'delta', content: string } | { type: 'thinking', content: string } | { type: 'done', content: string, usage: object }}
   */
  async *chatStream(provider, messages, options = {}) {
    const client = this._getClient(provider);
    const model = getModelName(provider);

    // Inject language enforcement into system messages (pincer)
    const langMessages = this._injectLanguageInstruction(messages);

    const requestParams = {
      model,
      messages: langMessages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    };

    const startTime = Date.now();
    let fullContent = '';

    try {
      hookRegistry.trigger(HookEvent.LLM_REQUEST_START, {
        providerId: provider.id, model, agentId: options._agentId,
      });

      const stream = await client.chat.completions.create(requestParams);

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Some providers (DeepSeek) emit reasoning_content for chain-of-thought
        if (delta.reasoning_content) {
          yield { type: 'thinking', content: delta.reasoning_content };
        }

        if (delta.content) {
          fullContent += delta.content;
          yield { type: 'delta', content: delta.content };
        }
      }

      const latency = Date.now() - startTime;

      // Audit log
      auditLogger.log({
        category: AuditCategory.LLM_REQUEST,
        level: AuditLevel.INFO,
        agentId: options._agentId || 'system',
        agentName: options._agentName || '',
        action: `LLM stream call: ${provider.name} (${model}) - ${latency}ms`,
        details: { providerId: provider.id, model, latency, streamed: true },
      });

      hookRegistry.trigger(HookEvent.LLM_REQUEST_END, {
        providerId: provider.id, model, latency, agentId: options._agentId,
      });

      // Dev模式: 记录流式调用的完整输入输出
      logLLMCall({
        agentId: options._agentId,
        agentName: options._agentName,
        providerId: provider.id,
        model,
        messages,
        response: { content: fullContent },
        options,
        latency,
        streamed: true,
      });

      yield { type: 'done', content: fullContent, usage: {} };
    } catch (error) {
      hookRegistry.trigger(HookEvent.LLM_ERROR, {
        providerId: provider.id, model, error: error.message,
        agentId: options._agentId,
      });

      // Dev模式: 记录错误
      logLLMCall({
        agentId: options._agentId,
        agentName: options._agentName,
        providerId: provider.id,
        model,
        messages,
        response: null,
        options,
        latency: Date.now() - startTime,
        error: error.message,
        streamed: true,
      });

      console.error(`[LLMClient] Stream call to ${provider.name} failed:`, error.message);
      throw new Error(`LLM stream failed (${provider.name}): ${error.message}`);
    }
  }

  /**
   * Multi-turn conversation (with tool call loop)
   * Core method for Agent task execution: send message -> model may call tools -> execute tools -> continue conversation
   *
   * Delegates to the shared ToolLoop for the actual loop logic.
   * ToolLoop provides: parallel read-only execution, tool tiering, auto-escalation,
   * embedded call parsing (DSML/XML), and unified progress callbacks.
   * 
   * @param {object} provider - Provider config
   * @param {Array} messages - Initial messages
   * @param {object} toolExecutor - Tool executor { definitions, execute(name, args) }
   * @param {object} [options] - Options
   * @param {number} [options.maxIterations] - Max tool call loop iterations
   * @returns {Promise<{content: string, toolResults: Array, messages: Array}>}
   */
  async chatWithTools(provider, messages, toolExecutor, options = {}) {
    const model = getModelName(provider);
    const loop = new ToolLoop({
      chatFn: (msgs, chatOpts) => this.chat(provider, msgs, chatOpts),
      toolExecutor,
      maxIterations: options.maxIterations || 15,
      taskContext: options.taskContext || null,
      activeTiers: options.activeTiers || null,
    });

    return loop.run(messages, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      _agentId: options._agentId,
      _agentName: options._agentName,
      _providerId: provider.id,
      _model: model,
      onToolCall: options.onToolCall || null,
      onLLMCall: options.onLLMCall || null,
    });
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
// Global singleton — use globalThis to survive Next.js HMR in dev mode
if (!globalThis.__llmClient) {
  globalThis.__llmClient = new LLMClient();
}
export const llmClient = globalThis.__llmClient;
