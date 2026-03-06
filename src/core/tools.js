/**
 * Agent Tool System - Callable tool set for Agents
 * 
 * Follows the Codex/OpenAI Agents tool_use pattern:
 * - file_read: Read file contents
 * - file_write: Write/create files
 * - file_list: List directory contents
 * - file_delete: Delete files
 * - shell_exec: Execute shell commands (restricted)
 * - send_message: Send messages to other Agents
 */
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { securityGuard } from './system/audit.js';
import { pluginRegistry, HookPoint } from './system/plugin.js';
// chatStore recording is handled centrally by requirement.js messageHandler

const execAsync = promisify(exec);

/**
 * Agent Tool Kit - Each Agent instance holds one ToolKit
 * Tool operations are restricted to the specified workspace directory
 */
export class AgentToolKit {
  /**
   * @param {string} workspaceDir - Agent's workspace root directory
   * @param {object} messageBus - Message bus reference
   * @param {string} agentId - Current Agent's ID
   */
  constructor(workspaceDir, messageBus = null, agentId = null, agentName = '') {
    this.workspaceDir = workspaceDir;
    this.messageBus = messageBus;
    this.agentId = agentId;
    this.agentName = agentName;

    // Ensure workspace directory exists
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
    }
  }

  /**
   * Safe path resolution: ensure all file ops stay within workspace
   */
  _safePath(filePath) {
    const resolved = path.resolve(this.workspaceDir, filePath);
    if (!resolved.startsWith(path.resolve(this.workspaceDir))) {
      throw new Error(`Security restriction: path "${filePath}" is outside workspace`);
    }
    return resolved;
  }

  /**
   * Get tool definitions in OpenAI function calling format
   */
  get definitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'file_read',
          description: 'Read the contents of a file at the given path. Path is relative to workspace directory.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path (relative to workspace)' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_write',
          description: 'Create or overwrite a file. Directories are auto-created if needed. Path is relative to workspace.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path (relative to workspace)' },
              content: { type: 'string', description: 'File content' },
            },
            required: ['path', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_list',
          description: 'List files and subdirectories under the given path. Path is relative to workspace.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Directory path (relative to workspace), defaults to root' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_delete',
          description: 'Delete the specified file. Path is relative to workspace.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path of the file to delete' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'shell_exec',
          description: 'Execute a shell command in the workspace directory. Only safe commands are allowed (e.g. ls, cat, grep, node, npm).',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Shell command to execute' },
            },
            required: ['command'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'send_message',
          description: 'Send a message to another Agent in the team for collaboration, asking questions, sharing results, or requesting feedback. Use this to communicate with colleagues when you need their input or want to share your work output.',
          parameters: {
            type: 'object',
            properties: {
              targetAgentId: { type: 'string', description: 'Target Agent ID' },
              content: { type: 'string', description: 'Message content. You can mention colleagues with @Name format.' },
              type: { type: 'string', enum: ['task', 'question', 'report', 'review', 'feedback'], description: 'Message type' },
            },
            required: ['targetAgentId', 'content'],
          },
        },
      },
      // Include tools from enabled plugins
      ...pluginRegistry.getPluginTools(),
    ];
  }

  /**
   * Execute a tool call
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments
   * @returns {Promise<string>} Tool execution result
   */
  async execute(name, args) {
    // Parameter safety check
    if (!args || typeof args !== 'object') {
      args = {};
    }

    // Security audit: log all tool calls
    securityGuard.logToolCall(name, args, this.agentId, this.agentName);

    // Fire plugin hooks: before tool call
    await pluginRegistry.fireHook(HookPoint.BEFORE_TOOL_CALL, {
      toolName: name, args, agentId: this.agentId, agentName: this.agentName,
    });

    // Parameter name compatibility: LLMs sometimes use filePath, file_path, etc. instead of path
    const resolvePath = (a) => a.path || a.filePath || a.file_path || a.filename || a.fileName || null;

    let result;
    switch (name) {
      case 'file_read': {
        const filePath = resolvePath(args);
        if (!filePath) throw new Error(`Missing required parameter: path (received args: ${JSON.stringify(args)})`);
        result = await this._fileRead(filePath);
        break;
      }
      case 'file_write': {
        const filePath = resolvePath(args);
        const content = args.content ?? args.text ?? args.data ?? null;
        if (!filePath) throw new Error(`Missing required parameter: path (received args: ${JSON.stringify(Object.keys(args))})`);
        if (content === undefined || content === null) throw new Error(`Missing required parameter: content (received args: ${JSON.stringify(Object.keys(args))})`);
        // Security: validate file write permission and scan for secrets
        const writeCheck = securityGuard.validateFileWrite(filePath, content, this.agentId, this.agentName);
        if (!writeCheck.allowed) return `Security blocked: ${writeCheck.reason}`;
        securityGuard.scanForSecrets(content, `file_write:${filePath}`, this.agentId);
        result = await this._fileWrite(filePath, content);
        break;
      }
      case 'file_list':
        result = await this._fileList(resolvePath(args) || args.dir || args.directory || '.');
        break;
      case 'file_delete': {
        const filePath = resolvePath(args);
        if (!filePath) throw new Error(`Missing required parameter: path (received args: ${JSON.stringify(args)})`);
        result = await this._fileDelete(filePath);
        break;
      }
      case 'shell_exec': {
        const command = args.command || args.cmd || null;
        if (!command) throw new Error(`Missing required parameter: command (received args: ${JSON.stringify(Object.keys(args))})`);
        // Security: validate shell command before execution
        const shellCheck = securityGuard.validateShellCommand(command, this.agentId, this.agentName);
        if (!shellCheck.allowed) return `Security blocked: ${shellCheck.reason}`;
        result = await this._shellExec(command);
        // Security: scan command output for leaked secrets
        securityGuard.scanForSecrets(result, `shell_output:${command}`, this.agentId);
        break;
      }
      case 'send_message':
        result = await this._sendMessage(args.targetAgentId, args.content, args.type);
        break;
      default: {
        // Try plugin tools before giving up
        const pluginTools = pluginRegistry.getPluginTools();
        const hasPluginTool = pluginTools.some(t => t.function?.name === name);
        if (hasPluginTool) {
          result = await pluginRegistry.executePluginTool(name, args);
          break;
        }
        throw new Error(`Unknown tool: ${name}`);
      }
    }

    // Fire plugin hooks: after tool call
    await pluginRegistry.fireHook(HookPoint.AFTER_TOOL_CALL, {
      toolName: name, args, result, agentId: this.agentId, agentName: this.agentName,
    });

    return result;
  }

  /**
   * Read a file
   */
  async _fileRead(filePath) {
    const fullPath = this._safePath(filePath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return `Error: file not found "${filePath}"`;
      }
      throw error;
    }
  }

  /**
   * Write a file (auto-creates directories)
   */
  async _fileWrite(filePath, content) {
    const fullPath = this._safePath(filePath);
    const dir = path.dirname(fullPath);

    // Auto-create directory
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    await fs.writeFile(fullPath, content, { encoding: 'utf-8', mode: 0o644 });
    return `File written: ${filePath} (${content.length} chars)`;
  }

  /**
   * List directory contents
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
        return `Error: directory not found "${dirPath}"`;
      }
      throw error;
    }
  }

  /**
   * Delete a file
   */
  async _fileDelete(filePath) {
    const fullPath = this._safePath(filePath);
    try {
      await fs.unlink(fullPath);
      return `File deleted: ${filePath}`;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return `Error: file not found "${filePath}"`;
      }
      throw error;
    }
  }

  /**
   * Execute shell command (security restricted)
   */
  async _shellExec(command) {
    // Safety whitelist: only allow specific command prefixes
    const allowedPrefixes = [
      'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc',
      'node', 'npm', 'npx', 'echo', 'mkdir', 'cp', 'mv',
      'tree', 'pwd', 'which', 'git',
      'curl', 'wget', 'date', 'python', 'python3', 'env', 'sort', 'uniq', 'awk', 'sed', 'jq',
    ];

    const cmdName = command.trim().split(/\s+/)[0];
    if (!allowedPrefixes.includes(cmdName)) {
      return `Security restriction: command "${cmdName}" not allowed. Allowed commands: ${allowedPrefixes.join(', ')}`;
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workspaceDir,
        timeout: 30000, // 30s timeout
        maxBuffer: 1024 * 1024, // 1MB output limit
      });
      return stdout + (stderr ? `\n[stderr]: ${stderr}` : '');
    } catch (error) {
      return `Command execution failed: ${error.message}`;
    }
  }

  /**
   * Send message to another Agent
   */
  async _sendMessage(targetAgentId, content, type = 'task') {
    if (!this.messageBus) {
      return 'Error: message bus not initialized';
    }
    this.messageBus.send({
      from: this.agentId,
      to: targetAgentId,
      content,
      type: type || 'task',
    });

    // chatStore recording is handled centrally by _recordAgentChat in requirement.js messageHandler
    // Avoid double recording

    return `Message sent to ${targetAgentId}`;
  }
}
