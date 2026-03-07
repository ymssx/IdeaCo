/**
 * Electron Web Backends — 管理 Web AI 后端的 DOM 交互和窗口管理
 *
 * 这是 Electron 主进程侧的后端管理模块（CJS 格式）。
 * 每个 web 后端（ChatGPT、Claude、DeepSeek 等）在此注册其 DOM 脚本和配置。
 *
 * 架构分工：
 * - 本文件（Electron 侧）：DOM 脚本生成、选择器管理、BrowserWindow 管理
 * - src/core/agent/web-agent/backends/（Next.js 侧）：后端注册、消息构建、会话管理
 *
 * 关键改进：每个 sessionId 拥有独立的 BrowserWindow，避免并发冲突。
 */
const fs = require('fs');
const path = require('path');

// ============================================================
// 后端配置注册表
// ============================================================

/**
 * 后端基本配置
 * 每个后端必须提供：id、siteUrl、partition、选择器、DOM 脚本构建函数
 */
const backends = new Map();

// ============================================================
// ChatGPT 后端
// ============================================================

const CHATGPT_DEFAULT_SELECTORS = {
  input: [
    'p.placeholder',
    '#prompt-textarea',
    'textarea[placeholder]',
    'textarea',
    '[contenteditable="true"][data-placeholder]',
    "[contenteditable='true']",
  ],
  send: [
    '#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    "form button[type='submit']",
    "form button:last-child",
  ],
  response: [
    'div.text-base.my-auto',
    'article[data-testid^="conversation-turn-"] div[data-message-author-role="assistant"]',
    'article[data-testid^="conversation-turn-"]',
    '[data-testid^="conversation-turn-"]',
    'div[data-message-author-role="assistant"]',
    '.agent-turn [data-message-author-role="assistant"]',
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
    'a[data-testid="create-new-chat-button"]',
    'a[href="/"]',
    'nav a:first-child',
    'button[aria-label*="New chat"]',
    'button[aria-label*="new chat"]',
  ],
};

/**
 * 构建 ChatGPT 的发送消息 DOM 脚本
 */
function chatgptBuildSendMessageScript(message, getSelectors) {
  const escaped = JSON.stringify(message);
  const inputSels = JSON.stringify(getSelectors('input'));
  const sendSels = JSON.stringify(getSelectors('send'));
  return `
(async () => {
  try {
    const inputSelectors = ${inputSels};
    let inputEl = null;
    for (const sel of inputSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) { inputEl = el; break; }
    }
    if (!inputEl) {
      return { error: "Cannot find input element" };
    }
    inputEl.focus();
    const msg = ${escaped};
    if (inputEl.tagName === "TEXTAREA" || inputEl.tagName === "INPUT") {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(inputEl, msg);
      } else {
        inputEl.value = msg;
      }
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      inputEl.innerHTML = "<p>" + msg.replace(/\\n/g, "</p><p>") + "</p>";
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 300));
    const sendSelectors = ${sendSels};
    let sendBtn = null;
    for (const sel of sendSelectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && btn.offsetParent !== null) { sendBtn = btn; break; }
    }
    if (!sendBtn) {
      return { error: "Cannot find send button" };
    }
    sendBtn.click();
    return { ok: true };
  } catch (err) {
    return { error: err.message || String(err) };
  }
})()
`;
}

/**
 * 构建 ChatGPT 的读取回复 DOM 脚本
 */
