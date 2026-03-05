import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';

export async function POST(request, { params }) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });

  try {
    const { profileId } = await params;
    const { departmentId, newSkills } = await request.json();
    if (!departmentId) {
      return NextResponse.json({ error: t('api.targetDeptRequired') }, { status: 400 });
    }
    company.recallAgent(departmentId, profileId, newSkills || []);
    company._log('Recall talent', `Recalled employee from talent market`);
    return NextResponse.json({ success: true, data: company.getFullState() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
