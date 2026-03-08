#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { createCliT } from './i18n.js';
import { Jimp } from 'jimp';

// Check Node.js version
const requiredVersion = 20;
const currentVersion = process.versions.node;
const majorVersion = parseInt(currentVersion.split('.')[0], 10);

if (majorVersion < requiredVersion) {
  console.error(chalk.red(`\nError: Node.js version ${requiredVersion} or higher is required.`));
  console.error(chalk.white(`You are running Node.js ${currentVersion}`));
  console.error(chalk.gray(`Please upgrade your Node.js version and try again.\n`));
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.IDEACO_PORT || 9999);
const HOME_DIR = path.join(ROOT, '.ideaco');
const PID_FILE = path.join(HOME_DIR, 'server.pid');
const PORT_FILE = path.join(HOME_DIR, 'server.port');
const LOG_FILE = path.join(HOME_DIR, 'server.log');
const DATA_DIR = path.join(HOME_DIR, 'data');
const WORKSPACE_DIR = path.join(HOME_DIR, 'workspace');
const BANNER_FILE = path.join(DATA_DIR, 'banner.ans');
const BUILD_VERSION_FILE = path.join(HOME_DIR, 'build.version');
const t = createCliT();

const args = process.argv.slice(2);
const command = args[0] || 'help';

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(HOME_DIR, { recursive: true });
}

function isPidRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
  const pid = Number(raw);
  return Number.isFinite(pid) ? pid : null;
}

function writePid(pid) {
  fs.writeFileSync(PID_FILE, String(pid));
}

function clearPid() {
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
}

function readPort() {
  if (!fs.existsSync(PORT_FILE)) return null;
  const raw = fs.readFileSync(PORT_FILE, 'utf8').trim();
  const port = Number(raw);
  return Number.isFinite(port) ? port : null;
}

function writePort(port) {
  fs.writeFileSync(PORT_FILE, String(port));
}

function clearPort() {
  if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
      client.end();
      resolve(true);
    });
    client.on('error', () => resolve(false));
  });
}

