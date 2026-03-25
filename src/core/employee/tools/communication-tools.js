/**
 * Communication Tools — Inter-agent messaging tool.
 *
 * Provides the send_message tool for agents to communicate with
 * each other via the message bus.
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
        description: 'Send a message to another Agent in the team for collaboration, asking questions, sharing results, or requesting feedback. Use this to communicate with colleagues when you need their input or want to share your work output.',
        parameters: {
          type: 'object',
          properties: {
            targetAgentId: { type: 'string', description: 'Target Agent ID' },
            content: { type: 'string', description: 'Message content. You can mention colleagues with @Name format.' },
            type: { type: 'string', enum: ['task', 'question', 'report', 'review', 'feedback'], description: 'Message type' },
          },
          required: ['targetAgentId', 'content'],
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
    messageBus.send({
      from: agentId,
      to: args.targetAgentId,
      content: args.content,
      type: args.type || 'task',
    });
    return `Message sent to ${args.targetAgentId}`;
  });

  return handlers;
}
