/**
 * Chat History Tools — Query chat records for employees.
 *
 * Provides the query_chat_history tool that allows employees to search
 * and retrieve their own chat history across DM sessions, group chats,
 * and boss chats. Supports filtering by target, time range, keyword, etc.
 */

import { chatStore } from '../../agent/chat-store.js';

// ======================== Tool Definitions ========================

/**
 * Get chat history tool definitions (OpenAI function calling format).
 * @returns {Array<object>}
 */
export function getChatHistoryToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'query_chat_history',
        description:
          'Query your chat history. You can search messages from a specific colleague (DM), a group chat, or your boss chat. '
          + 'Supports keyword search, time range filtering, and pagination. '
          + 'If no targetType is specified, searches across all your accessible sessions.',
        parameters: {
          type: 'object',
          properties: {
            targetType: {
              type: 'string',
              enum: ['dm', 'group', 'boss', 'all'],
              description:
                'Type of chat to query: "dm" for direct messages with a specific colleague, '
                + '"group" for a group/department chat, "boss" for your boss chat, '
                + '"all" to search across all your sessions. Default: "all"',
            },
            targetId: {
              type: 'string',
              description:
                'Target identifier. For "dm": the colleague\'s agent ID or name. '
                + 'For "group": the group chat ID (e.g. "dept-xxx", "req-xxx"). '
                + 'Not needed for "boss" or "all".',
            },
            keyword: {
              type: 'string',
              description: 'Search keyword to filter messages by content. Messages containing this keyword will be returned.',
            },
            after: {
              type: 'string',
              description: 'Only return messages after this time (ISO 8601 format, e.g. "2025-01-01T00:00:00Z").',
            },
            before: {
              type: 'string',
              description: 'Only return messages before this time (ISO 8601 format, e.g. "2025-12-31T23:59:59Z").',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of messages to return. Default: 20, max: 50.',
            },
          },
          required: [],
        },
      },
    },
  ];
}

// ======================== Tool Handler Factory ========================

/**
 * Create chat history tool handlers bound to an employee context.
 *
 * @param {object} context
 * @param {object} context.employee - Back-reference to the owning Employee
 * @returns {Map<string, function>} Tool name → async handler
 */
