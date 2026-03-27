/**
 * Management Tools — Company operations tools for the management skill.
 *
 * These tools are NOT part of the base AgentToolKit. They are registered
 * dynamically when an employee has the `company-management` skill enabled.
 * Each tool requires a specific permission granted by the skill.
 *
 * Architecture:
 * - Skill (`company-management`) grants permissions via `grantedPermissions`
 * - AgentToolKit filters tool visibility by employee permissions
 * - Tool execution also validates permissions (defense in depth)
 * - Tool handlers need a `company` reference, injected via factory function
 */

import { JobTemplates } from '../../organization/workforce/hr.js';

// ======================== Permission Constants ========================

export const ManagementPermissions = {
  QUERY_DEPARTMENT: 'management.query_department',
  LIST_DEPARTMENTS: 'management.list_departments',
  CREATE_DEPARTMENT: 'management.create_department',
  DISBAND_DEPARTMENT: 'management.disband_department',
  ASSIGN_TASK: 'management.assign_task',
  LIST_TALENT: 'management.list_talent',
  LIST_JOB_TEMPLATES: 'management.list_job_templates',
};

/**
 * All management permissions as a flat array.
 * Used by the company-management skill's `grantedPermissions`.
 */
export const ALL_MANAGEMENT_PERMISSIONS = Object.values(ManagementPermissions);

// ======================== Tool Definitions ========================

/**
 * Get all management tool definitions (OpenAI function calling format).
 * These are static and do not depend on company state.
 *
 * @returns {Array<{definition: object, permission: string, name: string}>}
 */
