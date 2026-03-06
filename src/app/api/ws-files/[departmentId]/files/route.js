import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

/**
 * GET /api/ws-files/[departmentId]/files?path=subPath
 * List workspace files (shallow, one level)
 */
export async function GET(request, { params }) {
  try {
    const company = getCompany();
    if (!company) return NextResponse.json({ error: 'No company' }, { status: 400 });

    const { departmentId } = await params;
    const url = new URL(request.url);
    const subPath = url.searchParams.get('path') || '';

    const files = await company.getShallowWorkspaceFiles(departmentId, subPath);
    return NextResponse.json({ data: files });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
