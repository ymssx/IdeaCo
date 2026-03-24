import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT, getLanguageFromRequest } from '@/lib/api-i18n';
import { setAppLanguage } from '@/core/utils/app-language.js';
import { processSecretaryAction, runningTasks } from './action-handler.js';

export async function POST(request) {
  const t = getApiT(request);
  const lang = getLanguageFromRequest(request);
  setAppLanguage(lang);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }
  try {
    const { message } = await request.json();
    if (!message) {
      return NextResponse.json({ error: t('api.messageRequired') }, { status: 400 });
    }
    const reply = await company.chatWithSecretary(message, { lang });

    // Process all action types (create_department, secretary_handle, task_assigned, etc.)
    processSecretaryAction(reply, message, company, { lang });

    return NextResponse.json({
      success: true,
      data: {
        reply,
        chatHistory: company.chatHistory.slice(-30),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  // Support task status queries
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');

  if (taskId) {
    const taskState = runningTasks.get(taskId);
    if (!taskState) {
      return NextResponse.json({ data: { status: 'unknown' } });
    }
    return NextResponse.json({ data: taskState });
  }

  return NextResponse.json({
    data: company.chatHistory.slice(-50),
  });
}
