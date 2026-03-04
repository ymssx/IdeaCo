import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

/**
 * GET /api/agents/[agentId]/conversations - 获取某agent与其他人的所有聊天会话
 * Query params:
 *   - sessionId: 如果提供, 返回该会话的聊天记录
 *   - limit: 消息数限制 (默认 50)
 */
export async function GET(request, { params }) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }
  try {
    const { agentId } = await params;
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    if (sessionId) {
      // 返回特定会话的聊天记录（含 participants 信息）
      const result = company.getAgentAgentChatHistory(sessionId, limit);
      return NextResponse.json({ data: result });
    }

    // 返回该agent的所有聊天会话列表
    const conversations = company.getAgentConversations(agentId);
    return NextResponse.json({ data: conversations });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
