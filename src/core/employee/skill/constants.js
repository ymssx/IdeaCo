/**
 * Skill System Constants — Shared enums and constants.
 *
 * Extracted from registry.js to break circular imports:
 * registry.js → definitions/*.js → registry.js (cycle!)
 *
 * Both registry.js and definitions/*.js now import from this file.
 */

/**
 * Skill states
 */
export const SkillState = {
  AVAILABLE: 'available',
  INSTALLED: 'installed',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
};

/**
 * Skill categories
 */
export const SkillCategory = {
  CODING: 'coding',
  ANALYSIS: 'analysis',
  CREATIVE: 'creative',
  COMMUNICATION: 'communication',
  AUTOMATION: 'automation',
  RESEARCH: 'research',
  DESIGN: 'design',
  DEVOPS: 'devops',
  MANAGEMENT: 'management',
};

/**
 * Skill sources — where the skill came from
 */
export const SkillSource = {
  BUILTIN: 'builtin',
  CUSTOM: 'custom',
  MARKETPLACE: 'marketplace',
};
