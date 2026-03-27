import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { chatStore } from '@/core/agent/chat-store.js';

/**
 * GET /api/chat/history — Secretary chat history endpoint.
 *
 * Query params (all optional):
 *   - before: ISO timestamp cursor — return messages older than this
 *   - limit:  max messages per page (default 30, max 100)
 *   - after:  ISO timestamp — return only messages newer than this (for polling)
 *
 * Without params: returns the full in-memory chatHistory (backward compat).
 * With params: returns paginated results from file-based chat store.
 */
export async function GET(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ data: [] });
  }

  const url = new URL(request.url);
  const before = url.searchParams.get('before');
  const after = url.searchParams.get('after');
  const limitParam = url.searchParams.get('limit');

  // Polling mode: return only messages newer than `after` timestamp
  if (after) {
    const afterDate = new Date(after).getTime();
    const allMsgs = company.chatHistory || [];
    const newer = allMsgs.filter(m => m.time && new Date(m.time).getTime() > afterDate);
    return NextResponse.json({
      data: newer,
      total: allMsgs.length,
    });
  }

  // Paginated mode: cursor-based reads from file store
  if (before || limitParam) {
    const limit = Math.min(100, Math.max(1, parseInt(limitParam || '30')));
    const page = chatStore.getMessagesPage(company.chatSessionId, { before: before || null, limit });
    return NextResponse.json({
      data: page.messages,
      hasMore: page.hasMore,
      total: page.total,
    });
  }

  // Default: return in-memory chatHistory (backward compat for conversation list preview)
  return NextResponse.json({ data: company.chatHistory || [] });
}
