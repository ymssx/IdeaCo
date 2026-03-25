import { Employee } from './base-employee.js';
import { EmployeeSkillSet } from './skill/skill-set.js';

/**
 * Secretary — A pre-configured Employee.
 *
 * The secretary is NOT a special class with unique logic. It is simply an
 * Employee created with:
 *   1. A specific role positioning (Personal Secretary)
 *   2. A default skill set (company-management)
 *
 * ALL capabilities come from the Employee base class:
 * - handleBossMessage() / _buildBossMessageContext() — boss 1-on-1 chat
 * - _buildSystemMessage() — identity, tools, skills, knowledge, language
 * - _buildBossChatResponseFormat() — structured JSON response format
 * - parseStructuredResponse() — memory/relationship processing
 * - initToolKit() — auto-registers management tools when company-management skill is present
 *
 * In the future, more pre-configured employees (e.g. CFO, CTO) will follow
 * this same pattern: constructor only, no custom methods.
 */
export class Secretary extends Employee {
  constructor({ company, providerConfig, secretaryName, secretaryAvatar, secretaryGender, secretaryAge }) {
    // Build a proper EmployeeSkillSet with company-management and basic-operations
    const skillSet = new EmployeeSkillSet('secretary', {
      enabledSkills: ['company-management', 'basic-operations'],
      pinnedSkills: ['company-management', 'basic-operations'],
    });

    super({
      name: secretaryName || 'Secretary',
      role: 'Personal Secretary',
      prompt: `You are the boss's personal secretary. Smart, efficient, approachable, and always ready to help.`,
      skillSet,
      provider: providerConfig,
      avatar: secretaryAvatar,
      gender: secretaryGender || 'female',
      age: secretaryAge || 18,
    });
    this.employeeClass = 'secretary';
  }
}