function waitForPort(port, retries = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = async () => {
      attempts += 1;
      const open = await isPortOpen(port);
      if (open) return resolve();
      if (attempts >= retries) return reject(new Error(t('cli.startTimeout')));
      setTimeout(check, 500);
    };
    check();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getBannerContent(title) {
  const bulbLines = [
    '                ████████                ',
    '           ██████████████████           ',
    '        ████████████████████████        ',
    '      ████████████████████████████      ',
    '    ████████████████████████████████    ',
    '   ██████████████████████████████████   ',
    '   ██████████████████████████████████   ',
    '   ██████████████████████████████████   ',
    '   ██████████████████████████████████   ',
    '    ████████████████████████████████    ',
    '      ████████████████████████████      ',
    '        ████████████████████████        ',
    '            ░░░░░░░░░░░░░░░░            ',
    '             ░▒▒▒▒▒▒▒▒▒▒▒▒▒▒            ',
    '               ░▒▒▒▒▒▒▒▒▒▒              ',
    '                ░▒▒▒▒▒▒▒▒                ',
  ];
  const bulbColor = '#ffef99';
  const baseColors = ['#a3a3a3', '#bdbdbd', '#d4d4d4', '#e5e5e5'];
  const baseTint = '#c9c9c9';
  const width = bulbLines[0].length;
  const padCenter = (text) => {
    const visible = text.length;
    if (visible >= width) return text;
    const padLeft = Math.floor((width - visible) / 2);
    const padRight = width - visible - padLeft;
    return `${' '.repeat(padLeft)}${text}${' '.repeat(padRight)}`;
  };
  const softenLeft = (line, softChar = '░', widthSoft = 3) => {
    const chars = Array.from(line);
    const first = chars.findIndex(ch => ch !== ' ');
    if (first === -1) return line;
    for (let i = first; i < Math.min(first + widthSoft, chars.length); i += 1) {
      if (chars[i] !== ' ') chars[i] = softChar;
    }
    return chars.join('');
  };
  
  let content = '';
  for (let i = 0; i < bulbLines.length; i += 1) {
    const isBase = i >= bulbLines.length - 4;
    const baseIndex = i - (bulbLines.length - 4);
    const color = isBase ? (baseColors[baseIndex] || baseTint) : bulbColor;
    const softened = softenLeft(bulbLines[i], isBase ? '░' : '░', isBase ? 4 : 3);
    const line = isBase ? chalk.hex(color)(softened) : chalk.bold.hex(color)(softened);
    content += line + '\n';
  }
  const brandLine = chalk.bold.hex('#22d3ee')(padCenter('IdeaCo Console'));
  const separator = chalk.hex('#2dd4bf')('─'.repeat(width));
  // Note: Title with port is dynamic, so we don't include it in static banner file if possible, 
  // but for consistency with previous behavior, let's just return the graphic part.
  content += brandLine + '\n' + separator + '\n';
  return content;
}

async function printBootBanner(port) {
  const title = t('cli.startBoot', { port });
  let banner = '';
  
  // Try to generate dynamic banner from public/logo.png if exists
  const dynamicLogoPath = path.join(ROOT, 'public', 'logo.png');
  if (fs.existsSync(dynamicLogoPath)) {
    const dynamicBanner = await generateBannerFromImage(dynamicLogoPath);
    if (dynamicBanner) {
      banner = dynamicBanner;
      // Also update the cached file
      try {
        ensureDirs();
        if (fs.existsSync(BANNER_FILE)) fs.unlinkSync(BANNER_FILE);
        fs.writeFileSync(BANNER_FILE, dynamicBanner);
      } catch (e) {}
    }
  }

  // Fallback to cached banner or default
  if (!banner) {
    if (fs.existsSync(BANNER_FILE)) {
      banner = fs.readFileSync(BANNER_FILE, 'utf8');
    } else {
      banner = await getBannerContent(title);
      // Write default banner to file for user customization
      try {
        ensureDirs();
        fs.writeFileSync(BANNER_FILE, banner);
      } catch (e) {
        // ignore
      }
    }
  }

  // Print banner
  console.log(banner);
  
  // Always print port info below banner
  const width = 40; // Approx width of banner
  const padCenter = (text) => {
    // Strip ANSI codes for length calculation
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    if (visible >= width) return text;
    const padLeft = Math.floor((width - visible) / 2);
    const padRight = width - visible - padLeft;
    return `${' '.repeat(padLeft)}${text}${' '.repeat(padRight)}`;
  };
  console.log(chalk.hex('#7dd3fc')(padCenter(title)));
}

async function generateBannerFromImage(absPath) {
  try {
    const image = await Jimp.read(absPath);
    
    // Resize to reasonable width for terminal (e.g. 40 chars)
    const targetWidth = 40;
    // Jimp resize(w, h) - if h is undefined or auto, it maintains aspect ratio
    image.resize({ w: targetWidth });
    
    const width = image.width;
    const height = image.height;
    
    let ansi = '';

    const intToRGBA = (i) => {
      return {
        r: (i >>> 24) & 0xff,
        g: (i >>> 16) & 0xff,
        b: (i >>> 8) & 0xff,
        a: i & 0xff
      };
    };
    
    // Use upper half block (▀) to combine two vertical pixels
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x++) {
        const topColor = image.getPixelColor(x, y);
        const botColor = (y + 1 < height) ? image.getPixelColor(x, y + 1) : 0x00000000;
        
        const top = intToRGBA(topColor);
        const bot = intToRGBA(botColor);
        
        const isTopTrans = top.a < 128;
        const isBotTrans = bot.a < 128;
        
        // Reset styles first
        // \x1b[0m resets everything.
        // We need to set FG and BG color for the block.
        // ▀ (upper half block) uses FG color for top half, BG color for bottom half.
        
        if (isTopTrans && isBotTrans) {
          ansi += '\x1b[0m ';
        } else if (!isTopTrans && isBotTrans) {
          // Top visible, bottom transparent -> use upper block with FG=top
          ansi += `\x1b[38;2;${top.r};${top.g};${top.b}m\x1b[49m▀`;
        } else if (isTopTrans && !isBotTrans) {
          // Top transparent, bottom visible -> use lower block with FG=bottom?
          // Or use upper block with FG=default (transparent?) and BG=bottom.
          // \x1b[39m resets FG to default. \x1b[48;2;...m sets BG.
          // ▀ with BG=bottom makes the bottom half colored. Top half takes FG (default).
          // But default FG is usually white/gray, not transparent.
          // Better use ▄ (lower half block) with FG=bottom.
          ansi += `\x1b[38;2;${bot.r};${bot.g};${bot.b}m\x1b[49m▄`;
        } else {
          // Both visible -> ▀ with FG=top, BG=bottom
          ansi += `\x1b[38;2;${top.r};${top.g};${top.b}m\x1b[48;2;${bot.r};${bot.g};${bot.b}m▀`;
        }
      }
      ansi += '\x1b[0m\n';
    }
    return ansi;
  } catch (err) {
    console.error(chalk.red('Failed to process image:'), err);
    return null;
  }
}

