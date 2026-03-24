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

/**
 * Parse embedded tool calls from LLM content text.
 * Supports:
 *  - DeepSeek DSML format: <｜DSML｜function_calls>...<｜DSML｜invoke name="tool">...<｜DSML｜parameter name="x">val</｜DSML｜parameter>...
 *  - Generic XML-style: <function_call>{"name":"...","arguments":{...}}</function_call>
 *  - <tool_call>{"name":"...","arguments":{...}}</tool_call>
 *
 * @param {string} content - Raw LLM content
 * @returns {Array<{name: string, args: object}>|null}
 */
function _parseEmbeddedToolCalls(content) {
  if (!content) return null;
  const calls = [];

  // 1. DSML format: <｜DSML｜function_calls> ... </｜DSML｜function_calls>
  const dsmlBlockRegex = /<[｜|]DSML[｜|]function_calls>([\s\S]*?)(?:<\/[｜|]DSML[｜|]function_calls>|$)/g;
  let blockMatch;
  while ((blockMatch = dsmlBlockRegex.exec(content)) !== null) {
    const block = blockMatch[1];
    // Parse each <｜DSML｜invoke name="tool_name"> block
    const invokeRegex = /<[｜|]DSML[｜|]invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)(?:<\/[｜|]DSML[｜|]invoke>|$)/g;
    let invokeMatch;
    while ((invokeMatch = invokeRegex.exec(block)) !== null) {
      const toolName = invokeMatch[1];
      const paramsBlock = invokeMatch[2];
      const args = {};
      // Parse <｜DSML｜parameter name="x" string="true">value</｜DSML｜parameter>
      const paramRegex = /<[｜|]DSML[｜|]parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)(?:<\/[｜|]DSML[｜|]parameter>|$)/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
        const paramName = paramMatch[1];
        const paramValue = paramMatch[2].trim();
        // Try JSON parse for complex values, otherwise keep as string
        try { args[paramName] = JSON.parse(paramValue); } catch { args[paramName] = paramValue; }
      }
      if (toolName) {
        calls.push({ name: toolName, args });
      }
    }
  }

  // 2. Generic XML <function_call>JSON</function_call>
  const fcRegex = /<function_call>([\s\S]*?)(?:<\/function_call>|$)/g;
  let fcMatch;
  while ((fcMatch = fcRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(fcMatch[1].trim());
      if (parsed.name) {
        calls.push({ name: parsed.name, args: parsed.arguments || parsed.args || {} });
      }
    } catch { /* skip malformed */ }
  }

  // 3. Generic XML <tool_call>JSON</tool_call>
  const tcRegex = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g;
  let tcMatch;
  while ((tcMatch = tcRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(tcMatch[1].trim());
      if (parsed.name) {
        calls.push({ name: parsed.name, args: parsed.arguments || parsed.args || {} });
      }
    } catch { /* skip malformed */ }
  }

  return calls.length > 0 ? calls : null;
}

/**
 * Strip tool-call markup from LLM output content.
 * Removes DSML blocks, <function_call>, <tool_call> etc. so only natural language text remains.
 *
 * @param {string} text
 * @returns {string}
 */
