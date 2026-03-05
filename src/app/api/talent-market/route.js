import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';

export async function GET(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });

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
