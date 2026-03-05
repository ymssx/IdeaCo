import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * GET /api/browse-dir?path=xxx - 列出指定路径下的子目录
 * 不传 path 则返回用户 home 目录下的子目录
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const dirPath = searchParams.get('path') || os.homedir();

    // 安全检查：确保路径存在且是目录
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: 'Path does not exist' }, { status: 400 });
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
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
