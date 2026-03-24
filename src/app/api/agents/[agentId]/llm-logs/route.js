/**
 * LLM Debug Logs API — 获取某个员工的LLM调用日志
 * 
 * GET /api/agents/[agentId]/llm-logs?limit=50&offset=0  → 日志列表
 * GET /api/agents/[agentId]/llm-logs?logId=xxx           → 日志详情
 * DELETE /api/agents/[agentId]/llm-logs                   → 清除该员工所有日志
 */
import { NextResponse } from 'next/server';
import { getAgentLogs, getLogDetail, clearAgentLogs } from '@/core/system/llm-debug-logger.js';

export async function GET(request, { params }) {
  try {
    const { agentId } = await params;
    const { searchParams } = new URL(request.url);
    const logId = searchParams.get('logId');

    // 获取单条日志详情
    if (logId) {
      const detail = getLogDetail(agentId, logId);
      if (!detail) {
        return NextResponse.json({ error: 'Log not found' }, { status: 404 });
      }
      return NextResponse.json(detail);
    }

    // 获取日志列表
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const result = getAgentLogs(agentId, { limit, offset });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[LLM Logs API] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { agentId } = await params;
    clearAgentLogs(agentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[LLM Logs API] Delete error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
