const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

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

app.whenReady().then(async () => {
  try {
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
          env: { ...process.env },
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
  app.quit();
});

app.on('before-quit', () => {
  stopServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    findAvailablePort(PORT).then((port) => createWindow(port));
  }
});
