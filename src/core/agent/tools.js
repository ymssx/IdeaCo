/**
 * Agent Tool System — Framework for agent tool execution.
 *
 * This module provides the AgentToolKit class, which is the framework/engine
 * that agents use to discover and execute tools. It does NOT define tools
 * itself — tool definitions and handlers live in the employee tool pool
 * (employee/tools/).
 *
 * Responsibilities:
 * - Collect tool definitions from employee/tools/ modules
 * - Manage custom tools registered at runtime (e.g. management tools)
 * - Enforce workspace sandboxing (_safePath)
 * - Enforce permission-based tool visibility/execution
 * - Integrate with plugin system and security audit
 * - Route tool calls to the appropriate handler
 */

import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { securityGuard } from '../system/audit.js';
import { pluginRegistry, HookPoint } from '../system/plugin.js';
import { skillRegistry } from '../employee/skill/registry.js';

// Import tool definitions and handler factories from the employee tool pool
import { getFileToolDefinitions, createFileToolHandlers } from '../employee/tools/file-tools.js';
import { getSearchToolDefinitions, createSearchToolHandlers } from '../employee/tools/search-tools.js';
import { getShellToolDefinitions, createShellToolHandlers } from '../employee/tools/shell-tools.js';
import { getCommunicationToolDefinitions, createCommunicationToolHandlers } from '../employee/tools/communication-tools.js';
import { getSkillToolDefinitions, createSkillToolHandlers } from '../employee/tools/skill-tools.js';
import { getDiscoveryToolDefinitions, createDiscoveryToolHandlers } from '../employee/tools/discovery-tools.js';

/**
 * Agent Tool Kit — Each Agent instance holds one ToolKit.
 * Tool operations are restricted to the specified workspace directory.
 *
 * The toolkit acts as a pure framework: it loads tool definitions and handlers
 * from employee/tools/ modules, manages permission filtering, and routes
 * tool calls through security audit and plugin hooks.
 */
export class AgentToolKit {
  /**
   * @param {string} workspaceDir - Agent's workspace root directory
   * @param {object} messageBus - Message bus reference
   * @param {string} agentId - Current Agent's ID
   * @param {string} agentName - Current Agent's display name
   * @param {object} [employee] - Back-reference to the owning Employee (for memory access)
   */
  constructor(workspaceDir, messageBus = null, agentId = null, agentName = '', employee = null) {
    this.workspaceDir = workspaceDir;
    this.messageBus = messageBus;
    this.agentId = agentId;
    this.agentName = agentName;
    this.employee = employee;

    // Custom tools registered at runtime (e.g. management tools via skills)
    this._customTools = new Map(); // name → { definition, handler, requiredPermission }

    // Ensure workspace directory exists
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
    }

    // Build the base tool handler map from employee/tools/ modules.
    // Each module's createXxxHandlers() returns a Map<name, handler>.
    // IMPORTANT: agentId / agentName are read dynamically from the employee
    // object, NOT captured at construction time. This is critical because
    // the employee's ID may be restored to a different value after
    // deserialization (e.g. secretary ID restoration).
    const toolContext = {
      workspaceDir,
      safePath: (fp) => this._safePath(fp),
      // Dynamic getters — always return the employee's CURRENT id/name
      get agentId() { return employee?.id ?? agentId; },
      get agentName() { return employee?.name ?? agentName; },
      messageBus,
      // Find agent by ID (for looking up agent names in DM)
      findAgent: (id) => {
        if (!employee) return null;
        return employee.company?.findAgentById(id) ?? null;
      },
      // Resolve agent name → agentId (LLM sometimes passes name instead of UUID)
      resolveAgentId: (nameOrId) => {
        if (!employee) return nameOrId;
        const company = employee.company;
        if (!company) return nameOrId;
        // Check by ID first (unified lookup)
        const byId = company.findAgentById(nameOrId);
        if (byId) return byId.id;
        // Check boss by ID/name
        if (company.boss?.id === nameOrId || company.boss?.name === nameOrId) return company.boss.id;
        // Fallback: search by name across all lifecycles (covers all employees)
        // IMPORTANT: return employee.id (the canonical ID), NOT the lifecycle map key,
        // because the map key may be stale after ID restoration during deserialization.
        const lifecycles = company.groupChatLoop?._lifecycles;
        if (lifecycles) {
          for (const [id, lc] of lifecycles) {
            if (lc.employee?.name === nameOrId) return lc.employee.id;
          }
        }
        return null; // not found
      },
    };

