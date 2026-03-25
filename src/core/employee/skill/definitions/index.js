/**
 * Built-in Skill Definitions — Index
 *
 * Each file in this directory exports one or more skill definition configs.
 * This index collects them all into a single array for the SkillRegistry.
 *
 * To add a new built-in skill:
 * 1. Create a new .js file in this directory
 * 2. Export a skill config object (or array of configs) as default
 * 3. Import and spread it into the builtinSkillConfigs array below
 */

import { codingSkills } from './coding.js';
import { analysisSkills } from './analysis.js';
import { creativeSkills } from './creative.js';
import { communicationSkills } from './communication.js';
import { automationSkills } from './automation.js';
import { designSkills } from './design.js';
import { devopsSkills } from './devops.js';
import { managementSkills } from './management.js';

/**
 * All built-in skill configs, collected from individual definition files.
 * Each config is a plain object passed to `new SkillDefinition(config)`.
 */
export const builtinSkillConfigs = [
  ...codingSkills,
  ...analysisSkills,
  ...creativeSkills,
  ...communicationSkills,
  ...automationSkills,
  ...designSkills,
  ...devopsSkills,
  ...managementSkills,
];