function _stripToolCallMarkup(text) {
  if (!text) return '';
  let cleaned = text;
  // DSML blocks (complete - closed tags)
  cleaned = cleaned.replace(/<[｜|]DSML[｜|]function_calls>[\s\S]*?<\/[｜|]DSML[｜|]function_calls>/g, '');
  // Also match ASCII pipe variant (closed)
  cleaned = cleaned.replace(/<\|DSML\|function_calls>[\s\S]*?<\/\|DSML\|function_calls>/g, '');
  // Trailing incomplete DSML blocks (unclosed, only at the end of the string)
  // Only strip if the remaining text after the opening tag looks like markup (contains invoke/parameter tags)
  cleaned = cleaned.replace(/<[｜|]DSML[｜|]function_calls>(?=[\s\S]*<[｜|]DSML[｜|]invoke)[\s\S]*$/g, '');
  cleaned = cleaned.replace(/<\|DSML\|function_calls>(?=[\s\S]*<\|DSML\|invoke)[\s\S]*$/g, '');
  // Generic XML-style (closed)
  cleaned = cleaned.replace(/<function_call>[\s\S]*?<\/function_call>/g, '');
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  // Trailing incomplete generic XML (only if it looks like a tool call with JSON inside)
  cleaned = cleaned.replace(/<function_call>\s*\{[\s\S]*$/g, '');
  cleaned = cleaned.replace(/<tool_call>\s*\{[\s\S]*$/g, '');
  return cleaned.trim();
}

/**
 * Build a human-readable summary from tool execution results.
 * Used as fallback when LLM returns empty content after tool calls.
 *
 * @param {Array<{tool: string, args: object, result: any, success: boolean, error?: string}>} results
 * @returns {string}
 */
function _summarizeToolResults(results) {
  if (!results || results.length === 0) return '';
  const parts = [];
  for (const r of results) {
    if (r.success && r.result != null) {
      const text = typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
      if (text.trim()) parts.push(text.trim());
    } else if (!r.success && r.error) {
      parts.push(`⚠️ ${r.tool}: ${r.error}`);
    }
  }
  return parts.join('\n\n') || '';
}

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

    const requestParams = {
      model,
      messages,
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
   * @param {object} provider - Provider config
   * @param {Array} messages - Initial messages
   * @param {object} toolExecutor - Tool executor { definitions, execute(name, args) }
   * @param {object} [options] - Options
   * @param {number} [options.maxIterations] - Max tool call loop iterations
   * @returns {Promise<{content: string, toolResults: Array, messages: Array}>}
   */
  async chatWithTools(provider, messages, toolExecutor, options = {}) {
const maxIterations = options.maxIterations || 15;    const onToolCall = options.onToolCall || null;  // Callback: notify on tool call
    const onLLMCall = options.onLLMCall || null;    // Callback: notify on each LLM call
    const conversationMessages = [...messages];
    const toolResults = [];
    const chatWithToolsStartTime = Date.now();
    // Track whether we just executed embedded (DSML) tool calls. If so, the next
    // LLM call should NOT include tool definitions — we want the model to summarize
    // the tool results in natural language instead of attempting more tool calls.
    let justDidEmbeddedCalls = false;

    for (let i = 0; i < maxIterations; i++) {
      // Notify: about to call LLM
      if (onLLMCall) {
        try { onLLMCall({ iteration: i + 1, maxIterations }); } catch {}
      }

      const chatOpts = {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        _agentId: options._agentId,
        _agentName: options._agentName,
      };
      // Only pass tool definitions when we're NOT in the "summarize embedded results" phase
      if (!justDidEmbeddedCalls) {
        chatOpts.tools = toolExecutor.definitions;
      }
      const wasEmbeddedSummaryRound = justDidEmbeddedCalls;
      justDidEmbeddedCalls = false; // reset flag

      const response = await this.chat(provider, conversationMessages, chatOpts);

      // If no tool calls, check for DSML/XML-style tool calls embedded in content
      // (DeepSeek sometimes emits tool calls as text markup instead of via tool_calls API field)
      // HOWEVER: if this was a "summarize embedded results" round, do NOT parse new embedded
      // calls — the model should be answering, not calling more tools. Just strip any
      // residual markup and treat the text as the final answer.
      if (!response.toolCalls || response.toolCalls.length === 0) {
        const embeddedCalls = wasEmbeddedSummaryRound ? null : _parseEmbeddedToolCalls(response.content);
        if (embeddedCalls && embeddedCalls.length > 0) {
          // Strip the DSML markup from content so we keep only the natural language part
          const cleanContent = _stripToolCallMarkup(response.content);
          console.log(`  🔄 [LLMClient] Detected ${embeddedCalls.length} embedded tool call(s) in content, executing...`);

          conversationMessages.push({
            role: 'assistant',
            content: response.content,
          });

          const callResultTexts = [];
          for (const call of embeddedCalls) {
            console.log(`  🔧 [Tool Call] (embedded) ${call.name}(${JSON.stringify(call.args).slice(0, 100)}...)`);
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

          // Feed tool results back with a clear instruction for the model to summarize.
          // Because embedded calls don't follow the standard tool_calls protocol,
          // we must explicitly tell the model that the tools have been executed and
          // it should now produce a natural-language answer based on the results.
          const resultsPayload = callResultTexts.join('\n\n');
          conversationMessages.push({
            role: 'user',
            content: `The tool(s) you requested have been executed. Here are the results:\n\n${resultsPayload}\n\nPlease review the tool results above. If you need more information or need to run additional tools to complete the task, go ahead and call them. If you have enough information, provide a complete, helpful answer to the user's original question.`,
          });
          justDidEmbeddedCalls = true;
          continue;
        }

        const strippedContent = _stripToolCallMarkup(response.content);
        // If content is empty after stripping (LLM only output markup, no natural language),
        // summarize tool results as the response so user doesn't see an empty message
        const finalContent = strippedContent || _summarizeToolResults(toolResults);

        // Log the full chatWithTools conversation (including tool calls) as a summary entry
        if (toolResults.length > 0) {
          logLLMCall({
            agentId: options._agentId,
            agentName: options._agentName,
            providerId: provider.id,
            model: getModelName(provider),
            messages: conversationMessages,
            response: { content: finalContent, toolResults },
            options: { ...options, _isChatWithToolsSummary: true, iterationsUsed: i + 1 },
            latency: Date.now() - chatWithToolsStartTime,
            usage: response.usage,
            streamed: false,
          });
        }

        return {
          content: finalContent,
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
      _agentId: options._agentId,
      _agentName: options._agentName,
    });

    const strippedFinal = _stripToolCallMarkup(finalResponse.content);
    const finalContent = strippedFinal || _summarizeToolResults(toolResults);

    // Log the full chatWithTools conversation (including tool calls) as a summary entry
    if (toolResults.length > 0) {
      logLLMCall({
        agentId: options._agentId,
        agentName: options._agentName,
        providerId: provider.id,
        model: getModelName(provider),
        messages: conversationMessages,
        response: { content: finalContent, toolResults },
        options: { ...options, _isChatWithToolsSummary: true, iterationsUsed: maxIterations, maxIterationsReached: true },
        latency: Date.now() - chatWithToolsStartTime,
        usage: finalResponse.usage,
        streamed: false,
      });
    }

    return {
      content: finalContent,
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