    this._baseHandlers = new Map();
    const handlerSources = [
      createFileToolHandlers(toolContext),
      createSearchToolHandlers(toolContext),
      createShellToolHandlers(toolContext),
      createCommunicationToolHandlers(toolContext),
      createSkillToolHandlers(),
      createDiscoveryToolHandlers({ employee }),
    ];
    for (const handlerMap of handlerSources) {
      for (const [name, handler] of handlerMap) {
        this._baseHandlers.set(name, handler);
      }
    }
  }

  /**
   * Register a custom tool at runtime.
   * Used to inject context-specific tools (e.g. management tools)
   * without polluting the base tool set.
   *
   * @param {string} name - Tool name
   * @param {object} definition - OpenAI function calling format definition
   * @param {function} handler - async (args) => result
   * @param {string} [requiredPermission] - Permission string required to see/execute this tool (null = no restriction)
   */
  registerTool(name, definition, handler, requiredPermission = null) {
    this._customTools.set(name, { definition, handler, requiredPermission });
  }

  /**
   * Get the set of permissions the owning employee currently has.
   * Permissions are accumulated from enabled skills.
   * @returns {Set<string>}
   */
  _getEmployeePermissions() {
    if (!this.employee?.skillSet) return new Set();
    return this.employee.skillSet.getPermissions(skillRegistry);
  }

  /**
   * Path resolution: resolve relative paths against workspace root.
   * Absolute paths are returned as-is.
   */
  _safePath(filePath) {
    return path.resolve(this.workspaceDir, filePath);
  }

  /**
   * Get tool definitions in OpenAI function calling format.
   * Collects definitions from all tool pool modules, plugins, and custom tools.
   */
  get definitions() {
    // Base tool definitions from employee/tools/ modules
    const baseDefs = [
      ...getFileToolDefinitions(),
      ...getSearchToolDefinitions(),
      ...getShellToolDefinitions(),
      ...getCommunicationToolDefinitions(),
      ...getSkillToolDefinitions(),
      ...getDiscoveryToolDefinitions(),
    ];

    // Employee permission set for filtering restricted tools
    const employeePerms = this._getEmployeePermissions();

    return [
      ...baseDefs,
      // Include tools from enabled plugins
      ...pluginRegistry.getPluginTools(),
      // Include custom tools registered at runtime (filtered by permission)
      ...[...this._customTools.values()]
        .filter(t => !t.requiredPermission || employeePerms.has(t.requiredPermission))
        .map(t => t.definition),
    ];
  }

  /**
   * Execute a tool call.
   * Routes to the appropriate handler from the base handler map,
   * custom tools, or plugin tools.
   *
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments
   * @returns {Promise<string>} Tool execution result
   */
  async execute(name, args) {
    // Parameter safety check
    if (!args || typeof args !== 'object') {
      args = {};
    }

    // Security audit: log all tool calls
    securityGuard.logToolCall(name, args, this.agentId, this.agentName);

    // Fire plugin hooks: before tool call
    await pluginRegistry.fireHook(HookPoint.BEFORE_TOOL_CALL, {
      toolName: name, args, agentId: this.agentId, agentName: this.agentName,
    });

    let result;

    // 1. Try base tool handlers (from employee/tools/ modules)
    const baseHandler = this._baseHandlers.get(name);
    if (baseHandler) {
      result = await baseHandler(args);
    }
    // 2. Try custom registered tools (e.g. management tools)
    else if (this._customTools.has(name)) {
      const customTool = this._customTools.get(name);
      // Permission check (defense in depth): even if the tool was visible,
      // re-validate at execution time to prevent privilege escalation.
      if (customTool.requiredPermission) {
        const perms = this._getEmployeePermissions();
        if (!perms.has(customTool.requiredPermission)) {
          throw new Error(`Permission denied: tool "${name}" requires "${customTool.requiredPermission}" permission.`);
        }
      }
      result = await customTool.handler(args);
    }
    // 3. Try plugin tools
    else {
      const pluginTools = pluginRegistry.getPluginTools();
      const hasPluginTool = pluginTools.some(t => t.function?.name === name);
      if (hasPluginTool) {
        result = await pluginRegistry.executePluginTool(name, args);
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
    }

    // Fire plugin hooks: after tool call
    await pluginRegistry.fireHook(HookPoint.AFTER_TOOL_CALL, {
      toolName: name, args, result, agentId: this.agentId, agentName: this.agentName,
    });

    return result;
  }
}
