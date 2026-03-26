/**
 * Web Chat Client — 通过 Electron 隐藏 BrowserWindow 的 DOM 交互与 Web AI 聊天。
 *
 * 架构重构：
 * - 本文件只负责通用的通信层（proxy 发现、请求转发、会话管理）
 * - ChatGPT 专属逻辑（选择器、DOM 脚本等）已迁移到 backends/chatgpt/
 * - 每个员工（sessionId）在 Electron 侧会获得独立的 BrowserWindow，避免并发冲突
 * - 新增 web 后端（Claude、DeepSeek 等）只需在 backends/ 下新增文件夹
 *
 * 通信链路：
 *   WebClient.chat() → HTTP POST 到 Electron proxy → IPC → 独立 BrowserWindow → DOM 交互
 */

import { auditLogger, AuditCategory, AuditLevel } from '../../system/audit.js';
import { webBackendRegistry } from './backends/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// --- Proxy port 发现 ---
let _proxyPort = null;

function _getProxyPort() {
  if (_proxyPort) return _proxyPort;

  // 1. 环境变量（Electron 启动 Next.js 时注入）
  if (process.env.CHATGPT_PROXY_PORT) {
    _proxyPort = parseInt(process.env.CHATGPT_PROXY_PORT, 10);
    if (_proxyPort > 0) return _proxyPort;
  }

  // 2. 临时文件（Electron 主进程写入）
  const candidatePaths = [
    path.join(os.tmpdir(), 'ideaco-chatgpt-proxy-port'),
    path.join(os.homedir(), '.ideaco-chatgpt-proxy-port'),
  ];
  for (const tmpFile of candidatePaths) {
    try {
      if (fs.existsSync(tmpFile)) {
        const port = parseInt(fs.readFileSync(tmpFile, 'utf8').trim(), 10);
        if (port > 0) {
          _proxyPort = port;
          return _proxyPort;
        }
      }
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * 通过 Electron proxy 发送 DOM 聊天请求。
 *
 * @param {string} message - 消息内容
 * @param {string} model - 模型名称
 * @param {object} options - { timeoutMs, newConversation, sessionId, backendId }
 */
async function _domChat(message, model, { timeoutMs = 120000, newConversation = false, sessionId = null, backendId = 'chatgpt' } = {}) {
  let proxyPort = _getProxyPort();
  if (!proxyPort) {
    throw new Error(
      'ChatGPT proxy not available. ' +
      `ENV CHATGPT_PROXY_PORT=${process.env.CHATGPT_PROXY_PORT || '(not set)'}. ` +
      'Make sure you are running inside Electron, or set the CHATGPT_PROXY_PORT env var.'
    );
  }

  const payload = JSON.stringify({
    url: '__dom_chat__',
    method: 'DOM_CHAT',
    body: JSON.stringify({ message, model, timeoutMs, newConversation, sessionId, backendId }),
  });

  let res;
  try {
    res = await fetch(`http://127.0.0.1:${proxyPort}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
  } catch (fetchErr) {
    // 端口可能过期（应用重启），清缓存重试一次
    _proxyPort = null;
    proxyPort = _getProxyPort();
    if (proxyPort) {
      try {
        res = await fetch(`http://127.0.0.1:${proxyPort}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
      } catch (retryErr) {
        throw new Error(
          `Cannot reach proxy at 127.0.0.1:${proxyPort} — ${retryErr.message}. ` +
          'The Electron proxy server may not be running. Try restarting the app.'
        );
      }
    } else {
      throw new Error(
        `Cannot reach proxy — ${fetchErr.message}. ` +
        'The Electron proxy server may not be running. Try restarting the app.'
      );
    }
  }

  if (res.status !== 200) {
    throw new Error(`DOM chat proxy returned ${res.status}`);
  }

  const data = JSON.parse(await res.text());

  if (data.error && data.error !== 'timeout_partial') {
    throw new Error(`DOM chat failed: ${data.error}`);
  }

  if (!data.text) {
    throw new Error('DOM chat returned empty response');
  }

  return data.text;
}

/**
 * BaseWebClient — Web 聊天客户端基类
 *
 * 管理会话状态、消息构建、与 Electron proxy 的通信。
 * 所有 web 后端（ChatGPT、Claude、DeepSeek 等）共享这套通信机制，
 * 差异化的 DOM 交互由各自的 backend 处理。
 */
class BaseWebClient {
  /**
   * @param {string} backendId - 后端标识，如 'chatgpt'
   */
  constructor(backendId) {
    this._backendId = backendId;
    this._cookieRefresher = null;
    // 每个 session 的对话状态：sessionId → { hasActiveConversation, messageCount, currentContext }
    this._sessions = new Map();
  }

  get backendId() {
    return this._backendId;
  }

  /**
   * 是否运行在 Electron 代理环境中
   */
  get _useProxy() {
    return !!_getProxyPort();
  }

  /**
   * 获取或创建指定 sessionId 的会话状态
   */
  _getSession(sessionId) {
    if (!sessionId) sessionId = '__default__';
    if (!this._sessions.has(sessionId)) {
      this._sessions.set(sessionId, {
        hasActiveConversation: false,
        messageCount: 0,
        currentContext: null,
      });
    }
    return this._sessions.get(sessionId);
  }

  /**
   * 重置会话状态
   * @param {string} [sessionId] - 指定则只重置该会话，否则重置全部
   */
  resetConversation(sessionId) {
    if (sessionId) {
      this._sessions.delete(sessionId);
    } else {
      this._sessions.clear();
    }
  }

  /**
   * 检查会话是否需要新开对话（消息数过多）
   */
  needsNewSession(sessionId, maxMessages = 50) {
    const session = this._getSession(sessionId);
    return session.messageCount >= maxMessages;
  }

  /**
   * 发送聊天消息
   * 每个 sessionId 在 Electron 侧拥有独立的 BrowserWindow 和对话线程。
   */
  async chat(messages, options = {}) {
    if (!this._useProxy) {
      throw new Error('Web client requires Electron environment');
    }

    const model = options.model || 'auto';
    const sessionId = options.sessionId || null;
    const startTime = Date.now();

    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    if (!lastUserMsg) {
      throw new Error('No user message found in messages array');
    }

    const session = this._getSession(sessionId);

    // 判断是否需要新建对话
    const forceNew = options.newConversation === true;
    const forceReuse = options.newConversation === false;
    const needNewConversation = forceNew || (!forceReuse && !session.hasActiveConversation);

    // 根据对话状态构建 DOM 消息
    const domMessage = needNewConversation
      ? this._buildFirstMessage(messages)
      : this._buildFollowUpMessage(messages);

    const content = await _domChat(domMessage, model, {
      timeoutMs: options.timeoutMs,
      newConversation: needNewConversation,
      sessionId: sessionId,
      backendId: this._backendId,
    });

    // 更新会话状态
    session.hasActiveConversation = true;
    session.messageCount++;

    const latency = Date.now() - startTime;
    console.log(`[${this._backendId}-web] DOM chat success (session=${sessionId || 'default'}, ${content.length} chars, ${latency}ms, reused=${!needNewConversation}, msgCount=${session.messageCount})`);

    auditLogger.log({
      category: AuditCategory.LLM_REQUEST,
      level: AuditLevel.INFO,
      agentId: options._agentId || 'system',
      agentName: options._agentName || '',
      action: `Web chat: ${this._backendId} (${model}) - ${latency}ms`,
      details: { provider: `${this._backendId}-web`, model, latency, mode: 'dom', reused: !needNewConversation, sessionId },
    });

    return {
      content,
      toolCalls: null,
      finishReason: 'stop',
      usage: {},
    };
  }

  /**
   * 构建新对话的第一条消息（包含 system prompt + 完整上下文）
   */
  _buildFirstMessage(messages) {
    const parts = [];

    const systemMsgs = messages.filter(m => m.role === 'system');
    if (systemMsgs.length > 0) {
      parts.push('[System Instructions]\n' + systemMsgs.map(m => m.content).join('\n\n'));
    }

    const nonSystem = messages.filter(m => m.role !== 'system');
    if (nonSystem.length > 1) {
      const history = nonSystem.slice(0, -1);
      if (history.length > 0) {
        parts.push('[Conversation History]');
        for (const msg of history) {
          const role = msg.role === 'assistant' ? 'Assistant' : 'User';
          parts.push(`${role}: ${msg.content}`);
        }
      }
    }

    const lastUser = nonSystem[nonSystem.length - 1];
    if (lastUser) {
      if (parts.length > 0) {
        parts.push('[Current Message]');
      }
      parts.push(lastUser.content);
    }

    return parts.join('\n\n');
  }

  /**
   * 构建跟进消息（上下文已在对话中，通常只发最新的用户消息）
   * 如果有 system 消息（动态上下文，如秘书的实时公司状态），需要带上。
   */
  _buildFollowUpMessage(messages) {
    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    const lastUser = nonSystem[nonSystem.length - 1];

    if (systemMsgs.length > 0) {
      const parts = [];
      parts.push('[Context Update]\n' + systemMsgs.map(m => m.content).join('\n\n'));

      if (nonSystem.length > 1) {
        const history = nonSystem.slice(0, -1);
        if (history.length > 0) {
          parts.push('[Conversation History]');
          for (const msg of history) {
            const role = msg.role === 'assistant' ? 'Assistant' : 'User';
            parts.push(`${role}: ${msg.content}`);
          }
        }
      }

      if (lastUser) {
        parts.push('[Current Message]');
        parts.push(lastUser.content);
      }
      return parts.join('\n\n');
    }

    return lastUser ? lastUser.content : '';
  }

  /**
   * 测试连接
   */
  async testConnection() {
    if (!this._useProxy) {
      return { ok: false, error: 'Not running in Electron' };
    }
    return { ok: true, proxyMode: true, mode: 'dom', backend: this._backendId };
  }
}

/**
 * WebClientRegistry — 管理所有 web 聊天客户端
 *
 * 通过 providerId 查找对应的客户端实例。
 * 每个后端（chatgpt、claude、deepseek）对应一个 BaseWebClient 实例。
 */
export class WebClientRegistry {
  constructor() {
    this.clients = new Map();
    // 为每个已注册的后端创建客户端
    for (const backend of webBackendRegistry.getAll()) {
      this.clients.set(backend.id, new BaseWebClient(backend.id));
    }
  }

  /**
   * 根据 providerId 获取客户端
   * 兼容旧的命名方式（如 'web-chatgpt-xxx'）
   */
  getClient(providerId) {
    // 精确匹配
    if (this.clients.has(providerId)) {
      return this.clients.get(providerId);
    }
    // 模糊匹配（兼容 'web-chatgpt-xxx' 格式）
    for (const [id, client] of this.clients) {
      if (providerId.includes(id)) {
        return client;
      }
    }
    return null;
  }

  /**
   * No-op：DOM 模式使用 Electron 的 Chromium session cookies。
   * 保留用于向后兼容。
   */
  configureCookie(_providerId, _cookie) {
    // No-op
  }

  setCookieRefresher(providerId, refresher) {
    const client = this.getClient(providerId);
    if (client) {
      client._cookieRefresher = refresher;
    }
  }

  async testConnection(providerId) {
    const client = this.getClient(providerId);
    if (!client) return { ok: false, error: 'Unknown web provider' };
    return await client.testConnection();
  }

  async chat(providerId, messages, options = {}) {
    const client = this.getClient(providerId);
    if (!client) throw new Error(`No web client for: ${providerId}`);
    return await client.chat(messages, options);
  }

  /**
   * 重置会话
   */
  resetConversation(providerId, sessionId) {
    const client = this.getClient(providerId);
    if (client) client.resetConversation(sessionId);
  }

  /**
   * 检查是否需要新建会话
   */
  needsNewSession(providerId, sessionId, maxMessages) {
    const client = this.getClient(providerId);
    if (!client) return false;
    return client.needsNewSession(sessionId, maxMessages);
  }
}

// 全局单例
// Global singleton — use globalThis to survive Next.js HMR in dev mode
if (!globalThis.__webClientRegistry) {
  globalThis.__webClientRegistry = new WebClientRegistry();
}
export const webClientRegistry = globalThis.__webClientRegistry;