function chatgptBuildReadResponseScript(getSelectors) {
  const responseSels = JSON.stringify(getSelectors('response'));
  const stopSels = JSON.stringify(getSelectors('stop'));
  return `
(() => {
  const clean = (t) => t.replace(/[\\u200B-\\u200D\\uFEFF]/g, "").trim();
  const selectors = ${responseSels};
  let allEls = [];
  let matchedSelector = null;
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) { allEls = Array.from(els); matchedSelector = sel; break; }
  }
  const last = allEls.length > 0 ? allEls[allEls.length - 1] : null;
  let text = "";
  if (last) {
    const assistantInner = last.querySelector('[data-message-author-role="assistant"]');
    const target = assistantInner || last;
    const mdContainer = target.querySelector('[class*="markdown"]') || target.querySelector('.prose') || target;
    text = clean(mdContainer.innerText || mdContainer.textContent || "");
  }
  if (!text) {
    const assistantEls = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (assistantEls.length > 0) {
      const lastAssistant = assistantEls[assistantEls.length - 1];
      const md = lastAssistant.querySelector('[class*="markdown"]') || lastAssistant.querySelector('.prose') || lastAssistant;
      text = clean(md.innerText || md.textContent || "");
      matchedSelector = '[data-message-author-role="assistant"] (dynamic fallback)';
      allEls = Array.from(assistantEls);
    }
  }
  if (!text) {
    const articles = document.querySelectorAll('article');
    if (articles.length > 0) {
      const lastArticle = articles[articles.length - 1];
      const md = lastArticle.querySelector('[class*="markdown"]') || lastArticle.querySelector('.prose') || lastArticle;
      const candidate = clean(md.innerText || md.textContent || "");
      if (candidate.length > 5) {
        text = candidate;
        matchedSelector = 'article (dynamic fallback)';
        allEls = Array.from(articles);
      }
    }
  }
  if (!text) {
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    if (main) {
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => {
          if (node.closest('nav, header, footer, textarea, [contenteditable], input, button')) return NodeFilter.FILTER_REJECT;
          const t = clean(node.innerText || '');
          if (t.length > 30) return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_SKIP;
        }
      });
      let lastNode = null;
      while (walker.nextNode()) { lastNode = walker.currentNode; }
      if (lastNode) {
        const candidate = clean(lastNode.innerText || '');
        if (candidate.length > 30) {
          text = candidate;
          matchedSelector = 'TreeWalker brute-force (main)';
          allEls = [lastNode];
        }
      }
    }
  }
  const stopSelectors = ${stopSels};
  let isStreaming = false;
  let matchedStopSelector = null;
  for (const sel of stopSelectors) {
    const stopEl = document.querySelector(sel);
    if (stopEl && stopEl.offsetParent !== null) { isStreaming = true; matchedStopSelector = sel; break; }
  }
  return { text, isStreaming, matchedSelector, matchedStopSelector, elementCount: allEls.length };
})()
`;
}

/**
 * 构建 ChatGPT 的新建对话 DOM 脚本
 */
function chatgptBuildNewChatScript(getSelectors) {
  const newChatSels = JSON.stringify(getSelectors('newChat'));
  return `
(() => {
  const selectors = ${newChatSels};
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) { el.click(); return { ok: true }; }
  }
  window.location.href = 'https://chatgpt.com/';
  return { ok: true, navigated: true };
})()
`;
}

/**
 * 构建 ChatGPT 的 DOM 诊断脚本
 */
function chatgptBuildDiagnosticScript() {
  return `
(() => {
  const url = location.href;
  const title = document.title;
  const bodyLen = document.body ? document.body.innerHTML.length : 0;
  const hasDialog = !!document.querySelector('dialog, [role="dialog"], [role="alertdialog"]');
  const hasCaptcha = !!document.querySelector('[class*="captcha"], [id*="captcha"], iframe[src*="captcha"]');
  const hasLogin = !!document.querySelector('[data-testid="login-button"], [class*="login"], a[href*="/auth/login"]');
  const probe = [];
  const candidates = ['article', '[data-message-author-role]', '[class*="markdown"]', '.prose',
    '[data-testid]', 'main', '[role="main"]', '[class*="conversation"]', '[class*="message"]',
    '[class*="response"]', '[class*="chat"]', '[class*="turn"]', '[class*="agent"]'];
  for (const sel of candidates) {
    const count = document.querySelectorAll(sel).length;
    if (count > 0) probe.push(sel + ':' + count);
  }
  const mainEl = document.querySelector('main') || document.querySelector('[role="main"]');
  let mainChildren = '';
  if (mainEl) {
    mainChildren = Array.from(mainEl.children).slice(0, 5).map(c =>
      c.tagName.toLowerCase() + (c.className ? '.' + String(c.className).split(' ').slice(0,3).join('.') : '') + (c.id ? '#' + c.id : '')
    ).join(', ');
  }
  return { url, title, bodyLen, hasDialog, hasCaptcha, hasLogin, probe, mainChildren };
})()
`;
}

