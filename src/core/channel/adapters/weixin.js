/**
 * WeixinChannel - WeChat Channel Adapter via iLink Bot API
 *
 * Uses the official Tencent iLink Bot API (ilinkai.weixin.qq.com)
 * ported from @tencent-weixin/openclaw-weixin plugin source code,
 * with all OpenClaw framework dependencies removed.
 *
 * Architecture:
 * - QR login via /ilink/bot/get_bot_qrcode + /ilink/bot/get_qrcode_status
 * - Long-poll message receive via /ilink/bot/getupdates
 * - Send messages via /ilink/bot/sendmessage
 * - Typing indicators via /ilink/bot/sendtyping
 * - Config cache via /ilink/bot/getconfig (typing_ticket per-user)
 * - Auth: Bearer bot_token (ilink_bot_token)
 *
 * Transport: direct (long-poll)
 */
import { BaseChannel, ChannelState, InboundMessage, OutboundMessage } from '../base-channel.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_BOT_TYPE = '3';
const CHANNEL_VERSION = '2.0.0';
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
// Client-side abort margin: add extra 5s so server long-poll closes first
const LONG_POLL_CLIENT_MARGIN_MS = 5_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_QR_REFRESH_COUNT = 3;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const SESSION_EXPIRED_ERRCODE = -14;
// Pause all API calls for 1 hour when session expires (matching SDK)
const SESSION_PAUSE_DURATION_MS = 60 * 60 * 1000;
// Config cache TTL: 24 hours (matching SDK)
const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIG_CACHE_INITIAL_RETRY_MS = 2_000;
const CONFIG_CACHE_MAX_RETRY_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// iLink Bot API helpers
// ---------------------------------------------------------------------------

/** Build base_info metadata for every API request. */
function buildBaseInfo() {
  return { channel_version: CHANNEL_VERSION };
}

/** Generate a random X-WECHAT-UIN header value. */
function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

/** Build auth headers for iLink Bot API requests. */
function buildHeaders(token, body) {
  const headers = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (body) {
    headers['Content-Length'] = String(Buffer.byteLength(body, 'utf-8'));
  }
  if (token?.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`;
  }
  return headers;
}

/**
 * Fetch wrapper: POST JSON to an iLink Bot API endpoint with timeout.
 * Returns parsed JSON on success; throws on HTTP error or timeout.
 */
async function apiFetch({ baseUrl, endpoint, body, token, timeoutMs, label }) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(endpoint, base);
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = buildHeaders(token, bodyStr);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_API_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`${label} HTTP ${res.status}: ${rawText}`);
    }
    return JSON.parse(rawText);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * GET request to an iLink Bot API endpoint with timeout.
 * Returns parsed JSON.
 */
async function apiGet({ baseUrl, endpoint, token, timeoutMs, label, extraHeaders }) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(endpoint, base);
  const headers = {
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (token?.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`;
  }
  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_API_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`${label} HTTP ${res.status}: ${rawText}`);
    }
    return JSON.parse(rawText);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// iLink Bot API methods
// ---------------------------------------------------------------------------

