import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

export async function POST(request, { params }) {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });

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
