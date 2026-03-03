import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/secretary - 获取秘书当前设置
 */
export async function GET() {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: '请先创建公司' }, { status: 400 });
  }

  const agent = company.secretary.agent;
  return NextResponse.json({
    data: {
      name: agent.name,
      avatar: agent.avatar,
      prompt: agent.prompt,
      signature: agent.signature,
      provider: agent.provider.name,
      tokenUsage: agent.tokenUsage,
    },
  });
}

/**
 * PUT /api/secretary - 更新秘书设置
 * Body: { name?, avatar?, prompt?, signature? }
 */
export async function PUT(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: '请先创建公司' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const settings = {};
    if (body.name) settings.name = body.name;
    if (body.avatar) settings.avatar = body.avatar;
    if (body.prompt !== undefined) settings.prompt = body.prompt;
    if (body.signature) settings.signature = body.signature;
    if (body.providerId) settings.providerId = body.providerId;

    if (Object.keys(settings).length === 0) {
      return NextResponse.json({ error: '请提供至少一项要修改的设置' }, { status: 400 });
    }

    const result = company.updateSecretarySettings(settings);
    return NextResponse.json({
      success: true,
      data: result,
      fullState: company.getFullState(),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
