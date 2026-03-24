import { getCompany } from '@/lib/store';
import { chatStore } from '@/core/agent/chat-store.js';
import { getApiT, getLanguageFromRequest } from '@/lib/api-i18n';
import { setAppLanguage } from '@/core/utils/app-language.js';
import { processSecretaryAction } from '../action-handler.js';
import { extractFieldFromPartialJSON } from '@/core/utils/json-parse.js';

/**
 * SSE streaming endpoint for secretary chat.
 *
 * The secretary is just an Employee with a different prompt — streaming is
 * a generic capability provided by Employee.chatStream(). The secretary
 * enables the `contentExtractor` option to extract the "content" field
 * from its structured JSON response in real-time, so the frontend sees
 * clean text instead of raw JSON fragments.
 *
 * Events:
 *   - thinking: { content }  — chain-of-thought reasoning token
 *   - delta:    { content }  — incremental "content" field text
 *   - done:     { reply }    — final parsed reply (same shape as non-streaming POST /api/chat)
 *   - error:    { message }  — error occurred
 */
export async function POST(request) {
  const t = getApiT(request);
  const lang = getLanguageFromRequest(request);
  setAppLanguage(lang);
  const company = getCompany();
  if (!company) {
    return new Response(JSON.stringify({ error: t('api.noCompany') }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  let message;
  try {
    const body = await request.json();
    message = body.message;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!message) {
    return new Response(JSON.stringify({ error: t('api.messageRequired') }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const sec = company.secretary;

  // Fall back to non-streaming if secretary doesn't support streaming
  // (CLI backend, canChat() false, etc.)
  if (!sec.canChat() || sec.cliBackend) {
    try {
      const reply = await company.chatWithSecretary(message, { lang });
      processSecretaryAction(reply, message, company, { lang });

      const encoder = new TextEncoder();
      const body = encoder.encode(`event: done\ndata: ${JSON.stringify({ reply })}\n\n`);
      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (err) {
      const encoder = new TextEncoder();
      const body = encoder.encode(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      return new Response(body, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }
  }

  // Persist the boss message before streaming starts
  const bossMsg = { role: 'boss', content: message, time: new Date() };
  company.chatHistory.push(bossMsg);
  chatStore.appendMessage(company.chatSessionId, bossMsg);

  // Build context — same as handleBossMessage but we drive the stream ourselves
  const { messages, secretaryChatGroupId } = sec._buildBossMessageContext(message, company, { lang });

  // The contentExtractor enables real-time JSON "content" field extraction at the
  // Employee/Agent layer — this is the "switch" the secretary turns on.
  const streamOptions = {
    temperature: 0.8,
    maxTokens: 2048,
    contentExtractor: extractFieldFromPartialJSON,
  };

  // Create a ReadableStream that pushes SSE events
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let fullRawContent = '';

      try {
        // Stream using the base Employee.chatStream() with contentExtractor
        for await (const chunk of sec.chatStream(messages, streamOptions)) {
          if (chunk.type === 'thinking') {
            send('thinking', { content: chunk.content });
          } else if (chunk.type === 'delta') {
            send('delta', { content: chunk.content });
          } else if (chunk.type === 'done') {
            fullRawContent = chunk.content || fullRawContent;
          }
        }

        let reply = sec.parseStructuredResponse(fullRawContent, secretaryChatGroupId);

        // Progressive disclosure: query_department → re-stream with details
        if (reply.action?.type === 'query_department' && reply.action.departmentId) {
          const dept = company.departments.get(reply.action.departmentId);
          if (dept) {
            const memberList = [...dept.agents.values()].map(a =>
              `  - ${a.name} (${a.role}) [status: ${a.status || 'active'}]`
            ).join('\n');
            const deptInfo = `Department "${dept.name}" members:\n${memberList}`;

            messages.push(
              { role: 'assistant', content: fullRawContent },
              { role: 'user', content: `[System: Department query result]\n${deptInfo}\n\nNow please respond to the boss's original message with this information.` }
            );

            fullRawContent = '';
            for await (const chunk of sec.chatStream(messages, streamOptions)) {
              if (chunk.type === 'thinking') {
                send('thinking', { content: chunk.content });
              } else if (chunk.type === 'delta') {
                send('delta', { content: chunk.content });
              } else if (chunk.type === 'done') {
                fullRawContent = chunk.content || fullRawContent;
              }
            }
            reply = sec.parseStructuredResponse(fullRawContent, secretaryChatGroupId);
          }
        }

        // Send the final done event with parsed reply
        send('done', { reply });

        // Process action and persist
        processSecretaryAction(reply, message, company, { lang });

        const secretaryMsg = {
          role: 'secretary',
          content: reply.content,
          action: reply.action || null,
          time: new Date(),
        };
        company.chatHistory.push(secretaryMsg);
        chatStore.appendMessage(company.chatSessionId, secretaryMsg);

        if (company.chatHistory.length > 50) {
          company.chatHistory = company.chatHistory.slice(-50);
        }
        company.save();
      } catch (err) {
        console.error('❌ [Chat Stream] Error:', err.message);

        // Try to salvage partial content
        if (fullRawContent.length > 0) {
          try {
            const reply = sec.parseStructuredResponse(fullRawContent, secretaryChatGroupId);
            send('done', { reply });
          } catch {
            send('error', { message: err.message });
          }
        } else {
          send('error', { message: err.message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
