import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';

export async function POST(request, { params }) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });

  try {
    const { id } = await params;
    const { apiKey, baseURL } = await request.json();
    
    // Prepare options for custom OpenAI providers
    const options = {};
    if (baseURL) {
      options.baseURL = baseURL;
    }
    
    const provider = company.configureProvider(id, apiKey, options);
    return NextResponse.json({
      success: true,
      data: { 
        id: provider.id, 
        name: provider.name, 
        enabled: provider.enabled,
        hasKey: !!provider.apiKey,
        baseURL: provider.baseURL || ''
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
