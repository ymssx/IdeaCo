import { NextResponse } from 'next/server';
import { knowledgeManager, KnowledgeType, EntryType } from '@/core/knowledge.js';

/**
 * GET /api/system/knowledge - 获取知识库列表或搜索
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const kbId = searchParams.get('kbId');

    // 搜索
    if (query) {
      const results = knowledgeManager.search(query, { limit: 20 });
      return NextResponse.json({ data: results });
    }

    // 获取单个知识库的条目列表
    if (kbId) {
      const kb = knowledgeManager.get(kbId);
      if (!kb) return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 });
      return NextResponse.json({
        data: {
          id: kb.id,
          name: kb.name,
          description: kb.description,
          type: kb.type,
          enabled: kb.enabled,
          entries: kb.listEntries(),
          stats: kb.getStats(),
        },
      });
    }

    // 列出所有知识库
    return NextResponse.json({
      data: {
        bases: knowledgeManager.list(),
        stats: knowledgeManager.getOverallStats(),
        types: KnowledgeType,
        entryTypes: EntryType,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/system/knowledge - 知识库管理操作
 * Actions: create, addEntry, removeEntry, delete, toggle
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'create': {
        const kb = knowledgeManager.create({
          name: body.name,
          description: body.description,
          type: body.type || KnowledgeType.GLOBAL,
          ownerId: body.ownerId || null,
        });
        return NextResponse.json({ data: { id: kb.id, success: true } });
      }
      case 'addEntry': {
        const entry = knowledgeManager.addEntry(body.kbId, {
          title: body.title,
          content: body.content,
          type: body.entryType || EntryType.NOTE,
          tags: body.tags || [],
          importance: body.importance || 0.5,
          source: body.source || null,
          createdBy: body.createdBy || null,
        });
        return NextResponse.json({ data: { id: entry.id, success: true } });
      }
      case 'removeEntry': {
        const result = knowledgeManager.removeEntry(body.kbId, body.entryId);
        return NextResponse.json({ data: { success: result } });
      }
      case 'delete': {
        const result = knowledgeManager.delete(body.kbId);
        return NextResponse.json({ data: { success: result } });
      }
      case 'toggle': {
        const kb = knowledgeManager.get(body.kbId);
        if (!kb) return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 });
        kb.enabled = !kb.enabled;
        return NextResponse.json({ data: { success: true, enabled: kb.enabled } });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
