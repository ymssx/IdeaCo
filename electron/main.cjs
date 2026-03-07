const { app, BrowserWindow, shell, dialog, ipcMain, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const webBackends = require('./web-backends.cjs');

const isDev = !app.isPackaged;
const PORT = 9999;

let mainWindow = null;
let serverProcess = null;

function getResourcePath() {
  if (isDev) {
    return path.join(__dirname, '..');
  }
  return path.join(process.resourcesPath, 'app');
}

function getUserDataPath() {
  return path.join(app.getPath('userData'), 'server-data');
}

function ensureDataDirs() {
  // In packaged mode, write data to userData (writable) instead of resources (read-only)
  const base = isDev ? getResourcePath() : getUserDataPath();
  const dirs = ['data', 'data/memories', 'data/audit', 'workspace'];
  for (const dir of dirs) {
    const fullPath = path.join(base, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
  return base;
}

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

function waitForServer(port, retries = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
        client.end();
        resolve();
      });
      client.on('error', () => {
        if (attempts >= retries) {
          reject(new Error(`Server did not start after ${retries} attempts`));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

async function startNextServer(port, dataPath) {
  const resourcePath = getResourcePath();
  const serverJs = path.join(resourcePath, 'server.js');

  if (!fs.existsSync(serverJs)) {
    throw new Error(`server.js not found at ${serverJs}`);
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    // ELECTRON_RUN_AS_NODE makes Electron binary behave as plain Node.js
    ELECTRON_RUN_AS_NODE: '1',
    CHATGPT_PROXY_PORT: String(chatgptProxyPort || ''),
  };

  // If packaged, point data/workspace dirs to writable userData location
  if (!isDev) {
    env.IDEACO_DATA_DIR = path.join(dataPath, 'data');
    env.IDEACO_WORKSPACE_DIR = path.join(dataPath, 'workspace');
  }

  serverProcess = spawn(process.execPath, [serverJs], {
    cwd: resourcePath,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[server] ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[server] ${data.toString().trim()}`);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[server] exited with code ${code}`);
    if (code !== 0 && code !== null && mainWindow) {
      dialog.showErrorBox('Server Error', `Next.js server exited unexpectedly (code ${code})`);
    }
  });

  await waitForServer(port);
}

function createWindow(port) {
  const windowOptions = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'IdeaCo',
    icon: path.join(getResourcePath(), 'public', 'logo.png'),
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  };

  // macOS: 使用隐藏标题栏 + 内嵌红绿灯按钮，背景色与页面一致
  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 12, y: 12 };
  }

  // Windows: 自定义标题栏颜色
  if (process.platform === 'win32') {
    windowOptions.titleBarOverlay = {
      color: '#0a0a0a',
      symbolColor: '#ededed',
      height: 36,
    };
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }, 5000);
    serverProcess = null;
  }
}

// === ChatGPT Cookie Helpers (shared between login and refresh) ===
// Default partition and UA (kept for backward compatibility with login-chatgpt IPC handler)
const CHATGPT_PARTITION = 'persist:chatgpt-login';
const CLEAN_CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.191 Safari/537.36';

/**
 * Get session for a backend (or default to ChatGPT)
 * @param {object} [backend] - Backend config from webBackends.backends
 */
function getBackendSession(backend) {
  const partition = backend?.partition || CHATGPT_PARTITION;
  const ua = backend?.userAgent || CLEAN_CHROME_UA;
  const ses = session.fromPartition(partition);
  ses.setUserAgent(ua);
  return ses;
}

// Shortcut: ChatGPT session (backward compat)
function getChatGPTSession() {
  return getBackendSession(webBackends.backends.get('chatgpt'));
}

/**
 * Collect cookies for a backend
 * @param {object} [backend] - Backend config; defaults to ChatGPT
 */
