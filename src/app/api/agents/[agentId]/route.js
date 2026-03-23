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
            personalityBio: agent.personalityBio || '',
            signature: agent.signature,
            prompt: agent.prompt,
            skills: agent.skills,
            status: agent.status,
            provider: agent.getProviderDisplayInfo(),
            cliBackend: agent.cliBackend || null,
            fallbackProvider: agent.getFallbackProviderName(),
            customPrompt: agent.customPrompt || '',
            department: dept.name,
            departmentId: dept.id,
            // Available providers for frontend dropdown (same category as current agent)
            availableProviders: company.providerRegistry
              .getByCategory(agent.agent.provider?.category || 'general')
              .map(p => ({ id: p.id, name: p.name, provider: p.provider, model: p.model })),
            memory: agent.memory.getSummary(),
            stamina: agent.stamina ? agent.stamina.getSummary() : null,
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
        // Set CLI backend (only supported for CLI agents)
        if ('cliBackend' in body && agent.agentType === 'cli') {
          agent.agent.cliBackend = body.cliBackend || null;
        }

        // Switch provider (by provider ID)
        if ('providerId' in body && body.providerId) {
          const newProvider = company.providerRegistry.getById(body.providerId);
          if (newProvider && newProvider.enabled) {
            const oldProviderName = agent.getProviderDisplayInfo()?.name || 'unknown';
            agent.switchProvider(newProvider);
            console.log(`[${agent.name}] Provider switched: ${oldProviderName} → ${newProvider.name} (id: ${newProvider.id})`);
            // Re-onboard in background (non-blocking): regenerate signature/personalityBio with new model
            // Don't await — return the response immediately so the save doesn't time out
            const bgDeptName = dept.name || 'the company';
            agent.onboard({ departmentName: bgDeptName, bossName: company.bossName || 'Boss' })
              .then(() => {
                console.log(`[${agent.name}] Re-onboard after provider switch completed`);
                company.save();
              })
              .catch(e => {
                console.error(`[${agent.name}] Re-onboard after provider switch failed:`, e.message);
              });
          } else {
            console.warn(`[${agent.name}] Provider switch failed: provider "${body.providerId}" ${!newProvider ? 'not found' : 'is disabled'}`);
          }
        }

        // Update role prompt
        if ('prompt' in body && typeof body.prompt === 'string') {
          agent.prompt = body.prompt;
        }

        // Update custom prompt (boss's special instructions)
        if ('customPrompt' in body && typeof body.customPrompt === 'string') {
          agent.customPrompt = body.customPrompt;
        }

        // Persist
        company.save();

        return NextResponse.json({
          data: {
            id: agent.id,
            name: agent.name,
            cliBackend: agent.cliBackend,
            provider: agent.getProviderDisplayInfo(),
            prompt: agent.prompt,
            customPrompt: agent.customPrompt || '',
            signature: agent.signature,
            personalityBio: agent.personalityBio || '',
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
