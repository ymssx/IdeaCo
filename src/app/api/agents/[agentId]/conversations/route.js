import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';

/**
 * GET /api/agents/[agentId]/conversations - Get all chat sessions between an agent and others
 * Query params:
 *   - sessionId: if provided, return chat history for that session
 *   - limit: message count limit (default 50)
 */
export async function GET(request, { params }) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }
  try {
    const { agentId } = await params;
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    if (sessionId) {
      // Return chat history for a specific session (with participant info)
      const result = company.getAgentAgentChatHistory(sessionId, limit);
      return NextResponse.json({ data: result });
    }

    // Return all chat sessions for this agent
    const conversations = company.getAgentConversations(agentId);
    return NextResponse.json({ data: conversations });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
