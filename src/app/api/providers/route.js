import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';

export async function GET(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });

  return NextResponse.json({ data: company.getProviderDashboard() });
}