export function getManagementToolDefinitions() {
  return [
    {
      name: 'query_department',
      permission: ManagementPermissions.QUERY_DEPARTMENT,
      definition: {
        type: 'function',
        function: {
          name: 'query_department',
          description: 'Query detailed information about a specific department, including its member list with roles and status. Use this when you need to know who is in a department before assigning tasks or reporting.',
          parameters: {
            type: 'object',
            properties: {
              departmentId: { type: 'string', description: 'The department ID to query' },
            },
            required: ['departmentId'],
          },
        },
      },
    },
    {
      name: 'list_departments',
      permission: ManagementPermissions.LIST_DEPARTMENTS,
      definition: {
        type: 'function',
        function: {
          name: 'list_departments',
          description: 'List all departments in the company with their basic info (name, mission, status, member count, leader). Use this to get an overview of the organizational structure.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
    },
    {
      name: 'create_department',
      permission: ManagementPermissions.CREATE_DEPARTMENT,
      definition: {
        type: 'function',
        function: {
          name: 'create_department',
          description: 'Create a new department with a team of employees. You must design the team composition using available job templates. The first member should be the project leader (isLeader=true). Use list_job_templates first to see available roles.',
          parameters: {
            type: 'object',
            properties: {
              departmentName: { type: 'string', description: 'Name for the new department' },
              mission: { type: 'string', description: 'Department mission / goal description' },
              members: {
                type: 'array',
                description: 'Team members to recruit (2-6 people). First member should be the leader.',
                items: {
                  type: 'object',
                  properties: {
                    templateId: { type: 'string', description: 'Job template ID from list_job_templates' },
                    name: { type: 'string', description: 'Nickname for this employee' },
                    isLeader: { type: 'boolean', description: 'Whether this person is the department leader' },
                    reportsTo: {
                      type: ['integer', 'null'],
                      description: 'Index of the manager in this members array (null for the leader, 0 for direct report to leader)',
                    },
                    reason: { type: 'string', description: 'Why this role is needed for the department mission' },
                  },
                  required: ['templateId', 'name'],
                },
              },
            },
            required: ['departmentName', 'mission', 'members'],
          },
        },
      },
    },
    {
      name: 'disband_department',
      permission: ManagementPermissions.DISBAND_DEPARTMENT,
      definition: {
        type: 'function',
        function: {
          name: 'disband_department',
          description: 'Disband an existing department. All members will be dismissed and enter the talent market. Use this when a department is no longer needed.',
          parameters: {
            type: 'object',
            properties: {
              departmentId: { type: 'string', description: 'ID of the department to disband' },
              reason: { type: 'string', description: 'Reason for disbanding' },
            },
            required: ['departmentId'],
          },
        },
      },
    },
    {
      name: 'assign_task',
      permission: ManagementPermissions.ASSIGN_TASK,
      definition: {
        type: 'function',
        function: {
          name: 'assign_task',
          description: 'Assign a task to an existing department. The department leader will decompose it into subtasks and distribute to team members. Use list_departments or query_department first to find the right department.',
          parameters: {
            type: 'object',
            properties: {
              departmentId: { type: 'string', description: 'Target department ID' },
              taskTitle: { type: 'string', description: 'Short task title' },
              taskDescription: { type: 'string', description: 'Detailed task description and requirements' },
            },
            required: ['departmentId', 'taskTitle', 'taskDescription'],
          },
        },
      },
    },
    {
      name: 'list_talent_market',
      permission: ManagementPermissions.LIST_TALENT,
      definition: {
        type: 'function',
        function: {
          name: 'list_talent_market',
          description: 'List available talent in the talent market (previously dismissed employees who can be re-hired). Shows their name, role, skills, and previous performance.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
    },
    {
      name: 'list_job_templates',
      permission: ManagementPermissions.LIST_JOB_TEMPLATES,
      definition: {
        type: 'function',
        function: {
          name: 'list_job_templates',
          description: 'List all available job templates that can be used when creating departments. Shows template ID, title, and category. You need this to know valid templateId values for create_department.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
    },
  ];
}

// ======================== Tool Handler Factory ========================

/**
 * Create management tool handlers bound to a specific company instance.
 * Returns a Map of tool name → async handler function.
 *
 * @param {object} company - The Company instance
 * @returns {Map<string, function>} Tool name → handler
 */
export function createManagementToolHandlers(company) {
  const handlers = new Map();

  handlers.set('query_department', async (args) => {
    const deptId = args.departmentId || args.department_id || args.id;
    if (!deptId) throw new Error('Missing required parameter: departmentId');
    const dept = company.departments.get(deptId);
    if (!dept) {
      const available = [...company.departments.keys()].join(', ') || '(none)';
      return `Department "${deptId}" not found. Available departments: ${available}`;
    }
    const memberList = [...dept.agents.values()].map(a =>
      `  - ${a.name} (${a.role}) [status: ${a.status || 'active'}]`
    ).join('\n');
    return `Department "${dept.name}" (id: ${dept.id})\nMission: ${dept.mission}\nStatus: ${dept.status}\nLeader: ${dept.getLeader()?.name || 'Unassigned'}\nMembers (${dept.agents.size}):\n${memberList}`;
  });

  handlers.set('list_departments', async () => {
    if (company.departments.size === 0) {
      return 'No departments exist yet. Use create_department to create one.';
    }
    const depts = [...company.departments.values()].map(d => {
      const leader = d.getLeader();
      return `- ${d.name} (id: ${d.id}) [${d.status}]\n  Mission: ${d.mission}\n  Members: ${d.agents.size} | Leader: ${leader?.name || 'Unassigned'}`;
    });
    return `Company departments (${company.departments.size}):\n${depts.join('\n')}`;
  });

  handlers.set('create_department', async (args) => {
    const { departmentName, mission, members } = args;
    if (!departmentName) throw new Error('Missing required parameter: departmentName');
    if (!mission) throw new Error('Missing required parameter: mission');
    if (!members || !Array.isArray(members) || members.length === 0) {
      throw new Error('Missing required parameter: members (must be a non-empty array)');
    }

    const dept = await company.createDepartmentDirect({
      departmentName,
      mission,
      members,
    });

    const memberSummary = dept.getMembers().map(a => `  - ${a.name} (${a.role})`).join('\n');
    return `Department "${dept.name}" created successfully (id: ${dept.id})\nMembers (${dept.agents.size}):\n${memberSummary}\n\nThe team is ready and awaiting tasks.`;
  });

  handlers.set('disband_department', async (args) => {
    const deptId = args.departmentId || args.department_id || args.id;
    if (!deptId) throw new Error('Missing required parameter: departmentId');
    const reason = args.reason || 'Management decision';

    const dept = company.departments.get(deptId);
    if (!dept) throw new Error(`Department "${deptId}" not found`);
    const deptName = dept.name;
    const memberCount = dept.agents.size;

    company.disbandDepartment(deptId, reason);
    return `Department "${deptName}" has been disbanded. ${memberCount} members have been moved to the talent market. Reason: ${reason}`;
  });

  handlers.set('assign_task', async (args) => {
    const { departmentId, taskTitle, taskDescription } = args;
    const deptId = departmentId || args.department_id;
    if (!deptId) throw new Error('Missing required parameter: departmentId');
    if (!taskTitle) throw new Error('Missing required parameter: taskTitle');
    if (!taskDescription) throw new Error('Missing required parameter: taskDescription');

    const dept = company.departments.get(deptId);
    if (!dept) throw new Error(`Department "${deptId}" not found`);

    const result = await company.assignTaskToDepartment(deptId, taskDescription, taskTitle);
    return `Task "${taskTitle}" has been assigned to department "${dept.name}".\nRequirement ID: ${result.requirementId}\n\nThe department leader is now analyzing the requirement and will decompose it into subtasks. The team will start working on it shortly. You can track progress via the requirement detail page.`;
  });

  handlers.set('list_talent_market', async () => {
    const available = company.talentMarket.listAvailable();
    if (available.length === 0) {
      return 'The talent market is empty — no available talent for re-hire.';
    }
    const talents = available.map(t => {
      const perf = t.performanceHistory?.length > 0
        ? ` | Avg score: ${Math.round(t.performanceHistory.reduce((s, p) => s + p.score, 0) / t.performanceHistory.length)}`
        : '';
      return `- ${t.name} (${t.role}) [${t.skills?.join(', ') || 'no skills'}]${perf}`;
    });
    return `Talent market (${available.length} available):\n${talents.join('\n')}`;
  });

  handlers.set('list_job_templates', async () => {
    const templates = Object.values(JobTemplates).map(t =>
      `- ${t.id}: ${t.title} [${t.category}]`
    );
    return `Available job templates (${templates.length}):\n${templates.join('\n')}\n\nUse these templateId values when designing team members for create_department.`;
  });

  return handlers;
}

/**
 * Register all management tools into an AgentToolKit instance.
 * Called when an employee with the management skill initializes their toolKit.
 *
 * @param {import('../../agent/tools.js').AgentToolKit} toolKit - The employee's tool kit
 * @param {object} company - The Company instance
 */
export function registerManagementTools(toolKit, company) {
  const definitions = getManagementToolDefinitions();
  const handlers = createManagementToolHandlers(company);

  for (const toolDef of definitions) {
    const handler = handlers.get(toolDef.name);
    if (handler) {
      toolKit.registerTool(toolDef.name, toolDef.definition, handler, toolDef.permission);
    }
  }
}
