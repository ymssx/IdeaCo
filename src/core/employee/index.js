/**
 * Employee module — unified entry point.
 *
 * External code imports from here. Employees are the business-layer entities
 * that hold identity, memory, skills, org structure, and delegate communication
 * to their internal Agent (LLMAgent or CLIAgent).
 *
 * Usage:
 *   import { Employee, createEmployee, Secretary } from './employee/index.js';
 */

import { Employee } from './base-employee.js';
import { Secretary, HRAssistant } from './secretary.js';
import { EmployeeLifecycle, InnerMonologue } from './lifecycle.js';
import { StaminaSystem } from './stamina.js';

/**
 * Create an Employee from a recruit config.
 * @param {object} config - Recruit config (from HR.recruit() or similar)
 * @returns {Employee}
 */
export function createEmployee(config) {
  return new Employee(config);
}

/**
 * Deserialize an Employee from saved data.
 * @param {object} data
 * @param {object} [providerRegistry]
 * @returns {Employee}
 */
export function deserializeEmployee(data, providerRegistry) {
  return Employee.deserialize(data, providerRegistry);
}

export { Employee, Secretary, HRAssistant, EmployeeLifecycle, InnerMonologue, StaminaSystem };
