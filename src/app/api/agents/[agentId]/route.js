import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

export async function GET(request, { params }) {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });

  try {
    const { agentId } = await params;
    for (const dept of company.departments.values()) {
      const agent = dept.agents.get(agentId);
      if (agent) {
        const reviews = company.performanceSystem.getReviews(agent.id);
        return NextResponse.json({
          data: {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            avatar: agent.avatar,
            gender: agent.gender,
            age: agent.age,
            personality: agent.personality,
            signature: agent.signature,
            prompt: agent.prompt,
            skills: agent.skills,
            status: agent.status,
            // CLI agent 展示 cliProvider 信息（实际的 CLI 工具），而非 fallback general provider
            provider: agent.cliProvider
              ? { id: agent.cliProvider.id, name: agent.cliProvider.name, provider: agent.cliProvider.provider || 'Local CLI' }
              : { id: agent.provider.id, name: agent.provider.name, provider: agent.provider.provider },
            cliBackend: agent.cliBackend || null,
            // CLI agent 的聊天引擎（fallback LLM provider 名称）
            fallbackProvider: agent.cliProvider ? agent.provider.name : null,
            department: dept.name,
            departmentId: dept.id,
            memory: agent.memory.getSummary(),
            performanceHistory: agent.performanceHistory,
            reviews: reviews.map(r => r.getSummary()),
            taskHistory: agent.taskHistory.map(t => ({
              task: t.task,
              completedAt: t.completedAt,
              success: t.result?.success,
              toolsUsed: t.result?.toolResults?.length || 0,
            })),
            tokenUsage: { ...agent.tokenUsage },
            avgScore: agent.performanceHistory.length > 0
              ? Math.round(agent.performanceHistory.reduce((s, p) => s + p.score, 0) / agent.performanceHistory.length)
              : null,
            // 激励：基于绩效记录生成（高分获得小红花）
            incentives: agent.performanceHistory
              .filter(p => p.score >= 80)
              .map(p => ({
                type: 'flower',
                emoji: '🌸',
                label: p.score >= 90 ? 'outstanding' : 'excellent',
                task: p.task,
                score: p.score,
                level: p.level,
                date: p.date,
              })),
          },
        });
      }
    }
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[agentId] - 更新 Agent 配置（如 CLI 后端）
 */
export async function PUT(request, { params }) {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });

  try {
    const { agentId } = await params;
    const body = await request.json();

    for (const dept of company.departments.values()) {
      const agent = dept.agents.get(agentId);
      if (agent) {
        // 设置 CLI 后端
        if ('cliBackend' in body) {
          agent.setCLIBackend(body.cliBackend || null);
        }

        // 持久化
        company.save();

        return NextResponse.json({
          data: {
            id: agent.id,
            name: agent.name,
            cliBackend: agent.cliBackend,
            message: 'Agent configuration updated',
          },
        });
      }
    }
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
