import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

export async function GET(request) {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: '请先创建公司' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '20');

  return NextResponse.json({ data: company.getRecentMessages(limit) });
}
