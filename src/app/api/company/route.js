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
      return NextResponse.json({ error: '请输入公司名称' }, { status: 400 });
    }
    const company = new Company(companyName, bossName || '老板', {
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
 * DELETE /api/company - 重置公司（清除持久化数据）
 */
export async function DELETE() {
  resetCompany();
  return NextResponse.json({ success: true, message: '公司已解散，所有数据已清除' });
}
