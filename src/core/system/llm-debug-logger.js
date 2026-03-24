/**
 * LLM Debug Logger - 开发模式下记录完整的LLM输入输出
 * 
 * 每个员工的日志存储在 data/llm-logs/{agentId}/ 目录下
 * 每条记录包含完整的 messages (输入) 和 response (输出)
 * 用于调试提示词和模型行为
 */
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../lib/paths.js';

const LLM_LOGS_DIR = path.join(DATA_DIR, 'llm-logs');

// 确保日志目录存在
if (!fs.existsSync(LLM_LOGS_DIR)) {
  fs.mkdirSync(LLM_LOGS_DIR, { recursive: true });
}

/**
 * 是否处于 dev 模式
 * 通过环境变量 LLM_DEBUG=1 或 NODE_ENV=development 开启
 */
function isDebugEnabled() {
  return process.env.LLM_DEBUG === '1' || process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
}

/**
 * 获取某个 agent 的日志目录
 */
function getAgentLogDir(agentId) {
  const dir = path.join(LLM_LOGS_DIR, agentId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 记录一次 LLM 调用的完整输入输出
 * 
 * @param {object} params
 * @param {string} params.agentId - 员工ID
 * @param {string} params.agentName - 员工名称
 * @param {string} params.providerId - 供应商ID
 * @param {string} params.model - 模型名称
 * @param {Array} params.messages - 完整的输入消息列表
 * @param {object} params.response - 完整的LLM响应
 * @param {object} [params.options] - 请求选项 (temperature, maxTokens等)
 * @param {number} [params.latency] - 延迟(ms)
 * @param {object} [params.usage] - token使用情况
 * @param {boolean} [params.streamed] - 是否流式调用
 * @param {string} [params.error] - 错误信息（如果有）
 */
export function logLLMCall(params) {
  if (!isDebugEnabled()) return;
  if (!params.agentId) return;

  try {
    const logDir = getAgentLogDir(params.agentId);
    const timestamp = new Date().toISOString();
    // 文件名: timestamp_随机后缀.json，用时间戳排序
    const filename = `${timestamp.replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 6)}.json`;
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
      },
      // 完整输入
      input: {
        messages: params.messages || [],
        tools: params.options?.tools || undefined,
      },
      // 完整输出
      output: params.response || null,
    };

    const filePath = path.join(logDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(logEntry, null, 2), 'utf-8');
  } catch (err) {
    console.error('[LLMDebugLogger] 记录失败:', err.message);
  }
}

/**
 * 获取某个 agent 的日志列表（按时间倒序，只返回摘要信息）
 * 
 * @param {string} agentId
 * @param {object} [options]
 * @param {number} [options.limit=50] - 最大返回条数
 * @param {number} [options.offset=0] - 偏移量
 * @returns {Array<{id, timestamp, model, latency, streamed, error, messageCount, outputPreview}>}
 */
export function getAgentLogs(agentId, options = {}) {
  const limit = options.limit || 50;
  const offset = options.offset || 0;
  const logDir = path.join(LLM_LOGS_DIR, agentId);

  if (!fs.existsSync(logDir)) return { logs: [], total: 0 };

  try {
    let files = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a)); // 按文件名倒序 = 按时间倒序

    const total = files.length;
    files = files.slice(offset, offset + limit);

    const logs = files.map(f => {
      try {
        const content = fs.readFileSync(path.join(logDir, f), 'utf-8');
        const entry = JSON.parse(content);
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
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    return { logs, total };
  } catch (err) {
    console.error('[LLMDebugLogger] 读取日志列表失败:', err.message);
    return { logs: [], total: 0 };
  }
}

/**
 * 获取某条日志的完整内容
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
    console.error('[LLMDebugLogger] 读取日志详情失败:', err.message);
    return null;
  }
}

/**
 * 清除某个 agent 的所有日志
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
 * 获取所有有日志的 agent 列表
 * 
 * @returns {Array<{agentId, logCount}>}
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
