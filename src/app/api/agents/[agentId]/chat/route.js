import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT, getLanguageFromRequest } from '@/lib/api-i18n';
import { setAppLanguage } from '@/core/utils/app-language.js';
import { chatStore } from '@/core/agent/chat-store.js';

/**
 * POST /api/agents/[agentId]/chat - Chat with an agent
 */
export async function POST(request, { params }) {
  const t = getApiT(request);
  setAppLanguage(getLanguageFromRequest(request));
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }
  try {
    const { agentId } = await params;
    const { message } = await request.json();
    if (!message) {
      return NextResponse.json({ error: t('api.messageRequired') }, { status: 400 });
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
 *
 * Query params (all optional):
 *   - before: ISO timestamp cursor — return messages older than this
 *   - after:  ISO timestamp — return only messages newer than this (for polling)
 *   - limit:  max messages per page (default 30, max 100)
 *
 * Without params: returns the latest `limit` messages (backward compat).
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
    const before = url.searchParams.get('before');
    const after = url.searchParams.get('after');
    const limitParam = url.searchParams.get('limit');
    const limit = Math.min(100, Math.max(1, parseInt(limitParam || '30')));
    const sessionId = `boss-agent-${agentId}`;

    // Polling mode: return only messages newer than `after` timestamp
    if (after) {
      const afterDate = new Date(after).getTime();
      const recent = chatStore.getRecentMessages(sessionId, 50);
      const newer = recent.filter(m => m.time && new Date(m.time).getTime() > afterDate);
      return NextResponse.json({
        data: newer,
        total: chatStore.getMessageCount(sessionId),
      });
    }

    // Paginated mode: cursor-based reads from file store
    if (before || limitParam) {
      const page = chatStore.getMessagesPage(sessionId, { before: before || null, limit });
      return NextResponse.json({
        data: page.messages,
        hasMore: page.hasMore,
        total: page.total,
      });
    }

    // Default: return latest messages (backward compat)
    const history = chatStore.getRecentMessages(sessionId, limit);
    return NextResponse.json({ data: history });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[agentId]/chat - Mark agent chat as read
 */
export async function PUT(request, { params }) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }
  try {
    const { agentId } = await params;
    company.markAgentChatRead(agentId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
