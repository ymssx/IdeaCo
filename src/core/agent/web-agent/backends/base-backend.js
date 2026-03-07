/**
 * BaseWebBackend — Web 后端基类
 *
 * 所有 web 后端（ChatGPT、Claude、DeepSeek 等）都继承此类。
 * 定义了统一的接口：DOM 脚本构建、选择器管理、站点配置等。
 *
 * Electron 主进程通过 IPC 调用这些方法来操作隐藏的 BrowserWindow。
 * 注意：DOM 脚本运行在渲染进程（浏览器页面）中，必须是纯 JS 字符串。
 */
export class BaseWebBackend {
  constructor() {
    if (new.target === BaseWebBackend) {
      throw new Error('BaseWebBackend is abstract — use a specific backend like ChatGPTBackend');
    }
  }

  // ======================== 必须实现 ========================

  /** @returns {string} 后端唯一标识，如 'chatgpt', 'claude', 'deepseek' */
  get id() {
    throw new Error('Subclass must implement get id()');
  }

  /** @returns {string} 显示名称 */
  get displayName() {
    throw new Error('Subclass must implement get displayName()');
  }

  /** @returns {string} 站点首页 URL */
  get siteUrl() {
    throw new Error('Subclass must implement get siteUrl()');
  }

  /** @returns {string} Electron session partition 名称，如 'persist:chatgpt-login' */
  get partition() {
    throw new Error('Subclass must implement get partition()');
  }

  /**
   * 获取指定角色的 CSS 选择器列表（优先使用用户校准的，再用默认的）
   * @param {'input'|'send'|'response'|'stop'|'newChat'} role
   * @returns {string[]}
   */
  getSelectors(role) {
    throw new Error('Subclass must implement getSelectors()');
  }

  /**
   * 构建"发送消息"的 DOM 脚本字符串
   * @param {string} message - 要发送的消息文本
   * @returns {string} 可在 webContents.executeJavaScript() 中执行的脚本
   */
  buildSendMessageScript(message) {
    throw new Error('Subclass must implement buildSendMessageScript()');
  }

  /**
   * 构建"读取回复"的 DOM 脚本字符串
   * @returns {string} 返回 { text, isStreaming, matchedSelector, elementCount } 的脚本
   */
  buildReadResponseScript() {
    throw new Error('Subclass must implement buildReadResponseScript()');
  }

  /**
   * 构建"新建对话"的 DOM 脚本字符串
   * @returns {string} 返回 { ok: true } 或导航到首页的脚本
   */
  buildNewChatScript() {
    throw new Error('Subclass must implement buildNewChatScript()');
  }

  /**
   * 获取默认选择器配置
   * @returns {object} { input: string[], send: string[], response: string[], stop: string[], newChat: string[] }
   */
  getDefaultSelectors() {
    throw new Error('Subclass must implement getDefaultSelectors()');
  }

  // ======================== 可选覆写 ========================

  /**
   * 判断页面是否已跳转到登录页（session 失效）
   * @param {string} url - 当前页面 URL
   * @returns {boolean}
   */
  isLoginPage(url) {
    return url.includes('auth0') || url.includes('/auth/') || url.includes('login');
  }

  /**
   * 判断 URL 是否属于本后端的站点
   * @param {string} url
   * @returns {boolean}
   */
  isOwnSite(url) {
    return url.includes(new URL(this.siteUrl).hostname);
  }

  /**
   * 判断 URL 是否是一个已有对话页面（用于会话复用）
   * @param {string} url
   * @returns {boolean}
   */
  isConversationUrl(url) {
    return url.includes('/c/');
  }

  /**
   * 构建带模型选择的 URL（某些后端支持通过 URL 参数切换模型）
   * @param {string} model
   * @returns {string|null} 返回 URL 或 null 表示不支持
   */
  buildModelUrl(model) {
    return null;
  }

  /**
   * 验证 cookies 中是否包含有效的 session token
   * @param {Array} cookies - Electron cookie 对象数组
   * @returns {boolean}
   */
  hasValidSession(cookies) {
    return cookies.length > 0;
  }

  /**
   * 获取收集 cookies 时需要查询的域名列表
   * @returns {string[]}
   */
  getCookieDomains() {
    const hostname = new URL(this.siteUrl).hostname;
    return [`.${hostname}`, hostname];
  }

  /**
   * 校准流程的步骤定义（可覆写以适配不同站点的 UI）
   * @returns {Array<{role: string|null, icon: string, type: 'select'|'pause', zh: string, en: string}>}
   */
  getCalibrationSteps() {
    return [
      {
        role: 'newChat', icon: '➕', type: 'select',
        zh: `这是 ${this.displayName} 首页，请点击【新建对话按钮】`,
        en: `Click the NEW CHAT button on ${this.displayName}`,
      },
      {
        role: null, icon: '⌨️', type: 'pause',
        zh: `请在 ${this.displayName} 页面中点击输入框，准备好后点击下方【继续】`,
        en: `Click the input box in ${this.displayName}, then click CONTINUE below`,
      },
      {
        role: 'input', icon: '⌨️', type: 'select',
        zh: '现在请点击【消息输入框】来录制',
        en: 'Now click the MESSAGE INPUT BOX to record it',
      },
      {
        role: null, icon: '✏️', type: 'pause',
        zh: '请在输入框中输入一条消息（不要发送），准备好后点击【继续】',
        en: 'Type a message in the input box (do NOT send yet), then click CONTINUE',
      },
      {
        role: 'send', icon: '📤', type: 'select',
        zh: '现在请点击【发送按钮】来录制',
        en: 'Now click the SEND BUTTON to record it',
      },
      {
        role: null, icon: '⏳', type: 'pause',
        zh: '请点击发送并等待 AI 回复完成，然后点击【继续】',
        en: 'Click send and wait for the AI reply to finish, then click CONTINUE',
      },
      {
        role: 'response', icon: '💬', type: 'select',
        zh: '请点击最后一条【AI 回复气泡】（回复文字区域，注意选最后一条）',
        en: 'Click the LAST AI reply bubble (the text area of the reply)',
      },
    ];
  }
}
