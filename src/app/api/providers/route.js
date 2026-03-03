import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

export async function GET() {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: '请先创建公司' }, { status: 400 });
  return NextResponse.json({ data: company.getProviderDashboard() });
}