/**
 * 构建最后手段的文本提取脚本
 */
function chatgptBuildLastResortScript() {
  return `
(() => {
  const clean = (t) => t.replace(/[\\u200B-\\u200D\\uFEFF]/g, "").trim();
  const main = document.querySelector('main') || document.querySelector('[role="main"]');
  if (!main) return '';
  const allDivs = main.querySelectorAll('div, p, span, section');
  let bestText = '';
  let bestLen = 0;
  for (const el of allDivs) {
    if (el.closest('nav, header, footer, textarea, [contenteditable]')) continue;
    const t = clean(el.innerText || '');
    if (t.length > bestLen && t.length > 20) {
      bestText = t;
      bestLen = t.length;
    }
  }
  return bestText;
})()
`;
}

/**
 * 构建响应选择器泛化脚本（校准用）
 */
function chatgptBuildResponseSelectorGeneralizationScript(specificSelector) {
  return `
(function() {
  const clicked = document.querySelector(${JSON.stringify(specificSelector)});
  if (!clicked) return ${JSON.stringify(specificSelector)};
  const directMatches = document.querySelectorAll(${JSON.stringify(specificSelector)});
  if (directMatches.length > 1) return ${JSON.stringify(specificSelector)};
  let el = clicked;
  const maxDepth = 6;
  for (let depth = 0; depth < maxDepth && el && el !== document.body; depth++) {
    const role = el.getAttribute('data-message-author-role');
    if (role === 'assistant') {
      const sel = el.tagName.toLowerCase() + '[data-message-author-role="assistant"]';
      if (document.querySelectorAll(sel).length >= 1) return sel;
    }
    const testId = el.getAttribute('data-testid');
    if (testId && testId.includes('conversation') || testId && testId.includes('message')) {
      const sel = el.tagName.toLowerCase() + '[data-testid="' + testId + '"]';
      if (document.querySelectorAll(sel).length > 1) return sel;
    }
    if (el.classList.length > 0) {
      for (const cls of el.classList) {
        if (cls.startsWith('__') || cls.length < 3) continue;
        const sel = el.tagName.toLowerCase() + '.' + cls;
        const matches = document.querySelectorAll(sel);
        if (matches.length > 1 && matches.length < 50) return sel;
      }
    }
    el = el.parentElement;
  }
  return ${JSON.stringify(specificSelector)};
})()
`;
}

