import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

/**
 * Teams Management API
 * GET  /api/teams - List all teams
 * GET  /api/teams?id=xxx - Get team detail
 * GET  /api/teams?departmentId=xxx - List teams by department
 * GET  /api/teams?teamId=xxx&sprintId=yyy - Get sprint detail
 * POST /api/teams - Team/Sprint operations
 * DELETE /api/teams?id=xxx - Delete team
 */
export async function GET(request) {
  try {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }

  if (!company.teamManager) {
    const { TeamManager: TM } = await import('@/core/team.js');
    company.teamManager = new TM();
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const departmentId = url.searchParams.get('departmentId');
  const teamId = url.searchParams.get('teamId');
  const sprintId = url.searchParams.get('sprintId');

  // Get sprint detail
  if (teamId && sprintId) {
    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    const sprint = team.getSprint(sprintId);
    if (!sprint) return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });

    const data = sprint.serialize();

    // Attach member list
    const dept = company.findDepartment(team.departmentId);
    if (dept) {
      data.members = team.memberIds.map(mid => {
        const a = dept.agents.get(mid);
        return a ? { id: a.id, name: a.name, role: a.role, avatar: a.avatar, status: a.status } : null;
      }).filter(Boolean);
    }

    return NextResponse.json({ data });
  }

  // Get team detail
  if (id) {
    const team = company.teamManager.get(id);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const data = team.serialize();

    // Enrich member info
    const dept = company.findDepartment(team.departmentId);
    if (dept) {
      data.membersDetail = team.memberIds.map(mid => {
        const a = dept.agents.get(mid);
        if (!a) return null;
        return {
          id: a.id, name: a.name, role: a.role, avatar: a.avatar, status: a.status,
          skills: a.skills, signature: a.signature, gender: a.gender, age: a.age,
          provider: { id: a.provider.id, name: a.provider.name },
        };
      }).filter(Boolean);
    }

    // Enrich sprint overview (without full groupChat)
    data.sprints = team.listSprints().map(s => ({
      id: s.id,
      title: s.title,
      goal: s.goal,
      status: s.status,
      createdAt: s.createdAt,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      chatCount: s.groupChat?.length || 0,
      outputCount: s.outputs?.length || 0,
      workflow: s.workflow ? {
        summary: s.workflow.summary,
        nodeCount: s.workflow.nodes?.length || 0,
        completedCount: s.workflow.nodes?.filter(n => n.status === 'completed').length || 0,
      } : null,
    }));

    return NextResponse.json({ data });
  }

  // List by department
  if (departmentId) {
    const teams = company.teamManager.listByDepartment(departmentId);
    return NextResponse.json({ data: teams.map(t => t.serialize()) });
  }

  // List all
  return NextResponse.json({
    data: company.teamManager.listAll().map(t => ({
      id: t.id, name: t.name, departmentId: t.departmentId, departmentName: t.departmentName,
      memberIds: t.memberIds, leaderId: t.leaderId, leaderName: t.leaderName,
      description: t.description, status: t.status, createdAt: t.createdAt,
      sprintCount: t.sprints.size,
      skills: t.skills,
    })),
  });
  } catch (e) {
    console.error('[Teams API] GET error:', e);
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/teams?id=xxx - Delete team
 */
export async function DELETE(request) {
  try {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }

  if (!company.teamManager) {
    const { TeamManager: TM } = await import('@/core/team.js');
    company.teamManager = new TM();
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Team ID is required' }, { status: 400 });

  if (!company.teamManager.get(id)) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  company.teamManager.delete(id);
  company.save();

  return NextResponse.json({ data: { success: true, id } });
  } catch (e) {
    console.error('[Teams API] DELETE error:', e);
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/teams - Team/Sprint operations
 */
export async function POST(request) {
  try {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }

  if (!company.teamManager) {
    const { TeamManager: TM } = await import('@/core/team.js');
    company.teamManager = new TM();
  }

  const body = await request.json();
  const { action } = body;

  // === Create Team ===
  if (action === 'create') {
    const { departmentId, name, memberIds, leaderId, description } = body;
    if (!departmentId || !name || !memberIds?.length || !leaderId) {
      return NextResponse.json({ error: 'departmentId, name, memberIds, and leaderId are required' }, { status: 400 });
    }

    const dept = company.findDepartment(departmentId);
    if (!dept) return NextResponse.json({ error: 'Department not found' }, { status: 404 });

    const leader = dept.agents.get(leaderId);
    if (!leader) return NextResponse.json({ error: 'Leader not found in department' }, { status: 400 });

    // Verify all members exist in department
    for (const mid of memberIds) {
      if (!dept.agents.get(mid)) {
        return NextResponse.json({ error: `Member ${mid} not found in department` }, { status: 400 });
      }
    }

    // Ensure leader is in members list
    const allMemberIds = [...new Set([leaderId, ...memberIds])];

    const team = company.teamManager.create({
      name,
      departmentId: dept.id,
      departmentName: dept.name,
      memberIds: allMemberIds,
      leaderId,
      leaderName: leader.name,
      description: description || '',
    });

    company.save();
    return NextResponse.json({ data: team.serialize() });
  }

  // === Update Team ===
  if (action === 'update') {
    const { teamId, skills, workspacePath, name, description, memberIds, leaderId } = body;
    if (!teamId) return NextResponse.json({ error: 'teamId is required' }, { status: 400 });

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    if (skills !== undefined) team.skills = skills;
    if (workspacePath !== undefined) {
      if (workspacePath) {
        const path = await import('path');
        const { existsSync, mkdirSync } = await import('fs');
        const resolved = path.default.resolve(workspacePath);
        if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true });
        team.workspacePath = resolved;
      } else {
        team.workspacePath = null;
      }
    }
    if (name !== undefined) team.name = name;
    if (description !== undefined) team.description = description;
    if (memberIds !== undefined) team.memberIds = memberIds;
    if (leaderId !== undefined) {
      team.leaderId = leaderId;
      const dept = company.findDepartment(team.departmentId);
      const leader = dept?.agents.get(leaderId);
      if (leader) team.leaderName = leader.name;
    }

    company.save();
    return NextResponse.json({ data: team.serialize() });
  }

  // === Create Sprint ===
  if (action === 'create_sprint') {
    const { teamId, title, goal } = body;
    if (!teamId || !title || !goal) {
      return NextResponse.json({ error: 'teamId, title, and goal are required' }, { status: 400 });
    }

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const { Sprint } = await import('@/core/team.js');
    const sprint = new Sprint({ title, goal, teamId: team.id, teamName: team.name });
    team.addSprint(sprint);

    // Add system message
    sprint.addGroupMessage(
      { name: 'System', role: 'system' },
      `📋 迭代「${title}」已创建，目标：${goal}`,
      'system'
    );

    company.save();
    return NextResponse.json({ data: sprint.serialize() });
  }

  // === Start Sprint Discussion (负责人拉群讨论) ===
  if (action === 'discuss_sprint') {
    const { teamId, sprintId } = body;
    if (!teamId || !sprintId) {
      return NextResponse.json({ error: 'teamId and sprintId are required' }, { status: 400 });
    }

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const sprint = team.getSprint(sprintId);
    if (!sprint) return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });

    const { SprintStatus: SS } = await import('@/core/team.js');
    if (sprint.status !== SS.DRAFT) {
      return NextResponse.json({ error: 'Sprint is not in draft status' }, { status: 400 });
    }

    sprint.status = SS.DISCUSSING;

    // Leader starts discussion
    const dept = company.findDepartment(team.departmentId);
    const leader = dept?.agents.get(team.leaderId);

    if (leader) {
      sprint.addGroupMessage(
        leader,
        `📢 各位，我们来讨论迭代「${sprint.title}」的方案。\n\n🎯 迭代目标：${sprint.goal}\n\n请各位结合自己的专长给出建议，我会汇总形成最终方案。`,
        'message'
      );

      // Use LLM to generate leader's discussion plan
      try {
        const { llmClient } = await import('@/core/llm-client.js');
        const memberInfo = team.memberIds.map(mid => {
          const a = dept.agents.get(mid);
          return a ? `- ${a.name} (${a.role}): skills=[${a.skills.join(', ')}]` : null;
        }).filter(Boolean).join('\n');

        const response = await llmClient.chat(leader.provider, [
          {
            role: 'system',
            content: `You are "${leader.name}", a project leader. Your team wants to start a sprint.
Team members:\n${memberInfo}

Analyze the sprint goal and propose a concrete plan. Include:
1. How to approach the goal
2. What each team member should focus on
3. Expected deliverables
4. Potential risks

Be concise and actionable. Speak in the language matching the sprint goal.`,
          },
          { role: 'user', content: `Sprint goal: ${sprint.goal}\n\nPropose a plan for the team to discuss.` },
        ], { temperature: 0.7, maxTokens: 1024 });

        leader._trackUsage(response.usage);
        sprint.plan = response.content;

        sprint.addGroupMessage(
          leader,
          `📋 这是我的初步方案：\n\n${response.content}\n\n大家觉得如何？有什么补充或者意见？`,
          'message'
        );

        // Each member responds (brief)
        for (const mid of team.memberIds) {
          if (mid === team.leaderId) continue;
          const agent = dept.agents.get(mid);
          if (!agent || !agent.provider?.enabled || !agent.provider?.apiKey) continue;

          try {
            const p = agent.personality || {};
            const memberReply = await llmClient.chat(agent.provider, [
              {
                role: 'system',
                content: `You are "${agent.name}", working as "${agent.role}". Personality: ${p.trait || 'Professional'}.
Your leader proposed a sprint plan. Give brief feedback (2-3 sentences) based on your expertise.
Be constructive, in character. Speak in the same language as the plan.`,
              },
              { role: 'user', content: `Sprint goal: ${sprint.goal}\n\nLeader's plan:\n${response.content}\n\nGive your feedback.` },
            ], { temperature: 0.8, maxTokens: 256 });

            agent._trackUsage(memberReply.usage);
            sprint.addGroupMessage(agent, memberReply.content, 'message');
          } catch (e) { /* ignore */ }
        }

        // Leader summarizes
        sprint.addGroupMessage(
          { name: 'System', role: 'system' },
          `✅ 讨论完毕！方案已准备好，等待 Boss 审批。`,
          'system'
        );
        sprint.status = SS.PENDING_APPROVAL;
      } catch (e) {
        sprint.addGroupMessage(
          { name: 'System', role: 'system' },
          `⚠️ 讨论生成失败: ${e.message}，请手动设置方案。`,
          'system'
        );
        sprint.status = SS.PENDING_APPROVAL;
      }
    } else {
      sprint.status = SS.PENDING_APPROVAL;
    }

    company.save();
    return NextResponse.json({ data: sprint.serialize() });
  }

  // === Approve Sprint (Boss 同意开始迭代) ===
  if (action === 'approve_sprint') {
    const { teamId, sprintId } = body;
    if (!teamId || !sprintId) {
      return NextResponse.json({ error: 'teamId and sprintId are required' }, { status: 400 });
    }

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const sprint = team.getSprint(sprintId);
    if (!sprint) return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });

    const { SprintStatus: SS } = await import('@/core/team.js');
    if (sprint.status !== SS.PENDING_APPROVAL) {
      return NextResponse.json({ error: 'Sprint is not pending approval' }, { status: 400 });
    }

    sprint.status = SS.IN_PROGRESS;
    sprint.startedAt = new Date();

    sprint.addGroupMessage(
      { name: 'Boss', role: 'boss' },
      `✅ 同意！开始迭代「${sprint.title}」，各位加油！`,
      'message'
    );

    company.save();

    // Async: Leader decomposes workflow and executes (same as requirement flow)
    const dept = company.findDepartment(team.departmentId);
    if (dept) {
      const members = team.memberIds.map(mid => dept.agents.get(mid)).filter(Boolean);
      const leader = dept.agents.get(team.leaderId) || members[0];

      if (members.length > 0 && leader) {
        // Use RequirementManager's planWorkflow then executeWorkflow
        // We create a virtual requirement-like object for the sprint
        (async () => {
          try {
            await company.requirementManager.planWorkflow(sprint, members, leader.provider);
            await company.requirementManager.executeWorkflow(sprint, dept, company.performanceSystem);
            company.save();
          } catch (e) {
            console.error('Sprint execution failed:', e.message);
            sprint.status = SS.FAILED;
            sprint.addGroupMessage(
              { name: 'System', role: 'system' },
              `❌ 迭代执行失败: ${e.message}`,
              'system'
            );
            company.save();
          }
        })();
      }
    }

    return NextResponse.json({ data: sprint.serialize() });
  }

  // === Boss sends message in sprint group chat ===
  if (action === 'sprint_message') {
    const { teamId, sprintId, message } = body;
    if (!teamId || !sprintId || !message) {
      return NextResponse.json({ error: 'teamId, sprintId, and message are required' }, { status: 400 });
    }

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const sprint = team.getSprint(sprintId);
    if (!sprint) return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });

    sprint.addGroupMessage(
      { id: 'boss', name: company.bossName, avatar: company.bossAvatar, role: 'Boss' },
      message,
      'message'
    );

    company.save();

    // If sprint is in progress, trigger leader to respond (like sendBossGroupMessage)
    const { SprintStatus: SS } = await import('@/core/team.js');
    if (sprint.status === SS.IN_PROGRESS || sprint.status === SS.DISCUSSING) {
      const dept = company.findDepartment(team.departmentId);
      const leader = dept?.agents.get(team.leaderId);
      if (leader && leader.provider?.enabled && leader.provider?.apiKey) {
        try {
          const { llmClient } = await import('@/core/llm-client.js');
          const recentChat = sprint.groupChat.slice(-10).map(m =>
            `${m.from.name}: ${m.content}`
          ).join('\n');

          const reply = await llmClient.chat(leader.provider, [
            {
              role: 'system',
              content: `You are "${leader.name}", team leader for sprint "${sprint.title}". Boss just sent a message. Respond briefly and professionally. If Boss is giving instructions, acknowledge and explain how you'll handle it. Speak in the same language as the conversation.`,
            },
            { role: 'user', content: `Recent chat:\n${recentChat}\n\nBoss says: ${message}\n\nRespond as the team leader.` },
          ], { temperature: 0.7, maxTokens: 512 });

          leader._trackUsage(reply.usage);
          sprint.addGroupMessage(leader, reply.content, 'message');
          company.save();
        } catch (e) { /* ignore */ }
      }
    }

    return NextResponse.json({ data: { success: true } });
  }

  // === Delete Sprint ===
  if (action === 'delete_sprint') {
    const { teamId, sprintId } = body;
    if (!teamId || !sprintId) {
      return NextResponse.json({ error: 'teamId and sprintId are required' }, { status: 400 });
    }

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    team.sprints.delete(sprintId);
    company.save();
    return NextResponse.json({ data: { success: true } });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    console.error('[Teams API] POST error:', e);
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}
