/**
 * Discovery Tools — Tool & Skill detail inspection.
 *
 * Provides get_tool_detail and get_skill_detail tools so agents can
 * inspect the full parameter schema of any registered tool or the full
 * instructions of any installed skill on demand.
 *
 * This enables progressive disclosure: the system prompt only shows
 * brief summaries for non-core tools/skills, and the agent loads
 * details when needed.
 */

import { skillRegistry } from '../skill/registry.js';

// ======================== Tool Definitions ========================

/**
 * Get discovery tool definitions (OpenAI function calling format).
 * @returns {Array<object>}
 */
export function getDiscoveryToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'get_tool_detail',
        description: 'View the full parameter schema and usage details of a specific tool by name. Use this when you see a tool listed in your brief tool catalog and need to know its exact parameters before calling it.',
        parameters: {
          type: 'object',
          properties: {
            toolName: { type: 'string', description: 'The exact tool name to inspect (e.g. "file_patch", "grep_search")' },
          },
          required: ['toolName'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_skill_detail',
        description: 'View the full instructions and workflow of a specific skill by its ID. Use this when you see a skill in your skill list and need to understand its detailed workflow before applying it.',
        parameters: {
          type: 'object',
          properties: {
            skillId: { type: 'string', description: 'The skill ID to inspect' },
          },
          required: ['skillId'],
        },
      },
    },
  ];
}

// ======================== Tool Handler Factory ========================

/**
 * Create discovery tool handlers.
 *
 * @param {object} context
 * @param {object} context.employee - Back-reference to the owning Employee (for toolKit access)
 * @returns {Map<string, function>} Tool name → async handler
 */
export function createDiscoveryToolHandlers(context) {
  const { employee } = context;
  const handlers = new Map();

  handlers.set('get_tool_detail', async (args) => {
    const toolName = args.toolName || args.tool_name || args.name;
    if (!toolName) throw new Error('Missing required parameter: toolName');

    if (!employee?.toolKit) {
      return 'Error: No toolKit available.';
    }

    const defs = employee.toolKit.definitions;
    const def = defs.find(d => d.function?.name === toolName);
    if (!def) {
      return `Error: Tool "${toolName}" not found. Available tools: ${defs.map(d => d.function?.name).filter(Boolean).join(', ')}`;
    }

    const fn = def.function;
    let detail = `## ${fn.name}\n${fn.description || '(no description)'}\n`;

    const params = fn.parameters;
    if (params && params.properties && Object.keys(params.properties).length > 0) {
      const required = new Set(params.required || []);
      detail += `\nParameters:\n`;
      for (const [name, schema] of Object.entries(params.properties)) {
        const req = required.has(name) ? '(required)' : '(optional)';
        const type = schema.type || 'any';
        const desc = schema.description || '';

        if (type === 'array' && schema.items) {
          const itemProps = schema.items.properties;
          if (itemProps) {
            detail += `  - ${name}: array ${req} — ${desc}\n`;
            detail += `    Item fields:\n`;
            for (const [k, v] of Object.entries(itemProps)) {
              const itemReq = (schema.items.required || []).includes(k) ? '(required)' : '(optional)';
              detail += `      - ${k}: ${v.type || 'any'} ${itemReq} — ${v.description || ''}\n`;
            }
          } else {
            detail += `  - ${name}: array ${req} — ${desc}\n`;
          }
        } else if (type === 'object' && schema.properties) {
          detail += `  - ${name}: object ${req} — ${desc}\n`;
          for (const [k, v] of Object.entries(schema.properties)) {
            detail += `    - ${k}: ${v.type || 'any'} — ${v.description || ''}\n`;
          }
        } else {
          let line = `  - ${name}: ${type} ${req} — ${desc}`;
          if (schema.enum) line += ` (values: ${schema.enum.join(', ')})`;
          detail += line + '\n';
        }
      }
    } else {
      detail += `\nParameters: (none)\n`;
    }

    return detail;
  });

  handlers.set('get_skill_detail', async (args) => {
    const skillId = args.skillId || args.skill_id || args.id;
    if (!skillId) throw new Error('Missing required parameter: skillId');

    const entry = skillRegistry.get(skillId);
    if (!entry) {
      return `Error: Skill "${skillId}" not found.`;
    }

    const def = entry.definition;
    const body = def.getBody();
    let detail = `## Skill: ${def.name} (${def.id})\n`;
    detail += `Category: ${def.category} | Author: ${def.author}\n`;
    if (def.requiredTools.length > 0) {
      detail += `Required tools: ${def.requiredTools.join(', ')}\n`;
    }
    detail += `\n${body}`;

    return detail;
  });

  return handlers;
}
