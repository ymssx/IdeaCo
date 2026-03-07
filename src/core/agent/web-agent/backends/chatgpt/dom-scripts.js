/**
 * ChatGPT DOM 脚本 — 在浏览器页面中执行的 DOM 操作脚本
 *
 * 这些函数生成纯 JS 字符串，通过 webContents.executeJavaScript() 注入到 ChatGPT 页面中执行。
 * 所有脚本必须是自包含的（不能引用外部变量），因为它们在渲染进程的沙盒中运行。
 *
 * 从 electron/main.cjs 中抽出，便于维护和扩展。
 */
import { getSelectors } from './config.js';

/**
 * 构建"发送消息"的 DOM 脚本
 * 在 ChatGPT 页面中找到输入框，输入消息，然后点击发送按钮。
 *
 * @param {string} message - 要发送的消息
 * @returns {string} 可执行的 JS 脚本字符串，返回 { ok: true } 或 { error: string }
 */
export function buildSendMessageScript(message) {
  const escaped = JSON.stringify(message);
  const inputSels = JSON.stringify(getSelectors('input'));
  const sendSels = JSON.stringify(getSelectors('send'));
  return `
(async () => {
  try {
    // --- Step 1: 查找输入框 ---
    const inputSelectors = ${inputSels};
    let inputEl = null;
    for (const sel of inputSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) { inputEl = el; break; }
    }
    if (!inputEl) {
      return { error: "Cannot find input element" };
    }

    // --- Step 2: 清除已有内容并输入消息 ---
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

    // --- Step 3: 查找并点击发送按钮 ---
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
 * 构建"读取回复"的 DOM 脚本
 * 轮询 ChatGPT 页面，读取最新的 assistant 回复内容。
 *
 * @returns {string} 可执行的 JS 脚本字符串，返回 { text, isStreaming, matchedSelector, matchedStopSelector, elementCount }
 */
export function buildReadResponseScript() {
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

  // 总是使用最后一个匹配的元素（最新的回复）
  const last = allEls.length > 0 ? allEls[allEls.length - 1] : null;
  let text = "";
  if (last) {
    const assistantInner = last.querySelector('[data-message-author-role="assistant"]');
    const target = assistantInner || last;
    const mdContainer = target.querySelector('[class*="markdown"]') || target.querySelector('.prose') || target;
    text = clean(mdContainer.innerText || mdContainer.textContent || "");
  }

  // 动态回退 1：查找任何 assistant-like 内容
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

  // 动态回退 2：查找 article 元素
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

  // 动态回退 3：暴力扫描 main 区域
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

  // 停止按钮检测（判断是否还在流式输出）
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
 * 构建"新建对话"的 DOM 脚本
 * 点击 ChatGPT 的"新建对话"按钮，或直接导航到首页。
 *
 * @returns {string} 可执行的 JS 脚本字符串，返回 { ok: true }
 */
export function buildNewChatScript() {
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
 * 构建 DOM 诊断脚本（调试用）
 * 当选择器匹配失败时，收集页面 DOM 结构信息帮助排查。
 *
 * @returns {string} 可执行的 JS 脚本字符串
 */
export function buildDiagnosticScript() {
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
 * 当所有选择器都失败时，尝试从页面 main 区域提取最长的文本块。
 *
 * @returns {string} 可执行的 JS 脚本字符串
 */
export function buildLastResortExtractionScript() {
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
 * 构建响应选择器泛化脚本（校准时使用）
 * 用户点击一个回复气泡后，尝试找到能匹配所有类似气泡的通用选择器。
 *
 * @param {string} specificSelector - 用户点击的元素对应的具体选择器
 * @returns {string} 可执行的 JS 脚本字符串，返回泛化后的选择器
 */
export function buildResponseSelectorGeneralizationScript(specificSelector) {
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
