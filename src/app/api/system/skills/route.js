import { NextResponse } from 'next/server';
import { skillRegistry, SkillSource } from '@/core/employee/skill/registry.js';
import { getApiT } from '@/lib/api-i18n';

/**
 * GET /api/system/skills - Get all skills (optionally filtered by source or category)
 * Query params: ?source=builtin|custom|marketplace  &category=coding|analysis|...  &q=search
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const category = searchParams.get('category');
    const query = searchParams.get('q');

    let skills;
    if (query) {
      skills = skillRegistry.search(query).map(s => formatSkillEntry(s));
    } else if (source) {
      skills = skillRegistry.getBySource(source).map(s => formatSkillEntry(s));
    } else if (category) {
      skills = skillRegistry.getByCategory(category).map(s => formatSkillEntry(s));
    } else {
      skills = skillRegistry.list();
    }

    return NextResponse.json({ data: skills });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/system/skills - Manage skills
 * Actions: enable, disable, configure, loadBody
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
      case 'loadBody': {
        const body = skillRegistry.loadSkillBody(skillId);
        return NextResponse.json({ data: { skillId, body } });
      }
      default:
        return NextResponse.json({ error: t('api.pluginUnknownAction', { action }) }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function formatSkillEntry(s) {
  return {
    id: s.definition.id,
    name: s.definition.name,
    version: s.definition.version,
    category: s.definition.category,
    description: s.definition.description,
    icon: s.definition.icon,
    state: s.state,
    tags: s.definition.tags,
    author: s.definition.author,
    source: s.definition.source,
    sourceUrl: s.definition.sourceUrl,
    hasBody: !!(s.definition.body || s.definition.filePath),
    toolCount: s.definition.requiredTools.length,
    installedAt: s.installedAt,
    enabledAt: s.enabledAt,
  };
}