// 注册 ChatGPT 后端
backends.set('chatgpt', {
  id: 'chatgpt',
  displayName: 'ChatGPT',
  siteUrl: 'https://chatgpt.com/',
  partition: 'persist:chatgpt-login',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.191 Safari/537.36',
  cookieDomains: ['.chatgpt.com', 'chatgpt.com', '.openai.com'],
  sessionTokenNames: [
    '__Secure-next-auth.session-token',
    '__Secure-next-auth.session-token.0',
  ],
  defaultSelectors: CHATGPT_DEFAULT_SELECTORS,
  selectorsFile: null, // 运行时由 init() 设置

  buildSendMessageScript: chatgptBuildSendMessageScript,
  buildReadResponseScript: chatgptBuildReadResponseScript,
  buildNewChatScript: chatgptBuildNewChatScript,
  buildDiagnosticScript: chatgptBuildDiagnosticScript,
  buildLastResortScript: chatgptBuildLastResortScript,
  buildResponseSelectorGeneralizationScript: chatgptBuildResponseSelectorGeneralizationScript,

  isLoginPage(url) {
    return url.includes('auth0') || url.includes('/auth/') || url.includes('login');
  },
  isOwnSite(url) {
    return url.includes('chatgpt.com');
  },
  isConversationUrl(url) {
    return url.includes('/c/');
  },
  buildModelUrl(model) {
    if (model && model !== 'auto') return `https://chatgpt.com/?model=${model}`;
    return null;
  },
  hasValidSession(cookies) {
    return cookies.some(c => this.sessionTokenNames.includes(c.name));
  },

  /** 校准步骤定义 */
  calibrationSteps: [
    { role: 'newChat', icon: '➕', type: 'select',
      zh: '这是 ChatGPT 首页，请点击【新建对话按钮】（如侧栏的 New Chat）',
      en: 'Click the NEW CHAT button (e.g. in the sidebar)' },
    { role: null, icon: '⌨️', type: 'pause',
      zh: '请在 ChatGPT 页面中点击输入框，准备好后点击下方【继续】',
      en: 'Click the input box in ChatGPT, then click CONTINUE below' },
    { role: 'input', icon: '⌨️', type: 'select',
      zh: '现在请点击【消息输入框】来录制',
      en: 'Now click the MESSAGE INPUT BOX to record it' },
    { role: null, icon: '✏️', type: 'pause',
      zh: '请在输入框中输入一条消息（不要发送），准备好后点击【继续】',
      en: 'Type a message in the input box (do NOT send yet), then click CONTINUE' },
    { role: 'send', icon: '📤', type: 'select',
      zh: '现在请点击【发送按钮】来录制',
      en: 'Now click the SEND BUTTON to record it' },
    { role: null, icon: '⏳', type: 'pause',
      zh: '请点击发送并等待 AI 回复完成，然后点击【继续】',
      en: 'Click send and wait for the AI reply to finish, then click CONTINUE' },
    { role: 'response', icon: '💬', type: 'select',
      zh: '请点击最后一条【AI 回复气泡】（回复文字区域，注意选最后一条）',
      en: 'Click the LAST AI reply bubble (the text area of the reply)' },
  ],
});

// ============================================================
// 通用选择器管理
// ============================================================

/**
 * 加载用户校准的选择器
 * @param {object} backend - 后端配置
 * @returns {{ recorded: object, timestamp: string|null }}
 */
function loadSelectors(backend) {
  if (!backend.selectorsFile) return { recorded: {}, timestamp: null };
  try {
    if (fs.existsSync(backend.selectorsFile)) {
      const saved = JSON.parse(fs.readFileSync(backend.selectorsFile, 'utf8'));
      if (saved.timestamp) {
        const ageMs = Date.now() - new Date(saved.timestamp).getTime();
        const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
        if (ageMs > MAX_AGE_MS) {
          console.log(`[selectors:${backend.id}] Recorded selectors expired (>30 days old), clearing`);
          fs.unlinkSync(backend.selectorsFile);
          return { recorded: {}, timestamp: null };
        }
      }
      return saved;
    }
  } catch (e) {
    console.error(`[selectors:${backend.id}] Failed to load:`, e.message);
  }
  return { recorded: {}, timestamp: null };
}

/**
 * 保存用户校准的选择器
 * @param {object} backend - 后端配置
 * @param {object} data - { recorded, timestamp }
 */
function saveSelectors(backend, data) {
  if (!backend.selectorsFile) return;
  try {
    fs.writeFileSync(backend.selectorsFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`[selectors:${backend.id}] Failed to save:`, e.message);
  }
}

/**
 * 获取指定角色的有效选择器列表（用户校准优先，然后是默认值）
 * @param {object} backend - 后端配置
 * @param {string} role - 'input' | 'send' | 'response' | 'stop' | 'newChat'
 * @returns {string[]}
 */
function getSelectors(backend, role) {
  const saved = loadSelectors(backend);
  const recorded = saved.recorded?.[role];
  const defaults = backend.defaultSelectors[role] || [];
  if (recorded) {
    return [recorded, ...defaults.filter(s => s !== recorded)];
  }
  return defaults;
}

// ============================================================
// 每个 session 独立的 BrowserWindow 管理
// ============================================================

