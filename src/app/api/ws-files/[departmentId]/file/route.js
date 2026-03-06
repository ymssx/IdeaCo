import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

/**
 * GET /api/ws-files/[departmentId]/file?path=filePath
 * Read a single workspace file content
 */
export async function GET(request, { params }) {
  try {
    const company = getCompany();
    if (!company) return NextResponse.json({ error: 'No company' }, { status: 400 });

    const { departmentId } = await params;
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    const content = await company.readWorkspaceFile(departmentId, filePath);
    return NextResponse.json({ data: { path: filePath, content } });
  } catch (e) {
    const status = e.code === 'ENOENT' ? 404 : e.code === 'EACCES' ? 403 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
