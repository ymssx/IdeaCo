/**
 * CLI Backends API - Manage CLI backends (detect, register, configure)
 */
import { NextResponse } from 'next/server';
import { cliBackendRegistry } from '@/core/agent/cli-agent/backends/index.js';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';

/**
 * GET /api/system/cli-backends
 * Get all CLI backend statuses
 */
export async function GET() {
  try {
    const backends = cliBackendRegistry.listAll();
    return NextResponse.json({ data: backends });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/system/cli-backends
 * CLI backend management operations
 * 
 * Actions:
 * - detect: detect all CLIs
 * - detectOne: detect a single CLI
 * - register: register a custom CLI
 * - unregister: remove a custom CLI
 */
export async function POST(request) {
  const t = getApiT(request);
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'detect': {
        const results = await cliBackendRegistry.detectAll();
        // Sync detected CLI backends into provider registry
        const company = getCompany();
        if (company) {
          company.providerRegistry.syncCLIBackends(cliBackendRegistry);
        }
        return NextResponse.json({ data: results });
      }

      case 'detectOne': {
        const { backendId } = body;
        if (!backendId) {
          return NextResponse.json({ error: t('api.missingBackendId') }, { status: 400 });
        }
        const result = await cliBackendRegistry.detect(backendId);
        return NextResponse.json({ data: { id: backendId, ...result } });
      }

      case 'register': {
        const { config } = body;
        if (!config || !config.id || !config.execCommand) {
          return NextResponse.json({ error: t('api.cliConfigRequired') }, { status: 400 });
        }
        const registered = cliBackendRegistry.register(config);
        // Detect immediately after registration
        await cliBackendRegistry.detect(registered.id);
        // Sync to provider registry
        const company2 = getCompany();
        if (company2) {
          company2.providerRegistry.syncCLIBackends(cliBackendRegistry);
        }
        const backends = cliBackendRegistry.listAll();
        return NextResponse.json({ data: backends });
      }

      case 'unregister': {
        const { backendId } = body;
        if (!backendId) {
          return NextResponse.json({ error: t('api.missingBackendId') }, { status: 400 });
        }
        cliBackendRegistry.unregister(backendId);
        const backends = cliBackendRegistry.listAll();
        return NextResponse.json({ data: backends });
      }

      default:
        return NextResponse.json({ error: t('api.pluginUnknownAction', { action }) }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
