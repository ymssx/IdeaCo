/**
 * Skill Tools — Skill loading tool.
 *
 * Provides the load_skill tool for agents to load full SKILL.md
 * instructions on demand (L2 progressive disclosure).
 *
 * Extracted from AgentToolKit to live in the employee tool pool.
 */

import { skillRegistry } from '../skill/registry.js';

// ======================== Tool Definitions ========================

/**
 * Get skill tool definitions (OpenAI function calling format).
 * @returns {Array<object>}
 */
export function getSkillToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'load_skill',
        description: 'Load the full instructions (SKILL.md body) for a specific skill by its ID. Use this when you see <available_skills> in your system prompt and determine a skill applies to the current task. Returns the detailed workflow and best practices for that skill.',
        parameters: {
          type: 'object',
          properties: {
            skillId: { type: 'string', description: 'The skill ID from the <id> field in <available_skills>' },
          },
          required: ['skillId'],
        },
      },
    },
  ];
}

// ======================== Tool Handler Factory ========================

/**
 * Create skill tool handlers.
 *
 * @returns {Map<string, function>} Tool name → async handler
 */
export function createSkillToolHandlers() {
  const handlers = new Map();

  handlers.set('load_skill', async (args) => {
    const skillId = args.skillId || args.skill_id || args.id;
    if (!skillId) throw new Error('Missing required parameter: skillId');

    const body = skillRegistry.loadSkillBody(skillId);
    // Skill→Tool linkage: include required tools metadata in the result
    // so that ToolLoop can auto-escalate tiers when a skill is loaded.
    const entry = skillRegistry.get(skillId);
    const requiredTools = entry?.definition?.requiredTools || [];
    if (requiredTools.length > 0) {
      return `${body}\n\n<!-- skill_required_tools: ${JSON.stringify(requiredTools)} -->`;
    }
    return body;
  });

  return handlers;
}
