import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { groupChatLoop } from '@/core/organization/group-chat-loop.js';
import { getApiT } from '@/lib/api-i18n';

/**
 * Group Chat Flow API - lets the boss peek at employees' inner monologues in group chats
 *
 * GET /api/group-chat-loop?agentId=xxx&groupId=xxx           - Get an employee's current flow in a group
 * GET /api/group-chat-loop?agentId=xxx&groupId=xxx&history=1 - Get an employee's flow history in a group
 * GET /api/group-chat-loop?active=1                          - Get all currently thinking employees
 * GET /api/group-chat-loop?status=1                          - Get group chat loop engine status
 */
export async function GET(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  const url = new URL(request.url);
  const agentId = url.searchParams.get('agentId');
  const groupId = url.searchParams.get('groupId');
  const history = url.searchParams.get('history');
  const active = url.searchParams.get('active');
  const status = url.searchParams.get('status');

  // Get engine status
  if (status) {
    return NextResponse.json({
      data: {
        running: groupChatLoop.running,
        activePollers: groupChatLoop._lifecycles.size,
        activeMonologues: groupChatLoop.getActiveThinkingAgents().length,
        processingCount: groupChatLoop._lifecycles.size,
      },
    });
  }

  // Get all currently thinking employees
  if (active) {
    const thinkingAgents = groupChatLoop.getActiveThinkingAgents();
    return NextResponse.json({ data: thinkingAgents });
  }

  // Get an employee's flow in a specific group
  if (agentId && groupId) {
    // Get flow messages (work process) for an employee in a group
    const flowMessages = url.searchParams.get('flowMessages');
    const monologueMessages = url.searchParams.get('monologueMessages');
    if (flowMessages || monologueMessages) {
      // Support both requirement group chats and department group chats
      let chatMessages = [];
      if (groupId.startsWith('dept-')) {
        const deptId = groupId.replace('dept-', '');
        const dept = company.findDepartment(deptId);
        chatMessages = dept?.groupChat || [];
      } else {
        const requirement = company.requirementManager.get(groupId);
        chatMessages = requirement?.groupChat || [];
      }

      if (monologueMessages) {
        // Return all inner monologue messages for this employee in this group (type === 'monologue')
        const agentMonologueMsgs = chatMessages
          .filter(m => m.type === 'monologue' && m.from?.id === agentId)
          .slice(-50);
        return NextResponse.json({ data: agentMonologueMsgs });
      }

      // Return work logs for this employee in this group (flow visibility, excluding monologue)
      const agentFlowMsgs = chatMessages
        .filter(m => m.visibility === 'flow' && m.type !== 'monologue' && m.from?.id === agentId)
        .slice(-50);
      return NextResponse.json({ data: agentFlowMsgs });
    }

    if (history) {
      // Historical flow
      const monologues = groupChatLoop.getMonologueHistory(agentId, groupId);
      return NextResponse.json({
        data: monologues.map(m => m.toJSON()),
      });
    } else {
      // Current flow
      const current = groupChatLoop.getActiveMonologue(agentId, groupId);
      return NextResponse.json({
        data: current ? current.toJSON() : null,
      });
    }
  }

  return NextResponse.json({ error: t('api.missingField', { field: 'agentId and groupId' }) }, { status: 400 });
}
