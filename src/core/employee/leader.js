import { Employee } from './base-employee.js';
import { EmployeeSkillSet } from './skill/skill-set.js';

/**
 * Leader — Department leader / team lead.
 *
 * Same as GeneralEmployee but with leadership-oriented positioning.
 * Only has **basic-operations** skill for now (more skills will be added later).
 */
export class Leader extends Employee {
  constructor(config) {
    const skillSet = new EmployeeSkillSet(config.name || 'leader', {
      enabledSkills: ['basic-operations'],
      pinnedSkills: ['basic-operations'],
    });

    super({ ...config, skillSet });
    this.employeeClass = 'leader';
  }
}
