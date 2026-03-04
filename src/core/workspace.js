/**
 * Workspace Manager
 * 
 * Each department/project has its own independent working directory
 * Agents perform file operations within their respective workspaces
 */
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

// Default workspace root directory
const DEFAULT_ROOT = path.resolve(process.cwd(), 'workspace');

export class WorkspaceManager {
  constructor(rootDir = DEFAULT_ROOT) {
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
   * Read a file within the workspace
   */
  async readFile(wsPath, filePath) {
    const fullPath = path.join(wsPath, filePath);
    const resolved = path.resolve(fullPath);

    // Security check
    if (!resolved.startsWith(path.resolve(wsPath))) {
      throw new Error('Path is outside workspace boundary');
    }

    return fs.readFile(resolved, 'utf-8');
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
   * Get root workspace path
   */
  getRootDir() {
    return this.rootDir;
  }
}
