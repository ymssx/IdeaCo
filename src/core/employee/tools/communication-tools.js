/**
 * Communication Tools — Inter-agent messaging tool.
 *
 * Provides the send_message tool for agents to communicate with
 * each other via the message bus. Supports direct messages (DM),
 * group chat messages, and cross-channel communication.
 *
 * DM messages are written directly to chatStore (no messageBus relay).
 * Group messages still go through the messageBus for broadcast.
 */

import { chatStore } from '../../agent/chat-store.js';

// ======================== Tool Definitions ========================

/**
 * Get communication tool definitions (OpenAI function calling format).
 * @returns {Array<object>}
 */
export function getCommunicationToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'send_message',
        description: 'Send a message to a colleague (DM) or a group chat. Use "channel" to specify where: "dm" for private message to a specific agent, "group" to post in a group/department chat. Default is "dm".',
        parameters: {
          type: 'object',
          properties: {
            targetAgentId: { type: 'string', description: 'Target Agent ID (required for DM, optional for group — used as @mention)' },
            content: { type: 'string', description: 'Message content. You can mention colleagues with @Name format.' },
            channel: { type: 'string', enum: ['dm', 'group'], description: 'Message channel: "dm" for direct message, "group" for group chat. Default: "dm"' },
            groupId: { type: 'string', description: 'Group/department chat ID (required when channel is "group")' },
            type: { type: 'string', enum: ['task', 'question', 'report', 'review', 'feedback', 'chat'], description: 'Message type' },
            needsReply: { type: 'boolean', description: 'Mark this message as requiring a reply (use sparingly — only when you have a task depending on the answer). Default: false' },
          },
          required: ['content'],
        },
      },
    },
  ];
}

// ======================== Shared DM Helper ========================

/**
 * Send a direct message between two agents.
 * This is the single source of truth for DM message writing.
 * Both the send_message tool handler and lifecycle._processDM use this.
 *
 * @param {object} opts
 * @param {string} opts.fromAgentId - Sender agent ID
 * @param {string} opts.fromAgentName - Sender display name
 * @param {string} opts.toAgentId - Recipient agent ID
 * @param {string} opts.toAgentName - Recipient display name
 * @param {string} opts.content - Message content
 * @returns {{ sessionId: string, record: object }} The session ID and the appended message record
 */
export function sendDirectMessage({ fromAgentId, fromAgentName, toAgentId, toAgentName, content }) {
  const ids = [fromAgentId, toAgentId].sort();
  const sessionId = `agent-agent-${ids[0]}-${ids[1]}`;

  chatStore.createSession(sessionId, {
    title: `${fromAgentName} & ${toAgentName}`,
    participants: [fromAgentId, toAgentId],
    type: 'agent-agent',
  });

  const record = chatStore.appendMessage(sessionId, {
    role: 'agent',
    content,
    time: new Date(),
    fromAgentId,
    fromAgentName,
    toAgentId,
    toAgentName,
  });

  console.log(`  📨 [DM] ${fromAgentName} → ${toAgentName}: "${(content || '').slice(0, 60)}"`);
  return { sessionId, record };
}

// ======================== Tool Handler Factory ========================

/**
 * Create communication tool handlers bound to a message bus context.
 *
 * @param {object} context
 * @param {object} context.messageBus - Message bus reference
 * @param {string} context.agentId - Current Agent's ID
 * @returns {Map<string, function>} Tool name → async handler
 */
export function createCommunicationToolHandlers(context) {
  // NOTE: Do NOT destructure agentId / agentName from context here!
  // They are dynamic getters that return the employee's CURRENT id/name.
  // Destructuring would capture the value at creation time (stale after ID restoration).
  const { messageBus, resolveAgentId, findAgent } = context;
  const handlers = new Map();

  handlers.set('send_message', async (args) => {
    // Read agentId/agentName dynamically on each call
    const agentId = context.agentId;
    const agentName = context.agentName;

    if (!messageBus) {
      return 'Error: message bus not initialized';
    }

    const channel = args.channel || 'dm';
    const msgType = args.type || 'task';

    // Resolve targetAgentId: LLM may pass name instead of UUID
    const rawTargetId = args.targetAgentId;
    let targetAgentId = rawTargetId;
    if (targetAgentId && resolveAgentId) {
      const resolved = resolveAgentId(targetAgentId);
      if (!resolved) {
        return `Error: Agent "${rawTargetId}" not found. Please check the agent ID or name and try again. Use the correct agent ID from your colleague list.`;
      }
      targetAgentId = resolved;
    }

    if (channel === 'group') {
      if (!args.groupId) {
        return 'Error: groupId is required when channel is "group"';
      }
      messageBus.send({
        from: agentId,
        to: args.groupId,
        content: args.content,
        type: msgType,
        channel: 'group',
        mention: targetAgentId || null,
      });
      return `Message posted to group ${args.groupId}${targetAgentId ? ` (mentioning ${targetAgentId})` : ''}`;
    }

    // Default: DM — use the shared sendDirectMessage helper
    if (!targetAgentId) {
      return 'Error: targetAgentId is required for direct messages. Please provide the target agent ID or name.';
    }

    const senderAgent = findAgent ? findAgent(agentId) : null;
    const targetAgent = findAgent ? findAgent(targetAgentId) : null;
    const senderName = senderAgent?.name || agentName || agentId;
    const targetName = targetAgent?.name || targetAgentId;

    sendDirectMessage({
      fromAgentId: agentId,
      fromAgentName: senderName,
      toAgentId: targetAgentId,
      toAgentName: targetName,
      content: args.content,
    });

    return `Direct message sent to ${targetName}${args.needsReply ? ' (reply requested)' : ''}`;
  });

  return handlers;
}
