import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT, getLanguageFromRequest } from '@/lib/api-i18n';
import { setAppLanguage } from '@/core/utils/app-language.js';

/**
 * POST /api/departments - Department operations
 * action=undefined: Generate recruitment plan
 * action=confirm: Confirm recruitment plan
 * action=adjust: Generate adjustment plan
 * action=confirmAdjust: Confirm adjustment plan
 * action=disband: Disband department
 */
export async function POST(request) {
  const t = getApiT(request);
  setAppLanguage(getLanguageFromRequest(request));
  const company = getCompany();
  if (!company) return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'confirm') {
      // Confirm recruitment plan
      const { planId } = await request.json();
      if (!planId) {
        return NextResponse.json({ error: t('api.planIdRequired') }, { status: 400 });
      }
      const dept = await company.confirmPlan(planId);
      return NextResponse.json({ success: true, data: company.getFullState() });

    } else if (action === 'adjust') {
      // Generate adjustment plan
      const { departmentId, adjustGoal } = await request.json();
      if (!departmentId || !adjustGoal) {
        return NextResponse.json({ error: t('api.deptIdAdjustGoalRequired') }, { status: 400 });
      }
      const plan = await company.planAdjustment(departmentId, adjustGoal);
      return NextResponse.json({ success: true, data: plan });

    } else if (action === 'confirmAdjust') {
      // Confirm adjustment plan
      const { planId } = await request.json();
      if (!planId) {
        return NextResponse.json({ error: t('api.adjustPlanIdRequired') }, { status: 400 });
      }
      await company.confirmAdjustment(planId);
      return NextResponse.json({ success: true, data: company.getFullState() });

    } else if (action === 'disband') {
      // Disband department
      const { departmentId, reason } = await request.json();
      if (!departmentId) {
        return NextResponse.json({ error: t('api.deptIdRequired') }, { status: 400 });
      }
      const result = company.disbandDepartment(departmentId, reason || 'Boss decision');
      return NextResponse.json({ success: true, data: company.getFullState(), result });

    } else if (action === 'boss_message') {
      // Boss sends message to department group chat
      const { departmentId, message } = await request.json();
      if (!departmentId || !message) {
        return NextResponse.json({ error: t('api.deptIdMessageRequired') }, { status: 400 });
      }
      const result = company.sendBossDeptGroupMessage(departmentId, message);
      return NextResponse.json({ success: true, data: result });

    } else if (action === 'dept_chat') {
      // Get department group chat messages
      const { departmentId } = await request.json();
      if (!departmentId) {
        return NextResponse.json({ error: t('api.deptIdRequired') }, { status: 400 });
      }
      const dept = company.findDepartment(departmentId);
      if (!dept) {
        return NextResponse.json({ error: t('api.deptNotFound') }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: { groupChat: dept.groupChat || [] } });

    } else {
      // Generate recruitment plan
      const { name, mission } = await request.json();
      if (!name || !mission) {
        return NextResponse.json({ error: t('api.deptNameMissionRequired') }, { status: 400 });
      }
      const plan = await company.planDepartment(name, mission);
      return NextResponse.json({ success: true, data: plan });
    }
  } catch (e) {
    console.error('Department operation failed:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
