import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';
import { LLMAgent } from '@/core/agent/llm-agent/index.js';
import { CLIAgent } from '@/core/agent/cli-agent/index.js';
import { WebAgent } from '@/core/agent/web-agent/index.js';

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
            // Available providers for frontend dropdown (all enabled providers, not just same category)
            availableProviders: company.providerRegistry
              .listAll()
              .filter(p => p.enabled)
              .map(p => ({ id: p.id, name: p.name, provider: p.provider, model: p.model, category: p.category })),
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
    // Check if the requested agent is the secretary
    const sec = company.secretary;
    if (sec && sec.id === agentId) {
      const reviews = company.performanceSystem.getReviews(sec.id);
      return NextResponse.json({
        data: {
          id: sec.id,
          name: sec.name,
          role: sec.role || 'Personal Secretary',
          avatar: sec.avatar,
          gender: sec.gender,
          age: sec.age,
          personality: sec.personality,
          personalityBio: sec.personalityBio || '',
          signature: sec.signature,
          prompt: sec.prompt,
          skills: sec.skills,
          status: sec.status,
          provider: sec.getProviderDisplayInfo(),
          cliBackend: sec.cliBackend || null,
          fallbackProvider: sec.getFallbackProviderName(),
          customPrompt: sec.customPrompt || '',
          department: t('api.secretaryDept'),
          departmentId: null,
          employeeClass: 'secretary',
          availableProviders: company.providerRegistry
            .listAll()
            .filter(p => p.enabled)
            .map(p => ({ id: p.id, name: p.name, provider: p.provider, model: p.model, category: p.category })),
          memory: sec.memory.getSummary(),
          stamina: sec.stamina ? sec.stamina.getSummary() : null,
          performanceHistory: sec.performanceHistory,
          reviews: reviews.map(r => r.getSummary()),
          taskHistory: sec.taskHistory.map(t => ({
            task: t.task,
            completedAt: t.completedAt,
            success: t.result?.success,
            toolsUsed: t.result?.toolResults?.length || 0,
          })),
          tokenUsage: { ...sec.tokenUsage },
          avgScore: sec.performanceHistory.length > 0
            ? Math.round(sec.performanceHistory.reduce((s, p) => s + p.score, 0) / sec.performanceHistory.length)
            : null,
          incentives: sec.performanceHistory
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

        // Switch provider (by provider ID) — handles cross-type switching (e.g. CLI→LLM)
        if ('providerId' in body && body.providerId) {
          const newProvider = company.providerRegistry.getById(body.providerId);
          if (newProvider && newProvider.enabled) {
            const oldProviderName = agent.getProviderDisplayInfo()?.name || 'unknown';

            // Determine if agent type needs to change
            const targetType = newProvider.isCLI ? 'cli' : newProvider.isWeb ? 'web' : 'llm';
            const needsTypeSwitch = agent.agentType !== targetType;

            if (needsTypeSwitch) {
              // Agent type mismatch — rebuild the communication agent
              if (newProvider.isCLI && newProvider.cliBackendId) {
                const fallback = company.providerRegistry.recommend('general');
                agent.agent = new CLIAgent({
                  cliBackend: newProvider.cliBackendId,
                  cliProvider: newProvider,
                  fallbackProvider: fallback,
                  provider: fallback,
                });
                console.log(`[${agent.name}] Agent rebuilt as CLIAgent: ${newProvider.name} (${newProvider.cliBackendId})`);
              } else if (newProvider.isWeb) {
                agent.agent = new WebAgent({ provider: newProvider });
                agent.agent.setEmployeeId(agent.id);
                // Reset session so next chat reinitializes with the new provider
                agent._sessionAwake = false;
                console.log(`[${agent.name}] Agent rebuilt as WebAgent: ${newProvider.name}`);
              } else {
                agent.agent = new LLMAgent({ provider: newProvider });
                console.log(`[${agent.name}] Agent rebuilt as LLMAgent: ${newProvider.name}`);
              }
              // Reset introduction flag so the employee re-onboards with the new model
              agent.hasIntroduced = false;
            } else {
              agent.switchProvider(newProvider);
            }

            console.log(`[${agent.name}] Provider switched: ${oldProviderName} → ${newProvider.name} (id: ${newProvider.id}, type: ${agent.agentType})`);
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

        // Update profile fields (name, avatar, gender, age, signature)
        if ('name' in body && typeof body.name === 'string' && body.name.trim()) {
          agent.name = body.name.trim();
        }
        if ('avatar' in body && typeof body.avatar === 'string') {
          agent.avatar = body.avatar;
        }
        if ('avatarParams' in body && body.avatarParams) {
          agent.avatarParams = body.avatarParams;
        }
        if ('gender' in body && (body.gender === 'male' || body.gender === 'female')) {
          agent.gender = body.gender;
        }
        if ('age' in body && typeof body.age === 'number' && body.age >= 18 && body.age <= 60) {
          agent.age = body.age;
        }
        if ('signature' in body && typeof body.signature === 'string') {
          agent.signature = body.signature;
        }

        // Persist
        company.save();

        return NextResponse.json({
          data: {
            id: agent.id,
            name: agent.name,
            avatar: agent.avatar,
            gender: agent.gender,
            age: agent.age,
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

    // Check if the requested agent is the secretary
    const sec = company.secretary;
    if (sec && sec.id === agentId) {
      // Update profile fields for secretary
      if ('name' in body && typeof body.name === 'string' && body.name.trim()) {
        sec.name = body.name.trim();
      }
      if ('avatar' in body && typeof body.avatar === 'string') {
        sec.avatar = body.avatar;
      }
      if ('avatarParams' in body && body.avatarParams) {
        sec.avatarParams = body.avatarParams;
      }
      if ('gender' in body && (body.gender === 'male' || body.gender === 'female')) {
        sec.gender = body.gender;
      }
      if ('age' in body && typeof body.age === 'number' && body.age >= 18 && body.age <= 60) {
        sec.age = body.age;
      }
      if ('signature' in body && typeof body.signature === 'string') {
        sec.signature = body.signature;
      }
      if ('prompt' in body && typeof body.prompt === 'string') {
        sec.prompt = body.prompt;
      }
      if ('customPrompt' in body && typeof body.customPrompt === 'string') {
        sec.customPrompt = body.customPrompt;
      }
      // Switch provider for secretary
      if ('providerId' in body && body.providerId) {
        const newProvider = company.providerRegistry.getById(body.providerId);
        if (newProvider && newProvider.enabled) {
          const targetType = newProvider.isCLI ? 'cli' : newProvider.isWeb ? 'web' : 'llm';
          if (sec.agentType !== targetType) {
            if (newProvider.isCLI && newProvider.cliBackendId) {
              const fallback = company.providerRegistry.recommend('general');
              sec.agent = new CLIAgent({ cliBackend: newProvider.cliBackendId, cliProvider: newProvider, fallbackProvider: fallback, provider: fallback });
            } else if (newProvider.isWeb) {
              sec.agent = new WebAgent({ provider: newProvider });
              sec.agent.setEmployeeId(sec.id);
            } else {
              sec.agent = new LLMAgent({ provider: newProvider });
            }
          } else {
            sec.switchProvider(newProvider);
          }
        }
      }

      company.save();

      return NextResponse.json({
        data: {
          id: sec.id,
          name: sec.name,
          avatar: sec.avatar,
          gender: sec.gender,
          age: sec.age,
          provider: sec.getProviderDisplayInfo(),
          prompt: sec.prompt,
          customPrompt: sec.customPrompt || '',
          signature: sec.signature,
          personalityBio: sec.personalityBio || '',
          message: t('api.agentConfigUpdated'),
        },
      });
    }

    return NextResponse.json({ error: t('api.agentNotFound') }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
