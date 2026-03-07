import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { webClientRegistry } from '@/core/agent/web-agent/web-client.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/providers/[id]/refresh-cookie
 * Called by the frontend after obtaining a fresh cookie from Electron IPC.
 * Updates the provider's cookie in the server-side registry.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { cookie } = await request.json();

    if (!cookie) {
      return NextResponse.json({ ok: false, error: 'No cookie provided' }, { status: 400 });
    }

    // Update cookie in the web client registry
    webClientRegistry.configureCookie(id, cookie);

    // Also update provider config in company so it persists
    const company = getCompany();
    if (company) {
      const provider = company.providerRegistry.getById(id);
      if (provider && provider.isWeb) {
        provider.cookie = cookie;
        provider.enabled = true;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