async function runBanner(imagePath) {
  if (!imagePath) {
    console.log(chalk.red('Please provide an image path.'));
    console.log(chalk.yellow('Usage: ideaco banner <path/to/image.png>'));
    return;
  }
  
  const absPath = path.resolve(process.cwd(), imagePath);
  if (!fs.existsSync(absPath)) {
    console.log(chalk.red(`Image not found: ${absPath}`));
    return;
  }
  
  console.log(chalk.cyan(`Processing image: ${absPath}...`));
  
  const ansi = await generateBannerFromImage(absPath);
  if (ansi) {
    ensureDirs();
    try {
      if (fs.existsSync(BANNER_FILE)) fs.unlinkSync(BANNER_FILE);
    } catch (e) {
      // ignore
    }
    fs.writeFileSync(BANNER_FILE, ansi);
    console.log(chalk.green('Banner updated successfully!'));
    console.log(chalk.gray(`Saved to: ${BANNER_FILE}`));
    console.log('Run `ideaco start` to see it.');
  }
}

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

function getNextBin() {
  const binName = process.platform === 'win32' ? 'next.cmd' : 'next';
  return path.join(ROOT, 'node_modules', '.bin', binName);
}

function getElectronBin() {
  const binName = process.platform === 'win32' ? 'electron.cmd' : 'electron';
  return path.join(ROOT, 'node_modules', '.bin', binName);
}

