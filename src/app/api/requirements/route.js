import { NextResponse } from 'next/server';
import { getCompany, setCompany } from '@/lib/store';

/**
 * 需求管理 API
 * GET  /api/requirements - 获取需求列表
 * GET  /api/requirements?id=xxx - 获取单个需求详情
 * GET  /api/requirements?departmentId=xxx - 获取部门的需求列表
 */
export async function GET(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: '请先创建公司' }, { status: 400 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const departmentId = url.searchParams.get('departmentId');

  if (id) {
    const req = company.requirementManager.get(id);
    if (!req) {
      return NextResponse.json({ error: '需求不存在' }, { status: 404 });
    }
    return NextResponse.json({ data: req.serialize() });
  }

  if (departmentId) {
    const reqs = company.requirementManager.listByDepartment(departmentId);
    return NextResponse.json({ data: reqs.map(r => r.serialize()) });
  }

  // 返回所有需求（概览信息，不含完整群聊）
  const all = company.requirementManager.listAll().map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    status: r.status,
    workflow: r.workflow ? {
      summary: r.workflow.summary,
      nodeCount: r.workflow.nodes?.length || 0,
      completedCount: r.workflow.nodes?.filter(n => n.status === 'completed').length || 0,
    } : null,
    outputCount: r.outputs?.length || 0,
    chatCount: r.groupChat?.length || 0,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    summary: r.summary ? {
      totalTasks: r.summary.totalTasks,
      successTasks: r.summary.successTasks,
      totalDuration: r.summary.totalDuration,
    } : null,
  }));

  return NextResponse.json({ data: all });
}

/**
 * DELETE /api/requirements?id=xxx - 删除需求
 */
export async function DELETE(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: '请先创建公司' }, { status: 400 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: '缺少需求ID' }, { status: 400 });
  }

  const req = company.requirementManager.get(id);
  if (!req) {
    return NextResponse.json({ error: '需求不存在' }, { status: 404 });
  }

  // 从需求管理器中删除
  company.requirementManager.requirements.delete(id);
  company.save();

  return NextResponse.json({ data: { success: true, id } });
}

/**
 * POST /api/requirements - 需求操作
 * body: { action: 'restart', id: 'xxx' }
 */
export async function POST(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: '请先创建公司' }, { status: 400 });
  }

  const body = await request.json();
  const { action, id } = body;

  if (action === 'restart') {
    if (!id) {
      return NextResponse.json({ error: '缺少需求ID' }, { status: 400 });
    }

    const req = company.requirementManager.get(id);
    if (!req) {
      return NextResponse.json({ error: '需求不存在' }, { status: 404 });
    }

    // 保留原始信息，重置执行状态
    const { title, description, departmentId, departmentName, bossMessage } = req;

    // 删除旧需求
    company.requirementManager.requirements.delete(id);

    // 重新分配任务给部门（异步执行，不等待完成）
    const dept = company.findDepartment(departmentId);
    if (!dept) {
      return NextResponse.json({ error: '部门不存在，无法重启' }, { status: 400 });
    }

    // 异步执行任务，立即返回
    company.assignTaskToDepartment(departmentId, description, title).catch(e => {
      console.error('重启需求执行失败:', e.message);
    });

    // 等一下让需求创建完成
    await new Promise(resolve => setTimeout(resolve, 500));

    // 找到新创建的需求
    const allReqs = company.requirementManager.listAll();
    const newReq = allReqs.find(r => r.title === title && r.id !== id);

    return NextResponse.json({ 
      data: { 
        success: true, 
        oldId: id, 
        newId: newReq?.id || null,
        message: '需求已重新开始执行' 
      } 
    });
  }

  return NextResponse.json({ error: '未知操作' }, { status: 400 });
}
