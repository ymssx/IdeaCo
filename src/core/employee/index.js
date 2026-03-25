/**
 * Employee module — unified entry point.
 *
 * Class hierarchy:
 *   Employee (abstract base)  — base-employee.js
 *   ├── GeneralEmployee       — general-employee.js  (standard worker, has basic-operations skill)
 *   ├── Leader                — leader.js            (department head, has basic-operations skill)
 *   └── Secretary             — secretary.js         (boss's assistant, has management + basic-operations)
 *
 * External code imports from here. The factory functions (`createEmployee`,
 * `deserializeEmployee`) automatically pick the right concrete class.
 *
 * Usage:
 *   import { Employee, GeneralEmployee, Leader, Secretary, createEmployee } from './employee/index.js';
 */

import { Employee } from './base-employee.js';
import { GeneralEmployee } from './general-employee.js';
import { Leader } from './leader.js';
import { Secretary } from './secretary.js';
import { EmployeeLifecycle, InnerMonologue } from './lifecycle.js';
import { StaminaSystem } from './stamina.js';
import { EmployeeSkillSet } from './skill/skill-set.js';

/**
 * Create an Employee from a recruit config.
 *
 * All new employees are created as GeneralEmployee (with basic-operations skill).
 * Specialized roles (Secretary, Leader) are created through their own constructors
 * or via the `employeeClass` config hint.
 *
 * @param {object} config - Recruit config (from HR.recruit() or similar)
 * @param {string} [config.employeeClass] - Hint: 'leader' | 'secretary' | default 'general'
 * @returns {Employee}
 */
export function createEmployee(config) {
  const cls = (config.employeeClass || '').toLowerCase();
  if (cls === 'leader') {
    return new Leader(config);
  }
  // Default: GeneralEmployee (replaces raw Employee)
  return new GeneralEmployee(config);
}

/**
 * Deserialize an Employee from saved data.
 *
 * Routes to the correct concrete class based on the saved `employeeClass` field.
 * For backward compatibility, data without `employeeClass` defaults to GeneralEmployee.
 *
 * @param {object} data
 * @param {object} [providerRegistry]
 * @returns {Employee}
 */
export function deserializeEmployee(data, providerRegistry) {
  const employee = Employee.deserialize(data, providerRegistry);

  // Restore correct prototype based on saved employeeClass
  const cls = (data.employeeClass || '').toLowerCase();
  if (cls === 'leader') {
    Object.setPrototypeOf(employee, Leader.prototype);
    employee.employeeClass = 'leader';
  } else if (cls === 'secretary') {
    Object.setPrototypeOf(employee, Secretary.prototype);
    employee.employeeClass = 'secretary';
  } else {
    Object.setPrototypeOf(employee, GeneralEmployee.prototype);
  }

  return employee;
}

export { Employee, GeneralEmployee, Leader, Secretary, EmployeeLifecycle, InnerMonologue, StaminaSystem, EmployeeSkillSet };
