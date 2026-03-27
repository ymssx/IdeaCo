/**
 * LLM Debug Logger — Records full LLM input/output in dev mode.
 * 
 * Each agent's logs are stored in data/llm-logs/{agentId}/
 * Each entry contains full messages (input) and response (output)
 * Used for debugging prompts and model behavior.
 */
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../lib/paths.js';

const LLM_LOGS_DIR = path.join(DATA_DIR, 'llm-logs');

// Ensure log directory exists
if (!fs.existsSync(LLM_LOGS_DIR)) {
  fs.mkdirSync(LLM_LOGS_DIR, { recursive: true });
}

/**
 * Whether debug mode is enabled.
 * Activated via LLM_DEBUG=1 or NODE_ENV=development.
 */
function isDebugEnabled() {
  return process.env.LLM_DEBUG === '1' || process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
}

/**
 * Get the log directory for a specific agent.
 */
function getAgentLogDir(agentId) {
  const dir = path.join(LLM_LOGS_DIR, agentId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Record a full LLM call's input and output.
 * 
 * @param {object} params
 * @param {string} params.agentId - Agent ID
 * @param {string} params.agentName - Agent name
 * @param {string} params.providerId - Provider ID
 * @param {string} params.model - Model name
 * @param {Array} params.messages - Full input message list
 * @param {object} params.response - Full LLM response
 * @param {Array} [params.toolResults] - Tool execution results (from ToolLoop)
 * @param {object} [params.options] - Request options (temperature, maxTokens, etc.)
 * @param {number} [params.latency] - Latency in ms
 * @param {object} [params.usage] - Token usage
 * @param {boolean} [params.streamed] - Whether this was a streamed call
 * @param {string} [params.error] - Error message (if any)
 */
export function logLLMCall(params) {
  if (!isDebugEnabled()) return;
  if (!params.agentId) return;

  try {
    const logDir = getAgentLogDir(params.agentId);
    const timestamp = new Date().toISOString();
    // Filename: timestamp_randomSuffix.json, sorted by timestamp
    const filename = `${timestamp.replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 6)}.json`;
    // Extract tool call information from response
    const responseToolCalls = params.response?.toolCalls || null;
    const toolResults = params.toolResults || null;

    const logEntry = {
      id: filename.replace('.json', ''),
      timestamp,
      agentId: params.agentId,
      agentName: params.agentName || '',
      providerId: params.providerId || '',
      model: params.model || '',
      latency: params.latency || 0,
      streamed: params.streamed || false,
      error: params.error || null,
      usage: params.usage || {},
      options: {
        temperature: params.options?.temperature,
        maxTokens: params.options?.maxTokens,
        hasTools: !!(params.options?.tools?.length),
        toolCount: params.options?.tools?.length || 0,
        isSummary: params.options?._isChatWithToolsSummary || false,
        iterationsUsed: params.options?.iterationsUsed || 0,
      },
      // Full input
      input: {
        messages: params.messages || [],
        tools: params.options?.tools || undefined,
      },
      // Full output
      output: params.response || null,
      // Tool call details (from LLM response)
      toolCalls: responseToolCalls,
      // Tool execution results (from ToolLoop)
      toolResults: toolResults,
    };

    const filePath = path.join(logDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(logEntry, null, 2), 'utf-8');
  } catch (err) {
    console.error('[LLMDebugLogger] Write failed:', err.message);
  }
}

/**
 * Get the log list for an agent (reverse chronological, summaries only).
 * 
 * @param {string} agentId
 * @param {object} [options]
 * @param {number} [options.limit=50] - Max entries to return
 * @param {number} [options.offset=0] - Offset for pagination
 * @returns {{logs: Array, total: number}}
 */
export function getAgentLogs(agentId, options = {}) {
  const limit = options.limit || 50;
  const offset = options.offset || 0;
  const logDir = path.join(LLM_LOGS_DIR, agentId);

  if (!fs.existsSync(logDir)) return { logs: [], total: 0 };

  try {
    let files = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a)); // Reverse sort by filename = reverse chronological

    const total = files.length;
    files = files.slice(offset, offset + limit);

    const logs = files.map(f => {
      try {
        const content = fs.readFileSync(path.join(logDir, f), 'utf-8');
        const entry = JSON.parse(content);

        // Build tool call summary for list view
        const toolCallCount = entry.toolCalls?.length ||
          entry.toolResults?.length ||
          entry.output?.toolResults?.length || 0;
        const toolCallNames = entry.toolResults?.map(r => r.tool).filter(Boolean) ||
          entry.output?.toolResults?.map(r => r.tool).filter(Boolean) || [];

        return {
          id: entry.id,
          timestamp: entry.timestamp,
          agentName: entry.agentName,
          providerId: entry.providerId,
          model: entry.model,
          latency: entry.latency,
          streamed: entry.streamed,
          error: entry.error,
          usage: entry.usage,
          messageCount: entry.input?.messages?.length || 0,
          outputPreview: (entry.output?.content || entry.error || '').slice(0, 150),
          // Tool call visibility
          toolCallCount,
          toolCallNames: [...new Set(toolCallNames)],
          isSummary: entry.options?.isSummary || false,
          iterationsUsed: entry.options?.iterationsUsed || 0,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    return { logs, total };
  } catch (err) {
    console.error('[LLMDebugLogger] Failed to read log list:', err.message);
    return { logs: [], total: 0 };
  }
}

/**
 * Get the full content of a single log entry.
 * 
 * @param {string} agentId
 * @param {string} logId
 * @returns {object|null}
 */
export function getLogDetail(agentId, logId) {
  const logDir = path.join(LLM_LOGS_DIR, agentId);
  const filePath = path.join(logDir, `${logId}.json`);

  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('[LLMDebugLogger] Failed to read log detail:', err.message);
    return null;
  }
}

/**
 * Clear all logs for a specific agent.
 * 
 * @param {string} agentId
 */
export function clearAgentLogs(agentId) {
  const logDir = path.join(LLM_LOGS_DIR, agentId);
  if (fs.existsSync(logDir)) {
    fs.rmSync(logDir, { recursive: true, force: true });
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Get a summary list of all agents that have logs.
 * 
 * @returns {Array<{agentId: string, logCount: number}>}
 */
export function getAllAgentLogSummary() {
  if (!fs.existsSync(LLM_LOGS_DIR)) return [];

  try {
    return fs.readdirSync(LLM_LOGS_DIR)
      .filter(d => fs.statSync(path.join(LLM_LOGS_DIR, d)).isDirectory())
      .map(agentId => {
        const dir = path.join(LLM_LOGS_DIR, agentId);
        const count = fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
        return { agentId, logCount: count };
      })
      .filter(s => s.logCount > 0);
  } catch {
    return [];
  }
}