export function createChatHistoryToolHandlers(context) {
  const handlers = new Map();

  handlers.set('query_chat_history', async (args) => {
    const employee = context.employee;
    if (!employee) return 'Error: employee context not available';

    const agentId = employee.id;
    const company = employee.company;
    if (!company) return 'Error: company context not available';

    const targetType = args.targetType || 'all';
    const keyword = args.keyword || '';
    const afterTime = args.after ? new Date(args.after).getTime() : null;
    const beforeTime = args.before ? new Date(args.before).getTime() : null;
    const limit = Math.min(Math.max(args.limit || 20, 1), 50);

    // Resolve targetId: LLM may pass name instead of UUID
    let targetId = args.targetId || null;
    if (targetId && targetType === 'dm') {
      // Try to resolve name → ID
      const resolved = _resolveAgentId(company, targetId);
      if (resolved) targetId = resolved;
    }

    // Collect session IDs to search
    const sessionsToSearch = [];

    if (targetType === 'dm' || targetType === 'all') {
      if (targetType === 'dm' && targetId) {
        // Specific DM session
        const ids = [agentId, targetId].sort();
        sessionsToSearch.push({
          sessionId: `agent-agent-${ids[0]}-${ids[1]}`,
          label: _getAgentName(company, targetId),
          type: 'dm',
        });
      } else if (targetType === 'all') {
        // All DM sessions involving this agent
        const allSessions = chatStore.listSessions();
        for (const meta of allSessions) {
          if (meta.type !== 'agent-agent') continue;
          if (!meta.participants?.includes(agentId)) continue;
          const otherId = meta.participants.find(id => id !== agentId);
          sessionsToSearch.push({
            sessionId: meta.sessionId,
            label: _getAgentName(company, otherId),
            type: 'dm',
          });
        }
      }
    }

    if (targetType === 'group' || targetType === 'all') {
      if (targetType === 'group' && targetId) {
        // Specific group chat
        sessionsToSearch.push({
          sessionId: `group-${targetId}`,
          label: targetId,
          type: 'group',
        });
      } else if (targetType === 'all') {
        // All group chats this agent belongs to
        const groups = _getAgentGroups(company, agentId);
        for (const g of groups) {
          sessionsToSearch.push({
            sessionId: `group-${g.id}`,
            label: g.title,
            type: 'group',
          });
        }
      }
    }

    if (targetType === 'boss' || targetType === 'all') {
      // Boss chat session
      const isSecretary = company.secretary?.id === agentId;
      const bossSessionId = isSecretary
        ? (company.chatSessionId || `boss-secretary-${company.id}`)
        : `boss-agent-${agentId}`;
      sessionsToSearch.push({
        sessionId: bossSessionId,
        label: company.bossName || 'Boss',
        type: 'boss',
      });
    }

    if (sessionsToSearch.length === 0) {
      return 'No chat sessions found matching your query.';
    }

    // Search across all collected sessions
    const allResults = [];

    for (const session of sessionsToSearch) {
      let messages;

      if (keyword) {
        // Use keyword search
        messages = chatStore.searchMessages(session.sessionId, keyword, limit);
      } else {
        // Get recent messages
        messages = chatStore.getRecentMessages(session.sessionId, limit * 2);
      }

      // Apply time range filters
      if (afterTime || beforeTime) {
        messages = messages.filter(msg => {
          const msgTime = msg.time ? new Date(msg.time).getTime() : 0;
          if (afterTime && msgTime < afterTime) return false;
          if (beforeTime && msgTime > beforeTime) return false;
          return true;
        });
      }

      // Tag each message with session info
      for (const msg of messages) {
        allResults.push({
          ...msg,
          _sessionLabel: session.label,
          _sessionType: session.type,
          _sessionId: session.sessionId,
        });
      }
    }

    // Sort by time descending (most recent first)
    allResults.sort((a, b) => {
      const ta = a.time ? new Date(a.time).getTime() : 0;
      const tb = b.time ? new Date(b.time).getTime() : 0;
      return tb - ta;
    });

    // Trim to limit
    const finalResults = allResults.slice(0, limit);

    if (finalResults.length === 0) {
      const filters = [];
      if (keyword) filters.push(`keyword="${keyword}"`);
      if (args.after) filters.push(`after=${args.after}`);
      if (args.before) filters.push(`before=${args.before}`);
      if (targetId) filters.push(`target=${targetId}`);
      return `No messages found${filters.length > 0 ? ` matching filters: ${filters.join(', ')}` : ''}. Searched ${sessionsToSearch.length} session(s).`;
    }

    // Format output
    const lines = [`Found ${finalResults.length} message(s) (searched ${sessionsToSearch.length} session(s)):\n`];

    for (const msg of finalResults) {
      const time = msg.time ? new Date(msg.time).toLocaleString() : 'unknown time';
      const sender = msg.fromAgentName || msg.role || 'unknown';
      const sessionInfo = sessionsToSearch.length > 1 ? ` [${msg._sessionType}:${msg._sessionLabel}]` : '';
      const content = (msg.content || '').slice(0, 300);
      lines.push(`[${time}]${sessionInfo} ${sender}: ${content}`);
    }

    return lines.join('\n');
  });

  return handlers;
}

// ======================== Internal Helpers ========================

/**
 * Resolve agent name or ID to canonical agent ID.
 */
function _resolveAgentId(company, nameOrId) {
  if (!company) return null;
  const byId = company.findAgentById(nameOrId);
  if (byId) return byId.id;
  // Check boss
  if (company.boss?.id === nameOrId || company.boss?.name === nameOrId) return company.boss?.id;
  // Check secretary
  if (company.secretary?.name === nameOrId) return company.secretary.id;
  // Search all lifecycles
  const lifecycles = company.groupChatLoop?._lifecycles;
  if (lifecycles) {
    for (const [, lc] of lifecycles) {
      if (lc.employee?.name === nameOrId) return lc.employee.id;
    }
  }
  return null;
}

/**
 * Get display name for an agent by ID.
 */
function _getAgentName(company, agentId) {
  if (!agentId) return 'Unknown';
  if (company.boss?.id === agentId) return company.bossName || 'Boss';
  const agent = company.findAgentById(agentId);
  return agent?.name || agentId;
}

/**
 * Get all group chats an agent belongs to.
 */
function _getAgentGroups(company, agentId) {
  const groups = [];

  // Requirement work groups
  const requirements = company.requirementManager?.listAll() || [];
  for (const req of requirements) {
    if (req.status !== 'in_progress' && req.status !== 'planning') continue;
    const dept = company.findDepartment(req.departmentId);
    if (!dept || !dept.agents.has(agentId)) continue;
    groups.push({ id: req.id, title: req.title });
  }

  // Department general chat groups
  for (const dept of company.departments.values()) {
    if (!dept.agents.has(agentId)) continue;
    if (dept.status === 'disbanded') continue;
    groups.push({ id: `dept-${dept.id}`, title: `${dept.name} Department Chat` });
  }

  return groups;
}
