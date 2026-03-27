import { NextResponse } from 'next/server';
import { customSkillManager } from '@/core/employee/skill/custom.js';
import { getApiT } from '@/lib/api-i18n';

/**
 * GET /api/system/skills/custom - List all custom skills
 */
export async function GET() {
  try {
    return NextResponse.json({ data: customSkillManager.list() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/system/skills/custom - Create or update a custom skill
 * Body: { action: 'create'|'update'|'delete'|'getRaw', skillId?, markdown? }
 */
export async function POST(request) {
  const t = getApiT(request);
  try {
    const { action, skillId, markdown } = await request.json();

    switch (action) {
      case 'create': {
        if (!markdown) {
          return NextResponse.json({ error: t('api.missingParameter', { param: 'markdown' }) }, { status: 400 });
        }
        const result = customSkillManager.create(markdown);
        return NextResponse.json({ data: result });
      }
      case 'update': {
        if (!skillId || !markdown) {
          return NextResponse.json({ error: t('api.missingParameter', { param: 'skillId or markdown' }) }, { status: 400 });
        }
        const result = customSkillManager.update(skillId, markdown);
        return NextResponse.json({ data: result });
      }
      case 'delete': {
        if (!skillId) {
          return NextResponse.json({ error: t('api.missingSkillId') }, { status: 400 });
        }
        customSkillManager.delete(skillId);
        return NextResponse.json({ data: { success: true } });
      }
      case 'getRaw': {
        if (!skillId) {
          return NextResponse.json({ error: t('api.missingSkillId') }, { status: 400 });
        }
        const raw = customSkillManager.getRaw(skillId);
        return NextResponse.json({ data: { skillId, markdown: raw } });
      }
      default:
        return NextResponse.json({ error: t('api.pluginUnknownAction', { action }) }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
