/**
 * Agent Tool System - Callable tool set for Agents
 * 
 * Follows the Codex/OpenAI Agents tool_use pattern:
 * - file_read: Read file contents (with offset/limit for large files)
 * - file_write: Write/create files
 * - file_append: Append content to a file
 * - file_patch: Replace a text segment in a file
 * - multi_patch: Apply multiple replacements to a file in one call
 * - file_list: List directory contents
 * - file_delete: Delete files
 * - mkdir: Create directories (with recursive parent creation)
 * - file_stats: Get file metadata without reading content
 * - file_search: Search for files by name
 * - grep_search: Search file contents for text/regex patterns
 * - glob_search: Find files matching glob patterns (e.g. **\/*.js)
 * - workspace_files: List all files recursively
 * - shell_exec: Execute shell commands (restricted)
 * - send_message: Send messages to other Agents
 */
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { securityGuard } from '../system/audit.js';
import { pluginRegistry, HookPoint } from '../system/plugin.js';
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
   * @param {string} agentName - Current Agent's display name
   * @param {object} [employee] - Back-reference to the owning Employee (for memory access)
   */
  constructor(workspaceDir, messageBus = null, agentId = null, agentName = '', employee = null) {
    this.workspaceDir = workspaceDir;
    this.messageBus = messageBus;
    this.agentId = agentId;
    this.agentName = agentName;
    this.employee = employee;

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
          description: 'Read the contents of a file. For large files, use offset and limit to read specific line ranges to avoid context overflow. If the file is too large (>800 lines), it will be automatically truncated with a hint to use offset/limit for the remaining content.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path (relative to workspace)' },
              offset: { type: 'integer', description: 'Start reading from this line number (1-based). Omit to start from beginning.' },
              limit: { type: 'integer', description: 'Maximum number of lines to read. Omit to read all (subject to auto-truncation for large files).' },
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
          name: 'mkdir',
          description: 'Create one or more directories (with parent directories created automatically). Use this to set up project folder structures. You can pass a single path string or an array of paths to create multiple directories at once. Path is relative to workspace.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Directory path to create (relative to workspace). For multiple directories, separate with commas: "backend,frontend,shared"' },
              paths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of directory paths to create (alternative to single path)',
              },
            },
            required: [],
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
      {
        type: 'function',
        function: {
          name: 'file_stats',
          description: 'Get file metadata (size, line count, last modified) WITHOUT reading the content. Use this to check file size before reading, especially for large files. This helps you decide whether to use offset/limit with file_read.',
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
          name: 'file_append',
          description: 'Append content to the end of an existing file (or create it if it does not exist). Useful for building up long files incrementally without having to rewrite the entire content.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path (relative to workspace)' },
              content: { type: 'string', description: 'Content to append' },
            },
            required: ['path', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_patch',
          description: 'Replace a specific text segment in a file. Use this to edit part of a file without rewriting the entire content. The old_text must match exactly (including whitespace).',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path (relative to workspace)' },
              old_text: { type: 'string', description: 'The exact text to find and replace (must be unique in the file)' },
              new_text: { type: 'string', description: 'The replacement text' },
            },
            required: ['path', 'old_text', 'new_text'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'workspace_files',
          description: 'List ALL files in the workspace recursively. Returns a flat list of all file paths relative to workspace root. Use this to see what files exist before referencing them in your messages. This is especially useful before writing [[file:path]] references to ensure the file actually exists.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_search',
          description: 'Search for files by name pattern in the workspace. Returns matching file paths. Use this when you want to find a file but are unsure of its exact name or location. Supports partial name matching (case-insensitive).',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query — partial filename or keyword to match against file names (case-insensitive)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'grep_search',
          description: 'Search file contents for a text string or regex pattern across the workspace. Returns matching lines with file paths and line numbers. Essential for finding function definitions, variable usages, imports, and any code pattern. Much faster than reading files one by one.',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Search string or regular expression pattern to match against file contents' },
              path: { type: 'string', description: 'Directory to search in (relative to workspace). Defaults to workspace root.' },
              include: { type: 'string', description: 'File extension filter, e.g. "js", "ts", "py". Only search files with this extension.' },
              isRegex: { type: 'boolean', description: 'If true, treat pattern as a regular expression. Defaults to false (literal string match).' },
              maxResults: { type: 'integer', description: 'Maximum number of matching lines to return (default: 50)' },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'glob_search',
          description: 'Find files matching a glob-like pattern. Supports "*" (any filename), "**" (any directory depth), and "?" (single char). Examples: "**/*.test.js", "src/**/*.ts", "*.json".',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Glob pattern to match against file paths (e.g. "**/*.js", "src/**/*.test.ts", "*.json")' },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'multi_patch',
          description: 'Apply multiple text replacements to a single file in one operation. Each edit replaces one occurrence of old_text with new_text, applied sequentially. Use this instead of multiple file_patch calls when you need to make several changes to the same file.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path (relative to workspace)' },
              edits: {
                type: 'array',
                description: 'Array of edits to apply sequentially',
                items: {
                  type: 'object',
                  properties: {
                    old_text: { type: 'string', description: 'Exact text to find (must be unique in the file at the time of application)' },
                    new_text: { type: 'string', description: 'Replacement text' },
                  },
                  required: ['old_text', 'new_text'],
                },
              },
            },
            required: ['path', 'edits'],
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
        result = await this._fileRead(filePath, args.offset, args.limit);
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
      case 'mkdir': {
        // Support both single path (string, possibly comma-separated) and array of paths
        let dirs = [];
        if (args.paths && Array.isArray(args.paths)) {
          dirs = args.paths;
        } else {
          const p = resolvePath(args) || args.dir || args.directory || '';
          if (!p) throw new Error('Missing required parameter: path or paths');
          dirs = p.split(',').map(s => s.trim()).filter(Boolean);
        }
        result = await this._mkdir(dirs);
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
      case 'file_stats': {
        const filePath = resolvePath(args);
        if (!filePath) throw new Error(`Missing required parameter: path (received args: ${JSON.stringify(args)})`);
        result = await this._fileStats(filePath);
        break;
      }
      case 'file_append': {
        const filePath = resolvePath(args);
        const content = args.content ?? args.text ?? args.data ?? null;
        if (!filePath) throw new Error(`Missing required parameter: path (received args: ${JSON.stringify(Object.keys(args))})`);
        if (content === undefined || content === null) throw new Error(`Missing required parameter: content`);
        const writeCheck = securityGuard.validateFileWrite(filePath, content, this.agentId, this.agentName);
        if (!writeCheck.allowed) return `Security blocked: ${writeCheck.reason}`;
        securityGuard.scanForSecrets(content, `file_append:${filePath}`, this.agentId);
        result = await this._fileAppend(filePath, content);
        break;
      }
      case 'file_patch': {
        const filePath = resolvePath(args);
        const oldText = args.old_text || args.oldText || null;
        const newText = args.new_text ?? args.newText ?? null;
        if (!filePath) throw new Error(`Missing required parameter: path`);
        if (!oldText) throw new Error(`Missing required parameter: old_text`);
        if (newText === null || newText === undefined) throw new Error(`Missing required parameter: new_text`);
        result = await this._filePatch(filePath, oldText, newText);
        break;
      }
      case 'workspace_files':
        result = await this._workspaceFiles();
        break;
      case 'file_search':
        result = await this._fileSearch(args.query || args.keyword || args.pattern || '');
        break;
      case 'grep_search': {
        const pattern = args.pattern || args.query || args.search || '';
        if (!pattern) throw new Error('Missing required parameter: pattern');
        result = await this._grepSearch(pattern, resolvePath(args) || args.dir || '.', args.include, args.isRegex, args.maxResults);
        break;
      }
      case 'glob_search': {
        const pattern = args.pattern || args.glob || '';
        if (!pattern) throw new Error('Missing required parameter: pattern');
        result = await this._globSearch(pattern);
        break;
      }
      case 'multi_patch': {
        const filePath = resolvePath(args);
        const edits = args.edits;
        if (!filePath) throw new Error('Missing required parameter: path');
        if (!edits || !Array.isArray(edits) || edits.length === 0) throw new Error('Missing required parameter: edits (must be a non-empty array)');
        result = await this._multiPatch(filePath, edits);
        break;
      }
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
   * Read a file with optional line-based offset/limit and auto-truncation for large files
   */
  async _fileRead(filePath, offset, limit) {
    const fullPath = this._safePath(filePath);
    const MAX_LINES = 800; // Auto-truncation threshold
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      // Apply offset/limit if provided
      if (offset || limit) {
        const startLine = Math.max(1, offset || 1);
        const endLine = limit ? Math.min(totalLines, startLine + limit - 1) : totalLines;
        const slice = lines.slice(startLine - 1, endLine);
        const header = `[Lines ${startLine}-${endLine} of ${totalLines} total]\n`;
        return header + slice.join('\n');
      }

      // Auto-truncation for large files
      if (totalLines > MAX_LINES) {
        const truncated = lines.slice(0, MAX_LINES).join('\n');
        return `${truncated}\n\n--- FILE TRUNCATED ---\nShowing ${MAX_LINES} of ${totalLines} lines. Use file_read with offset=${MAX_LINES + 1} to read more, or file_stats to check file info.`;
      }

      return content;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return `Error: file not found "${filePath}". Use workspace_files or file_search to find available files.`;
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
   * Create directories (with recursive parent creation)
   */
  async _mkdir(dirs) {
    const created = [];
    const alreadyExist = [];
    const errors = [];

    for (const dir of dirs) {
      try {
        const fullPath = this._safePath(dir);
        if (existsSync(fullPath)) {
          alreadyExist.push(dir);
        } else {
          mkdirSync(fullPath, { recursive: true });
          created.push(dir);
        }
      } catch (error) {
        errors.push(`${dir}: ${error.message}`);
      }
    }

    const parts = [];
    if (created.length > 0) parts.push(`Created: ${created.join(', ')}`);
    if (alreadyExist.length > 0) parts.push(`Already exist: ${alreadyExist.join(', ')}`);
    if (errors.length > 0) parts.push(`Errors: ${errors.join('; ')}`);
    return parts.join('\n') || 'No directories specified.';
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

  /**
   * Save a memory for the owning Employee
   */
  /**
   * Get file stats without reading content
   */
  async _fileStats(filePath) {
    const fullPath = this._safePath(filePath);
    try {
      const stat = await fs.stat(fullPath);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lineCount = content.split('\n').length;
      const sizeKB = (stat.size / 1024).toFixed(1);
      return `File: ${filePath}\nSize: ${stat.size} bytes (${sizeKB} KB)\nLines: ${lineCount}\nLast modified: ${stat.mtime.toISOString()}\n${lineCount > 800 ? `⚠️ Large file — use file_read with offset/limit to read in sections.` : `✓ File is small enough to read in full.`}`;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return `Error: file not found "${filePath}". Use workspace_files or file_search to find available files.`;
      }
      throw error;
    }
  }

  /**
   * Append content to a file (creates if not exists)
   */
  async _fileAppend(filePath, content) {
    const fullPath = this._safePath(filePath);
    const dir = path.dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await fs.appendFile(fullPath, content, { encoding: 'utf-8' });
    return `Content appended to ${filePath} (${content.length} chars added)`;
  }

  /**
   * Patch a file by replacing a specific text segment
   */
  async _filePatch(filePath, oldText, newText) {
    const fullPath = this._safePath(filePath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const occurrences = content.split(oldText).length - 1;
      if (occurrences === 0) {
        return `Error: old_text not found in "${filePath}". Make sure the text matches exactly (including whitespace and newlines). Use file_read to check the current content.`;
      }
      if (occurrences > 1) {
        return `Error: old_text found ${occurrences} times in "${filePath}". It must be unique. Provide more surrounding context to make it unique.`;
      }
      const patched = content.replace(oldText, newText);
      await fs.writeFile(fullPath, patched, { encoding: 'utf-8', mode: 0o644 });
      return `File patched: ${filePath} (replaced ${oldText.length} chars with ${newText.length} chars)`;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return `Error: file not found "${filePath}"`;
      }
      throw error;
    }
  }

  /**
   * List all files in workspace recursively
   */
  async _workspaceFiles() {
    const files = [];
    const walk = async (dir, prefix = '') => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          // Skip hidden dirs and common noise
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(path.join(dir, entry.name), rel);
          } else {
            files.push(rel);
          }
        }
      } catch { /* ignore unreadable dirs */ }
    };
    await walk(this.workspaceDir);
    if (files.length === 0) return 'Workspace is empty — no files found.';
    return `Files in workspace (${files.length} total):\n${files.map(f => `  ${f}`).join('\n')}`;
  }

  /**
   * Grep search: search file contents for a pattern
   */
  async _grepSearch(pattern, searchDir = '.', include, isRegex = false, maxResults = 50) {
    const baseDir = this._safePath(searchDir);
    const results = [];
    const limit = Math.min(maxResults || 50, 200);

    let regex;
    try {
      regex = isRegex ? new RegExp(pattern, 'i') : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch (e) {
      return `Error: invalid regex pattern "${pattern}" — ${e.message}`;
    }

    const extFilter = include ? include.replace(/^\./, '').toLowerCase() : null;

    // Binary file extensions to skip
    const binaryExts = new Set(['png','jpg','jpeg','gif','bmp','ico','svg','woff','woff2','ttf','eot','mp3','mp4','avi','mov','zip','tar','gz','pdf','exe','dll','so','dylib','bin','dat','db','sqlite','lock']);

    const walk = async (dir) => {
      if (results.length >= limit) return;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= limit) return;
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === 'dist' || entry.name === 'build') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else {
            const ext = path.extname(entry.name).replace(/^\./, '').toLowerCase();
            if (binaryExts.has(ext)) continue;
            if (extFilter && ext !== extFilter) continue;
            try {
              const stat = await fs.stat(fullPath);
              if (stat.size > 512 * 1024) continue; // Skip files > 512KB
              const content = await fs.readFile(fullPath, 'utf-8');
              const lines = content.split('\n');
              const relPath = path.relative(this.workspaceDir, fullPath);
              for (let i = 0; i < lines.length; i++) {
                if (results.length >= limit) break;
                if (regex.test(lines[i])) {
                  results.push({ file: relPath, line: i + 1, text: lines[i].trimEnd().substring(0, 200) });
                }
              }
            } catch { /* skip unreadable files */ }
          }
        }
      } catch { /* skip unreadable dirs */ }
    };

    await walk(baseDir);

    if (results.length === 0) return `No matches found for "${pattern}"${extFilter ? ` in *.${extFilter} files` : ''}.`;

    const header = `Found ${results.length}${results.length >= limit ? '+' : ''} matches for "${pattern}"${extFilter ? ` in *.${extFilter} files` : ''}:\n`;
    const body = results.map(r => `${r.file}:${r.line}: ${r.text}`).join('\n');
    return header + body;
  }

  /**
   * Glob search: find files matching a glob-like pattern
   */
  async _globSearch(pattern) {
    // Convert glob pattern to regex:
    // ** => match any path segments
    // * => match anything except /
    // ? => match single char except /
    const globToRegex = (glob) => {
      let regexStr = '^';
      let i = 0;
      while (i < glob.length) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
          // ** matches any path depth
          regexStr += '.*';
          i += 2;
          if (glob[i] === '/') i++; // skip trailing /
        } else if (c === '*') {
          regexStr += '[^/]*';
          i++;
        } else if (c === '?') {
          regexStr += '[^/]';
          i++;
        } else if (c === '.') {
          regexStr += '\\.';
          i++;
        } else {
          regexStr += c;
          i++;
        }
      }
      regexStr += '$';
      return new RegExp(regexStr, 'i');
    };

    const regex = globToRegex(pattern);
    const matches = [];

    const walk = async (dir, prefix = '') => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(path.join(dir, entry.name), rel);
          } else {
            if (regex.test(rel)) {
              matches.push(rel);
            }
          }
        }
      } catch { /* skip */ }
    };

    await walk(this.workspaceDir);
    if (matches.length === 0) return `No files found matching pattern "${pattern}".`;
    return `Files matching "${pattern}" (${matches.length} found):\n${matches.map(f => `  ${f}`).join('\n')}`;
  }

  /**
   * Multi-patch: apply multiple edits to a single file sequentially
   */
  async _multiPatch(filePath, edits) {
    const fullPath = this._safePath(filePath);
    try {
      let content = await fs.readFile(fullPath, 'utf-8');
      const applied = [];
      const failed = [];

      for (let i = 0; i < edits.length; i++) {
        const { old_text, new_text } = edits[i];
        if (!old_text) {
          failed.push({ index: i + 1, reason: 'missing old_text' });
          continue;
        }
        const occurrences = content.split(old_text).length - 1;
        if (occurrences === 0) {
          failed.push({ index: i + 1, reason: 'old_text not found (may have been affected by a previous edit)' });
          continue;
        }
        if (occurrences > 1) {
          failed.push({ index: i + 1, reason: `old_text found ${occurrences} times — must be unique` });
          continue;
        }
        content = content.replace(old_text, new_text);
        applied.push(i + 1);
      }

      if (applied.length > 0) {
        // Security check on final content
        const writeCheck = securityGuard.validateFileWrite(filePath, content, this.agentId, this.agentName);
        if (!writeCheck.allowed) return `Security blocked: ${writeCheck.reason}`;
        await fs.writeFile(fullPath, content, { encoding: 'utf-8', mode: 0o644 });
      }

      let msg = `Multi-patch on ${filePath}: ${applied.length}/${edits.length} edits applied.`;
      if (failed.length > 0) {
        msg += `\nFailed edits: ${failed.map(f => `#${f.index} (${f.reason})`).join(', ')}`;
      }
      return msg;
    } catch (error) {
      if (error.code === 'ENOENT') return `Error: file not found "${filePath}"`;
      throw error;
    }
  }

  /**
   * Search for files by name pattern (case-insensitive partial match)
   */
  async _fileSearch(query) {
    if (!query) return 'Error: query parameter is required';
    const queryLower = query.toLowerCase();
    const matches = [];
    const walk = async (dir, prefix = '') => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(path.join(dir, entry.name), rel);
          } else {
            if (entry.name.toLowerCase().includes(queryLower)) {
              matches.push(rel);
            }
          }
        }
      } catch { /* ignore unreadable dirs */ }
    };
    await walk(this.workspaceDir);
    if (matches.length === 0) return `No files found matching "${query}". Use workspace_files to see all available files.`;
    return `Files matching "${query}" (${matches.length} found):\n${matches.map(f => `  ${f}`).join('\n')}`;
  }
}
