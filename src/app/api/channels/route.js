import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { channelRegistry } from '@/core/channel/index.js';
import { WeixinChannel } from '@/core/channel/adapters/weixin.js';
import { getApiT } from '@/lib/api-i18n';

export const dynamic = 'force-dynamic';

/**
 * GET /api/channels - List all channels (installed + available adapters)
 */
export async function GET(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  return NextResponse.json({
    data: {
      adapters: channelRegistry.listAdapters(),
      channels: channelRegistry.list(),
      stats: channelRegistry.getStats(),
    },
  });
}

/**
 * POST /api/channels - Install a channel
 * Body: { adapterId: string, config?: object }
 */
export async function POST(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  try {
    const { adapterId, config } = await request.json();
    if (!adapterId) {
      return NextResponse.json({ error: 'adapterId is required' }, { status: 400 });
    }

    const channel = channelRegistry.install(adapterId, config || {});
    return NextResponse.json({
      data: channel.getStatus(),
      message: `Channel "${channel.name}" installed successfully`,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
