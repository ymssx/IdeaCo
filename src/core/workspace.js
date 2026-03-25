/**
 * Workspace Manager
 * 
 * Each department/project has its own independent working directory
 * Agents perform file operations within their respective workspaces
 */
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { WORKSPACE_DIR } from '../lib/paths.js';

export class WorkspaceManager {
  constructor(rootDir = WORKSPACE_DIR) {
    this.rootDir = rootDir;
    if (!existsSync(rootDir)) {
      mkdirSync(rootDir, { recursive: true });
    }
  }

  /**
   * Create a workspace for a department
   * @param {string} departmentId - Department ID
   * @param {string} departmentName - Department name (used for directory naming)
   * @returns {string} Workspace path
   */
  createDepartmentWorkspace(departmentId, departmentName) {
    // Use a safe directory name
    const safeName = departmentName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    const dirName = `${safeName}_${departmentId.slice(0, 8)}`;
    const wsPath = path.join(this.rootDir, dirName);

    if (!existsSync(wsPath)) {
      mkdirSync(wsPath, { recursive: true });
    }

    return wsPath;
  }

  /**
   * Get the file tree under a department workspace
   */
  async getFileTree(wsPath, relativeTo = null) {
    const basePath = relativeTo || wsPath;
    const entries = [];

    try {
      const items = await fs.readdir(wsPath, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(wsPath, item.name);
        const relPath = path.relative(basePath, fullPath);

        if (item.isDirectory()) {
          const children = await this.getFileTree(fullPath, basePath);
          entries.push({
            name: item.name,
            path: relPath,
            type: 'directory',
            children,
          });
        } else {
          const stat = await fs.stat(fullPath);
          entries.push({
            name: item.name,
            path: relPath,
            type: 'file',
            size: stat.size,
            modifiedAt: stat.mtime,
          });
        }
      }
    } catch (error) {
      // Return empty if directory does not exist
    }

    return entries;
  }

  /**
   * Get shallow (one-level) listing of a directory within the workspace
   * @param {string} wsPath - Workspace root path
   * @param {string} subPath - Relative sub-directory path (empty string for root)
   */
  async getShallowFileTree(wsPath, subPath = '') {
    const targetDir = subPath ? path.join(wsPath, subPath) : wsPath;
    const entries = [];
    try {
      const items = await fs.readdir(targetDir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(targetDir, item.name);
        const relPath = path.relative(wsPath, fullPath);

        if (item.isDirectory()) {
          entries.push({
            name: item.name,
            path: relPath,
            type: 'directory',
          });
        } else {
          const stat = await fs.stat(fullPath);
          entries.push({
            name: item.name,
            path: relPath,
            type: 'file',
            size: stat.size,
            modifiedAt: stat.mtime,
          });
        }
      }
    } catch (error) {
      // Return empty if directory does not exist
    }

    return entries;
  }

  /**
   * Read a file within the workspace
   * Automatically attempts to fix permission issues
   */
  async readFile(wsPath, filePath) {
    const fullPath = path.join(wsPath, filePath);
    const resolved = path.resolve(fullPath);

    try {
      return await fs.readFile(resolved, 'utf-8');
    } catch (err) {
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        // Auto-fix: try to grant read permission and retry
        try {
          await fs.chmod(resolved, 0o644);
          console.log(`[workspace] Auto-fixed permission for: ${resolved}`);
          return await fs.readFile(resolved, 'utf-8');
        } catch (chmodErr) {
          // chmod itself failed — re-throw with clear message
          const error = new Error(
            `Permission denied reading "${filePath}". Auto-fix failed. ` +
            `Try running: chmod -R a+r "${path.resolve(wsPath)}"`
          );
          error.code = 'EACCES';
          throw error;
        }
      }
      throw err;
    }
  }

  /**
   * Get workspace statistics
   */
  async getStats(wsPath) {
    let fileCount = 0;
    let totalSize = 0;

    async function walk(dir) {
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            await walk(fullPath);
          } else {
            fileCount++;
            const stat = await fs.stat(fullPath);
            totalSize += stat.size;
          }
        }
      } catch { /* ignore */ }
    }

    await walk(wsPath);
    return { fileCount, totalSize };
  }

  /**
   * Take a snapshot of all files in a workspace (path → mtime mapping)
   * Used for detecting file changes after CLI execution
   * @param {string} wsPath - Workspace root path
   * @returns {Map<string, number>} Map of relative path → mtime timestamp
   */
  async takeSnapshot(wsPath) {
    const snapshot = new Map();
    async function walk(dir) {
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            // Skip common non-project directories
            if (item.name === 'node_modules' || item.name === '.git' || item.name === '__pycache__') continue;
            await walk(fullPath);
          } else {
            const stat = await fs.stat(fullPath);
            snapshot.set(path.relative(wsPath, fullPath), stat.mtimeMs);
          }
        }
      } catch { /* ignore unreadable dirs */ }
    }
    await walk(wsPath);
    return snapshot;
  }

  /**
   * Diff two snapshots to find created/modified files
   * @param {Map<string, number>} before - Snapshot before execution
   * @param {Map<string, number>} after - Snapshot after execution
   * @returns {{ created: string[], modified: string[] }}
   */
  diffSnapshots(before, after) {
    const created = [];
    const modified = [];
    for (const [filePath, mtime] of after) {
      if (!before.has(filePath)) {
        created.push(filePath);
      } else if (before.get(filePath) !== mtime) {
        modified.push(filePath);
      }
    }
    return { created, modified };
  }

  /**
   * Get root workspace path
   */
  getRootDir() {
    return this.rootDir;
  }
}
