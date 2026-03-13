/**
 * ChatGPT 配置 — 选择器、URL、Session 配置
 *
 * 集中管理所有 ChatGPT 特有的配置项：
 * - CSS 选择器（输入框、发送按钮、回复气泡、停止按钮、新建对话）
 * - 站点 URL 和 session partition
 * - Cookie 域名和 session token 名称
 */
import fs from 'fs';
import path from 'path';

// Selectors persistence file path (injected at runtime by Electron layer)
let _selectorsFilePath = null;

/**
 * Set selectors persistence file path (called by Electron main process)
 * @param {string} filePath
 */
export function setSelectorsFilePath(filePath) {
  _selectorsFilePath = filePath;
}

/**
 * ChatGPT 站点配置
 */
export const CHATGPT_CONFIG = {
  id: 'chatgpt',
  displayName: 'ChatGPT',
  siteUrl: 'https://chatgpt.com/',
  partition: 'persist:chatgpt-login',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.191 Safari/537.36',

  /** Cookie 相关 */
  cookieDomains: ['.chatgpt.com', 'chatgpt.com', '.openai.com'],
  sessionTokenNames: [
    '__Secure-next-auth.session-token',
    '__Secure-next-auth.session-token.0',
  ],
};

/**
 * 默认 CSS 选择器
 */
export const DEFAULT_SELECTORS = {
  input: [
    // Calibrated 2026-03
    'p.placeholder',
    '#prompt-textarea',
    'textarea[placeholder]',
    'textarea',
    '[contenteditable="true"][data-placeholder]',
    "[contenteditable='true']",
  ],
  send: [
    // Calibrated 2026-03
    '#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    "form button[type='submit']",
    "form button:last-child",
  ],
  response: [
    // Calibrated 2026-03
    'div.text-base.my-auto',
    // ChatGPT 2025+ structures
    'article[data-testid^="conversation-turn-"] div[data-message-author-role="assistant"]',
    'article[data-testid^="conversation-turn-"]',
    '[data-testid^="conversation-turn-"]',
    // Classic structures
    'div[data-message-author-role="assistant"]',
    '.agent-turn [data-message-author-role="assistant"]',
    // Broad fallbacks
    '[class*="markdown"]',
    '.prose',
  ],
  stop: [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label*="Stop"]',
    'button.bg-black .icon-lg',
  ],
  newChat: [
    // Calibrated 2026-03
    'a[data-testid="create-new-chat-button"]',
    'a[href="/"]',
    'nav a:first-child',
    'button[aria-label*="New chat"]',
    'button[aria-label*="new chat"]',
  ],
};

/**
 * 加载用户校准过的选择器（如果有的话）
 * @returns {{ recorded: object, timestamp: string|null }}
 */
export function loadRecordedSelectors() {
  if (!_selectorsFilePath) return { recorded: {}, timestamp: null };
  try {
    if (fs.existsSync(_selectorsFilePath)) {
      const saved = JSON.parse(fs.readFileSync(_selectorsFilePath, 'utf8'));
      // 超过 30 天自动过期
      if (saved.timestamp) {
        const ageMs = Date.now() - new Date(saved.timestamp).getTime();
        const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
        if (ageMs > MAX_AGE_MS) {
          console.log('[chatgpt-config] Recorded selectors expired (>30 days old), clearing');
          fs.unlinkSync(_selectorsFilePath);
          return { recorded: {}, timestamp: null };
        }
      }
      return saved;
    }
  } catch (e) {
    console.error('[chatgpt-config] Failed to load selectors:', e.message);
  }
  return { recorded: {}, timestamp: null };
}

/**
 * 保存用户校准的选择器
 * @param {object} data - { recorded: object, timestamp: string }
 */
export function saveRecordedSelectors(data) {
  if (!_selectorsFilePath) return;
  try {
    fs.writeFileSync(_selectorsFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[chatgpt-config] Failed to save selectors:', e.message);
  }
}

/**
 * 获取指定角色的有效选择器列表（用户校准优先）
 * @param {'input'|'send'|'response'|'stop'|'newChat'} role
 * @returns {string[]}
 */
export function getSelectors(role) {
  const saved = loadRecordedSelectors();
  const recorded = saved.recorded?.[role];
  const defaults = DEFAULT_SELECTORS[role] || [];
  if (recorded) {
    return [recorded, ...defaults.filter(s => s !== recorded)];
  }
  return defaults;
}
