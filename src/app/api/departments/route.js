import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

/**
 * POST /api/departments - 部门操作
 * action=undefined: 生成招聘方案
 * action=confirm: 确认招聘方案
 * action=adjust: 生成调整方案
 * action=confirmAdjust: 确认调整方案
 * action=disband: 解散部门
 */
export async function POST(request) {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: '公司还没开张呢，先去注册吧韭菜' }, { status: 400 });

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'confirm') {
      // 确认招聘方案
      const { planId } = await request.json();
      if (!planId) {
        return NextResponse.json({ error: '方案ID呢？HR已经气得摔文件了' }, { status: 400 });
      }
      const dept = await company.confirmPlan(planId);
      return NextResponse.json({ success: true, data: company.getFullState() });

    } else if (action === 'adjust') {
      // 生成调整方案
      const { departmentId, adjustGoal } = await request.json();
      if (!departmentId || !adjustGoal) {
        return NextResponse.json({ error: '部门ID和调整目标不能为空' }, { status: 400 });
      }
      const plan = await company.planAdjustment(departmentId, adjustGoal);
      return NextResponse.json({ success: true, data: plan });

    } else if (action === 'confirmAdjust') {
      // 确认调整方案
      const { planId } = await request.json();
      if (!planId) {
        return NextResponse.json({ error: '调整方案ID不能为空' }, { status: 400 });
      }
      await company.confirmAdjustment(planId);
      return NextResponse.json({ success: true, data: company.getFullState() });

    } else if (action === 'disband') {
      // 解散部门
      const { departmentId, reason } = await request.json();
      if (!departmentId) {
        return NextResponse.json({ error: '部门ID不能为空' }, { status: 400 });
      }
      const result = company.disbandDepartment(departmentId, reason || '老板决定');
      return NextResponse.json({ success: true, data: company.getFullState(), result });

    } else {
      // 生成招聘方案
      const { name, mission } = await request.json();
      if (!name || !mission) {
        return NextResponse.json({ error: '部门名和使命不能空着，资本家也得有目标' }, { status: 400 });
      }
      const plan = await company.planDepartment(name, mission);
      return NextResponse.json({ success: true, data: plan });
    }
  } catch (e) {
    console.error('部门操作失败:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