function ensureBuild() {
  ensureDirs();
  const currentVersion = readPackageVersion();
  const cachedVersion = readBuildVersion();
  const hasBuild = fs.existsSync(path.join(ROOT, '.next'));
  if (currentVersion && cachedVersion === currentVersion && hasBuild) return;
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmBin, ['run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      IDEACO_SILENT_INIT: '1',
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  if (currentVersion) writeBuildVersion(currentVersion);
}

function ensureDependencies() {
  const nextPkg = path.join(ROOT, 'node_modules', 'next', 'package.json');
  if (fs.existsSync(nextPkg)) return;
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log(t('cli.installDeps'));
  const result = spawnSync(npmBin, ['install', '--omit=dev'], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    console.log(t('cli.installDepsFailed'));
    process.exit(result.status ?? 1);
  }
  console.log(t('cli.installDepsDone'));
}

async function startServer() {
  ensureDirs();
  const existingPid = readPid();
  if (existingPid && isPidRunning(existingPid)) {
    console.log(chalk.yellow(t('cli.alreadyRunning', { pid: existingPid })));
    console.log(chalk.cyan('Restarting service...'));
    await stopServer();
    // Allow some time for port release
    await new Promise(r => setTimeout(r, 1000));
  }
  ensureDependencies();
  ensureBuild();
  const logFd = fs.openSync(LOG_FILE, 'a');
  const nextBin = getNextBin();
  const port = await findAvailablePort(PORT);
  await printBootBanner(port);
  const child = spawn(nextBin, ['start', '-p', String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      IDEACO_DATA_DIR: DATA_DIR,
      IDEACO_WORKSPACE_DIR: WORKSPACE_DIR,
    },
    stdio: ['ignore', logFd, logFd],
    detached: true,
  });
  writePid(child.pid);
  writePort(port);
  child.unref();
  try {
    await waitForPort(port);
    const url = `http://127.0.0.1:${port}`;
    console.log(t('cli.startSuccess', { pid: child.pid, url }));
    
    // Tip for user
    console.log(chalk.gray(`\nTip: You can use ${chalk.bold('ideaco ui')} to open the dashboard next time.`));

  } catch (err) {
    try { process.kill(child.pid, 'SIGTERM'); } catch {}
    clearPid();
    clearPort();
    console.log(t('cli.startFailed', { error: err.message }));
  }
}

async function stopServer() {
  const pid = readPid();
  if (!pid || !isPidRunning(pid)) {
    clearPid();
    clearPort();
    console.log(t('cli.notRunning'));
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    clearPid();
    clearPort();
    console.log(t('cli.stopped'));
    return;
  }
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (!isPidRunning(pid)) {
      clearPid();
      clearPort();
      console.log(t('cli.stopped'));
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  try { process.kill(pid, 'SIGKILL'); } catch {}
  clearPid();
  clearPort();
  console.log(t('cli.stopped'));
}

async function ensureServerRunning() {
  const pid = readPid();
  const port = readPort() ?? PORT;
  if (pid && isPidRunning(pid) && await isPortOpen(port)) return true;
  await startServer();
  const nextPort = readPort() ?? PORT;
  return await isPortOpen(nextPort);
}

function openUrl(url) {
  if (process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}

async function openWeb() {
  const ok = await ensureServerRunning();
  if (!ok) {
    console.log(t('cli.webUnavailable'));
    return;
  }
  const port = readPort() ?? PORT;
  const url = `http://127.0.0.1:${port}`;
  openUrl(url);
  console.log(t('cli.webOpened', { url }));
}

async function openElectron(port) {
  ensureDependencies();
  const electronBin = getElectronBin();
  const child = spawn(electronBin, ['.'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      IDEACO_DISABLE_DEVTOOLS: '1',
      IDEACO_PORT: String(port || PORT),
    },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

async function handleUiCommand() {
  const ok = await ensureServerRunning();
  if (!ok) {
    console.log(t('cli.webUnavailable'));
    return;
  }
  const port = readPort() ?? PORT;
  console.log(chalk.cyan(`Opening Electron UI on port ${port}...`));
  await openElectron(port);
}

function printHelp() {
  console.log(`
${t('cli.helpTitle')}
  ${t('cli.helpStart')}
  ${t('cli.helpStop')}
  ${t('cli.helpUi')}
  ${t('cli.helpBanner')}
  ${t('cli.helpHelp')}
`);
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

function readBuildVersion() {
  if (!fs.existsSync(BUILD_VERSION_FILE)) return null;
  return fs.readFileSync(BUILD_VERSION_FILE, 'utf8').trim() || null;
}

function writeBuildVersion(version) {
  fs.writeFileSync(BUILD_VERSION_FILE, version);
}

async function main() {
  if (command === 'start') return await startServer();
  if (command === 'stop') return await stopServer();
  if (command === 'web') return await openWeb();
  if (command === 'banner') return await runBanner(args[1]);
  if (command === 'ui') return await handleUiCommand();
  if (command === 'electron') return await handleUiCommand();
  return printHelp();
}

main();
