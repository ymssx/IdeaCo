/**
 * LLM统一客户端 - 真实调用各模型提供方API
 * 
 * 支持：OpenAI/GPT、Anthropic/Claude、DeepSeek 等通用文本模型
 * 以及 DALL-E、Midjourney 等图像模型的API调用
 */
import OpenAI from 'openai';

/**
 * 基于供应商配置创建对应的API客户端
 * @param {object} provider - 供应商配置对象
 * @returns {object} API客户端实例
 */
function createClient(provider) {
  const { id, apiKey } = provider;

  // OpenAI 系列（GPT、DALL-E）
  if (id.startsWith('openai-')) {
    return new OpenAI({ apiKey });
  }

  // Anthropic Claude - 使用 OpenAI 兼容接口
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

  // DeepSeek - 兼容 OpenAI 接口
  if (id.startsWith('deepseek-')) {
    return new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com',
    });
  }

  // 通义千问 - 阿里云 DashScope OpenAI 兼容接口
  if (id.startsWith('qwen-')) {
    return new OpenAI({
      apiKey,
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  }

  // 默认使用 OpenAI 兼容接口
  return new OpenAI({ apiKey });
}

/**
 * 获取供应商对应的模型名称
 */
function getModelName(provider) {
  const modelMap = {
    'openai-gpt4': 'gpt-4-turbo',
    'openai-gpt35': 'gpt-3.5-turbo',
    'anthropic-claude': 'claude-3-5-sonnet-20241022',
    'deepseek-v3': 'deepseek-chat',
  };
  return modelMap[provider.id] || provider.model || 'gpt-4-turbo';
}

/**
 * LLM统一通信客户端
 */
export class LLMClient {
  constructor() {
    // 缓存已创建的客户端实例
    this.clients = new Map();
  }

  /**
   * 获取或创建API客户端
   */
  _getClient(provider) {
    if (!provider.apiKey) {
      throw new Error(`供应商 ${provider.name} 未配置API Key`);
    }
    if (!this.clients.has(provider.id)) {
      this.clients.set(provider.id, createClient(provider));
    }
    return this.clients.get(provider.id);
  }

  /**
   * 发送聊天消息（通用文本模型）
   * 
   * @param {object} provider - 供应商配置
   * @param {Array<{role: string, content: string}>} messages - 消息列表
   * @param {object} [options] - 额外选项
   * @param {string[]} [options.tools] - 可用工具定义
   * @param {number} [options.temperature] - 温度
   * @param {number} [options.maxTokens] - 最大token
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

    // 如果提供了工具定义，加入请求
    if (options.tools && options.tools.length > 0) {
      requestParams.tools = options.tools;
      requestParams.tool_choice = 'auto';
    }

    try {
      const response = await client.chat.completions.create(requestParams);
      const choice = response.choices[0];

      return {
        content: choice.message.content || '',
        toolCalls: choice.message.tool_calls || null,
        finishReason: choice.finish_reason,
        usage: response.usage || {},
      };
    } catch (error) {
      console.error(`[LLMClient] 调用 ${provider.name} 失败:`, error.message);
      throw new Error(`LLM调用失败 (${provider.name}): ${error.message}`);
    }
  }

  /**
   * 多轮对话（带工具调用循环）
   * Agent执行任务时的核心方法：发送消息 → 模型可能调用工具 → 执行工具 → 继续对话
   * 
   * @param {object} provider - 供应商配置
   * @param {Array} messages - 初始消息
   * @param {object} toolExecutor - 工具执行器 { definitions, execute(name, args) }
   * @param {object} [options] - 选项
   * @param {number} [options.maxIterations] - 最大工具调用循环次数
   * @returns {Promise<{content: string, toolResults: Array, messages: Array}>}
   */
  async chatWithTools(provider, messages, toolExecutor, options = {}) {
    const maxIterations = options.maxIterations || 5;    const onToolCall = options.onToolCall || null;  // 回调：工具调用时通知
    const onLLMCall = options.onLLMCall || null;    // 回调：每次LLM调用时通知
    const conversationMessages = [...messages];
    const toolResults = [];

    for (let i = 0; i < maxIterations; i++) {
      // 通知：即将调用LLM
      if (onLLMCall) {
        try { onLLMCall({ iteration: i + 1, maxIterations }); } catch {}
      }

      const response = await this.chat(provider, conversationMessages, {
        tools: toolExecutor.definitions,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      });

      // 如果没有工具调用，直接返回最终结果
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          content: response.content,
          toolResults,
          messages: conversationMessages,
          usage: response.usage,
        };
      }

      // 处理工具调用
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
        } catch {
          args = {};
        }

        console.log(`  🔧 [工具调用] ${name}(${JSON.stringify(args).slice(0, 100)}...)`);

        // 通知：正在调用工具
        if (onToolCall) {
          try { onToolCall({ tool: name, args, status: 'start' }); } catch {}
        }

        let result;
        try {
          result = await toolExecutor.execute(name, args);
          toolResults.push({ tool: name, args, result, success: true });
          // 通知：工具调用完成
          if (onToolCall) {
            try { onToolCall({ tool: name, args, status: 'done', success: true }); } catch {}
          }
        } catch (error) {
          result = `工具执行错误: ${error.message}`;
          toolResults.push({ tool: name, args, error: error.message, success: false });
          // 通知：工具调用失败
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

    // 超过最大循环次数，做最后一次不带工具的调用
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
   * 生成图片（画图模型）
   * 
   * @param {object} provider - 供应商配置
   * @param {string} prompt - 图片描述
   * @param {object} [options] - 选项
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
      console.error(`[LLMClient] 图片生成失败 (${provider.name}):`, error.message);
      throw new Error(`图片生成失败 (${provider.name}): ${error.message}`);
    }
  }

  /**
   * 清除缓存的客户端（供应商API Key更新时调用）
   */
  clearClient(providerId) {
    this.clients.delete(providerId);
  }

  clearAll() {
    this.clients.clear();
  }
}

// 全局单例
export const llmClient = new LLMClient();
