import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

/**
 * Requirements Management API
 * GET  /api/requirements - Get requirements list
 * GET  /api/requirements?id=xxx - Get single requirement detail
 * GET  /api/requirements?departmentId=xxx - Get department's requirements list
 */
export async function GET(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const departmentId = url.searchParams.get('departmentId');

  if (id) {
    const req = company.requirementManager.get(id);
    if (!req) {
      return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
    }
    return NextResponse.json({ data: req.serialize() });
  }

  if (departmentId) {
    const reqs = company.requirementManager.listByDepartment(departmentId);
    return NextResponse.json({ data: reqs.map(r => r.serialize()) });
  }

  // Return all requirements (overview info, without full group chat)
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
 * DELETE /api/requirements?id=xxx - Delete requirement
 */
export async function DELETE(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Requirement ID is required' }, { status: 400 });
  }

  const req = company.requirementManager.get(id);
  if (!req) {
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
  }

  // Delete from requirement manager
  company.requirementManager.requirements.delete(id);
  company.save();

  return NextResponse.json({ data: { success: true, id } });
}

/**
 * POST /api/requirements - Requirement operations
 * body: { action: 'restart', id: 'xxx' }
 */
export async function POST(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }

  const body = await request.json();
  const { action, id } = body;

  // Boss sends a message in group chat
  if (action === 'boss_message') {
    const { id: reqId, message: bossMsg } = body;
    if (!reqId || !bossMsg) {
      return NextResponse.json({ error: 'Requirement ID and message are required' }, { status: 400 });
    }
    try {
      const result = await company.sendBossGroupMessage(reqId, bossMsg);
      return NextResponse.json({ data: result });
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  if (action === 'restart') {
    if (!id) {
      return NextResponse.json({ error: 'Requirement ID is required' }, { status: 400 });
    }

    const req = company.requirementManager.get(id);
    if (!req) {
      return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
    }

    // Preserve original info, reset execution state
    const { title, description, departmentId, departmentName, bossMessage } = req;

    // Delete old requirement
    company.requirementManager.requirements.delete(id);

    // Re-assign task to department (async execution, don't wait for completion)
    const dept = company.findDepartment(departmentId);
    if (!dept) {
      return NextResponse.json({ error: 'Department not found, cannot restart' }, { status: 400 });
    }

    // Async task execution, return immediately
    company.assignTaskToDepartment(departmentId, description, title).catch(e => {
      console.error('Restart requirement execution failed:', e.message);
    });

    // Brief wait for requirement creation to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Find newly created requirement
    const allReqs = company.requirementManager.listAll();
    const newReq = allReqs.find(r => r.title === title && r.id !== id);

    return NextResponse.json({ 
      data: { 
        success: true, 
        oldId: id, 
        newId: newReq?.id || null,
        message: 'Requirement has been restarted' 
      } 
    });
  }

  return NextResponse.json({ error: 'Unknown operation' }, { status: 400 });
}
