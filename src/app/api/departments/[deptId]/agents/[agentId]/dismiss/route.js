import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';

export async function POST(request, { params }) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });

  try {
    const { deptId, agentId } = await params;
    const { reason } = await request.json();
    company.dismissAgent(deptId, agentId, reason || 'Dismissed by boss');
    company._log('Dismiss employee', `Employee dismissed`);
    return NextResponse.json({ success: true, data: company.getFullState() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
