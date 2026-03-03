/**
 * 工作空间管理器
 * 
 * 每个部门/项目拥有独立的工作目录
 * Agent在各自的工作空间内进行文件操作
 */
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

// 默认工作空间根目录
const DEFAULT_ROOT = path.resolve(process.cwd(), 'workspace');

export class WorkspaceManager {
  constructor(rootDir = DEFAULT_ROOT) {
    this.rootDir = rootDir;
    if (!existsSync(rootDir)) {
      mkdirSync(rootDir, { recursive: true });
    }
  }

  /**
   * 为部门创建工作空间
   * @param {string} departmentId - 部门ID
   * @param {string} departmentName - 部门名称（用于目录命名）
   * @returns {string} 工作空间路径
   */
  createDepartmentWorkspace(departmentId, departmentName) {
    // 用安全的目录名
    const safeName = departmentName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    const dirName = `${safeName}_${departmentId.slice(0, 8)}`;
    const wsPath = path.join(this.rootDir, dirName);

    if (!existsSync(wsPath)) {
      mkdirSync(wsPath, { recursive: true });
    }

    return wsPath;
  }

  /**
   * 获取部门工作空间下的文件树
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
      // 目录不存在时返回空
    }

    return entries;
  }

  /**
   * 读取工作空间内的文件
   */
  async readFile(wsPath, filePath) {
    const fullPath = path.join(wsPath, filePath);
    const resolved = path.resolve(fullPath);

    // 安全检查
    if (!resolved.startsWith(path.resolve(wsPath))) {
      throw new Error('路径超出工作空间范围');
    }

    return fs.readFile(resolved, 'utf-8');
  }

  /**
   * 获取工作空间统计
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
   * 获取根工作空间路径
   */
  getRootDir() {
    return this.rootDir;
  }
}
