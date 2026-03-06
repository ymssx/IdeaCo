import { NextResponse } from 'next/server';
import { resetCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';
import fs from 'fs';
import { DATA_DIR, WORKSPACE_DIR } from '@/lib/paths.js';

/**
 * POST /api/company/factory-reset
 * Nuclear option: wipe ALL data (company state, memories, chats, audit, workspace).
 * This is the "restart company" high-risk operation.
 */
export async function POST(request) {
  const t = getApiT(request);

  try {
    // 1. Reset in-memory company state + clear state files & memories
    resetCompany();

    // 2. Recursively remove the entire data directory (chats, audit, etc.)
    if (fs.existsSync(DATA_DIR)) {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
      console.log(`🗑️ Factory reset: removed DATA_DIR (${DATA_DIR})`);
    }

    // 3. Recursively remove the entire workspace directory
    if (fs.existsSync(WORKSPACE_DIR)) {
      fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
      console.log(`🗑️ Factory reset: removed WORKSPACE_DIR (${WORKSPACE_DIR})`);
    }

    // 4. Re-create the data directory so the app can restart cleanly
    fs.mkdirSync(DATA_DIR, { recursive: true });

    return NextResponse.json({
      success: true,
      message: t('api.factoryResetDone'),
      cleared: { dataDir: DATA_DIR, workspaceDir: WORKSPACE_DIR },
    });
  } catch (e) {
    console.error('❌ Factory reset failed:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
