import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT, getLanguageFromRequest } from '@/lib/api-i18n';
import { setAppLanguage } from '@/core/utils/app-language.js';

/**
 * Requirements Management API
 * GET  /api/requirements - Get requirements list
 * GET  /api/requirements?id=xxx - Get single requirement detail
 * GET  /api/requirements?departmentId=xxx - Get department's requirements list
 */
export async function GET(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const departmentId = url.searchParams.get('departmentId');

  if (id) {
    const req = company.requirementManager.get(id);
    if (!req) {
      return NextResponse.json({ error: t('api.requirementNotFound') }, { status: 404 });
    }
    const data = req.serialize();
    // groupChat is stored separately in chatStore files, attach from memory
    data.groupChat = req.groupChat || [];

    // Attach department member list (group member list)
    const dept = company.findDepartment(req.departmentId);
    if (dept) {
      data.members = dept.getMembers().map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        avatar: a.avatar,
        status: a.status,
      }));
    }

    // Calculate current blocking: find all running/reviewing/revision nodes and their assignees
    if (data.workflow?.nodes) {
      data.blockingInfo = data.workflow.nodes
        .filter(n => ['running', 'reviewing', 'revision'].includes(n.status))
        .map(n => ({
          nodeId: n.id,
          nodeTitle: n.title,
          status: n.status,
          assigneeId: n.assigneeId,
          assigneeName: n.assigneeName,
          reviewerId: n.reviewerId,
          reviewerName: n.reviewerName,
        }));
    }

    return NextResponse.json({ data });
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
  const t = getApiT(request);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: t('api.requirementIdRequired') }, { status: 400 });
  }

  const req = company.requirementManager.get(id);
  if (!req) {
    return NextResponse.json({ error: t('api.requirementNotFound') }, { status: 404 });
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
  const t = getApiT(request);
  setAppLanguage(getLanguageFromRequest(request));
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  const body = await request.json();
  const { action, id } = body;

  // Create a new requirement for a department (with optional custom workspace dir)
  if (action === 'create') {
    const { departmentId, title, description, workspaceDir } = body;
    if (!departmentId || !title) {
      return NextResponse.json({ error: t('api.requirementDeptTitleRequired') }, { status: 400 });
    }

    const dept = company.findDepartment(departmentId);
    if (!dept) {
      return NextResponse.json({ error: t('api.deptNotFound') }, { status: 404 });
    }

    // If custom workspaceDir provided, temporarily override department workspace for this requirement only
    // assignTaskToDepartment will create a per-requirement subdirectory under it, and restore afterward
    const originalDeptWorkspace = dept.workspacePath;
    if (workspaceDir) {
      const path = await import('path');
      const { existsSync, mkdirSync } = await import('fs');
      const resolved = path.default.resolve(workspaceDir);
      if (!existsSync(resolved)) {
        mkdirSync(resolved, { recursive: true });
      }
      dept.workspacePath = resolved;
    }

    // Async task execution, return immediately
    const taskTitle = title;
    const taskDescription = description || title;
    company.assignTaskToDepartment(departmentId, taskDescription, taskTitle)
      .catch(e => {
        console.error('Create requirement execution failed:', e.message);
      })
      .finally(() => {
        // Ensure department workspace is restored even if assignTaskToDepartment didn't restore it
        if (workspaceDir && originalDeptWorkspace) {
          dept.workspacePath = originalDeptWorkspace;
        }
      });

    // Brief wait for requirement creation
    await new Promise(resolve => setTimeout(resolve, 500));

    // Find newly created requirement
    const allReqs = company.requirementManager.listAll();
    const newReq = allReqs.find(r => r.title === taskTitle && r.departmentId === departmentId);

    return NextResponse.json({
      data: {
        success: true,
        id: newReq?.id || null,
        title: taskTitle,
        departmentId,
        workspaceDir: workspaceDir || null,
      }
    });
  }

  // Boss sends a message in group chat
  if (action === 'boss_message') {
    const { id: reqId, message: bossMsg } = body;
    if (!reqId || !bossMsg) {
      return NextResponse.json({ error: t('api.requirementIdMessageRequired') }, { status: 400 });
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
      return NextResponse.json({ error: t('api.requirementIdRequired') }, { status: 400 });
    }

    const req = company.requirementManager.get(id);
    if (!req) {
      return NextResponse.json({ error: t('api.requirementNotFound') }, { status: 404 });
    }

    // Preserve original info, reset execution state
    const { title, description, departmentId, departmentName, bossMessage } = req;

    // Delete old requirement
    company.requirementManager.requirements.delete(id);

    // Re-assign task to department (async execution, don't wait for completion)
    const dept = company.findDepartment(departmentId);
    if (!dept) {
      return NextResponse.json({ error: t('api.deptNotFoundRestart') }, { status: 400 });
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
        message: t('api.requirementRestarted'),
      } 
    });
  }

  return NextResponse.json({ error: t('api.unknownOperation') }, { status: 400 });
}
