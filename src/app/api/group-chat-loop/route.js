import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { groupChatLoop } from '@/core/group-chat-loop.js';

/**
 * 群聊心流 API - 让老板偷看员工在群聊中的内心独白
 * 
 * GET /api/group-chat-loop?agentId=xxx&groupId=xxx          - 获取某员工在某群的当前心流
 * GET /api/group-chat-loop?agentId=xxx&groupId=xxx&history=1 - 获取某员工在某群的历史心流
 * GET /api/group-chat-loop?active=1                          - 获取所有正在思考的员工
 * GET /api/group-chat-loop?status=1                          - 获取群聊循环引擎状态
 */
export async function GET(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: '请先创建公司' }, { status: 400 });
  }

  const url = new URL(request.url);
  const agentId = url.searchParams.get('agentId');
  const groupId = url.searchParams.get('groupId');
  const history = url.searchParams.get('history');
  const active = url.searchParams.get('active');
  const status = url.searchParams.get('status');

  // 获取引擎状态
  if (status) {
    return NextResponse.json({
      data: {
        running: groupChatLoop.running,
        activePollers: groupChatLoop._pollTimers.size,
        activeMonologues: groupChatLoop._activeMonologues.size,
        processingCount: groupChatLoop._processing.size,
      },
    });
  }

  // 获取所有正在思考的员工
  if (active) {
    const thinkingAgents = groupChatLoop.getActiveThinkingAgents();
    return NextResponse.json({ data: thinkingAgents });
  }

  // 获取某员工在某群的心流
  if (agentId && groupId) {
    // 获取某员工在某群的心流消息（工作过程中的 flow 消息）
    const flowMessages = url.searchParams.get('flowMessages');
    const monologueMessages = url.searchParams.get('monologueMessages');
    if (flowMessages || monologueMessages) {
      // 支持需求群聊和部门群聊的 flow 消息查询
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
        // 返回该员工在此群的所有内心独白消息（type === 'monologue'）
        const agentMonologueMsgs = chatMessages
          .filter(m => m.type === 'monologue' && m.from?.id === agentId)
          .slice(-50);
        return NextResponse.json({ data: agentMonologueMsgs });
      }

      // 返回该员工在此群的工作日志（flow 可见性，排除 monologue）
      const agentFlowMsgs = chatMessages
        .filter(m => m.visibility === 'flow' && m.type !== 'monologue' && m.from?.id === agentId)
        .slice(-50);
      return NextResponse.json({ data: agentFlowMsgs });
    }

    if (history) {
      // 历史心流
      const monologues = groupChatLoop.getMonologueHistory(agentId, groupId);
      return NextResponse.json({
        data: monologues.map(m => m.toJSON()),
      });
    } else {
      // 当前心流
      const current = groupChatLoop.getActiveMonologue(agentId, groupId);
      return NextResponse.json({
        data: current ? current.toJSON() : null,
      });
    }
  }

  return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
}
