import { NextResponse } from 'next/server';
import { getCompany, setCompany, resetCompany } from '@/lib/store';
import { Company, setPromptLocale, getPromptLocaleCode } from '@/core/index.js';

export async function GET() {
  const company = getCompany();
  return NextResponse.json({ data: company ? company.getFullState() : null, promptLocale: getPromptLocaleCode() });
}

export async function POST(request) {
  try {
    const { companyName, bossName, secretaryConfig, promptLocale } = await request.json();
    if (!companyName) {
      return NextResponse.json({ error: 'Please enter company name' }, { status: 400 });
    }
    // Set prompt locale for AI employee chat (default: 'en')
    if (promptLocale) {
      setPromptLocale(promptLocale);
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

/**
 * PUT /api/company - Update company settings (e.g., boss avatar)
 */
export async function PUT(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }
  try {
    const body = await request.json();
    // Support prompt locale change via PUT
    if (body.promptLocale) {
      setPromptLocale(body.promptLocale);
    }
    if (typeof company.updateBossProfile !== 'function') {
      // Fallback: server might have a stale instance without this method, apply directly
      if (body.avatar) company.bossAvatar = body.avatar;
      const { saveState } = await import('@/core/persistence.js');
      saveState(company);
      return NextResponse.json({
        success: true,
        data: { bossAvatar: company.bossAvatar },
        fullState: company.getFullState(),
      });
    }
    const result = company.updateBossProfile(body);
    return NextResponse.json({
      success: true,
      data: result,
      fullState: company.getFullState(),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
