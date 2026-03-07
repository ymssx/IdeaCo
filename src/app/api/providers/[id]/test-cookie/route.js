import { NextResponse } from 'next/server';
import { webClientRegistry } from '@/core/agent/web-agent/web-client.js';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { cookie } = await request.json();

    if (!cookie) {
      return NextResponse.json({ ok: false, error: 'No cookie provided' }, { status: 400 });
    }

    // Temporarily set the cookie to test
    webClientRegistry.configureCookie(id, cookie);
    const result = await webClientRegistry.testConnection(id);

    // If test failed, clear the cookie
    if (!result.ok) {
      webClientRegistry.configureCookie(id, '');
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
