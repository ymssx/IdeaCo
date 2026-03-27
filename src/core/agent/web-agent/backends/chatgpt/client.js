/**
 * ChatGPTBackend — ChatGPT Web 后端实现
 *
 * 继承 BaseWebBackend，实现 ChatGPT 特有的：
 * - DOM 脚本（输入、发送、读取回复、新建对话）
 * - 选择器管理
 * - 登录/Session 验证
 * - 站点判断
 *
 * Electron 主进程通过此后端获取 DOM 脚本，操作隐藏的 BrowserWindow。
 */
import { BaseWebBackend } from '../base-backend.js';
import {
  CHATGPT_CONFIG,
  DEFAULT_SELECTORS,
  getSelectors,
  loadRecordedSelectors,
  saveRecordedSelectors,
  setSelectorsFilePath,
} from './config.js';
import {
  buildSendMessageScript,
  buildReadResponseScript,
  buildNewChatScript,
  buildDiagnosticScript,
  buildLastResortExtractionScript,
  buildResponseSelectorGeneralizationScript,
} from './dom-scripts.js';

export class ChatGPTBackend extends BaseWebBackend {
  constructor() {
    super();
  }

  // ======================== 基本信息 ========================

  get id() {
    return CHATGPT_CONFIG.id;
  }

  get displayName() {
    return CHATGPT_CONFIG.displayName;
  }

  get siteUrl() {
    return CHATGPT_CONFIG.siteUrl;
  }

  get partition() {
    return CHATGPT_CONFIG.partition;
  }

  get userAgent() {
    return CHATGPT_CONFIG.userAgent;
  }

  // ======================== 选择器 ========================

  getSelectors(role) {
    return getSelectors(role);
  }

  getDefaultSelectors() {
    return { ...DEFAULT_SELECTORS };
  }

  /**
   * Set selectors file path (called by Electron layer)
   */
  setSelectorsFilePath(filePath) {
    setSelectorsFilePath(filePath);
  }

  /**
   * 加载已校准的选择器
   */
  loadRecordedSelectors() {
    return loadRecordedSelectors();
  }

  /**
   * 保存校准的选择器
   */
  saveRecordedSelectors(data) {
    saveRecordedSelectors(data);
  }

  // ======================== DOM 脚本 ========================

  buildSendMessageScript(message) {
    return buildSendMessageScript(message);
  }

  buildReadResponseScript() {
    return buildReadResponseScript();
  }

  buildNewChatScript() {
    return buildNewChatScript();
  }

  buildDiagnosticScript() {
    return buildDiagnosticScript();
  }

  buildLastResortExtractionScript() {
    return buildLastResortExtractionScript();
  }

  buildResponseSelectorGeneralizationScript(specificSelector) {
    return buildResponseSelectorGeneralizationScript(specificSelector);
  }

  // ======================== 站点与登录 ========================

  isLoginPage(url) {
    return url.includes('auth0') || url.includes('/auth/') || url.includes('login');
  }

  isOwnSite(url) {
    return url.includes('chatgpt.com');
  }

  isConversationUrl(url) {
    return url.includes('/c/');
  }

  buildModelUrl(model) {
    if (model && model !== 'auto') {
      return `https://chatgpt.com/?model=${model}`;
    }
    return null;
  }

  hasValidSession(cookies) {
    const tokenNames = CHATGPT_CONFIG.sessionTokenNames;
    return cookies.some(c => tokenNames.includes(c.name));
  }

  getCookieDomains() {
    return CHATGPT_CONFIG.cookieDomains;
  }
}

/** 全局单例 */
// Global singleton — use globalThis to survive Next.js HMR in dev mode
if (!globalThis.__chatgptBackend) {
  globalThis.__chatgptBackend = new ChatGPTBackend();
}
export const chatgptBackend = globalThis.__chatgptBackend;
