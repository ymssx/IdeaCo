import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

export async function POST(request, { params }) {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: '请先创建公司' }, { status: 400 });

  try {
    const { id } = await params;
    const { apiKey } = await request.json();
    const provider = company.configureProvider(id, apiKey);
    return NextResponse.json({
      success: true,
      data: { id: provider.id, name: provider.name, enabled: provider.enabled },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
