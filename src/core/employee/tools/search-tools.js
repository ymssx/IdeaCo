/**
 * Search Tools — Workspace search and discovery tools.
 *
 * Provides tools for searching file names, file contents (grep),
 * glob-pattern matching, and listing all workspace files recursively.
 *
 * Extracted from AgentToolKit to live in the employee tool pool.
 */

import fs from 'fs/promises';
import path from 'path';

// ======================== Tool Definitions ========================

/**
 * Get all search-related tool definitions (OpenAI function calling format).
 * @returns {Array<object>}
 */
export function getSearchToolDefinitions() {
  return [
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
        name: 'workspace_files',
        description: 'List ALL files in the workspace recursively. Returns a flat list of all file paths relative to workspace root. Use this to see what files exist before referencing them in your messages. This is especially useful before writing [[file:path]] references to ensure the file actually exists.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
  ];
}

// ======================== Tool Handler Factory ========================

/**
 * Create search tool handlers bound to a workspace context.
 *
 * @param {object} context
 * @param {string} context.workspaceDir - Agent's workspace root directory
 * @param {function} context.safePath - Path resolution & sandboxing function
 * @returns {Map<string, function>} Tool name → async handler
 */
export function createSearchToolHandlers(context) {
  const { workspaceDir, safePath } = context;
  const handlers = new Map();

  // Binary file extensions to skip during content search
  const binaryExts = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'woff', 'woff2',
    'ttf', 'eot', 'mp3', 'mp4', 'avi', 'mov', 'zip', 'tar', 'gz',
    'pdf', 'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sqlite', 'lock',
  ]);

  // ---- file_search ----
  handlers.set('file_search', async (args) => {
    const query = args.query || args.keyword || args.pattern || '';
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
    await walk(workspaceDir);
    if (matches.length === 0) return `No files found matching "${query}". Use workspace_files to see all available files.`;
    return `Files matching "${query}" (${matches.length} found):\n${matches.map(f => `  ${f}`).join('\n')}`;
  });

  // ---- grep_search ----
  handlers.set('grep_search', async (args) => {
    const pattern = args.pattern || args.query || args.search || '';
    if (!pattern) throw new Error('Missing required parameter: pattern');
    const searchDir = args.path || args.filePath || args.file_path || args.dir || '.';
    const include = args.include;
    const isRegex = args.isRegex || false;
    const maxResults = args.maxResults || 50;

    const baseDir = safePath(searchDir);
    const results = [];
    const limit = Math.min(maxResults, 200);

    let regex;
    try {
      regex = isRegex ? new RegExp(pattern, 'i') : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch (e) {
      return `Error: invalid regex pattern "${pattern}" — ${e.message}`;
    }

    const extFilter = include ? include.replace(/^\./, '').toLowerCase() : null;

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
              const relPath = path.relative(workspaceDir, fullPath);
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
  });

  // ---- glob_search ----
  handlers.set('glob_search', async (args) => {
    const pattern = args.pattern || args.glob || '';
    if (!pattern) throw new Error('Missing required parameter: pattern');

    // Convert glob pattern to regex
    const globToRegex = (glob) => {
      let regexStr = '^';
      let i = 0;
      while (i < glob.length) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
          regexStr += '.*';
          i += 2;
          if (glob[i] === '/') i++;
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

    await walk(workspaceDir);
    if (matches.length === 0) return `No files found matching pattern "${pattern}".`;
    return `Files matching "${pattern}" (${matches.length} found):\n${matches.map(f => `  ${f}`).join('\n')}`;
  });

  // ---- workspace_files ----
  handlers.set('workspace_files', async () => {
    const files = [];
    const walk = async (dir, prefix = '') => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
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
    await walk(workspaceDir);
    if (files.length === 0) return 'Workspace is empty — no files found.';
    return `Files in workspace (${files.length} total):\n${files.map(f => `  ${f}`).join('\n')}`;
  });

  return handlers;
}