async function collectCookiesForBackend(backend) {
  const ses = getBackendSession(backend);
  const domains = backend?.cookieDomains || ['.chatgpt.com', 'chatgpt.com', '.openai.com'];
  const results = await Promise.all(
    domains.map(d => ses.cookies.get({ domain: d }).catch(() => []))
  );
  const all = results.flat();
  const seen = new Set();
  return all.filter(c => {
    const key = `${c.name}@${c.domain}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Backward compat
async function collectChatGPTCookies() {
  return collectCookiesForBackend(webBackends.backends.get('chatgpt'));
}

/**
 * Check if cookies contain a valid session token for a backend
 * @param {Array} cookies
 * @param {object} [backend]
 */
function hasSessionToken(cookies, backend) {
  const tokenNames = backend?.sessionTokenNames || [
    '__Secure-next-auth.session-token',
    '__Secure-next-auth.session-token.0',
  ];
  return cookies.some(c => tokenNames.includes(c.name));
}

function cookiesToString(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/**
 * Open a login window for a web backend and wait for the user to complete login.
 * Supports any backend — uses backend config for URL, partition, session token detection.
 * @param {object} [backend] - Backend config from webBackends.backends; defaults to ChatGPT
 * @returns {Promise<{ok: boolean, cookie?: string, error?: string}>}
 */
function openLoginWindow(backend) {
  const backendConfig = backend || webBackends.backends.get('chatgpt');
  const displayName = backendConfig?.displayName || 'ChatGPT';
  const siteUrl = backendConfig?.siteUrl || 'https://chatgpt.com/';
  const partition = backendConfig?.partition || CHATGPT_PARTITION;

  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 520,
      height: 720,
      title: `Login to ${displayName}`,
      parent: mainWindow,
      modal: false,
      webPreferences: {
        partition: partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    loginWin.loadURL(siteUrl);
    if (isDev) loginWin.webContents.openDevTools({ mode: 'detach' });

    let resolved = false;

    const checkLogin = async () => {
      if (resolved) return;
      try {
        const cookies = await collectCookiesForBackend(backendConfig);
        if (isDev) console.log(`[login-${backendConfig?.id || 'chatgpt'}] poll cookies:`, cookies.length, 'hasToken:', hasSessionToken(cookies, backendConfig));
        if (hasSessionToken(cookies, backendConfig)) {
          resolved = true;
          if (isDev) console.log(`[login-${backendConfig?.id || 'chatgpt'}] login detected! cookie names:`, cookies.map(c => c.name));
          loginWin.close();
          resolve({ ok: true, cookie: cookiesToString(cookies) });
        }
      } catch (e) {
        if (isDev) console.log(`[login-${backendConfig?.id || 'chatgpt'}] checkLogin error:`, e.message);
      }
    };

    const pollInterval = setInterval(() => {
      if (resolved) { clearInterval(pollInterval); return; }
      checkLogin();
    }, 3000);

    loginWin.on('closed', () => {
      clearInterval(pollInterval);
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, error: `${displayName} login window closed` });
      }
    });
  });
}

// === ChatGPT Browser Login: open a window, let user login, extract cookies ===
ipcMain.handle('login-chatgpt', async () => {
  // Quick check: if already logged in from a previous session, return cookies directly
  const existingCookies = await collectChatGPTCookies();
  if (isDev) console.log('[login-chatgpt] existing cookies:', existingCookies.length, 'names:', existingCookies.map(c => c.name));
  if (hasSessionToken(existingCookies)) {
    if (isDev) console.log('[login-chatgpt] found existing session token, reusing cookies');
    return { ok: true, cookie: cookiesToString(existingCookies) };
  }
  // No valid session — open login window
  return await openLoginWindow();
});

// === Refresh ChatGPT Cookie: silently re-collect cookies, open login window only if truly expired ===
ipcMain.handle('refresh-chatgpt-cookie', async () => {
  const cookies = await collectChatGPTCookies();
  if (isDev) console.log('[refresh-cookie] cookies:', cookies.length, 'hasToken:', hasSessionToken(cookies));

  if (hasSessionToken(cookies)) {
    return { ok: true, cookie: cookiesToString(cookies) };
  }

  // Cookies expired — open login window for re-login
  if (isDev) console.log('[refresh-cookie] session expired, opening login window...');
  return await openLoginWindow();
});

// === ChatGPT Proxy Server ===
// Local HTTP proxy that forwards requests to ChatGPT using Chromium's network stack
// (ses.fetch with persist:chatgpt-login session). This ensures:
// 1. TLS fingerprint = real Chromium (not Node.js)
// 2. Cookies auto-managed by Chromium session
// 3. HTTP/2, header ordering, etc. all match real browser
let chatgptProxyPort = null;

function startChatGPTProxy() {
  return new Promise((resolve) => {
    const ses = getChatGPTSession();

    const proxyServer = http.createServer(async (req, res) => {
      // Only accept POST from localhost
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }

      // Read request body
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bodyBuf = Buffer.concat(chunks);

      try {
        const { url, method, headers, body } = JSON.parse(bodyBuf.toString());

        // Special route: DOM-based chat via hidden BrowserWindow
        if (url === '__dom_chat__' && method === 'DOM_CHAT') {
          try {
            const params = JSON.parse(body || '{}');
            const result = await webBackends.domChat(params, {
              BrowserWindow, session, isDev,
              openLoginWindow: (backend) => openLoginWindow(backend),
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (domErr) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ text: '', error: domErr.message }));
          }
          return;
        }

        if (!url || !url.startsWith('https://chatgpt.com/')) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid URL — only chatgpt.com allowed' }));
          return;
        }

        if (isDev) console.log(`[chatgpt-proxy] ${method || 'GET'} ${url}`);

        // Build headers for Chromium fetch — use real browser headers
        const fetchHeaders = { ...(headers || {}) };
        // Remove Cookie header — Chromium session manages cookies automatically
        delete fetchHeaders['Cookie'];
        delete fetchHeaders['cookie'];

        const fetchOpts = {
          method: method || 'GET',
          headers: fetchHeaders,
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
          fetchOpts.body = body;
        }

        // Use ses.fetch — Chromium network stack with the persist:chatgpt-login session
        // This automatically sends cookies, uses Chromium TLS, etc.
        const response = await ses.fetch(url, fetchOpts);

        // Forward response status and headers
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
          // Skip transfer-encoding since we're re-sending the body
          if (key.toLowerCase() === 'transfer-encoding') return;
          responseHeaders[key] = value;
        });

        const responseBody = await response.text();

        res.writeHead(response.status, responseHeaders);
        res.end(responseBody);

        if (isDev) console.log(`[chatgpt-proxy] → ${response.status} (${responseBody.length} bytes)`);
      } catch (err) {
        console.error('[chatgpt-proxy] error:', err.message);
        res.writeHead(502);
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    // Listen on random available port on localhost only
    proxyServer.listen(0, '127.0.0.1', () => {
      chatgptProxyPort = proxyServer.address().port;
      console.log(`[chatgpt-proxy] listening on http://127.0.0.1:${chatgptProxyPort}`);
      resolve(chatgptProxyPort);
    });
  });
}

