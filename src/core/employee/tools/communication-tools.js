/**
 * Communication Tools — Inter-agent messaging tool.
 *
 * Provides the send_message tool for agents to communicate with
 * each other via the message bus. Supports direct messages (DM),
 * group chat messages, and cross-channel communication.
 *
 * Extracted from AgentToolKit to live in the employee tool pool.
 */

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
          },
          required: ['content'],
        },
      },
    },
  ];
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
  const { messageBus, agentId } = context;
  const handlers = new Map();

  handlers.set('send_message', async (args) => {
    if (!messageBus) {
      return 'Error: message bus not initialized';
    }

    const channel = args.channel || 'dm';
    const msgType = args.type || 'task';

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
        mention: args.targetAgentId || null,
      });
      return `Message posted to group ${args.groupId}${args.targetAgentId ? ` (mentioning ${args.targetAgentId})` : ''}`;
    }

    // Default: DM
    if (!args.targetAgentId) {
      return 'Error: targetAgentId is required for direct messages';
    }
    messageBus.send({
      from: agentId,
      to: args.targetAgentId,
      content: args.content,
      type: msgType,
      channel: 'dm',
    });
    return `Direct message sent to ${args.targetAgentId}`;
  });

  return handlers;
}
