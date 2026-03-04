import { NextResponse } from 'next/server';
import { pluginRegistry } from '@/core/plugin.js';

/**
 * GET /api/system/plugins - List all plugins
 */
export async function GET() {
  try {
    return NextResponse.json({ data: pluginRegistry.list() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/system/plugins - Manage plugins
 * Actions: enable, disable
 */
export async function POST(request) {
  try {
    const { action, pluginId } = await request.json();
    if (!pluginId) {
      return NextResponse.json({ error: 'Missing pluginId' }, { status: 400 });
    }
    switch (action) {
      case 'enable':
        pluginRegistry.enable(pluginId);
        return NextResponse.json({ data: { success: true } });
      case 'disable':
        pluginRegistry.disable(pluginId);
        return NextResponse.json({ data: { success: true } });
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
