import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

/**
 * POST /api/departments - Department operations
 * action=undefined: Generate recruitment plan
 * action=confirm: Confirm recruitment plan
 * action=adjust: Generate adjustment plan
 * action=confirmAdjust: Confirm adjustment plan
 * action=disband: Disband department
 */
export async function POST(request) {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: 'Company not created yet, please register first' }, { status: 400 });

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'confirm') {
      // Confirm recruitment plan
      const { planId } = await request.json();
      if (!planId) {
        return NextResponse.json({ error: 'Plan ID is required' }, { status: 400 });
      }
      const dept = await company.confirmPlan(planId);
      return NextResponse.json({ success: true, data: company.getFullState() });

    } else if (action === 'adjust') {
      // Generate adjustment plan
      const { departmentId, adjustGoal } = await request.json();
      if (!departmentId || !adjustGoal) {
        return NextResponse.json({ error: 'Department ID and adjustment goal are required' }, { status: 400 });
      }
      const plan = await company.planAdjustment(departmentId, adjustGoal);
      return NextResponse.json({ success: true, data: plan });

    } else if (action === 'confirmAdjust') {
      // Confirm adjustment plan
      const { planId } = await request.json();
      if (!planId) {
        return NextResponse.json({ error: 'Adjustment plan ID is required' }, { status: 400 });
      }
      await company.confirmAdjustment(planId);
      return NextResponse.json({ success: true, data: company.getFullState() });

    } else if (action === 'disband') {
      // Disband department
      const { departmentId, reason } = await request.json();
      if (!departmentId) {
        return NextResponse.json({ error: 'Department ID is required' }, { status: 400 });
      }
      const result = company.disbandDepartment(departmentId, reason || 'Boss decision');
      return NextResponse.json({ success: true, data: company.getFullState(), result });

    } else {
      // Generate recruitment plan
      const { name, mission } = await request.json();
      if (!name || !mission) {
        return NextResponse.json({ error: 'Department name and mission are required' }, { status: 400 });
      }
      const plan = await company.planDepartment(name, mission);
      return NextResponse.json({ success: true, data: plan });
    }
  } catch (e) {
    console.error('Department operation failed:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
