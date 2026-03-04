import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

export async function POST(request, { params }) {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });

  try {
    const { profileId } = await params;
    const { departmentId, newSkills } = await request.json();
    if (!departmentId) {
      return NextResponse.json({ error: 'Please select a target department' }, { status: 400 });
    }
    company.recallAgent(departmentId, profileId, newSkills || []);
    company._log('Recall talent', `Recalled employee from talent market`);
    return NextResponse.json({ success: true, data: company.getFullState() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
