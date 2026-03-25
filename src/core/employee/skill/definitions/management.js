/**
 * Management Skills — Built-in skill definitions for company operations.
 */

import { SkillCategory } from '../constants.js';

export const managementSkills = [
  {
    id: 'company-management',
    name: 'Company Management',
    category: SkillCategory.MANAGEMENT,
    description: 'Company operations management: create departments, recruit staff, assign tasks to departments, design team structures, query organizational data, and track progress. This skill grants access to management tools.',
    body: `# Company Management Skill

You are authorized to perform company operations management.

## Management Tools Available
This skill grants you access to the following tools:
- **list_departments**: Get an overview of all departments
- **query_department**: Query detailed info about a specific department (members, status, leader)
- **create_department**: Create a new department with a designed team (use list_job_templates first to see available roles)
- **disband_department**: Dissolve a department (members go to talent market)
- **assign_task**: Assign a task to an existing department
- **list_talent_market**: See available talent for re-hiring
- **list_job_templates**: See available job role templates for team design

## Workflow (ALWAYS follow this — use real tool calls at each step)
1. Understand the intent (create department, assign task, adjust staffing, progress inquiry, or casual conversation)
2. For department creation: call list_job_templates → design team → call create_department
3. For task assignment: call list_departments → find matching dept → call assign_task
4. For staffing review: call query_department to inspect team composition
5. For progress inquiries: call query_department to gather status, then summarize

## Intent Classification (by priority)
- "create/establish/set up a department" → Call create_department tool (after list_job_templates)
- Complex professional tasks (coding, development, large projects) → Call assign_task tool
- Simple/personal tasks (lookups, calculations, quick research) → Handle it yourself with your other tools
- Progress/status inquiries → Call query_department / list_departments, then generate report
- Staffing questions → Call query_department, list_talent_market to gather info
- Casual chat → No tool needed

## Important Notes
- Always call list_job_templates before create_department to ensure valid template IDs
- When creating a department, design 2-6 members with the first being the leader (isLeader=true)
- Only use job templates whose category has an enabled AI provider`,
    requiredTools: [
      'query_department', 'list_departments', 'create_department',
      'disband_department', 'assign_task', 'list_talent_market', 'list_job_templates',
      'send_message',
    ],
    grantedPermissions: [
      'management.query_department',
      'management.list_departments',
      'management.create_department',
      'management.disband_department',
      'management.assign_task',
      'management.list_talent',
      'management.list_job_templates',
    ],
    // Currently only the secretary role can install this skill.
    // Will be opened to other roles (e.g. department leaders) in the future.
    restrictedTo: ['secretary'],
    tags: ['management', 'organization', 'hr', 'task-assignment', 'team-design'],
    icon: '🏢',
  },
];
