import { getCompany } from '@/lib/store';
import { chatStore } from '@/core/agent/chat-store.js';
import { getApiT, getLanguageFromRequest } from '@/lib/api-i18n';
import { setAppLanguage } from '@/core/utils/app-language.js';
import { processSecretaryAction } from '../action-handler.js';

/**
 * SSE streaming endpoint for secretary chat.
 *
 * Events:
 *   - thinking: { content }  — chain-of-thought reasoning token
 *   - delta:    { content }  — incremental "content" field text
 *   - done:     { reply }    — final parsed reply (same shape as non-streaming POST /api/chat)
 *   - error:    { message }  — error occurred
 */
export async function POST(request) {
  const t = getApiT(request);
  setAppLanguage(getLanguageFromRequest(request));
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
  // (CLI backend, canChat() false, or handleBossMessageStream missing after HMR)
  if (!sec.canChat() || sec.cliBackend || typeof sec.handleBossMessageStream !== 'function') {
    try {
      // chatWithSecretary handles its own boss message + reply persistence
      const reply = await company.chatWithSecretary(message);

      // Process all action types even in non-streaming fallback
      processSecretaryAction(reply, message, company);

      // Return as a single SSE "done" event
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
  // (only for the streaming path — the fallback above uses chatWithSecretary which persists internally)
  const bossMsg = { role: 'boss', content: message, time: new Date() };
  company.chatHistory.push(bossMsg);
  chatStore.appendMessage(company.chatSessionId, bossMsg);

  // Create a ReadableStream that pushes SSE events
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const streamIterator = sec.handleBossMessageStream(message, company);
        // Verify the return value is async iterable before iterating
        if (!streamIterator || typeof streamIterator[Symbol.asyncIterator] !== 'function') {
          throw new Error('handleBossMessageStream did not return an async iterable');
        }
        for await (const chunk of streamIterator) {
          send(chunk.event, chunk.data);

          // When done, persist the secretary reply to chat history
          if (chunk.event === 'done' && chunk.data.reply) {
            const reply = chunk.data.reply;

            // Process all action types (secretary_handle, task_assigned, create_department, etc.)
            processSecretaryAction(reply, message, company);

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
          }
        }
      } catch (err) {
        console.error('❌ [Chat Stream] Error:', err.message);
        send('error', { message: err.message });
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