// IPC to get the proxy port
ipcMain.handle('get-chatgpt-proxy-port', () => {
  return chatgptProxyPort;
});

// === Selector Recording & Persistence (delegated to web-backends.cjs) ===
// Users can calibrate selectors by clicking on actual UI elements.
// Selector storage and management is handled by the web-backends module.
// Initialize backends with userData path (called after app.whenReady)
function initWebBackends() {
  webBackends.init({ userDataPath: app.getPath('userData') });
}

/**
 * Convenience: get selectors for a given backend and role
 */
function getSelectorsForBackend(backendId, role) {
  const backend = webBackends.backends.get(backendId);
  if (!backend) return [];
  return webBackends.getSelectors(backend, role);
}

/**
 * Generate a CSS selector for a DOM node, given its attributes.
 * Used in the main process to build a selector from CDP node data.
 */
function buildSelectorFromNodeAttrs(nodeName, attributes) {
  const attrs = {};
  // CDP returns attributes as flat array: [name, value, name, value, ...]
  for (let i = 0; i < attributes.length; i += 2) {
    attrs[attributes[i]] = attributes[i + 1];
  }
  const tag = nodeName.toLowerCase();
  if (attrs.id) return '#' + attrs.id;
  if (attrs['data-testid']) return `${tag}[data-testid="${attrs['data-testid']}"]`;
  if (attrs['aria-label']) return `${tag}[aria-label="${attrs['aria-label']}"]`;
  if (attrs['data-message-author-role']) return `${tag}[data-message-author-role="${attrs['data-message-author-role']}"]`;
  if (attrs.placeholder) return `${tag}[placeholder="${attrs.placeholder}"]`;
  if (attrs.contenteditable === 'true') return `${tag}[contenteditable="true"]`;
  if (attrs.href) return `${tag}[href="${attrs.href}"]`;
  // Fallback: tag + class
  if (attrs.class) {
    const cls = attrs.class.split(/\s+/).filter(c => c && !c.startsWith('__')).slice(0, 2).join('.');
    if (cls) return `${tag}.${cls}`;
  }
  return tag;
}

