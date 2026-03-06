import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';

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
  const t = getApiT(request);
  try {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  if (!company.teamManager) {
    const { TeamManager: TM } = await import('@/core/organization/team.js');
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
    if (!team) return NextResponse.json({ error: t('api.teamNotFound') }, { status: 404 });
    const sprint = team.getSprint(sprintId);
    if (!sprint) return NextResponse.json({ error: t('api.sprintNotFound') }, { status: 404 });

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
    if (!team) return NextResponse.json({ error: t('api.teamNotFound') }, { status: 404 });

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
  const t = getApiT(request);
  try {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  if (!company.teamManager) {
    const { TeamManager: TM } = await import('@/core/organization/team.js');
    company.teamManager = new TM();
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: t('api.teamDeleteIdRequired') }, { status: 400 });

  if (!company.teamManager.get(id)) {
    return NextResponse.json({ error: t('api.teamNotFound') }, { status: 404 });
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
  const t = getApiT(request);
  try {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  if (!company.teamManager) {
    const { TeamManager: TM } = await import('@/core/organization/team.js');
    company.teamManager = new TM();
  }

  const body = await request.json();
  const { action } = body;

  // === Create Team ===
  if (action === 'create') {
    const { departmentId, name, memberIds, leaderId, description } = body;
    if (!departmentId || !name || !memberIds?.length || !leaderId) {
      return NextResponse.json({ error: t('api.teamCreateRequired') }, { status: 400 });
    }

    const dept = company.findDepartment(departmentId);
    if (!dept) return NextResponse.json({ error: t('api.deptNotFound') }, { status: 404 });

    const leader = dept.agents.get(leaderId);
    if (!leader) return NextResponse.json({ error: t('api.leaderNotFound') }, { status: 400 });

    // Verify all members exist in department
    for (const mid of memberIds) {
      if (!dept.agents.get(mid)) {
        return NextResponse.json({ error: t('api.memberNotFound', { id: mid }) }, { status: 400 });
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
    if (!teamId) return NextResponse.json({ error: t('api.teamIdRequired') }, { status: 400 });

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: t('api.teamNotFound') }, { status: 404 });

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
      return NextResponse.json({ error: t('api.sprintCreateRequired') }, { status: 400 });
    }

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: t('api.teamNotFound') }, { status: 404 });

    const { Sprint } = await import('@/core/organization/team.js');
    const sprint = new Sprint({ title, goal, teamId: team.id, teamName: team.name });
    team.addSprint(sprint);

    // Add system message
    sprint.addGroupMessage(
      { name: 'System', role: 'system' },
      t('api.sprintCreated', { title, goal }),
      'system'
    );

    company.save();
    return NextResponse.json({ data: sprint.serialize() });
  }

  // === Start Sprint Discussion ===
  if (action === 'discuss_sprint') {
    const { teamId, sprintId } = body;
    if (!teamId || !sprintId) {
      return NextResponse.json({ error: t('api.sprintDiscussRequired') }, { status: 400 });
    }

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: t('api.teamNotFound') }, { status: 404 });

    const sprint = team.getSprint(sprintId);
    if (!sprint) return NextResponse.json({ error: t('api.sprintNotFound') }, { status: 404 });

    const { SprintStatus: SS } = await import('@/core/organization/team.js');
    if (sprint.status !== SS.DRAFT) {
      return NextResponse.json({ error: t('api.sprintNotDraft') }, { status: 400 });
    }

    sprint.status = SS.DISCUSSING;
    company.save();

    // Return immediately, run discussion async so frontend can poll progress
    const response = NextResponse.json({ data: sprint.serialize() });

    // Async discussion flow
    const dept = company.findDepartment(team.departmentId);
    const leader = dept?.agents.get(team.leaderId);

    if (leader) {
      (async () => {
        try {
          const { getTraitStyle, getAgeStyle } = await import('@/core/prompt-locale.js');

          const members = team.memberIds.map(mid => dept.agents.get(mid)).filter(Boolean);
          const nonLeaderMembers = members.filter(m => m.id !== team.leaderId);

          const memberInfo = members.map(a =>
            `- ${a.name} (${a.role}): skills=[${a.skills.join(', ')}]`
          ).join('\n');

          // Helper: build personality-aware system prompt for an agent
          const buildAgentPrompt = (agent, scenario) => {
            const p = agent.personality || {};
            const traitStyle = getTraitStyle(p.trait);
            const ageStyle = getAgeStyle(agent.age);
            return `${traitStyle}

You are "${agent.name}", ${agent.gender || 'male'}, age ${agent.age || 28}, working as "${agent.role}".
Tone: ${p.tone || 'professional'}. Quirk: ${p.quirk || 'none'}. Signature: ${agent.signature || ''}.

${ageStyle}

---

${scenario}

IMPORTANT: Stay in character. Your reply should reflect your personality, age, and speaking style. DO NOT sound like a polite AI assistant. Be natural, opinionated, and real.
Speak in the same language as the conversation (match the sprint goal language).`;
          };

          // Helper: get recent chat as context string
          const getChatContext = () => {
            const msgs = (sprint.groupChat || []).filter(m => m.visibility !== 'flow');
            return msgs.slice(-15).map(m => `${m.from?.name || 'System'}: ${m.content}`).join('\n');
          };

          // === Phase 1: Leader opens discussion ===
          sprint.addGroupMessage(
            leader,
            t('api.sprintDiscussionOpening', { title: sprint.title, goal: sprint.goal }),
            'message'
          );
          company.save();

          // === Phase 2: Leader proposes initial plan ===
          const planResponse = await leader.chat([
            {
              role: 'system',
              content: buildAgentPrompt(leader, `You are the team leader. Your team is starting a sprint discussion.
Team members:\n${memberInfo}

Analyze the sprint goal and propose a concrete initial plan. Include:
1. Overall approach and architecture
2. Task breakdown — what each team member should focus on (based on their skills)
3. Expected deliverables
4. Potential risks and mitigation

Be specific and actionable. This is a DRAFT plan for the team to discuss and improve.`),
            },
            { role: 'user', content: `Sprint goal: ${sprint.goal}\n\nPropose your initial plan for the team to discuss.` },
          ], { temperature: 0.7, maxTokens: 1024 });

          sprint.plan = planResponse.content;

          sprint.addGroupMessage(
            leader,
            `📋 Here is my initial plan:\n\n${planResponse.content}\n\nWhat do you think? Please share your feedback and suggestions based on your expertise so we can improve it together.`,
            'message'
          );
          company.save();

          // Small delay to mimic natural pacing
          await new Promise(r => setTimeout(r, 1500));

          // === Phase 3: Each member gives feedback (Round 1 — initial opinions) ===
          // Randomize order so it feels natural
          const shuffled = [...nonLeaderMembers].sort(() => Math.random() - 0.5);

          for (const agent of shuffled) {
            if (!agent.canChat()) continue;

            // Inner monologue (flow visibility — Boss can peek)
            try {
              const monologueResp = await agent.chat([
                {
                  role: 'system',
                  content: buildAgentPrompt(agent, `You are in a sprint planning discussion. The leader just proposed a plan. Think about what you really feel about this plan — your honest inner thoughts. This is your PRIVATE inner monologue, not what you'll say out loud.

Consider: Does the plan make sense for your role? Any concerns? Anything missing? What would YOU change?`),
                },
                { role: 'user', content: `Chat context:\n${getChatContext()}\n\nWhat are your honest inner thoughts about this plan? (1-2 sentences, be real)` },
              ], { temperature: 0.95, maxTokens: 200 });
              sprint.addGroupMessage(
                { id: agent.id, name: agent.name, avatar: agent.avatar, role: agent.role },
                monologueResp.content,
                'monologue',
                'flow'
              );
            } catch (e) { /* monologue failed, continue */ }

            // Actual group message — substantive feedback
            try {
              const feedbackResp = await agent.chat([
                {
                  role: 'system',
                  content: buildAgentPrompt(agent, `You are in a sprint planning discussion group. The leader proposed an initial plan. Now it's your turn to give feedback.

Your expertise: ${agent.role}, skills: [${(agent.skills || []).join(', ')}]

REQUIREMENTS for your feedback:
1. Comment on the parts relevant to YOUR expertise — be specific
2. Point out any issues, risks, or improvements you see
3. If you disagree with something, say so clearly and suggest alternatives
4. If you have additional ideas, propose them
5. Keep it concise but substantive (3-5 sentences)

Other team members:\n${memberInfo}

DO NOT just say "looks good" or "I agree". Give REAL, specific feedback.`),
                },
                { role: 'user', content: `Chat context:\n${getChatContext()}\n\nGive your professional feedback on the plan.` },
              ], { temperature: 0.8, maxTokens: 400 });

              sprint.addGroupMessage(agent, feedbackResp.content, 'message');
              company.save();

              // Stagger replies
              await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
            } catch (e) { /* ignore */ }
          }

          // === Phase 4: Cross-discussion (Round 2 — members respond to each other) ===
          // Pick 2-3 members who had the most substantive feedback to continue
          const discussants = shuffled
            .filter(a => a.canChat())
            .slice(0, Math.min(3, nonLeaderMembers.length));

          if (discussants.length > 1) {
            await new Promise(r => setTimeout(r, 1000));

            for (const agent of discussants) {
              try {
                const crossResp = await agent.chat([
                  {
                    role: 'system',
                    content: buildAgentPrompt(agent, `You are in a sprint planning discussion. Other team members have given their feedback. Now you can:
1. Respond to a colleague's point you agree or disagree with
2. Build on someone else's suggestion
3. Raise a new concern that wasn't mentioned
4. Propose a specific technical solution

Be brief (2-3 sentences). Reference specific colleagues by name when responding to their points. Stay in character.`),
                  },
                  { role: 'user', content: `Full discussion so far:\n${getChatContext()}\n\nAdd to the discussion — respond to colleagues or raise new points.` },
                ], { temperature: 0.85, maxTokens: 300 });

                sprint.addGroupMessage(agent, crossResp.content, 'message');
                company.save();

                await new Promise(r => setTimeout(r, 600 + Math.random() * 800));
              } catch (e) { /* ignore */ }
            }
          }

          // === Phase 5: Leader summarizes and revises plan ===
          await new Promise(r => setTimeout(r, 1000));

          // Leader inner monologue
          try {
            const leaderMonologue = await leader.chat([
              {
                role: 'system',
                content: buildAgentPrompt(leader, `You are the team leader. Your team has finished discussing the sprint plan. Think about all the feedback — what should you incorporate? What should you push back on? This is your PRIVATE inner thought.`),
              },
              { role: 'user', content: `Discussion:\n${getChatContext()}\n\nYour honest thoughts on the team's feedback? (2-3 sentences)` },
            ], { temperature: 0.8, maxTokens: 200 });
            sprint.addGroupMessage(
              { id: leader.id, name: leader.name, avatar: leader.avatar, role: leader.role },
              leaderMonologue.content,
              'monologue',
              'flow'
            );
          } catch (e) { /* ignore */ }

          // Leader summary message in group
          try {
            const summaryResp = await leader.chat([
              {
                role: 'system',
                content: buildAgentPrompt(leader, `You are the team leader wrapping up the sprint plan discussion. You need to:
1. Acknowledge the team's valuable feedback (mention specific people and their points)
2. Explain which suggestions you're incorporating and why
3. Note any concerns you'll monitor during execution
4. Announce the plan is ready for Boss's approval

Be concise, professional, and appreciative. Show you actually listened.`),
              },
              { role: 'user', content: `Full discussion:\n${getChatContext()}\n\nSummarize the discussion and wrap up.` },
            ], { temperature: 0.7, maxTokens: 400 });

            sprint.addGroupMessage(leader, summaryResp.content, 'message');
          } catch (e) { /* ignore */ }

          // Leader revises the plan based on all feedback
          try {
            const revisedPlan = await leader.chat([
              {
                role: 'system',
                content: `You are "${leader.name}", team leader. Your team has discussed the sprint plan and given feedback. Now revise the plan incorporating the valid suggestions.

Output ONLY the revised plan in markdown format. Keep it concise and actionable.
Speak in the same language as the original plan.`,
              },
              { role: 'user', content: `Original plan:\n${sprint.plan}\n\nFull team discussion:\n${getChatContext()}\n\nOutput the REVISED plan incorporating the team's feedback:` },
            ], { temperature: 0.5, maxTokens: 2048 });

            sprint.plan = revisedPlan.content;
          } catch (e) { /* plan revision failed, keep original */ }

          // Final system message
          sprint.addGroupMessage(
            { name: 'System', role: 'system' },
            t('api.sprintDiscussionComplete'),
            'system'
          );
          sprint.status = SS.PENDING_APPROVAL;
          company.save();

        } catch (e) {
          console.error('[Sprint Discussion] Error:', e.message);
          sprint.addGroupMessage(
            { name: 'System', role: 'system' },
            t('api.sprintDiscussionError', { error: e.message }),
            'system'
          );
          sprint.status = SS.PENDING_APPROVAL;
          company.save();
        }
      })();
    } else {
      sprint.status = SS.PENDING_APPROVAL;
      company.save();
    }

    return response;
  }

  // === Approve Sprint (Boss approves → create standard requirement) ===
  if (action === 'approve_sprint') {
    const { teamId, sprintId } = body;
    if (!teamId || !sprintId) {
      return NextResponse.json({ error: t('api.sprintDiscussRequired') }, { status: 400 });
    }

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: t('api.teamNotFound') }, { status: 404 });

    const sprint = team.getSprint(sprintId);
    if (!sprint) return NextResponse.json({ error: t('api.sprintNotFound') }, { status: 404 });

    const { SprintStatus: SS } = await import('@/core/organization/team.js');
    if (sprint.status !== SS.PENDING_APPROVAL) {
      return NextResponse.json({ error: t('api.sprintNotPendingApproval') }, { status: 400 });
    }

    sprint.status = SS.IN_PROGRESS;
    sprint.startedAt = new Date();

    sprint.addGroupMessage(
      { name: 'Boss', role: 'boss' },
      t('api.sprintApproved'),
      'message'
    );

    company.save();

    // Async: Create a standard Requirement from the sprint and execute via the full requirement pipeline
    (async () => {
      try {
        const requirement = await company.assignSprintAsDepartmentTask(sprint, team);
        sprint.addGroupMessage(
          { name: 'System', role: 'system' },
          t('api.sprintRequirementCreated', { title: requirement.title }),
          'system'
        );
        company.save();
      } catch (e) {
        console.error('Sprint → Requirement failed:', e.message);
        sprint.status = SS.FAILED;
        sprint.addGroupMessage(
          { name: 'System', role: 'system' },
          t('api.sprintRequirementFailed', { error: e.message }),
          'system'
        );
        company.save();
      }
    })();

    return NextResponse.json({ data: sprint.serialize() });
  }

  // === Boss sends message in sprint group chat ===
  if (action === 'sprint_message') {
    const { teamId, sprintId, message } = body;
    if (!teamId || !sprintId || !message) {
      return NextResponse.json({ error: t('api.sprintMessageRequired') }, { status: 400 });
    }

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: t('api.teamNotFound') }, { status: 404 });

    const sprint = team.getSprint(sprintId);
    if (!sprint) return NextResponse.json({ error: t('api.sprintNotFound') }, { status: 404 });

    sprint.addGroupMessage(
      { id: 'boss', name: company.bossName, avatar: company.bossAvatar, role: 'Boss' },
      message,
      'message'
    );

    company.save();

    // Trigger leader to respond when Boss sends a message
    const { SprintStatus: SS } = await import('@/core/organization/team.js');
    if (sprint.status === SS.IN_PROGRESS || sprint.status === SS.DISCUSSING || sprint.status === SS.PENDING_APPROVAL) {
      const dept = company.findDepartment(team.departmentId);
      const leader = dept?.agents.get(team.leaderId);
      if (leader && leader.canChat()) {
        try {
          const recentChat = sprint.groupChat.slice(-10).map(m =>
            `${m.from.name}: ${m.content}`
          ).join('\n');

          const systemPrompts = {
            [SS.PENDING_APPROVAL]: `You are "${leader.name}", team leader for sprint "${sprint.title}". The plan has been submitted and is awaiting Boss's approval. Boss is now giving feedback or suggestions on the plan. Listen carefully, acknowledge the feedback, explain how you will adjust the plan accordingly, and update the approach. Be concise and professional. Speak in the same language as the conversation.`,
            [SS.DISCUSSING]: `You are "${leader.name}", team leader for sprint "${sprint.title}". The team is currently discussing the sprint plan. Boss is participating in the discussion. Respond to Boss's input, incorporate suggestions, and coordinate with the team. Be concise and professional. Speak in the same language as the conversation.`,
            [SS.IN_PROGRESS]: `You are "${leader.name}", team leader for sprint "${sprint.title}". Boss just sent a message. Respond briefly and professionally. If Boss is giving instructions, acknowledge and explain how you'll handle it. Speak in the same language as the conversation.`,
          };

          const reply = await leader.chat([
            {
              role: 'system',
              content: systemPrompts[sprint.status] || systemPrompts[SS.IN_PROGRESS],
            },
            { role: 'user', content: `Recent chat:\n${recentChat}\n\nBoss says: ${message}\n\nRespond as the team leader.` },
          ], { temperature: 0.7, maxTokens: 512 });

          sprint.addGroupMessage(leader, reply.content, 'message');
          company.save();

          // If pending_approval and Boss gave feedback, update the plan then trigger team discussion
          if (sprint.status === SS.PENDING_APPROVAL && sprint.plan) {
            // Run async so API returns immediately
            (async () => {
              try {
                const { getTraitStyle, getAgeStyle } = await import('@/core/prompt-locale.js');

                // Leader revises the plan based on Boss feedback
                const planReply = await leader.chat([
                  {
                    role: 'system',
                    content: `You are "${leader.name}", team leader. Boss has given feedback on your sprint plan. Update the plan based on Boss's feedback. Output ONLY the revised plan in the same format (markdown). Keep it concise. Speak in the same language as the original plan.`,
                  },
                  { role: 'user', content: `Original plan:\n${sprint.plan}\n\nBoss feedback: ${message}\n\nYour response to Boss: ${reply.content}\n\nNow output the revised plan:` },
                ], { temperature: 0.5, maxTokens: 2048 });

                sprint.plan = planReply.content;
                company.save();

                await new Promise(r => setTimeout(r, 1000));

                // Now trigger team members to review and comment on the revised plan
                const members = team.memberIds
                  .map(mid => dept.agents.get(mid))
                  .filter(a => a && a.id !== team.leaderId && a.canChat());

                const recentMsgs = sprint.groupChat.slice(-15)
                  .filter(m => m.visibility !== 'flow')
                  .map(m => `${m.from?.name || 'System'}: ${m.content}`)
                  .join('\n');

                const shuffled = [...members].sort(() => Math.random() - 0.5);

                for (const agent of shuffled) {
                  try {
                    const p = agent.personality || {};
                    const traitStyle = getTraitStyle(p.trait);
                    const ageStyle = getAgeStyle(agent.age);

                    const feedbackResp = await agent.chat([
                      {
                        role: 'system',
                        content: `${traitStyle}\n\nYou are "${agent.name}", ${agent.gender || 'male'}, age ${agent.age || 28}, working as "${agent.role}".\nTone: ${p.tone || 'professional'}. Quirk: ${p.quirk || 'none'}.\n\n${ageStyle}\n\n---\n\nYour team leader just revised the sprint plan based on Boss's feedback. Now it's your turn to review the REVISED plan and give your opinion.\n\nYour expertise: ${agent.role}, skills: [${(agent.skills || []).join(', ')}]\n\nREQUIREMENTS:\n1. Comment on whether the revisions address Boss's concerns\n2. Point out any issues or improvements you see in the NEW plan\n3. If you have additional suggestions, propose them\n4. Keep it concise (2-4 sentences)\n\nDO NOT just say "looks good". Give REAL, specific feedback. Stay in character.\nSpeak in the same language as the conversation.`,
                      },
                      { role: 'user', content: `Recent discussion:\n${recentMsgs}\n\nBoss's feedback: ${message}\n\nRevised plan:\n${sprint.plan}\n\nGive your feedback on the revised plan.` },
                    ], { temperature: 0.8, maxTokens: 400 });

                    sprint.addGroupMessage(agent, feedbackResp.content, 'message');
                    company.save();

                    await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
                  } catch (e) { /* ignore individual agent failure */ }
                }

                // Leader incorporates team feedback into a final revision
                if (shuffled.length > 0) {
                  await new Promise(r => setTimeout(r, 800));

                  const finalChat = sprint.groupChat.slice(-15)
                    .filter(m => m.visibility !== 'flow')
                    .map(m => `${m.from?.name || 'System'}: ${m.content}`)
                    .join('\n');

                  try {
                    const wrapResp = await leader.chat([
                      {
                        role: 'system',
                        content: `You are "${leader.name}", team leader. Boss gave feedback, you revised the plan, and team members have reviewed the revision. Now briefly acknowledge the team's input and confirm the plan is updated. Be concise (2-3 sentences). Speak in the same language as the conversation.`,
                      },
                      { role: 'user', content: `Discussion:\n${finalChat}\n\nWrap up briefly.` },
                    ], { temperature: 0.7, maxTokens: 256 });

                    sprint.addGroupMessage(leader, wrapResp.content, 'message');
                  } catch (e) { /* ignore */ }

                  // Final plan revision incorporating team's latest feedback
                  try {
                    const finalPlan = await leader.chat([
                      {
                        role: 'system',
                        content: `You are "${leader.name}", team leader. Revise the plan one more time incorporating the team's latest feedback. Output ONLY the revised plan in markdown. Keep the same language.`,
                      },
                      { role: 'user', content: `Current plan:\n${sprint.plan}\n\nTeam feedback:\n${finalChat}\n\nOutput the final revised plan:` },
                    ], { temperature: 0.5, maxTokens: 2048 });

                    sprint.plan = finalPlan.content;
                  } catch (e) { /* ignore */ }

                  company.save();
                }
              } catch (e) {
                console.error('[Sprint Boss Feedback Discussion] Error:', e.message);
              }
            })();
          } else {
            company.save();
          }
        } catch (e) { /* ignore */ }
      }
    }

    return NextResponse.json({ data: { success: true } });
  }

  // === Delete Sprint ===
  if (action === 'delete_sprint') {
    const { teamId, sprintId } = body;
    if (!teamId || !sprintId) {
      return NextResponse.json({ error: t('api.sprintDiscussRequired') }, { status: 400 });
    }

    const team = company.teamManager.get(teamId);
    if (!team) return NextResponse.json({ error: t('api.teamNotFound') }, { status: 404 });

    team.sprints.delete(sprintId);
    company.save();
    return NextResponse.json({ data: { success: true } });
  }

  return NextResponse.json({ error: t('api.unknownAction') }, { status: 400 });
  } catch (e) {
    console.error('[Teams API] POST error:', e);
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}
