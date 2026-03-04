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
            provider: { id: agent.provider.id, name: agent.provider.name, provider: agent.provider.provider },
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
          },
        });
      }
    }
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