/**
 * 窗口池：sessionId → { window, ready, conversationUrl, backendId, lastUsed }
 * 每个员工拥有独立的 BrowserWindow，避免并发冲突。
 */
const windowPool = new Map();

/**
 * 窗口闲置超时（毫秒），超过此时间自动关闭释放资源
 */
const WINDOW_IDLE_TIMEOUT = 10 * 60 * 1000; // 10 分钟

/**
 * 定期清理闲置窗口
 */
let cleanupInterval = null;

function startWindowCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, entry] of windowPool) {
      if (now - entry.lastUsed > WINDOW_IDLE_TIMEOUT) {
        console.log(`[window-pool] Closing idle window for session: ${sessionId}`);
        if (entry.window && !entry.window.isDestroyed()) {
          entry.window.close();
        }
        windowPool.delete(sessionId);
      }
    }
  }, 60000); // 每分钟检查一次
}

function stopWindowCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * 关闭所有窗口池中的窗口
 */
function closeAllWindows() {
  for (const [sessionId, entry] of windowPool) {
    if (entry.window && !entry.window.isDestroyed()) {
      entry.window.close();
    }
  }
  windowPool.clear();
}

/**
 * 获取或创建指定 session 的独立 BrowserWindow
 *
 * @param {string} sessionId - 员工/会话标识
 * @param {object} backend - 后端配置
 * @param {object} deps - { BrowserWindow, session, isDev, openLoginWindow }
 * @returns {Promise<BrowserWindow>}
 */
