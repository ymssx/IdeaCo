/**
 * Employee Tool Pool — unified export for all tool modules.
 *
 * Tools live under employee/tools/ because they represent the concrete
 * "what tools exist" (the tool pool), while agent/tools.js (AgentToolKit)
 * represents the "how to use tools" capability/framework.
 *
 * Each tool module exports:
 * - Tool definitions (OpenAI function calling format)
 * - Tool handler factories (bound to runtime context like workspace, company)
 * - Permission constants (where applicable)
 * - A register function to plug tools into an AgentToolKit instance (where applicable)
 *
 * To add a new tool category:
 * 1. Create a new file (e.g. analytics-tools.js) in this directory
 * 2. Export definitions, handlers, and a register function
 * 3. Re-export from this index.js
 */

// File tools — file read, write, patch, delete, stats, list, mkdir
export { getFileToolDefinitions, createFileToolHandlers } from './file-tools.js';

// Search tools — grep, glob, file search, workspace files
export { getSearchToolDefinitions, createSearchToolHandlers } from './search-tools.js';

// Shell tools — shell command execution
export { getShellToolDefinitions, createShellToolHandlers } from './shell-tools.js';

// Communication tools — inter-agent messaging
export { getCommunicationToolDefinitions, createCommunicationToolHandlers } from './communication-tools.js';

// Skill tools — on-demand skill loading (L2 progressive disclosure)
export { getSkillToolDefinitions, createSkillToolHandlers } from './skill-tools.js';

// Discovery tools — progressive disclosure: inspect tool/skill details on demand
export { getDiscoveryToolDefinitions, createDiscoveryToolHandlers } from './discovery-tools.js';

// Management tools — company operations (departments, tasks, talent, etc.)
export {
  ManagementPermissions,
  ALL_MANAGEMENT_PERMISSIONS,
  getManagementToolDefinitions,
  createManagementToolHandlers,
  registerManagementTools,
} from './management-tools.js';

// Future tool modules will be exported here:
// export { ... } from './analytics-tools.js';
// export { ... } from './communication-tools.js';
