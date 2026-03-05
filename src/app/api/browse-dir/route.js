import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getApiT } from '@/lib/api-i18n';

/**
 * GET /api/browse-dir?path=xxx - List subdirectories at the given path
 * Without a path param, returns subdirectories in the user's home directory
 */
export async function GET(request) {
  const t = getApiT(request);
  try {
    const { searchParams } = new URL(request.url);
    const dirPath = searchParams.get('path') || os.homedir();

    // Safety check: ensure path exists and is a directory
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: t('api.pathNotExist') }, { status: 400 });
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: t('api.pathNotDirectory') }, { status: 400 });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: path.join(resolved, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      current: resolved,
      parent: path.dirname(resolved) !== resolved ? path.dirname(resolved) : null,
      dirs,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