/** Fetch QR code for login. Returns { qrcode, qrcode_img_content }. */
async function fetchQRCode(baseUrl, botType) {
  return apiGet({
    baseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType || DEFAULT_BOT_TYPE)}`,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    label: 'get_bot_qrcode',
  });
}

/** Long-poll QR code status. Returns { status, bot_token?, ilink_bot_id?, baseurl? }. */
async function pollQRStatus(baseUrl, qrcode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
  try {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
    const res = await fetch(url.toString(), {
      headers: { 'iLink-App-ClientVersion': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`pollQRStatus HTTP ${res.status}: ${rawText}`);
    }
    return JSON.parse(rawText);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return { status: 'wait' };
    }
    throw err;
  }
}

/**
 * Long-poll getUpdates. Returns { ret, msgs[], get_updates_buf, longpolling_timeout_ms }.
 * Client timeout = server timeout + LONG_POLL_CLIENT_MARGIN_MS so server response arrives first.
 */
async function getUpdates({ baseUrl, token, getUpdatesBuf, timeoutMs }) {
  const serverTimeout = timeoutMs || DEFAULT_LONG_POLL_TIMEOUT_MS;
  // Add margin so AbortController fires after server-side timeout
  const clientTimeout = serverTimeout + LONG_POLL_CLIENT_MARGIN_MS;
  try {
    return await apiFetch({
      baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: {
        get_updates_buf: getUpdatesBuf || '',
        base_info: buildBaseInfo(),
      },
      token,
      timeoutMs: clientTimeout,
      label: 'getUpdates',
    });
  } catch (err) {
    // Long-poll timeout is normal; return empty response so caller can retry
    if (err.name === 'AbortError') {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
    }
    throw err;
  }
}

/** Send a message via iLink Bot API. Body matches SDK SendMessageReq shape. */
async function sendMessageApi({ baseUrl, token, body }) {
  return apiFetch({
    baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body: { ...body, base_info: buildBaseInfo() },
    token,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    label: 'sendMessage',
  });
}

/** Send a typing indicator. */
async function sendTypingApi({ baseUrl, token, body }) {
  return apiFetch({
    baseUrl,
    endpoint: 'ilink/bot/sendtyping',
    body: { ...body, base_info: buildBaseInfo() },
    token,
    timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
    label: 'sendTyping',
  });
}

/** Fetch bot config (includes typing_ticket) for a user. */
async function getConfigApi({ baseUrl, token, ilinkUserId, contextToken }) {
  return apiFetch({
    baseUrl,
    endpoint: 'ilink/bot/getconfig',
    body: {
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: buildBaseInfo(),
    },
    token,
    timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
    label: 'getConfig',
  });
}

// ---------------------------------------------------------------------------
// Config cache: per-user getConfig with 24h TTL and exponential backoff retry
// Matches SDK WeixinConfigManager pattern
// ---------------------------------------------------------------------------

class ConfigManager {
  constructor(apiOpts) {
    this._apiOpts = apiOpts; // { baseUrl, token }
    this._cache = new Map(); // userId -> { config, everSucceeded, nextFetchAt, retryDelayMs }
  }

  async getForUser(userId, contextToken) {
    const now = Date.now();
    const entry = this._cache.get(userId);
    const shouldFetch = !entry || now >= entry.nextFetchAt;

    if (shouldFetch) {
      let fetchOk = false;
      try {
        const resp = await getConfigApi({
          baseUrl: this._apiOpts.baseUrl,
          token: this._apiOpts.token,
          ilinkUserId: userId,
          contextToken,
        });
        if (resp.ret === 0 || resp.ret === undefined) {
          this._cache.set(userId, {
            config: { typingTicket: resp.typing_ticket || '' },
            everSucceeded: true,
            nextFetchAt: now + Math.random() * CONFIG_CACHE_TTL_MS,
            retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS,
          });
          console.log(`[WeixinChannel] config ${entry?.everSucceeded ? 'refreshed' : 'cached'} for ${userId}`);
          fetchOk = true;
        }
      } catch (err) {
        console.warn(`[WeixinChannel] getConfig failed for ${userId} (ignored): ${err.message}`);
      }
      if (!fetchOk) {
        const prevDelay = entry?.retryDelayMs || CONFIG_CACHE_INITIAL_RETRY_MS;
        const nextDelay = Math.min(prevDelay * 2, CONFIG_CACHE_MAX_RETRY_MS);
        if (entry) {
          entry.nextFetchAt = now + nextDelay;
          entry.retryDelayMs = nextDelay;
        } else {
          this._cache.set(userId, {
            config: { typingTicket: '' },
            everSucceeded: false,
            nextFetchAt: now + CONFIG_CACHE_INITIAL_RETRY_MS,
            retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS,
          });
        }
      }
    }

    return this._cache.get(userId)?.config || { typingTicket: '' };
  }
}

// ---------------------------------------------------------------------------
// Message type constants (from iLink Bot protocol)
// ---------------------------------------------------------------------------
const MessageType = { NONE: 0, USER: 1, BOT: 2 };
const MessageItemType = { NONE: 0, TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 };
const MessageState = { NEW: 0, GENERATING: 1, FINISH: 2 };
const TypingStatus = { TYPING: 1, CANCEL: 2 };

/** Generate a unique client message ID. */
function generateClientId() {
  return `ai-enterprise-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/** Extract text body from item_list. */
function extractTextBody(itemList) {
  if (!itemList?.length) return '';
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
    // Voice-to-text: if voice message has text field, use text content
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return '';
}

/**
 * Convert markdown-formatted model reply to plain text for WeChat delivery.
 * Matches SDK's markdownToPlainText behavior.
 */
function markdownToPlainText(text) {
  if (!text) return '';
  let result = text;
  // Code blocks: strip fences, keep code content
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => code.trim());
  // Images: remove entirely
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Links: keep display text only
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Tables: remove separator rows, then strip leading/trailing pipes
  result = result.replace(/^\|[\s:|-]+\|$/gm, '');
  result = result.replace(/^\|(.+)\|$/gm, (_, inner) =>
    inner.split('|').map(cell => cell.trim()).join('  '),
  );
  // Inline code
  result = result.replace(/`([^`]+)`/g, '$1');
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  // Italic
  result = result.replace(/\*(.+?)\*/g, '$1');
  result = result.replace(/_(.+?)_/g, '$1');
  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, '$1');
  // Headers
  result = result.replace(/^#{1,6}\s+/gm, '');
  // Blockquotes
  result = result.replace(/^>\s?/gm, '');
  // Horizontal rules
  result = result.replace(/^[-*_]{3,}$/gm, '');
  // Unordered list markers
  result = result.replace(/^[\s]*[-*+]\s+/gm, '• ');
  return result.trim();
}

// ---------------------------------------------------------------------------
// WeixinChannel class
// ---------------------------------------------------------------------------

export class WeixinChannel extends BaseChannel {
  constructor() {
    super({
      id: 'weixin',
      name: 'WeChat',
      description: 'Connect to WeChat via iLink Bot API for sending and receiving messages',
      version: CHANNEL_VERSION,
      icon: '💬',
      transport: 'direct',
      configSchema: {
        autoReply: { type: 'boolean', default: true, description: 'Whether to auto-reply to messages' },
        baseUrl: { type: 'string', default: DEFAULT_BASE_URL, description: 'iLink Bot API base URL' },
      },
    });

    // Internal state
    this._botToken = null;      // iLink bot_token from QR login
    this._botId = null;         // ilink_bot_id
    this._baseUrl = DEFAULT_BASE_URL;
    this._userId = null;        // The user ID who scanned the QR code
    this._getUpdatesBuf = '';   // Long-poll sync buffer
    this._abortController = null;
    this._monitorRunning = false;

    // QR login state
    this._loginState = 'idle';  // idle | qr_pending | scanned | logged_in
    this._qrCodeUrl = null;     // QR code HTML page URL for display
    this._qrCode = null;        // QR code token for status polling
    this._loginSessionKey = null;
    this._loginError = null;
    this._loginPromise = null;

    // Session pause (matching SDK session-guard)
    this._sessionPausedUntil = 0;

    // Context token store: userId -> contextToken
    this._contextTokens = new Map();

    // Config manager (typing_ticket cache)
    this._configManager = null;

    // Persistence path for account data
    this._dataDir = path.join(os.homedir(), '.ai-enterprise', 'channels', 'weixin');
  }

  // --- Abstract method implementations ---

  /**
   * Connect to WeChat via iLink Bot API.
   * If a saved token exists and is valid, reconnects immediately.
   * Otherwise, generates a QR code for login.
   */
  async connect() {
    this._loginError = null;

    // Try to restore existing account
    const restored = this._restoreAccount();
    if (restored && this._botToken) {
      try {
        // Validate token is still alive by doing a getUpdates with short timeout
        const testResp = await getUpdates({
          baseUrl: this._baseUrl,
          token: this._botToken,
          getUpdatesBuf: this._getUpdatesBuf,
          timeoutMs: 10000,
        });
        const isError = (testResp.ret !== undefined && testResp.ret !== 0) ||
                        (testResp.errcode !== undefined && testResp.errcode !== 0);
        if (!isError) {
          console.log(`[WeixinChannel] Session restored for bot: ${this._botId || 'unknown'}`);
          if (testResp.get_updates_buf) {
            this._getUpdatesBuf = testResp.get_updates_buf;
          }
          this._loginState = 'logged_in';
          this._initConfigManager();
          this._startMonitorLoop();
          return;
        }
        console.log('[WeixinChannel] Saved session expired, need to re-login');
      } catch (err) {
        console.log(`[WeixinChannel] Saved session check failed: ${err.message}`);
      }
    }

    // No valid session - start QR code login
    await this._startQRLogin();
    console.log('[WeixinChannel] WeChat channel started - waiting for QR code scan');

    // Start background login polling (non-blocking)
    this._loginPromise = this._completeLoginInBackground();
  }

  /**
   * Background login completion: waits for QR scan, then starts monitor.
   */
  async _completeLoginInBackground() {
    try {
      const result = await this._waitForQRLogin(480000); // 8 minute timeout
      if (result.connected) {
        this._botToken = result.botToken;
        this._botId = result.accountId;
        this._userId = result.userId;
        if (result.baseUrl) {
          this._baseUrl = result.baseUrl;
        }
        this._loginState = 'logged_in';
        this._saveAccount();
        this._initConfigManager();
        this._startMonitorLoop();
        this.setState(ChannelState.CONNECTED);
        this.error = null;
        console.log(`[WeixinChannel] WeChat connected, botId: ${this._botId}`);
      } else {
        throw new Error(result.message || 'Login failed');
      }
    } catch (err) {
      this._loginError = err.message;
      this.setState(ChannelState.ERROR);
      this.error = err.message;
      console.error(`[WeixinChannel] Login failed: ${err.message}`);
    }
  }

  /**
   * Disconnect from WeChat.
   */
  async disconnect() {
    this._monitorRunning = false;
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._loginState = 'idle';
    console.log('[WeixinChannel] Disconnected');
  }

  /**
   * Send a text message to a WeChat user via iLink Bot API.
   * Converts markdown to plain text before sending (matching SDK behavior).
   * @param {OutboundMessage} message
   */
  async sendMessage(message) {
    if (!this._botToken) {
      throw new Error('Not logged in to WeChat');
    }

    const to = message.platformUserId;
    const contextToken = this._contextTokens.get(to);
    const plainText = markdownToPlainText(message.content);

    if (!contextToken) {
      console.warn(`[WeixinChannel] contextToken missing for to=${to}, sending without context`);
    }

    const clientId = generateClientId();
    const body = {
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: plainText
          ? [{ type: MessageItemType.TEXT, text_item: { text: plainText } }]
          : undefined,
        context_token: contextToken || undefined,
      },
    };

    try {
      await sendMessageApi({
        baseUrl: this._baseUrl,
        token: this._botToken,
        body,
      });
    } catch (err) {
      throw new Error(`Send failed: ${err.message}`);
    }
  }

  /**
   * Validate config.
   */
  validateConfig(config) {
    const errors = [];
    if (config.baseUrl && !config.baseUrl.startsWith('http')) {
      errors.push('baseUrl must start with http:// or https://');
    }
    return { valid: errors.length === 0, errors };
  }

  // --- Static helper methods (for API route) ---

  /**
   * Check if the iLink Bot API is reachable.
   */
  static async checkWebProtocol() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${DEFAULT_BOT_TYPE}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      const available = res.ok;
      return {
        available,
        message: available
          ? 'iLink Bot API is reachable'
          : `iLink Bot API returned HTTP ${res.status}`,
      };
    } catch (err) {
      return { available: false, message: `Cannot reach iLink Bot API: ${err.message}` };
    }
  }

  /**
   * Check if a saved account exists.
   */
  static checkSavedSession() {
    const accountPath = path.join(os.homedir(), '.ai-enterprise', 'channels', 'weixin', 'account.json');
    try {
      const data = JSON.parse(fs.readFileSync(accountPath, 'utf-8'));
      return { exists: !!data.token, botId: data.botId || 'unknown' };
    } catch {
      return { exists: false };
    }
  }

  /** Get current login state. */
  getLoginState() {
    return this._loginState;
  }

  /** Get the QR code URL for login (HTML page URL from iLink API). */
  getQRCodeUrl() {
    return this._qrCodeUrl;
  }

  /** Get the last login error (if any). */
  getLoginError() {
    return this._loginError;
  }

  /** Get comprehensive login status for API/UI polling. */
  getLoginStatus() {
    return {
      loginState: this._loginState,
      qrCodeUrl: this._qrCodeUrl,
      channelState: this.state,
      error: this._loginError || this.error,
      botId: this._botId || null,
    };
  }

  // --- Session Guard (matching SDK session-guard.ts) ---

  /** Pause all API calls for 1 hour (called on session expiry). */
  _pauseSession() {
    this._sessionPausedUntil = Date.now() + SESSION_PAUSE_DURATION_MS;
    console.warn(`[WeixinChannel] Session paused until ${new Date(this._sessionPausedUntil).toISOString()}`);
  }

  /** Check if session is currently paused. */
  _isSessionPaused() {
    if (this._sessionPausedUntil <= 0) return false;
    if (Date.now() >= this._sessionPausedUntil) {
      this._sessionPausedUntil = 0;
      return false;
    }
    return true;
  }

  /** Get remaining pause time in ms. */
  _getRemainingPauseMs() {
    if (!this._isSessionPaused()) return 0;
    return Math.max(0, this._sessionPausedUntil - Date.now());
  }

  // --- Config Manager ---

  /** Initialize the per-user config cache (for typing_ticket). */
  _initConfigManager() {
    this._configManager = new ConfigManager({
      baseUrl: this._baseUrl,
      token: this._botToken,
    });
  }

  // --- iLink Bot QR Login Implementation ---

  /**
   * Start QR code login flow via iLink Bot API.
   */
  async _startQRLogin() {
    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    this._baseUrl = baseUrl;

    const qrResponse = await fetchQRCode(baseUrl, DEFAULT_BOT_TYPE);
    if (!qrResponse.qrcode || !qrResponse.qrcode_img_content) {
      throw new Error('Failed to get QR code from iLink Bot API');
    }

    this._qrCode = qrResponse.qrcode;
    this._qrCodeUrl = qrResponse.qrcode_img_content;
    this._loginState = 'qr_pending';
    this._loginSessionKey = crypto.randomUUID();
    this.emit('qr', { url: this._qrCodeUrl, qrcode: this._qrCode });
  }

  /**
   * Wait for QR code scan and login confirmation via long-poll.
   * Automatically refreshes QR code up to MAX_QR_REFRESH_COUNT times if it expires.
   */
  async _waitForQRLogin(timeoutMs = 480000) {
    const baseUrl = this._baseUrl || DEFAULT_BASE_URL;
    const deadline = Date.now() + timeoutMs;
    let qrRefreshCount = 1;
    let qrCode = this._qrCode;

    while (Date.now() < deadline) {
      try {
        const statusResp = await pollQRStatus(baseUrl, qrCode);

        switch (statusResp.status) {
          case 'wait':
            // Still waiting, continue polling
            break;

          case 'scaned':
            if (this._loginState !== 'scanned') {
              this._loginState = 'scanned';
              this.emit('login:scanned');
              console.log('[WeixinChannel] QR scanned, waiting for confirmation...');
            }
            break;

          case 'expired': {
            qrRefreshCount++;
            if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
              return { connected: false, message: 'Login timed out: QR code expired multiple times' };
            }
            console.log(`[WeixinChannel] QR expired, refreshing... (${qrRefreshCount}/${MAX_QR_REFRESH_COUNT})`);
            try {
              const qrResponse = await fetchQRCode(baseUrl, DEFAULT_BOT_TYPE);
              qrCode = qrResponse.qrcode;
              this._qrCode = qrCode;
              this._qrCodeUrl = qrResponse.qrcode_img_content;
              this._loginState = 'qr_pending';
              this.emit('qr:refresh', { url: this._qrCodeUrl });
            } catch (refreshErr) {
              return { connected: false, message: `Failed to refresh QR code: ${refreshErr.message}` };
            }
            break;
          }

          case 'confirmed': {
            if (!statusResp.ilink_bot_id) {
              return { connected: false, message: 'Login failed: server did not return ilink_bot_id' };
            }
            console.log(`[WeixinChannel] Login confirmed! botId=${statusResp.ilink_bot_id}`);
            return {
              connected: true,
              botToken: statusResp.bot_token,
              accountId: statusResp.ilink_bot_id,
              baseUrl: statusResp.baseurl || baseUrl,
              userId: statusResp.ilink_user_id,
              message: 'Login successful',
            };
          }

          default:
            break;
        }
      } catch (err) {
        console.error(`[WeixinChannel] QR status poll error: ${err.message}`);
        return { connected: false, message: `Login failed: ${err.message}` };
      }

      // Brief pause before next poll
      await new Promise(r => setTimeout(r, 1000));
    }

    return { connected: false, message: 'Login timed out' };
  }

  // --- Long-poll Monitor Loop ---

  /**
   * Start the getUpdates long-poll loop for receiving messages.
   * Matches SDK monitorWeixinProvider pattern with session pause support.
   */
  _startMonitorLoop() {
    if (this._monitorRunning) return;
    this._monitorRunning = true;
    this._abortController = new AbortController();

    const run = async () => {
      let consecutiveFailures = 0;
      let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS;

      while (this._monitorRunning && !this._abortController?.signal.aborted) {
        try {
          const resp = await getUpdates({
            baseUrl: this._baseUrl,
            token: this._botToken,
            getUpdatesBuf: this._getUpdatesBuf,
            timeoutMs: nextTimeoutMs,
          });

          // Update server-suggested timeout
          if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
            nextTimeoutMs = resp.longpolling_timeout_ms;
          }

          // Check for API errors
          const isApiError =
            (resp.ret !== undefined && resp.ret !== 0) ||
            (resp.errcode !== undefined && resp.errcode !== 0);

          if (isApiError) {
            const isSessionExpired =
              resp.errcode === SESSION_EXPIRED_ERRCODE ||
              resp.ret === SESSION_EXPIRED_ERRCODE;

            if (isSessionExpired) {
              // Match SDK: pause session for 1 hour instead of hard-stopping
              this._pauseSession();
              const pauseMs = this._getRemainingPauseMs();
              console.error(
                `[WeixinChannel] Session expired (errcode ${SESSION_EXPIRED_ERRCODE}), pausing for ${Math.ceil(pauseMs / 60_000)} min`,
              );
              consecutiveFailures = 0;
              await this._sleep(pauseMs);
              continue;
            }

            consecutiveFailures++;
            console.warn(
              `[WeixinChannel] getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg || ''} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
            );

            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              console.warn(
                `[WeixinChannel] ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off ${BACKOFF_DELAY_MS / 1000}s`,
              );
              consecutiveFailures = 0;
              await this._sleep(BACKOFF_DELAY_MS);
            } else {
              await this._sleep(RETRY_DELAY_MS);
            }
            continue;
          }

          // Success - reset failure counter
          consecutiveFailures = 0;

          // Update sync buffer
          if (resp.get_updates_buf != null && resp.get_updates_buf !== '') {
            this._getUpdatesBuf = resp.get_updates_buf;
            this._saveSyncBuf();
          }

          // Process messages
          const messages = resp.msgs || [];
          for (const msg of messages) {
            await this._processInboundMessage(msg);
          }

        } catch (err) {
          if (this._abortController?.signal.aborted) {
            console.log('[WeixinChannel] Monitor stopped (aborted)');
            return;
          }

          consecutiveFailures++;
          console.warn(`[WeixinChannel] getUpdates error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err.message}`);

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailures = 0;
            await this._sleep(BACKOFF_DELAY_MS);
          } else {
            await this._sleep(RETRY_DELAY_MS);
          }
        }
      }

      console.log('[WeixinChannel] Monitor loop ended');
    };

    run().catch(err => {
      console.error(`[WeixinChannel] Monitor crashed: ${err.message}`);
      this.setState(ChannelState.ERROR);
      this.error = `Monitor crashed: ${err.message}`;
    });
  }

  /**
   * Process a single inbound message from getUpdates.
   * Matches SDK processOneMessage pattern with typing indicators.
   */
  async _processInboundMessage(msg) {
    // Only process user messages (not bot messages)
    if (msg.message_type !== MessageType.USER) return;

    const fromUserId = msg.from_user_id || '';
    if (!fromUserId) return;

    // Store context token for this user (required for replies)
    if (msg.context_token) {
      this._contextTokens.set(fromUserId, msg.context_token);
      this._saveContextTokens();
    }

    // Extract text content
    const textBody = extractTextBody(msg.item_list);
    if (!textBody) return; // Skip non-text messages for now

    // Fetch cached config for typing_ticket
    const contextToken = this._contextTokens.get(fromUserId);
    let typingTicket = '';
    if (this._configManager) {
      try {
        const cachedConfig = await this._configManager.getForUser(fromUserId, contextToken);
        typingTicket = cachedConfig.typingTicket || '';
      } catch {
        // Config fetch failed, continue without typing
      }
    }

    // Send typing indicator (start)
    if (typingTicket) {
      try {
        await sendTypingApi({
          baseUrl: this._baseUrl,
          token: this._botToken,
          body: {
            ilink_user_id: fromUserId,
            typing_ticket: typingTicket,
            status: TypingStatus.TYPING,
          },
        });
      } catch (err) {
        console.warn(`[WeixinChannel] typing send error: ${err.message}`);
      }
    }

    // Note: messagesIn is incremented inside handleInbound() — no need to duplicate here.

    const inbound = new InboundMessage({
      channelId: this.id,
      platformUserId: fromUserId,
      platformUserName: fromUserId,
      content: textBody,
      messageId: String(msg.message_id || msg.seq || Date.now()),
      raw: msg,
      timestamp: msg.create_time_ms ? new Date(msg.create_time_ms) : new Date(),
    });

    try {
      if (this.config.autoReply !== false) {
        await this.handleInbound(inbound);
      } else {
        this.emit('message:in', inbound);
      }
    } finally {
      // Send typing indicator (cancel) after reply is sent
      if (typingTicket) {
        try {
          await sendTypingApi({
            baseUrl: this._baseUrl,
            token: this._botToken,
            body: {
              ilink_user_id: fromUserId,
              typing_ticket: typingTicket,
              status: TypingStatus.CANCEL,
            },
          });
        } catch (err) {
          console.warn(`[WeixinChannel] typing cancel error: ${err.message}`);
        }
      }
    }
  }

  // --- Account Persistence ---

  _saveAccount() {
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      const data = {
        token: this._botToken,
        botId: this._botId,
        baseUrl: this._baseUrl,
        userId: this._userId,
        savedAt: new Date().toISOString(),
      };
      const filePath = path.join(this._dataDir, 'account.json');
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      try { fs.chmodSync(filePath, 0o600); } catch { /* best-effort */ }
    } catch (err) {
      console.warn(`[WeixinChannel] Failed to save account: ${err.message}`);
    }
  }

  _restoreAccount() {
    try {
      const filePath = path.join(this._dataDir, 'account.json');
      if (!fs.existsSync(filePath)) return false;

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!data.token) return false;

      this._botToken = data.token;
      this._botId = data.botId;
      this._baseUrl = data.baseUrl || DEFAULT_BASE_URL;
      this._userId = data.userId;
      this._loginState = 'logged_in';

      // Restore sync buffer
      this._restoreSyncBuf();
      // Restore context tokens
      this._restoreContextTokens();
      return true;
    } catch {
      return false;
    }
  }

  _saveSyncBuf() {
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      fs.writeFileSync(
        path.join(this._dataDir, 'sync-buf.json'),
        JSON.stringify({ get_updates_buf: this._getUpdatesBuf }),
        'utf-8'
      );
    } catch { /* ignore */ }
  }

  _restoreSyncBuf() {
    try {
      const filePath = path.join(this._dataDir, 'sync-buf.json');
      if (!fs.existsSync(filePath)) return;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (data.get_updates_buf) {
        this._getUpdatesBuf = data.get_updates_buf;
      }
    } catch { /* ignore */ }
  }

  _saveContextTokens() {
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
      const tokens = Object.fromEntries(this._contextTokens);
      fs.writeFileSync(
        path.join(this._dataDir, 'context-tokens.json'),
        JSON.stringify(tokens),
        'utf-8'
      );
    } catch { /* ignore */ }
  }

  _restoreContextTokens() {
    try {
      const filePath = path.join(this._dataDir, 'context-tokens.json');
      if (!fs.existsSync(filePath)) return;
      const tokens = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      for (const [userId, token] of Object.entries(tokens)) {
        if (typeof token === 'string' && token) {
          this._contextTokens.set(userId, token);
        }
      }
    } catch { /* ignore */ }
  }

  _clearSavedAccount() {
    const files = ['account.json', 'sync-buf.json', 'context-tokens.json'];
    for (const file of files) {
      try {
        const filePath = path.join(this._dataDir, file);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch { /* ignore */ }
    }
  }

  // --- Utility Methods ---

  _sleep(ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      this._abortController?.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      }, { once: true });
    });
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      state: this.state,
      config: this.config,
      stats: this.stats,
      error: this.error,
      loginState: this._loginState,
      botId: this._botId || null,
    };
  }

  _getSafeConfig() {
    const safe = { ...this.config };
    delete safe.baseUrl;
    return safe;
  }
}
