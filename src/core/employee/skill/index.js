/**
 * Skill system barrel exports.
 *
 * Centralizes all skill-related modules under one directory:
 *   - registry.js   → SkillRegistry, built-in definitions, enums
 *   - skill-set.js  → EmployeeSkillSet (per-employee skill state)
 *   - custom.js     → CustomSkillManager (user-authored SKILL.md)
 *   - marketplace.js → SkillMarketplace (ClawHub integration)
 */

export {
  SkillRegistry,
  skillRegistry,
  SkillDefinition,
  SkillCategory,
  SkillState,
  SkillSource,
  parseSkillMarkdown,
} from './registry.js';

export { EmployeeSkillSet } from './skill-set.js';

export { CustomSkillManager, customSkillManager } from './custom.js';

export { SkillMarketplace, skillMarketplace } from './marketplace.js';
