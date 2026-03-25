import { Employee } from './base-employee.js';
import { EmployeeSkillSet } from './skill/skill-set.js';

/**
 * GeneralEmployee — The standard concrete Employee class.
 *
 * Every "regular" employee (non-secretary, non-leader) is a GeneralEmployee.
 * It extends the abstract Employee base class with the **basic-operations**
 * skill (pinned) — file ops, shell, search.
 *
 * All employee creation goes through GeneralEmployee, Leader, or Secretary.
 */
export class GeneralEmployee extends Employee {
  constructor(config) {
    const skillSet = new EmployeeSkillSet(config.name || 'employee', {
      enabledSkills: ['basic-operations'],
      pinnedSkills: ['basic-operations'],
    });

    super({ ...config, skillSet });
  }
}