/**
 * IPC: Open calibration windows for selector recording.
 * Uses CDP (Chrome DevTools Protocol) Overlay.inspectNodeRequested —
 * the same mechanism as Chrome DevTools "select element" button.
 * No JS event listeners injected into the page at all.
 *
 * Dual-window:
 *   1. Guide window (small, always-on-top) — shows step instructions
 *   2. ChatGPT window — CDP inspect mode highlights & selects elements
 */
ipcMain.handle('calibrate-selectors', async () => {
  /**
   * Calibration flow (redesigned):
   *   Step 1: newChat  — select the "New Chat" button (starts from homepage)
   *   Step 2: (auto-pause) user clicks input box naturally
   *   Step 3: input    — select the input box
   *   Step 4: (auto-pause) user types a message
   *   Step 5: send     — select the send button
   *   Step 6: (auto-pause) user clicks send & waits for AI reply
   *   Step 7: response — select the AI reply bubble (LAST one)
   *
   * "auto-pause" steps pause inspect mode so user can interact with the page,
   * then show a "Ready / 继续" button to re-enter selection mode.
   */
  // 从后端配置获取校准步骤
  const chatgptBackend = webBackends.backends.get('chatgpt');
  const STEPS = chatgptBackend ? chatgptBackend.calibrationSteps : [];

  return new Promise((resolve) => {
    // --- 1. Guide window ---
    const guideWin = new BrowserWindow({
      width: 460,
      height: 580,
      x: 50,
      y: 80,
      alwaysOnTop: true,
      resizable: false,
      minimizable: false,
      title: 'IdeaCo — Selector Calibration',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });

    let inspectPaused = false;

    const buildGuideHTML = (stepIdx) => {
      const step = STEPS[stepIdx];
      const isPauseStep = step.type === 'pause';

      const stepsHtml = STEPS.map((s, i) => {
        // Only show 'select' steps in the progress list, but also show current pause step
        const status = i < stepIdx ? '✅' : i === stepIdx ? '👉' : '⬜';
        const opacity = i === stepIdx ? '1' : i > stepIdx ? '0.35' : '0.6';
        const bg = i === stepIdx
          ? (isPauseStep ? 'background:rgba(234,179,8,0.15);' : 'background:rgba(67,97,238,0.15);')
          : '';
        return `<div style="display:flex;align-items:center;gap:10px;padding:7px 14px;opacity:${opacity};border-radius:8px;${bg}">
          <span style="font-size:16px">${status}</span>
          <span style="font-size:18px">${s.icon}</span>
          <div><div style="font-size:12px;font-weight:600">${s.zh}</div><div style="font-size:10px;color:#888;margin-top:2px">${s.en}</div></div>
        </div>`;
      }).join('');

      // For pause steps: show a prominent "Continue" button
      // For select steps: show status + skip button
      let controlsHtml = '';
      let statusText = '';

      if (isPauseStep) {
        statusText = '🟡 已暂停 — 请在 ChatGPT 页面中操作，完成后点击继续';
        controlsHtml = `
          <button style="background:rgba(34,197,94,0.25);border-color:rgba(34,197,94,0.5);color:#4ade80;padding:10px 32px;border-radius:8px;border:1px solid;font-size:14px;font-weight:700;cursor:pointer;-webkit-app-region:no-drag"
            onclick="console.log('__CONTINUE__')">▶️ 继续 Continue</button>
          <button style="background:rgba(120,120,120,0.2);border-color:rgba(120,120,120,0.4);color:#aaa;padding:8px 16px;border-radius:8px;border:1px solid;font-size:12px;cursor:pointer;-webkit-app-region:no-drag"
            onclick="console.log('__SKIP_STEP__')">⏭️ 跳过 Skip</button>`;
      } else {
        statusText = '🔵 选择模式 — 鼠标移到元素上高亮，点击选中';
        controlsHtml = `
          <button style="background:rgba(234,179,8,0.25);border-color:rgba(234,179,8,0.5);color:#facc15;padding:8px 18px;border-radius:8px;border:1px solid;font-size:13px;font-weight:600;cursor:pointer;-webkit-app-region:no-drag"
            onclick="console.log('__TOGGLE_PAUSE__')">⏸️ 暂停 Pause</button>
          <button style="background:rgba(120,120,120,0.2);border-color:rgba(120,120,120,0.4);color:#aaa;padding:8px 16px;border-radius:8px;border:1px solid;font-size:12px;cursor:pointer;-webkit-app-region:no-drag"
            onclick="console.log('__SKIP_STEP__')">⏭️ 跳过 Skip</button>`;
      }

      const selectSteps = STEPS.filter(s => s.type === 'select');
      const currentSelectIdx = step.type === 'select' ? selectSteps.indexOf(step) + 1 : selectSteps.findIndex(s => STEPS.indexOf(s) > stepIdx) ;
      const progressText = `Step ${stepIdx + 1} / ${STEPS.length} (录制 ${currentSelectIdx > 0 ? currentSelectIdx : '—'} / ${selectSteps.length})`;

      return `<!DOCTYPE html><html><head><meta charset="utf-8">
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family:system-ui,-apple-system,sans-serif; background:#1a1a2e; color:#e0e0e0;
                 padding:16px; user-select:none; overflow-y:auto; }
          .header { text-align:center; margin-bottom:10px; }
          .header h2 { font-size:16px; color:#4361ee; margin-bottom:4px; }
          .header p { font-size:11px; color:#888; }
          .steps { display:flex; flex-direction:column; gap:3px; margin-bottom:12px; }
          .controls { display:flex; gap:8px; justify-content:center; margin-top:12px; flex-wrap:wrap; }
          .status { text-align:center; margin-top:10px; font-size:11px; padding:6px 10px; border-radius:6px;
                    background:rgba(255,255,255,0.05); }
          .footer { text-align:center; margin-top:8px; font-size:10px; color:#555; }
        </style></head><body>
        <div class="header">
          <h2>🎯 Selector Calibration</h2>
          <p>${progressText}</p>
        </div>
        <div class="steps">${stepsHtml}</div>
        <div class="controls">${controlsHtml}</div>
        <div class="status">${statusText}</div>
        <div class="footer">关闭任一窗口可取消校准</div>
      </body></html>`;
    };

    const loadGuideStep = (stepIdx) => {
      if (!guideWin.isDestroyed()) {
        guideWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildGuideHTML(stepIdx)));
      }
    };

    // --- 2. ChatGPT window ---
    const chatWin = new BrowserWindow({
      width: 1100,
      height: 820,
      x: 530,
      y: 60,
      title: 'ChatGPT — Select Elements to Calibrate',
      webPreferences: {
        partition: CHATGPT_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    chatWin.loadURL('https://chatgpt.com/');

    let currentStep = 0;
    const recorded = {};
    let resolved = false;
    const dbg = chatWin.webContents.debugger;

    const cleanup = () => {
      try { dbg.detach(); } catch {}
      if (!guideWin.isDestroyed()) guideWin.close();
      if (!chatWin.isDestroyed()) chatWin.close();
    };

    const finishResolve = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    // Attach CDP debugger
    try {
      dbg.attach('1.3');
    } catch (e) {
      console.error('[calibrate] Failed to attach debugger:', e.message);
      guideWin.close();
      chatWin.close();
      resolve({ ok: false, error: 'Failed to attach CDP debugger: ' + e.message });
      return;
    }

    dbg.sendCommand('DOM.enable').catch(() => {});
    dbg.sendCommand('Overlay.enable').catch(() => {});

    const startInspectMode = () => {
      if (inspectPaused) return;
      dbg.sendCommand('Overlay.setInspectMode', {
        mode: 'searchForNode',
        highlightConfig: {
          showInfo: true,
          showStyles: false,
          showRulers: false,
          showAccessibilityInfo: false,
          contentColor: { r: 67, g: 97, b: 238, a: 0.3 },
          paddingColor: { r: 67, g: 97, b: 238, a: 0.15 },
          borderColor: { r: 67, g: 97, b: 238, a: 0.8 },
          marginColor: { r: 67, g: 97, b: 238, a: 0.1 },
        },
      }).catch(e => {
        if (isDev) console.log('[calibrate] setInspectMode error:', e.message);
      });
    };

    const stopInspectMode = () => {
      dbg.sendCommand('Overlay.setInspectMode', {
        mode: 'none',
        highlightConfig: {},
      }).catch(() => {});
    };

    /**
     * Enter a step: if it's a 'pause' step, stop inspect mode and show continue button.
     * If it's a 'select' step, start inspect mode.
     */
    const enterStep = (stepIdx) => {
      if (stepIdx >= STEPS.length) {
        // All done
        const data = { recorded, timestamp: new Date().toISOString() };
        if (chatgptBackend) webBackends.saveSelectors(chatgptBackend, data);
        finishResolve({ ok: true, selectors: recorded });
        return;
      }

      currentStep = stepIdx;
      const step = STEPS[stepIdx];

      if (step.type === 'pause') {
        // Auto-pause: stop inspect so user can interact with ChatGPT
        inspectPaused = true;
        stopInspectMode();
        if (isDev) console.log(`[calibrate] Step ${stepIdx + 1}: AUTO-PAUSE — ${step.zh}`);
      } else {
        // Select step: enable inspect mode
        inspectPaused = false;
        if (isDev) console.log(`[calibrate] Step ${stepIdx + 1}: SELECT — ${step.role}`);
        startInspectMode();
      }

      loadGuideStep(stepIdx);
    };

    const advanceStep = () => {
      enterStep(currentStep + 1);
    };

    // Listen for button clicks from guide window
    guideWin.webContents.on('console-message', (_event, _level, message) => {
      if (resolved) return;

      if (message === '__CONTINUE__') {
        // User finished the pause-step action, advance to next (select) step
        if (isDev) console.log(`[calibrate] Step ${currentStep + 1}: CONTINUE from pause`);
        advanceStep();
      }

      if (message === '__TOGGLE_PAUSE__') {
        // Manual pause/resume during a select step
        inspectPaused = !inspectPaused;
        if (isDev) console.log('[calibrate] Manual', inspectPaused ? 'PAUSE' : 'RESUME');
        if (inspectPaused) {
          stopInspectMode();
        } else {
          startInspectMode();
        }
        loadGuideStep(currentStep);
      }

      if (message === '__SKIP_STEP__') {
        if (isDev) console.log(`[calibrate] Step ${currentStep + 1}: SKIPPED`);
        advanceStep();
      }
    });

    // CDP inspect node event — only fires during 'select' steps
    dbg.on('message', async (_event, method, params) => {
      if (resolved || inspectPaused) return;
      if (STEPS[currentStep]?.type !== 'select') return;

      if (method === 'Overlay.inspectNodeRequested') {
        const backendNodeId = params.backendNodeId;
        if (isDev) console.log('[calibrate] inspectNodeRequested, backendNodeId:', backendNodeId);

        try {
          const { node } = await dbg.sendCommand('DOM.describeNode', { backendNodeId });
          const selector = buildSelectorFromNodeAttrs(node.nodeName, node.attributes || []);
          const step = STEPS[currentStep];

          if (step.role === 'response') {
            // For response bubbles, we need a selector that matches ALL similar bubbles
            // so we can always pick the last one. The user clicked one bubble — we look
            // for a generalized selector via JS in the page context.
            const generalizedSelector = await chatWin.webContents.executeJavaScript(`
              (function() {
                // Find the element user clicked
                const clicked = document.querySelector(${JSON.stringify(selector)});
                if (!clicked) return ${JSON.stringify(selector)};

                // Strategy 1: Check if the clicked element's selector already matches multiple
                const directMatches = document.querySelectorAll(${JSON.stringify(selector)});
                if (directMatches.length > 1) return ${JSON.stringify(selector)};

                // Strategy 2: Walk up and find an ancestor whose tag+attribute selector
                // matches multiple sibling-like elements (i.e. other response bubbles)
                let el = clicked;
                const maxDepth = 6;
                for (let depth = 0; depth < maxDepth && el && el !== document.body; depth++) {
                  // Try data-message-author-role attribute (ChatGPT specific)
                  const role = el.getAttribute('data-message-author-role');
                  if (role === 'assistant') {
                    const sel = el.tagName.toLowerCase() + '[data-message-author-role="assistant"]';
                    if (document.querySelectorAll(sel).length >= 1) return sel;
                  }
                  // Try data-testid
                  const testId = el.getAttribute('data-testid');
                  if (testId && testId.includes('conversation') || testId && testId.includes('message')) {
                    const sel = el.tagName.toLowerCase() + '[data-testid="' + testId + '"]';
                    if (document.querySelectorAll(sel).length > 1) return sel;
                  }
                  // Try class-based: find a class that yields multiple matches
                  if (el.classList.length > 0) {
                    for (const cls of el.classList) {
                      if (cls.startsWith('__') || cls.length < 3) continue;
                      const sel = el.tagName.toLowerCase() + '.' + cls;
                      const matches = document.querySelectorAll(sel);
                      // Good if it matches more than 1 (multiple bubbles)
                      if (matches.length > 1 && matches.length < 50) return sel;
                    }
                  }
                  el = el.parentElement;
                }

                // Strategy 3: fallback — use the original selector
                return ${JSON.stringify(selector)};
              })()
            `);

            recorded[step.role] = generalizedSelector;
            if (isDev) {
              const count = await chatWin.webContents.executeJavaScript(
                `document.querySelectorAll(${JSON.stringify(generalizedSelector)}).length`
              );
              console.log(`[calibrate] Step ${currentStep + 1}: ${step.role} => ${generalizedSelector} (matches ${count} elements, will use last)`);
            }
          } else {
            recorded[step.role] = selector;
            if (isDev) console.log(`[calibrate] Step ${currentStep + 1}: ${step.role} => ${selector}`);
          }

          advanceStep();
        } catch (e) {
          if (isDev) console.log('[calibrate] describeNode error:', e.message);
          startInspectMode();
        }
      }
    });

    // Start first step once ChatGPT page loads
    chatWin.webContents.on('dom-ready', () => {
      if (isDev) console.log('[calibrate] dom-ready, entering step 1');
      setTimeout(() => {
        enterStep(0);
      }, 1500);
    });

    // If either window is closed, save partial and cancel
    chatWin.on('closed', () => {
      if (!resolved) {
        if (Object.keys(recorded).length > 0 && chatgptBackend) {
          const existing = webBackends.loadSelectors(chatgptBackend);
          const merged = { ...existing.recorded, ...recorded };
          webBackends.saveSelectors(chatgptBackend, { recorded: merged, timestamp: new Date().toISOString() });
        }
        finishResolve({ ok: false, partial: recorded, error: 'Calibration window closed' });
      }
    });
    guideWin.on('closed', () => {
      if (!resolved) {
        finishResolve({ ok: false, partial: recorded, error: 'Guide window closed' });
      }
    });
  });
});

/**
 * IPC: Get current selector status (which are recorded vs default)
 */
ipcMain.handle('get-selector-status', () => {
  const backend = webBackends.backends.get('chatgpt');
  if (!backend) return { recorded: {}, timestamp: null, defaults: {} };
  const saved = webBackends.loadSelectors(backend);
  return {
    recorded: saved.recorded || {},
    timestamp: saved.timestamp,
    defaults: backend.defaultSelectors,
  };
});

/**
 * IPC: Reset selectors to defaults
 */
ipcMain.handle('reset-selectors', () => {
  const backend = webBackends.backends.get('chatgpt');
  if (!backend || !backend.selectorsFile) return { ok: true };
  try {
    if (fs.existsSync(backend.selectorsFile)) {
      fs.unlinkSync(backend.selectorsFile);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// === DOM Interaction via hidden BrowserWindow (delegated to web-backends.cjs) ===
// Each employee gets an independent BrowserWindow via webBackends.ensureSessionWindow().
// DOM scripts, selectors, and polling logic are managed by web-backends.cjs.
// This section only contains IPC handlers that delegate to webBackends.

/**
 * IPC handler: send a message via DOM interaction and wait for the response.
 * Delegates to webBackends.domChat() which manages per-session windows.
 */
ipcMain.handle('chatgpt-dom-chat', async (_event, params) => {
  try {
    return await webBackends.domChat(params, {
      BrowserWindow, session, isDev,
      openLoginWindow: (backend) => openLoginWindow(backend),
    });
  } catch (err) {
    console.error('[dom-chat] Error:', err.message);
    return { error: err.message, text: '' };
  }
});

/**
 * IPC handler: force refresh all chat windows
 */
ipcMain.handle('refresh-chat-window', async () => {
  webBackends.closeAllWindows();
  return { ok: true };
});

app.whenReady().then(async () => {
  try {
    // Initialize web backends (selectors file paths, window cleanup timer, etc.)
    initWebBackends();

    // Start the ChatGPT proxy before the Next.js server so it's ready when needed
    const proxyPort = await startChatGPTProxy();
    console.log(`[startup] ChatGPT proxy ready on port ${proxyPort}`);

    // Write proxy port to temp files so Next.js server can discover it
    // Write to multiple locations to ensure discoverability (os.tmpdir() may differ from app.getPath('temp'))
    const portLocations = [
      path.join(app.getPath('temp'), 'ideaco-chatgpt-proxy-port'),
      path.join(require('os').homedir(), '.ideaco-chatgpt-proxy-port'),
    ];
    for (const loc of portLocations) {
      try { fs.writeFileSync(loc, String(proxyPort)); } catch {}
    }
    if (isDev) console.log(`[startup] Proxy port written to: ${portLocations.join(', ')}`);

    const dataPath = ensureDataDirs();

    if (isDev) {
      // Dev 模式：直接连接已运行的 Next.js dev server 或用 next dev 启动
      const port = PORT;
      const isRunning = await new Promise((resolve) => {
        const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
          client.end();
          resolve(true);
        });
        client.on('error', () => resolve(false));
      });

      if (!isRunning) {
        // 自动启动 next dev
        const npxPath = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        serverProcess = spawn(npxPath, ['next', 'dev', '-p', String(port)], {
          cwd: path.join(__dirname, '..'),
          env: { ...process.env, CHATGPT_PROXY_PORT: String(proxyPort) },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        serverProcess.stdout.on('data', (d) => console.log(`[next-dev] ${d.toString().trim()}`));
        serverProcess.stderr.on('data', (d) => console.error(`[next-dev] ${d.toString().trim()}`));
        await waitForServer(port);
      }

      createWindow(port);
    } else {
      // Production 模式：启动 standalone server.js
      const port = await findAvailablePort(PORT);
      await startNextServer(port, dataPath);
      createWindow(port);
    }
  } catch (err) {
    dialog.showErrorBox('Startup Error', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  stopServer();
  webBackends.cleanup();
  app.quit();
});

app.on('before-quit', () => {
  stopServer();
  webBackends.cleanup();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    findAvailablePort(PORT).then((port) => createWindow(port));
  }
});
