import { NextResponse } from 'next/server';
import { skillMarketplace } from '@/core/employee/skill/marketplace.js';
import { getApiT } from '@/lib/api-i18n';

/**
 * GET /api/system/skills/marketplace - Search marketplace or get featured skills
 * Query params: ?q=search  &page=1  &limit=20  &category=coding  &featured=true
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const category = searchParams.get('category');
    const featured = searchParams.get('featured');

    if (featured === 'true') {
      const skills = await skillMarketplace.featured();
      return NextResponse.json({ data: skills });
    }

    const result = await skillMarketplace.search(query, { page, limit, category });
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/system/skills/marketplace - Install, uninstall, or update marketplace skills
 * Body: { action: 'install'|'uninstall'|'update'|'listInstalled', slug?, skillId? }
 */
export async function POST(request) {
  const t = getApiT(request);
  try {
    const { action, slug, skillId, version } = await request.json();

    switch (action) {
      case 'install': {
        if (!slug) {
          return NextResponse.json({ error: t('api.missingParameter', { param: 'slug' }) }, { status: 400 });
        }
        const result = await skillMarketplace.install(slug, version || 'latest');
        return NextResponse.json({ data: result });
      }
      case 'uninstall': {
        if (!skillId) {
          return NextResponse.json({ error: t('api.missingSkillId') }, { status: 400 });
        }
        skillMarketplace.uninstall(skillId);
        return NextResponse.json({ data: { success: true } });
      }
      case 'update': {
        if (!skillId) {
          return NextResponse.json({ error: t('api.missingSkillId') }, { status: 400 });
        }
        const result = await skillMarketplace.update(skillId);
        return NextResponse.json({ data: result });
      }
      case 'listInstalled': {
        const installed = skillMarketplace.listInstalled();
        return NextResponse.json({ data: installed });
      }
      default:
        return NextResponse.json({ error: t('api.pluginUnknownAction', { action }) }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
