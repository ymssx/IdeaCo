import { groupChatLoop } from '@/core/organization/group-chat-loop.js';

/**
 * SSE endpoint for real-time monologue (flow) events.
 *
 * GET /api/group-chat-loop/events
 *
 * Pushes:
 *   - monologue:start  { agentId, agentName, groupId }
 *   - monologue:end    { agentId, agentName, groupId, decision, thoughtCount, thoughts, reason }
 *   - snapshot         (initial full state on connect)
 */
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* client disconnected */ }
      };

      // Send initial snapshot so client immediately knows who is thinking
      const snapshot = groupChatLoop.getActiveThinkingAgents();
      send('snapshot', snapshot);

      // Listen to lifecycle events
      const onStart = (data) => send('monologue:start', data);
      const onEnd = (data) => send('monologue:end', data);

      groupChatLoop.on('monologue:start', onStart);
      groupChatLoop.on('monologue:end', onEnd);

      // Keep-alive every 30s to prevent proxy/browser timeout
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 30000);

      // Cleanup when client disconnects
      const cleanup = () => {
        groupChatLoop.off('monologue:start', onStart);
        groupChatLoop.off('monologue:end', onEnd);
        clearInterval(keepAlive);
      };

      // AbortSignal isn't available here, but we detect enqueue failure above.
      // Store cleanup for the cancel() callback.
      controller._cleanup = cleanup;
    },
    cancel(controller) {
      controller?._cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
