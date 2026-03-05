import { NextResponse } from 'next/server';
import { skillRegistry } from '@/core/skills.js';
import { getApiT } from '@/lib/api-i18n';

/**
 * GET /api/system/skills - Get all skills
 */
export async function GET() {
  try {
    return NextResponse.json({ data: skillRegistry.list() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/system/skills - Manage skills
 * Actions: enable, disable, configure
 */
export async function POST(request) {
  const t = getApiT(request);
  try {
    const { action, skillId, config } = await request.json();
    if (!skillId) {
      return NextResponse.json({ error: t('api.missingSkillId') }, { status: 400 });
    }
    switch (action) {
      case 'enable':
        skillRegistry.enable(skillId);
        return NextResponse.json({ data: { success: true } });
      case 'disable':
        skillRegistry.disable(skillId);
        return NextResponse.json({ data: { success: true } });
      case 'install':
        skillRegistry.install(skillId, config || {});
        return NextResponse.json({ data: { success: true } });
      case 'configure':
        skillRegistry.configure(skillId, config || {});
        return NextResponse.json({ data: { success: true } });
      default:
        return NextResponse.json({ error: t('api.pluginUnknownAction', { action }) }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
