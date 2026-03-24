import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { channelRegistry } from '@/core/channel/index.js';
import { WeixinChannel } from '@/core/channel/adapters/weixin.js';
import { getApiT, getLanguageFromRequest } from '@/lib/api-i18n';
import { setAppLanguage } from '@/core/utils/app-language.js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/channels/[channelId] - Get single channel details
 */
export async function GET(request, { params }) {
  const t = getApiT(request);
  setAppLanguage(getLanguageFromRequest(request));
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  const { channelId } = await params;
  const channel = channelRegistry.get(channelId);

  // For weixin channel, check web protocol and saved session status
  const extra = {};
  if (channelId === 'weixin') {
    try {
      extra.webProtocol = await WeixinChannel.checkWebProtocol();
      extra.savedSession = await WeixinChannel.checkSavedSession();
    } catch {
      extra.webProtocol = { available: false };
      extra.savedSession = { exists: false };
    }
  }

  // If channel is installed, return full status
  if (channel) {
    return NextResponse.json({
      data: { ...channel.getStatus(), ...extra },
    });
  }

  // If not installed but adapter is registered, return adapter info
  const adapters = channelRegistry.listAdapters();
  const adapterInfo = adapters.find(a => a.id === channelId);
  if (adapterInfo) {
    return NextResponse.json({
      data: { ...adapterInfo, state: 'not_installed', installed: false, ...extra },
    });
  }

  return NextResponse.json({ error: `Channel "${channelId}" not found` }, { status: 404 });
}

/**
 * PUT /api/channels/[channelId] - Configure / enable / disable a channel
 * Body: { action: 'configure' | 'enable' | 'disable', config?: object }
 */
export async function PUT(request, { params }) {
  const t = getApiT(request);
  setAppLanguage(getLanguageFromRequest(request));
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  const { channelId } = await params;

  try {
    const { action, config } = await request.json();

    // Allow 'install' action even if channel is not yet installed
    if (action === 'install') {
      if (channelRegistry.get(channelId)) {
        return NextResponse.json({ error: `Channel "${channelId}" is already installed` }, { status: 400 });
      }
      const channel = channelRegistry.install(channelId, config || {});
      return NextResponse.json({ data: channel.getStatus(), message: `Channel "${channel.name}" installed` });
    }

    let channel = channelRegistry.get(channelId);
    if (!channel) {
      // Check if adapter is registered but not installed
      const hasAdapter = channelRegistry.listAdapters().some(a => a.id === channelId);
      if (hasAdapter) {
        // For enable action, auto-install first (handles server restart / HMR losing in-memory state)
        if (action === 'enable') {
          channel = channelRegistry.install(channelId, config || {});
          console.log(`[API] Auto-installed channel "${channelId}" before enabling`);
        } else {
          return NextResponse.json(
            { error: `Channel "${channelId}" is registered but not installed. Use action "install" first.` },
            { status: 400 }
          );
        }
      } else {
        return NextResponse.json({ error: `Channel "${channelId}" not found` }, { status: 404 });
      }
    }

    switch (action) {
      case 'configure':
        if (!config) {
          return NextResponse.json({ error: 'config is required for configure action' }, { status: 400 });
        }
        channelRegistry.configure(channelId, config);
        return NextResponse.json({ data: channel.getStatus(), message: 'Channel configured' });

      case 'enable': {
        await channelRegistry.enable(channelId);
        // Include login status for WeChat (QR code URL + login state)
        const enableData = channel.getStatus();
        if (channelId === 'weixin' && channel.getLoginStatus) {
          enableData.loginStatus = channel.getLoginStatus();
        }
        return NextResponse.json({ data: enableData, message: 'Channel enabled' });
      }

      case 'disable':
        await channelRegistry.disable(channelId);
        return NextResponse.json({ data: channel.getStatus(), message: 'Channel disabled' });

      // WeChat-specific actions
      case 'check-protocol':
        if (channelId === 'weixin') {
          const result = await WeixinChannel.checkWebProtocol();
          return NextResponse.json({ data: result });
        }
        return NextResponse.json({ error: 'This action is only available for weixin channel' }, { status: 400 });

      case 'get-qrcode':
        if (channelId === 'weixin' && channel.getQRCodeUrl) {
          const qrUrl = channel.getQRCodeUrl();
          const loginState = channel.getLoginState();
          return NextResponse.json({ data: { qrCodeUrl: qrUrl, loginState } });
        }
        return NextResponse.json({ error: 'This action is only available for weixin channel' }, { status: 400 });

      case 'login-status':
        if (channelId === 'weixin' && channel.getLoginStatus) {
          return NextResponse.json({ data: channel.getLoginStatus() });
        }
        return NextResponse.json({ error: 'This action is only available for weixin channel' }, { status: 400 });

      default:
        return NextResponse.json({ error: `Unknown action: ${action}. Valid: configure, enable, disable, install, check-protocol, get-qrcode, login-status` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/channels/[channelId] - Uninstall a channel
 */
export async function DELETE(request, { params }) {
  const t = getApiT(request);
  setAppLanguage(getLanguageFromRequest(request));
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  const { channelId } = await params;

  try {
    await channelRegistry.uninstall(channelId);
    return NextResponse.json({ message: `Channel "${channelId}" uninstalled` });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
