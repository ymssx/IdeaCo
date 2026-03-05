/**
 * CLI Backends API - 管理 CLI 后端（检测、注册、配置）
 */
import { NextResponse } from 'next/server';
import { cliBackendRegistry } from '@/core/cli-backends/index.js';
import { getCompany } from '@/lib/store';

/**
 * GET /api/system/cli-backends
 * 获取所有 CLI 后端状态
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
 * CLI 后端管理操作
 * 
 * Actions:
 * - detect: 检测所有 CLI
 * - detectOne: 检测单个 CLI
 * - register: 注册自定义 CLI
 * - unregister: 移除自定义 CLI
 */
export async function POST(request) {
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
          return NextResponse.json({ error: 'Missing backendId' }, { status: 400 });
        }
        const result = await cliBackendRegistry.detect(backendId);
        return NextResponse.json({ data: { id: backendId, ...result } });
      }

      case 'register': {
        const { config } = body;
        if (!config || !config.id || !config.execCommand) {
          return NextResponse.json({ error: 'Config requires at least id and execCommand' }, { status: 400 });
        }
        const registered = cliBackendRegistry.register(config);
        // 注册后立即检测
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
          return NextResponse.json({ error: 'Missing backendId' }, { status: 400 });
        }
        cliBackendRegistry.unregister(backendId);
        const backends = cliBackendRegistry.listAll();
        return NextResponse.json({ data: backends });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
