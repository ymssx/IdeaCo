import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';

export async function GET(request, { params }) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });

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
            // CLI agent shows cliProvider info (actual CLI tool), not fallback general provider
            provider: agent.cliProvider
              ? { id: agent.cliProvider.id, name: agent.cliProvider.name, provider: agent.cliProvider.provider || 'Local CLI' }
              : { id: agent.provider.id, name: agent.provider.name, provider: agent.provider.provider },
            cliBackend: agent.cliBackend || null,
            // CLI agent chat engine (fallback LLM provider name)
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
            // Incentives: generated based on performance records (high scores earn flowers)
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
    return NextResponse.json({ error: t('api.agentNotFound') }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[agentId] - Update Agent configuration (e.g. CLI backend)
 */
export async function PUT(request, { params }) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });

  try {
    const { agentId } = await params;
    const body = await request.json();

    for (const dept of company.departments.values()) {
      const agent = dept.agents.get(agentId);
      if (agent) {
        // Set CLI backend
        if ('cliBackend' in body) {
          agent.setCLIBackend(body.cliBackend || null);
        }

        // Persist
        company.save();

        return NextResponse.json({
          data: {
            id: agent.id,
            name: agent.name,
            cliBackend: agent.cliBackend,
            message: t('api.agentConfigUpdated'),
          },
        });
      }
    }
    return NextResponse.json({ error: t('api.agentNotFound') }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
