/**
 * LLM Debug Logs API — Get LLM call logs for a specific agent.
 * 
 * GET /api/agents/[agentId]/llm-logs?limit=50&offset=0  → Log list
 * GET /api/agents/[agentId]/llm-logs?logId=xxx           → Log detail
 * DELETE /api/agents/[agentId]/llm-logs                   → Clear all logs for this agent
 */
import { NextResponse } from 'next/server';
import { getAgentLogs, getLogDetail, clearAgentLogs } from '@/core/system/llm-debug-logger.js';

export async function GET(request, { params }) {
  try {
    const { agentId } = await params;
    const { searchParams } = new URL(request.url);
    const logId = searchParams.get('logId');

    // Get single log detail
    if (logId) {
      const detail = getLogDetail(agentId, logId);
      if (!detail) {
        return NextResponse.json({ error: 'Log not found' }, { status: 404 });
      }
      return NextResponse.json(detail);
    }

    // Get log list
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
