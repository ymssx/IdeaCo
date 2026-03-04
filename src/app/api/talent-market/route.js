import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

export async function GET() {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });

  const market = company.talentMarket.listAvailable().map(p => ({
    id: p.id,
    name: p.name,
    role: p.role,
    skills: [...p.skills, ...p.acquiredSkills],
    acquiredSkills: p.acquiredSkills,
    dismissalReason: p.dismissalReason,
    performanceScore: p.performanceData?.averageScore,
    registeredAt: p.registeredAt,
    workHistory: p.workHistory,
    memoryCount: p.memorySnapshot
      ? (p.memorySnapshot.shortTerm?.length || 0) + (p.memorySnapshot.longTerm?.length || 0)
      : 0,
  }));

  return NextResponse.json({ data: market });
}