async function ensureSessionWindow(sessionId, backend, deps) {
  const { BrowserWindow, session, isDev, openLoginWindow } = deps;
  const key = sessionId || '__default__';

  // 检查现有窗口是否可用
  const existing = windowPool.get(key);
  if (existing && existing.window && !existing.window.isDestroyed() && existing.ready) {
    try {
      const url = existing.window.webContents.getURL();
      if (backend.isOwnSite(url) && !backend.isLoginPage(url)) {
        existing.lastUsed = Date.now();
        return existing.window;
      }
      // 页面跳走了，需要重建
      if (isDev) console.log(`[window-pool] Window for ${key} navigated away, recreating:`, url);
    } catch {}
    existing.ready = false;
    if (!existing.window.isDestroyed()) existing.window.close();
    windowPool.delete(key);
  }

  // 关闭旧窗口（如果有）
  if (existing && existing.window && !existing.window.isDestroyed()) {
    existing.window.close();
  }
  windowPool.delete(key);

  // 创建新的独立窗口
  const ses = session.fromPartition(backend.partition);
  ses.setUserAgent(backend.userAgent);

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: isDev,
    webPreferences: {
      partition: backend.partition,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadURL(backend.siteUrl);

  // 等待页面加载完成
  await new Promise((resolve) => {
    const wc = win.webContents;
    wc.once('did-finish-load', () => setTimeout(resolve, 3000));
    setTimeout(resolve, 20000);
  });

  // 检查是否被重定向到登录页
  const finalUrl = win.webContents.getURL();
  if (isDev) console.log(`[window-pool] Page loaded for ${key}, URL:`, finalUrl);

  if (backend.isLoginPage(finalUrl)) {
    if (isDev) console.log(`[window-pool] Redirected to login page for ${key}`);
    win.close();

    const loginResult = await openLoginWindow(backend);
    if (!loginResult.ok) {
      throw new Error(`${backend.displayName} login required. Please log in.`);
    }

    // 用新 session 重试
    const retryWin = new BrowserWindow({
      width: 1024,
      height: 768,
      show: isDev,
      webPreferences: {
        partition: backend.partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await retryWin.loadURL(backend.siteUrl);
    await new Promise((resolve) => {
      const wc = retryWin.webContents;
      wc.once('did-finish-load', () => setTimeout(resolve, 3000));
      setTimeout(resolve, 20000);
    });

    const entry = {
      window: retryWin,
      ready: true,
      conversationUrl: null,
      backendId: backend.id,
      lastUsed: Date.now(),
    };
    windowPool.set(key, entry);

    retryWin.on('closed', () => {
      const e = windowPool.get(key);
      if (e && e.window === retryWin) {
        windowPool.delete(key);
      }
    });

    return retryWin;
  }

  // 检查输入框是否存在
  try {
    const inputSels = getSelectors(backend, 'input');
    const hasInput = await win.webContents.executeJavaScript(`
      (function() {
        const sels = ${JSON.stringify(inputSels)};
        for (const sel of sels) {
          if (document.querySelector(sel)) return true;
        }
        return false;
      })()
    `);
    if (!hasInput) {
      if (isDev) console.log(`[window-pool] Warning: input not found for ${key} after page load`);
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (e) {
    if (isDev) console.log(`[window-pool] Input check error for ${key}:`, e.message);
  }

  const entry = {
    window: win,
    ready: true,
    conversationUrl: null,
    backendId: backend.id,
    lastUsed: Date.now(),
  };
  windowPool.set(key, entry);

  win.on('closed', () => {
    const e = windowPool.get(key);
    if (e && e.window === win) {
      windowPool.delete(key);
    }
  });

  if (isDev) console.log(`[window-pool] Window ready for session: ${key}`);
  return win;
}

/**
 * 执行 DOM 聊天：在指定 session 的独立窗口中发送消息并等待回复
 *
 * @param {object} params - { message, model, timeoutMs, newConversation, sessionId, backendId }
 * @param {object} deps - { BrowserWindow, session, isDev, openLoginWindow }
 * @returns {Promise<{ text: string, error: string|null }>}
 */
async function domChat(params, deps) {
  const { message, model, timeoutMs = 120000, newConversation = false, sessionId = null, backendId = 'chatgpt' } = params;
  const { isDev } = deps;

  const backend = backends.get(backendId);
  if (!backend) {
    return { text: '', error: `Unknown backend: ${backendId}` };
  }

  const getBackendSelectors = (role) => getSelectors(backend, role);

  try {
    const win = await ensureSessionWindow(sessionId, backend, deps);
    const wc = win.webContents;
    const key = sessionId || '__default__';
    const entry = windowPool.get(key);

    // 处理对话导航
    if (newConversation) {
      if (entry) entry.conversationUrl = null;
      await wc.executeJavaScript(backend.buildNewChatScript(getBackendSelectors));
      await new Promise(r => setTimeout(r, 1500));

      // 模型选择（如果后端支持）
      const modelUrl = backend.buildModelUrl(model);
      if (modelUrl) {
        try {
          await win.loadURL(modelUrl);
          await new Promise(r => setTimeout(r, 2000));
        } catch { /* 模型选择失败不影响功能 */ }
      }
    } else if (entry && entry.conversationUrl) {
      // 复用已有对话
      const currentUrl = wc.getURL();
      if (!backend.isConversationUrl(currentUrl) || currentUrl !== entry.conversationUrl) {
        if (isDev) console.log(`[dom-chat] Navigating to conversation for ${key}: ${entry.conversationUrl}`);
        await wc.loadURL(entry.conversationUrl);
        await new Promise(r => setTimeout(r, 2000));
      }
    } else {
      // 没有对话，新建
      await wc.executeJavaScript(backend.buildNewChatScript(getBackendSelectors));
      await new Promise(r => setTimeout(r, 1500));
    }

    // 发送消息
    const sendResult = await wc.executeJavaScript(backend.buildSendMessageScript(message, getBackendSelectors));
    if (sendResult.error) {
      if (sendResult.error.includes('Cannot find') && entry) {
        entry.ready = false;
      }
      return { error: `DOM send failed: ${sendResult.error}`, text: '' };
    }

    if (isDev) console.log(`[dom-chat] Message sent for ${key}, polling for response...`);

    // 首次轮询前多等一会
    await new Promise(r => setTimeout(r, 3000));

    // 轮询等待回复
    const startTime = Date.now();
    let lastText = '';
    let stableCount = 0;
    let pollCount = 0;
    let emptyCount = 0;
    let lastLoggedSelector = null;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(r => setTimeout(r, 1500));
      const result = await wc.executeJavaScript(backend.buildReadResponseScript(getBackendSelectors));
      pollCount++;

      if (isDev && (pollCount <= 3 || pollCount % 5 === 0)) {
        console.log(`[dom-chat:${key}] poll #${pollCount}: text=${result.text ? result.text.substring(0, 80) + '...' : '(empty)'}, streaming=${result.isStreaming}, selector=${result.matchedSelector || 'NONE'}, elements=${result.elementCount}`);
      }
      if (!lastLoggedSelector && result.matchedSelector) {
        lastLoggedSelector = result.matchedSelector;
        if (isDev) console.log(`[dom-chat:${key}] Response selector matched: "${result.matchedSelector}" (${result.elementCount} elements)`);
      }

      if (!result.text) {
        emptyCount++;
        // 诊断信息
        if (isDev && emptyCount === 3) {
          try {
            const diag = await wc.executeJavaScript(backend.buildDiagnosticScript());
            console.log(`[dom-chat:${key}] DOM diagnostic:`, JSON.stringify(diag, null, 2));
          } catch (diagErr) {
            console.error(`[dom-chat:${key}] Diagnostic failed:`, diagErr.message);
          }
        }
        if (emptyCount >= 20) {
          // 最后手段：提取页面文本
          let lastResortText = '';
          try {
            lastResortText = await wc.executeJavaScript(backend.buildLastResortScript());
          } catch {}

          if (lastResortText && lastResortText.length > 20) {
            if (isDev) console.log(`[dom-chat:${key}] Last-resort text extraction: ${lastResortText.length} chars`);
            return { text: lastResortText, error: null };
          }

          const selectors = getBackendSelectors('response');
          return {
            text: '',
            error: `Response selector not matching after ${emptyCount} polls. Tried: ${JSON.stringify(selectors)}. Re-calibrate needed.`
          };
        }
        continue;
      }

      emptyCount = 0;

      if (result.text === lastText) {
        if (result.isStreaming) {
          stableCount = 0;
        } else {
          stableCount++;
        }
        if (stableCount >= 2) {
          // 捕获对话 URL 用于会话复用
          try {
            const convUrl = wc.getURL();
            if (backend.isConversationUrl(convUrl) && entry) {
              entry.conversationUrl = convUrl;
              if (isDev) console.log(`[dom-chat:${key}] Conversation URL captured: ${convUrl}`);
            }
          } catch {}
          if (isDev) console.log(`[dom-chat:${key}] Response stable after ${pollCount} polls, ${result.text.length} chars`);
          return { text: result.text, error: null };
        }
      } else {
        stableCount = 0;
      }
      lastText = result.text;
    }

    // 超时
    if (isDev) console.log(`[dom-chat:${key}] Timeout after ${pollCount} polls`);
    if (lastText) {
      return { text: lastText, error: 'timeout_partial' };
    }
    return { error: 'Timeout waiting for response', text: '' };
  } catch (err) {
    console.error(`[dom-chat] Error:`, err.message);
    return { error: err.message, text: '' };
  }
}

// ============================================================
// 初始化（由 main.cjs 调用）
// ============================================================

/**
 * 初始化所有后端（设置文件路径等运行时配置）
 * @param {object} opts - { userDataPath }
 */
function init(opts) {
  const { userDataPath } = opts;
  // 设置 ChatGPT 选择器文件路径
  const chatgpt = backends.get('chatgpt');
  if (chatgpt) {
    chatgpt.selectorsFile = path.join(userDataPath, 'chatgpt-selectors.json');
  }
  // 启动窗口清理定时器
  startWindowCleanup();
}

/**
 * 清理资源
 */
function cleanup() {
  stopWindowCleanup();
  closeAllWindows();
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  backends,
  getSelectors,
  loadSelectors,
  saveSelectors,
  ensureSessionWindow,
  domChat,
  windowPool,
  closeAllWindows,
  init,
  cleanup,
};
