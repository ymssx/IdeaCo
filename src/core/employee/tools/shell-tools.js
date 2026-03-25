/**
 * Shell Tools — Shell command execution tool.
 *
 * Provides the shell_exec tool for running shell commands within
 * the agent's workspace. Security validation is handled by SecurityGuard.
 *
 * Extracted from AgentToolKit to live in the employee tool pool.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { securityGuard } from '../../system/audit.js';

const execAsync = promisify(exec);

// ======================== Tool Definitions ========================

/**
 * Get shell tool definitions (OpenAI function calling format).
 * @returns {Array<object>}
 */
export function getShellToolDefinitions() {
  return [
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
  ];
}

// ======================== Tool Handler Factory ========================

/**
 * Create shell tool handlers bound to a workspace context.
 *
 * @param {object} context
 * @param {string} context.workspaceDir - Agent's workspace root directory
 * @param {string} context.agentId - Current Agent's ID
 * @param {string} context.agentName - Current Agent's display name
 * @returns {Map<string, function>} Tool name → async handler
 */
export function createShellToolHandlers(context) {
  const { workspaceDir, agentId, agentName } = context;
  const handlers = new Map();

  handlers.set('shell_exec', async (args) => {
    const command = args.command || args.cmd || null;
    if (!command) throw new Error(`Missing required parameter: command (received args: ${JSON.stringify(Object.keys(args))})`);

    // Security: validate shell command before execution
    const shellCheck = securityGuard.validateShellCommand(command, agentId, agentName);
    if (!shellCheck.allowed) return `Security blocked: ${shellCheck.reason}`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceDir,
        timeout: 30000, // 30s timeout
        maxBuffer: 1024 * 1024, // 1MB output limit
      });
      const result = stdout + (stderr ? `\n[stderr]: ${stderr}` : '');
      // Security: scan command output for leaked secrets
      securityGuard.scanForSecrets(result, `shell_output:${command}`, agentId);
      return result;
    } catch (error) {
      return `Command execution failed: ${error.message}`;
    }
  });

  return handlers;
}
