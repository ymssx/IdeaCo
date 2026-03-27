/**
 * LLM Log Viewer — Renders a single LLM log as a clean, readable HTML page
 *
 * GET /api/agents/[agentId]/llm-logs/view?logId=xxx
 *
 * White background, black text, monospace font — easy to read and debug.
 */
import { getLogDetail } from '@/core/system/llm-debug-logger.js';

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatValue(val) {
  if (val === null || val === undefined) return '<em>null</em>';
  if (typeof val === 'string') return escapeHtml(val);
  return escapeHtml(JSON.stringify(val, null, 2));
}

function roleColor(role) {
  switch (role) {
    case 'system': return '#7c3aed';
    case 'assistant': return '#2563eb';
    case 'tool': return '#ea580c';
    case 'user': return '#16a34a';
    default: return '#333';
  }
}

export async function GET(request, { params }) {
  try {
    const { agentId } = await params;
    const { searchParams } = new URL(request.url);
    const logId = searchParams.get('logId');

    if (!logId) {
      return new Response('<h1>Missing logId parameter</h1>', {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const log = getLogDetail(agentId, logId);
    if (!log) {
      return new Response('<h1>Log not found</h1>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Build messages HTML
    const messagesHtml = (log.input?.messages || []).map((msg, i) => {
      const color = roleColor(msg.role);
      const content = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content, null, 2);

      let toolCallsHtml = '';
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const tcDetails = msg.tool_calls.map(tc => {
          const fnName = tc.function?.name || 'unknown';
          const fnArgs = tc.function?.arguments || '';
          let argsFormatted;
          try {
            argsFormatted = JSON.stringify(JSON.parse(fnArgs), null, 2);
          } catch {
            argsFormatted = fnArgs;
          }
          return `<div style="margin-top:4px;padding:6px 8px;background:#fff8f0;border-left:3px solid ${roleColor('tool')}">` +
            `<strong>tool_call: ${escapeHtml(fnName)}</strong> (id: ${escapeHtml(tc.id || '')})\n` +
            `<pre style="margin:4px 0 0 0;white-space:pre-wrap;word-break:break-all">${escapeHtml(argsFormatted)}</pre></div>`;
        }).join('');
        toolCallsHtml = toolCallsHtml + tcDetails;
      }

      let toolCallIdHtml = '';
      if (msg.tool_call_id) {
        toolCallIdHtml = ` <span style="color:#999;font-size:12px">tool_call_id: ${escapeHtml(msg.tool_call_id)}</span>`;
      }

      return `<div style="margin-bottom:12px;padding:10px 12px;border-left:4px solid ${color};background:#fafafa">
  <div style="margin-bottom:4px"><strong style="color:${color};text-transform:uppercase">${escapeHtml(msg.role)}</strong> <span style="color:#999;font-size:12px">[${i}]</span>${toolCallIdHtml}</div>
  <pre style="margin:0;white-space:pre-wrap;word-break:break-all">${escapeHtml(content)}</pre>${toolCallsHtml}
</div>`;
    }).join('\n');

    // Build tools HTML
    let toolsHtml = '';
    if (log.input?.tools?.length > 0) {
      toolsHtml = `
<h2 style="margin-top:32px;padding-bottom:4px;border-bottom:2px solid #ea580c;color:#ea580c">🔧 Tool Definitions (${log.input.tools.length})</h2>
<pre style="background:#fafafa;padding:12px;border:1px solid #ddd;white-space:pre-wrap;word-break:break-all">${escapeHtml(JSON.stringify(log.input.tools, null, 2))}</pre>`;
    }

    // Build output HTML
    let outputHtml;
    if (log.error) {
      outputHtml = `<pre style="background:#fff0f0;padding:12px;border:1px solid #fca5a5;color:#dc2626;white-space:pre-wrap;word-break:break-all">❌ ${escapeHtml(log.error)}</pre>`;
    } else {
      const outputStr = typeof log.output === 'string'
        ? log.output
        : JSON.stringify(log.output, null, 2);
      outputHtml = `<pre style="background:#f0f7ff;padding:12px;border:1px solid #bfdbfe;white-space:pre-wrap;word-break:break-all">${escapeHtml(outputStr)}</pre>`;
    }

    // Build tool results HTML (from ToolLoop execution)
    let toolResultsHtml = '';
    const allToolResults = log.toolResults || log.output?.toolResults || [];
    if (allToolResults.length > 0) {
      const resultsItems = allToolResults.map((r, idx) => {
        const statusIcon = r.success ? '✅' : '❌';
        const statusColor = r.success ? '#16a34a' : '#dc2626';
        const resultContent = r.success
          ? (typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2))
          : (r.error || 'Unknown error');
        const argsStr = r.args ? JSON.stringify(r.args, null, 2) : '{}';
        return `<div style="margin-bottom:10px;padding:10px 12px;border-left:4px solid ${statusColor};background:#fafafa">
  <div style="margin-bottom:4px">${statusIcon} <strong style="color:${statusColor}">${escapeHtml(r.tool || 'unknown')}</strong> <span style="color:#999;font-size:12px">[${idx}]</span></div>
  <div style="margin-bottom:4px;color:#666;font-size:12px">Args:</div>
  <pre style="margin:0 0 6px 0;white-space:pre-wrap;word-break:break-all;background:#f5f5f5;padding:6px 8px;font-size:12px">${escapeHtml(argsStr)}</pre>
  <div style="color:#666;font-size:12px">Result:</div>
  <pre style="margin:0;white-space:pre-wrap;word-break:break-all;background:${r.success ? '#f0fdf4' : '#fff0f0'};padding:6px 8px;font-size:12px;max-height:300px;overflow:auto">${escapeHtml(resultContent)}</pre>
</div>`;
      }).join('\n');

      toolResultsHtml = `
<hr class="separator">
<h2 style="padding-bottom:4px;border-bottom:2px solid #ea580c;color:#ea580c">🔧 Tool Execution Results (${allToolResults.length})</h2>
${resultsItems}`;
    }

    // Build tool calls HTML (from LLM response)
    let responseToolCallsHtml = '';
    if (log.toolCalls && log.toolCalls.length > 0) {
      const tcItems = log.toolCalls.map((tc, idx) => {
        const fnName = tc.function?.name || tc.name || 'unknown';
        const fnArgs = tc.function?.arguments || tc.args || '';
        let argsFormatted;
        try {
          argsFormatted = typeof fnArgs === 'string' ? JSON.stringify(JSON.parse(fnArgs), null, 2) : JSON.stringify(fnArgs, null, 2);
        } catch {
          argsFormatted = String(fnArgs);
        }
        return `<div style="margin-bottom:8px;padding:8px 10px;border-left:3px solid #ea580c;background:#fff8f0">
  <strong style="color:#ea580c">${escapeHtml(fnName)}</strong> <span style="color:#999;font-size:12px">[${idx}]${tc.id ? ` id: ${escapeHtml(tc.id)}` : ''}</span>
  <pre style="margin:4px 0 0 0;white-space:pre-wrap;word-break:break-all;font-size:12px">${escapeHtml(argsFormatted)}</pre>
</div>`;
      }).join('\n');

      responseToolCallsHtml = `
<hr class="separator">
<h2 style="padding-bottom:4px;border-bottom:2px solid #d97706;color:#d97706">🤖 LLM Tool Calls (${log.toolCalls.length})</h2>
<p style="color:#666;font-size:12px;margin-bottom:8px">Tool calls requested by the LLM in its response:</p>
${tcItems}`;
    }

    // Build metadata
    const meta = [
      `Provider: ${escapeHtml(log.providerId || '-')}`,
      `Model: ${escapeHtml(log.model || '-')}`,
      `Latency: ${log.latency || 0}ms`,
      `Streamed: ${log.streamed ? 'Yes' : 'No'}`,
      log.usage?.total_tokens ? `Tokens: ${log.usage.total_tokens} (prompt: ${log.usage.prompt_tokens || '?'}, completion: ${log.usage.completion_tokens || '?'})` : null,
      log.options?.temperature !== undefined ? `Temperature: ${log.options.temperature}` : null,
      log.options?.hasTools ? `Tools: ${log.options.toolCount}` : null,
      log.options?.isSummary ? `ToolLoop Summary (${log.options.iterationsUsed} iterations)` : null,
      allToolResults.length > 0 ? `Tool Calls: ${allToolResults.length}` : null,
    ].filter(Boolean).join('  |  ');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLM Log — ${escapeHtml(log.agentName || log.agentId)} — ${escapeHtml(log.model || '')}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: #111;
      background: #fff;
      padding: 24px 32px;
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 { font-size: 18px; margin-bottom: 8px; color: #000; }
    h2 { font-size: 15px; margin-bottom: 10px; margin-top: 24px; color: #333; }
    pre { font-family: inherit; font-size: 13px; line-height: 1.5; }
    .meta { color: #666; font-size: 12px; padding: 8px 0; border-bottom: 1px solid #ddd; margin-bottom: 20px; }
    .separator { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
    .timestamp { color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <h1>LLM Log — ${escapeHtml(log.agentName || log.agentId)}</h1>
  <div class="meta">
    <div class="timestamp">${escapeHtml(log.timestamp)}</div>
    <div style="margin-top:4px">${meta}</div>
  </div>

  <h2 style="padding-bottom:4px;border-bottom:2px solid #16a34a;color:#16a34a">📥 Input Messages (${log.input?.messages?.length || 0})</h2>
  ${messagesHtml}

  ${toolsHtml}

  <hr class="separator">

  <h2 style="padding-bottom:4px;border-bottom:2px solid #2563eb;color:#2563eb">📤 Output</h2>
  ${outputHtml}

  ${responseToolCallsHtml}
  ${toolResultsHtml}
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    console.error('[LLM Log Viewer] Error:', error);
    return new Response(`<h1>Error: ${escapeHtml(error.message)}</h1>`, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}
