import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/secretary - Get current secretary settings
 */
export async function GET() {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
  }

  const agent = company.secretary.agent;
  return NextResponse.json({
    data: {
      name: agent.name,
      avatar: agent.avatar,
      gender: agent.gender,
      age: agent.age,
      prompt: agent.prompt,
      signature: agent.signature,
      provider: agent.provider.name,
      tokenUsage: agent.tokenUsage,
    },
  });
}

/**
 * PUT /api/secretary - Update secretary settings
 * Body: { name?, avatar?, prompt?, signature? }
 */
export async function PUT(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: 'Please create a company first' }, { status: 400 });
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
      return NextResponse.json({ error: 'Please provide at least one setting to modify' }, { status: 400 });
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
