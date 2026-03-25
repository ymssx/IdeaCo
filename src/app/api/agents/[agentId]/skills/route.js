import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store.js';
import { skillRegistry } from '@/core/employee/skill/registry.js';
import { getApiT } from '@/lib/api-i18n';

/**
 * GET /api/agents/[agentId]/skills - Get an employee's skill configuration
 */
export async function GET(request, { params }) {
  try {
    const { agentId } = await params;
    const company = getCompany();
    const employee = company.employees.find(e => e.id === agentId);
    if (!employee) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Return the employee's skill set + all available skills for UI selection
    const skillSet = employee.skillSet;
    const allSkills = skillRegistry.list();
    const enabledIds = [...skillSet.enabledSkills];
    const pinnedIds = [...skillSet.pinnedSkills];

    return NextResponse.json({
      data: {
        enabledSkills: enabledIds,
        pinnedSkills: pinnedIds,
        legacySkills: skillSet.legacySkills,
        allSkills,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/agents/[agentId]/skills - Manage an employee's skills
 * Body: { action: 'enable'|'disable'|'pin'|'unpin'|'setAll', skillId?, skillIds? }
 */
export async function POST(request, { params }) {
  const t = getApiT(request);
  try {
    const { agentId } = await params;
    const company = getCompany();
    const employee = company.employees.find(e => e.id === agentId);
    if (!employee) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const { action, skillId, skillIds } = await request.json();
    const skillSet = employee.skillSet;

    switch (action) {
      case 'enable':
        if (!skillId) return NextResponse.json({ error: t('api.missingSkillId') }, { status: 400 });
        skillSet.enable(skillId);
        break;
      case 'disable':
        if (!skillId) return NextResponse.json({ error: t('api.missingSkillId') }, { status: 400 });
        skillSet.disable(skillId);
        break;
      case 'pin':
        if (!skillId) return NextResponse.json({ error: t('api.missingSkillId') }, { status: 400 });
        skillSet.pin(skillId);
        break;
      case 'unpin':
        if (!skillId) return NextResponse.json({ error: t('api.missingSkillId') }, { status: 400 });
        skillSet.unpin(skillId);
        break;
      case 'setAll':
        if (!Array.isArray(skillIds)) return NextResponse.json({ error: t('api.missingParameter', { param: 'skillIds' }) }, { status: 400 });
        skillSet.setEnabledSkills(skillIds);
        break;
      default:
        return NextResponse.json({ error: t('api.pluginUnknownAction', { action }) }, { status: 400 });
    }

    // Sync legacy accessor
    employee.skills = skillSet.toArray();

    // Persist
    company.saveState?.();

    return NextResponse.json({
      data: {
        success: true,
        enabledSkills: [...skillSet.enabledSkills],
        pinnedSkills: [...skillSet.pinnedSkills],
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
