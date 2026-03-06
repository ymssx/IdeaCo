/**
 * Prepare Next.js standalone output for Electron packaging.
 *
 * Copies .next/standalone, .next/static, and public into electron-dist/
 * so electron-builder can bundle them as extraResources.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const outDir = path.join(root, 'electron-dist');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;

  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

console.log('Preparing Electron distribution...');

// Clean previous build
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true });
}
fs.mkdirSync(outDir, { recursive: true });

// 1. Copy standalone output (includes server.js + node_modules)
const standaloneDir = path.join(root, '.next', 'standalone');
if (!fs.existsSync(standaloneDir)) {
  console.error('ERROR: .next/standalone not found. Run "npm run build" first.');
  process.exit(1);
}
copyRecursive(standaloneDir, outDir);

// 2. Copy static assets
const staticDir = path.join(root, '.next', 'static');
copyRecursive(staticDir, path.join(outDir, '.next', 'static'));

// 3. Copy public folder
const publicDir = path.join(root, 'public');
copyRecursive(publicDir, path.join(outDir, 'public'));

// 4. Create data directories
const dataDirs = ['data', 'data/memories', 'data/audit', 'workspace'];
for (const dir of dataDirs) {
  fs.mkdirSync(path.join(outDir, dir), { recursive: true });
}

console.log('Electron distribution prepared at:', outDir);
