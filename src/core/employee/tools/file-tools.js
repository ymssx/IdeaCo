/**
 * File Tools — File system operation tools.
 *
 * Provides tools for reading, writing, patching, deleting, and listing files
 * within the agent's workspace. All paths are resolved relative to workspace
 * and sandboxed to prevent access outside it.
 *
 * Extracted from AgentToolKit to live in the employee tool pool.
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { securityGuard } from '../../system/audit.js';

// ======================== Tool Definitions ========================

/**
 * Get all file-related tool definitions (OpenAI function calling format).
 * @returns {Array<object>}
 */
export function getFileToolDefinitions() {
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
  ];
}

// ======================== Tool Handler Factory ========================

/**
 * Create file tool handlers bound to a workspace context.
 *
 * @param {object} context
 * @param {string} context.workspaceDir - Agent's workspace root directory
 * @param {function} context.safePath - Path resolution & sandboxing function: (filePath) => absolutePath
 * @param {string} context.agentId - Current Agent's ID
 * @param {string} context.agentName - Current Agent's display name
 * @returns {Map<string, function>} Tool name → async handler
 */
export function createFileToolHandlers(context) {
  const { workspaceDir, safePath, agentId, agentName } = context;
  const handlers = new Map();

  // ---- file_read ----
  handlers.set('file_read', async (args) => {
    const filePath = args.path || args.filePath || args.file_path || args.filename || args.fileName;
    if (!filePath) throw new Error(`Missing required parameter: path (received args: ${JSON.stringify(args)})`);

    const fullPath = safePath(filePath);
    const MAX_LINES = 800;
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      if (args.offset || args.limit) {
        const startLine = Math.max(1, args.offset || 1);
        const endLine = args.limit ? Math.min(totalLines, startLine + args.limit - 1) : totalLines;
        const slice = lines.slice(startLine - 1, endLine);
        const header = `[Lines ${startLine}-${endLine} of ${totalLines} total]\n`;
        return header + slice.join('\n');
      }

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
  });

  // ---- file_write ----
  handlers.set('file_write', async (args) => {
    const filePath = args.path || args.filePath || args.file_path || args.filename || args.fileName;
    const content = args.content ?? args.text ?? args.data ?? null;
    if (!filePath) throw new Error(`Missing required parameter: path (received args: ${JSON.stringify(Object.keys(args))})`);
    if (content === undefined || content === null) throw new Error(`Missing required parameter: content (received args: ${JSON.stringify(Object.keys(args))})`);

    const writeCheck = securityGuard.validateFileWrite(filePath, content, agentId, agentName);
    if (!writeCheck.allowed) return `Security blocked: ${writeCheck.reason}`;
    securityGuard.scanForSecrets(content, `file_write:${filePath}`, agentId);

    const fullPath = safePath(filePath);
    const dir = path.dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await fs.writeFile(fullPath, content, { encoding: 'utf-8', mode: 0o644 });
    return `File written: ${filePath} (${content.length} chars)`;
  });

  // ---- file_list ----
  handlers.set('file_list', async (args) => {
    const dirPath = args.path || args.filePath || args.file_path || args.dir || args.directory || '.';
    const fullPath = safePath(dirPath);
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
  });

  // ---- file_delete ----
  handlers.set('file_delete', async (args) => {
    const filePath = args.path || args.filePath || args.file_path || args.filename || args.fileName;
    if (!filePath) throw new Error(`Missing required parameter: path (received args: ${JSON.stringify(args)})`);
    const fullPath = safePath(filePath);
    try {
      await fs.unlink(fullPath);
      return `File deleted: ${filePath}`;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return `Error: file not found "${filePath}"`;
      }
      throw error;
    }
  });

  // ---- mkdir ----
  handlers.set('mkdir', async (args) => {
    let dirs = [];
    if (args.paths && Array.isArray(args.paths)) {
      dirs = args.paths;
    } else {
      const p = args.path || args.filePath || args.file_path || args.dir || args.directory || '';
      if (!p) throw new Error('Missing required parameter: path or paths');
      dirs = p.split(',').map(s => s.trim()).filter(Boolean);
    }

    const created = [];
    const alreadyExist = [];
    const errors = [];

    for (const dir of dirs) {
      try {
        const fullPath = safePath(dir);
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
  });

  // ---- file_stats ----
  handlers.set('file_stats', async (args) => {
    const filePath = args.path || args.filePath || args.file_path || args.filename || args.fileName;
    if (!filePath) throw new Error(`Missing required parameter: path (received args: ${JSON.stringify(args)})`);
    const fullPath = safePath(filePath);
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
  });

  // ---- file_append ----
  handlers.set('file_append', async (args) => {
    const filePath = args.path || args.filePath || args.file_path || args.filename || args.fileName;
    const content = args.content ?? args.text ?? args.data ?? null;
    if (!filePath) throw new Error(`Missing required parameter: path (received args: ${JSON.stringify(Object.keys(args))})`);
    if (content === undefined || content === null) throw new Error(`Missing required parameter: content`);

    const writeCheck = securityGuard.validateFileWrite(filePath, content, agentId, agentName);
    if (!writeCheck.allowed) return `Security blocked: ${writeCheck.reason}`;
    securityGuard.scanForSecrets(content, `file_append:${filePath}`, agentId);

    const fullPath = safePath(filePath);
    const dir = path.dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await fs.appendFile(fullPath, content, { encoding: 'utf-8' });
    return `Content appended to ${filePath} (${content.length} chars added)`;
  });

  // ---- file_patch ----
  handlers.set('file_patch', async (args) => {
    const filePath = args.path || args.filePath || args.file_path || args.filename || args.fileName;
    const oldText = args.old_text || args.oldText || null;
    const newText = args.new_text ?? args.newText ?? null;
    if (!filePath) throw new Error(`Missing required parameter: path`);
    if (!oldText) throw new Error(`Missing required parameter: old_text`);
    if (newText === null || newText === undefined) throw new Error(`Missing required parameter: new_text`);

    const fullPath = safePath(filePath);
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
  });

  // ---- multi_patch ----
  handlers.set('multi_patch', async (args) => {
    const filePath = args.path || args.filePath || args.file_path || args.filename || args.fileName;
    const edits = args.edits;
    if (!filePath) throw new Error('Missing required parameter: path');
    if (!edits || !Array.isArray(edits) || edits.length === 0) throw new Error('Missing required parameter: edits (must be a non-empty array)');

    const fullPath = safePath(filePath);
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
        const writeCheck = securityGuard.validateFileWrite(filePath, content, agentId, agentName);
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
  });

  return handlers;
}
