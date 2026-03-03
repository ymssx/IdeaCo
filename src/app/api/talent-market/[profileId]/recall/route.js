import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

export async function POST(request, { params }) {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: '请先创建公司' }, { status: 400 });

  try {
    const { profileId } = await params;
    const { departmentId, newSkills } = await request.json();
    if (!departmentId) {
      return NextResponse.json({ error: '请选择目标部门' }, { status: 400 });
    }
    company.recallAgent(departmentId, profileId, newSkills || []);
    company._log('召回人才', `从人才市场召回员工`);
    return NextResponse.json({ success: true, data: company.getFullState() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
