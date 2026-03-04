import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

/**
 * POST /api/agents/[agentId]/chat - Chat with an agent
 */
export async function POST(request, { params }) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }
  try {
    const { agentId } = await params;
    const { message } = await request.json();
    if (!message) {
      return NextResponse.json({ error: 'Please enter a message' }, { status: 400 });
    }
    const result = await company.chatWithAgent(agentId, message);
    const history = company.getAgentChatHistory(agentId, 30);
    return NextResponse.json({
      success: true,
      data: {
        reply: result,
        chatHistory: history,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * GET /api/agents/[agentId]/chat - Get chat history with agent
 */
export async function GET(request, { params }) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }
  try {
    const { agentId } = await params;
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '30');
    const history = company.getAgentChatHistory(agentId, limit);
    return NextResponse.json({ data: history });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
