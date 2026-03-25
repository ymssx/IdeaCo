import { getCompany } from '@/lib/store';
import { chatStore } from '@/core/agent/chat-store.js';
import { getApiT, getLanguageFromRequest } from '@/lib/api-i18n';
import { extractFieldFromPartialJSON } from '@/core/utils/json-parse.js';

/**
 * SSE streaming endpoint for secretary chat.
 *
 * Supports a full tool-call loop:
 * 1. Stream LLM response (sending delta/thinking events)
 * 2. Parse structured JSON — if actions[] is non-empty, execute tools
 * 3. Send tool_call SSE events so the frontend can show progress
 * 4. Feed tool results back to LLM and stream again (go to step 1)
 * 5. When actions[] is empty, send the final done event
 *
 * Events:
 *   - thinking:  { content }                          — chain-of-thought token
 *   - delta:     { content }                          — incremental "content" field text
 *   - tool_call: { tool, args, status, result, error } — tool execution progress
 *   - done:      { reply }                            — final parsed reply
 *   - error:     { message }                          — error occurred
 */
export async function POST(request) {
  const t = getApiT(request);
  const lang = getLanguageFromRequest(request);
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

  // If secretary can't chat (no provider configured), return error
  if (!sec.canChat()) {
    const encoder = new TextEncoder();
    const body = encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'Secretary has no AI provider configured.' })}\n\n`);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }

  // Persist the boss message before streaming starts
  const bossMsg = { role: 'boss', content: message, time: new Date() };
  company.chatHistory.push(bossMsg);
  chatStore.appendMessage(company.chatSessionId, bossMsg);

  // Build context — same as handleBossMessage but we drive the stream ourselves
  const { messages, bossChatGroupId } = sec._buildBossMessageContext(message, company, { lang });

  const streamOptions = {
    temperature: 0.8,
    maxTokens: 2048,
    contentExtractor: extractFieldFromPartialJSON,
  };

const MAX_TOOL_ITERATIONS = 999;

  // Create a ReadableStream that pushes SSE events
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Mutable conversation context for multi-turn tool loop
      const conversationMessages = [...messages];

      try {
        let finalReply = null;
        let consecutiveLLMErrors = 0;
        const MAX_LLM_ERRORS = 3;

        for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
          let fullRawContent = '';
          let llmError = null;

          // Wrap the ENTIRE iteration body so that any error (stream, parse, tool exec)
          // can be caught and fed back into the loop rather than crashing out.
          try {

          // Stream the LLM response — catch stream-level errors specifically
          try {
            for await (const chunk of sec.chatStream(conversationMessages, streamOptions)) {
              if (chunk.type === 'thinking') {
                send('thinking', { content: chunk.content });
              } else if (chunk.type === 'delta') {
                send('delta', { content: chunk.content });
              } else if (chunk.type === 'done') {
                fullRawContent = chunk.content || fullRawContent;
              }
            }
          } catch (streamErr) {
            llmError = streamErr.message || String(streamErr);
            console.error(`  ⚠️ [${sec.name}] LLM stream error (iteration ${iteration + 1}):`, llmError);
          }

          // If the LLM call itself failed, feed the error back so the model can adapt
          if (llmError) {
            consecutiveLLMErrors++;

            // If we've hit too many consecutive errors, bail out
            if (consecutiveLLMErrors >= MAX_LLM_ERRORS) {
              console.error(`  ❌ [${sec.name}] ${MAX_LLM_ERRORS} consecutive LLM errors, aborting.`);
              send('error', { message: llmError });
              break;
            }

            // Notify frontend about the LLM error (shown as a tool-call-like event)
            send('tool_call', { tool: '_llm_error', args: {}, status: 'error', error: llmError });

            // For context-overflow errors, aggressively trim the conversation
            const isContextOverflow = /context length|token/i.test(llmError);
            if (isContextOverflow) {
              // Aggressive trim: keep only system prompt + the last user message
              const systemMsg = conversationMessages[0];
              const lastUserMsg = [...conversationMessages].reverse().find(m => m.role === 'user' && !m.content.startsWith('[System Error]'));
              const trimmedBefore = conversationMessages.length;
              conversationMessages.length = 0;
              conversationMessages.push(systemMsg);
              if (lastUserMsg) conversationMessages.push(lastUserMsg);
              console.log(`  🔄 [${sec.name}] Trimmed conversation from ${trimmedBefore} to ${conversationMessages.length} messages (context overflow recovery)`);
            }

            // Append the error as a user message so the next LLM call sees it
            conversationMessages.push({
              role: 'user',
              content: `[System Error] The previous LLM call failed with the following error:\n${llmError}\n\nPlease adapt your response accordingly. If the error is about context length, try to provide a shorter response or summarize previous context. Return your response with an empty "actions" array if you cannot proceed.`,
            });

            // Reset streaming content on frontend for retry
            send('delta', { content: '', reset: true });
            continue;
          }

          // LLM call succeeded — reset consecutive error counter
          consecutiveLLMErrors = 0;

          // Parse the structured response
          const reply = sec.parseStructuredResponse(fullRawContent, bossChatGroupId);

          // If no actions requested, this is the final response
          if (!reply.actions || reply.actions.length === 0) {
            finalReply = reply;
            break;
          }

          // --- Tool call loop iteration ---
          // Append assistant message to conversation
          conversationMessages.push({
            role: 'assistant',
            content: fullRawContent,
          });

          // Execute each action and send progress events to frontend
          const toolResultTexts = [];
          for (const action of reply.actions) {
            const { tool, args } = action;
            if (!tool) continue;

            // Notify frontend: tool starting
            send('tool_call', { tool, args, status: 'start' });

            try {
              console.log(`  🔧 [${sec.name}] Stream tool: ${tool}(${JSON.stringify(args || {}).slice(0, 100)})`);
              const result = await sec.toolKit.execute(tool, args || {});
              console.log(`  ✅ [${sec.name}] Stream tool ${tool} completed`);

              const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
              toolResultTexts.push(`[Tool Result: ${tool}]\n${resultText}`);

              // Notify frontend: tool done
              send('tool_call', { tool, args, status: 'done', result: resultText.slice(0, 500) });
            } catch (err) {
              console.error(`  ❌ [${sec.name}] Stream tool ${tool} failed:`, err.message);
              toolResultTexts.push(`[Tool Result: ${tool}]\nTool execution error: ${err.message}`);

              // Notify frontend: tool error
              send('tool_call', { tool, args, status: 'error', error: err.message });
            }
          }

          // Feed tool results back to LLM for the next iteration
          conversationMessages.push({
            role: 'user',
            content: `The tool(s) you requested have been executed. Here are the results:\n\n${toolResultTexts.join('\n\n')}\n\nPlease review the tool results above and continue. If you need to call more tools, include them in your "actions" array. If all tasks are complete, return your final response with an empty "actions" array.`,
          });

          // Reset streaming content on frontend for the new iteration
          send('delta', { content: '', reset: true });

          } catch (iterationErr) {
            // Catch-all for any unexpected error within this iteration (parse errors, etc.)
            // Treat it the same way as an LLM error: feed it back into the loop
            const errMsg = iterationErr.message || String(iterationErr);
            console.error(`  ⚠️ [${sec.name}] Iteration ${iteration + 1} error (caught for recovery):`, errMsg);

            consecutiveLLMErrors++;
            if (consecutiveLLMErrors >= MAX_LLM_ERRORS) {
              console.error(`  ❌ [${sec.name}] ${MAX_LLM_ERRORS} consecutive errors, aborting.`);
              send('error', { message: errMsg });
              break;
            }

            send('tool_call', { tool: '_iteration_error', args: {}, status: 'error', error: errMsg });

            // For context-overflow errors, aggressively trim
            const isContextOverflow = /context length|token/i.test(errMsg);
            if (isContextOverflow) {
              const systemMsg = conversationMessages[0];
              const lastUserMsg = [...conversationMessages].reverse().find(m => m.role === 'user' && !m.content.startsWith('[System Error]'));
              conversationMessages.length = 0;
              conversationMessages.push(systemMsg);
              if (lastUserMsg) conversationMessages.push(lastUserMsg);
            }

            conversationMessages.push({
              role: 'user',
              content: `[System Error] An error occurred during this iteration:\n${errMsg}\n\nPlease adapt your response accordingly. Return your response with an empty "actions" array if you cannot proceed.`,
            });

            send('delta', { content: '', reset: true });
            continue;
          }
        }

        // If we exhausted iterations without a final reply, use the last one
        if (!finalReply) {
          // One final non-tool call to get summary
          const fallbackResponse = await sec.chat(conversationMessages, {
            temperature: 0.8,
            maxTokens: 2048,
          });
          finalReply = sec.parseStructuredResponse(fallbackResponse.content, bossChatGroupId);
        }

        // Send the final done event with parsed reply
        send('done', { reply: finalReply });

        const secretaryMsg = {
          role: 'secretary',
          content: finalReply.content,
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
