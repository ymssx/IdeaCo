import { NextResponse } from 'next/server';
import { getCompany, setCompany, resetCompany } from '@/lib/store';
import { Company } from '@/core/index.js';

export async function GET() {
  const company = getCompany();
  return NextResponse.json({ data: company ? company.getFullState() : null });
}

export async function POST(request) {
  try {
    const { companyName, bossName, secretaryConfig } = await request.json();
    if (!companyName) {
      return NextResponse.json({ error: 'Please enter company name' }, { status: 400 });
    }
    const company = new Company(companyName, bossName || 'Boss', {
      ...secretaryConfig,
      secretaryName: secretaryConfig?.secretaryName,
      secretaryAvatar: secretaryConfig?.secretaryAvatar,
    });
    setCompany(company);
    return NextResponse.json({ success: true, data: company.getFullState() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/company - Reset company (clear persisted data)
 */
export async function DELETE() {
  resetCompany();
  return NextResponse.json({ success: true, message: 'Company dissolved, all data cleared' });
}
