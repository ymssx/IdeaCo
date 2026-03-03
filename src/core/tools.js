/**
 * Agent工具系统 - Agent可调用的工具集
 * 
 * 参考 Codex/OpenAI Agents 的 tool_use 模式：
 * - file_read: 读取文件
 * - file_write: 写入/创建文件
 * - file_list: 列出目录内容
 * - file_delete: 删除文件
 * - shell_exec: 执行Shell命令（受限）
 * - send_message: 向其他Agent发送消息
 */
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Agent工具集 - 每个Agent实例持有一个ToolKit
 * 工具操作限制在指定的工作空间目录内
 */
export class AgentToolKit {
  /**
   * @param {string} workspaceDir - Agent的工作空间根目录
   * @param {object} messageBus - 消息总线引用
   * @param {string} agentId - 当前Agent的ID
   */
  constructor(workspaceDir, messageBus = null, agentId = null) {
    this.workspaceDir = workspaceDir;
    this.messageBus = messageBus;
    this.agentId = agentId;

    // 确保工作空间目录存在
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
    }
  }

  /**
   * 安全路径解析：确保所有文件操作都在工作空间目录内
   */
  _safePath(filePath) {
    const resolved = path.resolve(this.workspaceDir, filePath);
    if (!resolved.startsWith(path.resolve(this.workspaceDir))) {
      throw new Error(`安全限制: 路径 "${filePath}" 超出工作空间范围`);
    }
    return resolved;
  }

  /**
   * 获取OpenAI函数定义格式的工具列表
   */
  get definitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'file_read',
          description: '读取指定路径的文件内容。路径相对于工作空间目录。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径（相对于工作空间）' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_write',
          description: '创建或覆盖写入文件。如果目录不存在会自动创建。路径相对于工作空间。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径（相对于工作空间）' },
              content: { type: 'string', description: '文件内容' },
            },
            required: ['path', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_list',
          description: '列出指定目录下的文件和子目录。路径相对于工作空间。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '目录路径（相对于工作空间），默认为根目录' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_delete',
          description: '删除指定文件。路径相对于工作空间。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '要删除的文件路径' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'shell_exec',
          description: '在工作空间目录中执行Shell命令。仅允许安全命令（如 ls, cat, grep, node, npm 等）。',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: '要执行的Shell命令' },
            },
            required: ['command'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'send_message',
          description: '向团队中的其他Agent发送消息，用于协作和任务委派。',
          parameters: {
            type: 'object',
            properties: {
              targetAgentId: { type: 'string', description: '目标Agent的ID' },
              content: { type: 'string', description: '消息内容' },
              type: { type: 'string', enum: ['task', 'question', 'report', 'review'], description: '消息类型' },
            },
            required: ['targetAgentId', 'content'],
          },
        },
      },
    ];
  }

  /**
   * 执行工具调用
   * @param {string} name - 工具名称
   * @param {object} args - 工具参数
   * @returns {Promise<string>} 工具执行结果
   */
  async execute(name, args) {
    // 参数安全校验：防止LLM返回的参数缺失导致崩溃
    if (!args || typeof args !== 'object') {
      args = {};
    }
    switch (name) {
      case 'file_read':
        if (!args.path) throw new Error('缺少必需参数: path');
        return this._fileRead(args.path);
      case 'file_write':
        if (!args.path) throw new Error('缺少必需参数: path');
        if (args.content === undefined || args.content === null) throw new Error('缺少必需参数: content');
        return this._fileWrite(args.path, args.content);
      case 'file_list':
        return this._fileList(args.path || '.');
      case 'file_delete':
        if (!args.path) throw new Error('缺少必需参数: path');
        return this._fileDelete(args.path);
      case 'shell_exec':
        if (!args.command) throw new Error('缺少必需参数: command');
        return this._shellExec(args.command);
      case 'send_message':
        return this._sendMessage(args.targetAgentId, args.content, args.type);
      default:
        throw new Error(`未知工具: ${name}`);
    }
  }

  /**
   * 读取文件
   */
  async _fileRead(filePath) {
    const fullPath = this._safePath(filePath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return `错误: 文件不存在 "${filePath}"`;
      }
      throw error;
    }
  }

  /**
   * 写入文件（自动创建目录）
   */
  async _fileWrite(filePath, content) {
    const fullPath = this._safePath(filePath);
    const dir = path.dirname(fullPath);

    // 自动创建目录
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    await fs.writeFile(fullPath, content, 'utf-8');
    return `文件已写入: ${filePath} (${content.length} 字符)`;
  }

  /**
   * 列出目录内容
   */
  async _fileList(dirPath) {
    const fullPath = this._safePath(dirPath);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const items = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
      return JSON.stringify(items, null, 2);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return `错误: 目录不存在 "${dirPath}"`;
      }
      throw error;
    }
  }

  /**
   * 删除文件
   */
  async _fileDelete(filePath) {
    const fullPath = this._safePath(filePath);
    try {
      await fs.unlink(fullPath);
      return `文件已删除: ${filePath}`;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return `错误: 文件不存在 "${filePath}"`;
      }
      throw error;
    }
  }

  /**
   * 执行Shell命令（安全限制）
   */
  async _shellExec(command) {
    // 安全白名单：只允许特定命令前缀
    const allowedPrefixes = [
      'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc',
      'node', 'npm', 'npx', 'echo', 'mkdir', 'cp', 'mv',
      'tree', 'pwd', 'which', 'git',
    ];

    const cmdName = command.trim().split(/\s+/)[0];
    if (!allowedPrefixes.includes(cmdName)) {
      return `安全限制: 不允许执行命令 "${cmdName}"。允许的命令: ${allowedPrefixes.join(', ')}`;
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workspaceDir,
        timeout: 30000, // 30秒超时
        maxBuffer: 1024 * 1024, // 1MB输出限制
      });
      return stdout + (stderr ? `\n[stderr]: ${stderr}` : '');
    } catch (error) {
      return `命令执行失败: ${error.message}`;
    }
  }

  /**
   * 发送消息给其他Agent
   */
  async _sendMessage(targetAgentId, content, type = 'task') {
    if (!this.messageBus) {
      return '错误: 消息总线未初始化';
    }
    this.messageBus.send({
      from: this.agentId,
      to: targetAgentId,
      content,
      type: type || 'task',
    });
    return `消息已发送给 ${targetAgentId}`;
  }
}
