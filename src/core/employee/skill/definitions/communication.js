/**
 * Communication Skills — Built-in skill definitions for teamwork and coordination.
 */

import { SkillCategory } from '../constants.js';

export const communicationSkills = [
  {
    id: 'project-management',
    name: 'Project Management',
    category: SkillCategory.COMMUNICATION,
    description: 'Plan, track, and coordinate project tasks and timelines',
    body: `# Project Management Skill

## Workflow
1. Break down project into workstreams and tasks
2. Define dependencies and critical path
3. Assign tasks based on team skills and capacity
4. Track progress with evidence-based status updates
5. Identify and mitigate risks proactively
6. Coordinate cross-functional communication

## Best Practices
- Define clear acceptance criteria for each task
- Maximize parallel execution — do not serialize independent tasks
- Demand evidence of completion, not just verbal status
- Escalate blockers early with proposed solutions
- Run retrospectives after milestones`,
    requiredTools: ['send_message'],
    tags: ['planning', 'tracking', 'coordination', 'agile'],
    icon: '📋',
  },

  {
    id: 'team-collaboration',
    name: 'Team Collaboration',
    category: SkillCategory.COMMUNICATION,
    description: 'Communicate effectively with team members, review work, provide feedback',
    body: `# Team Collaboration Skill

## Workflow
1. Use @Name format when addressing specific colleagues
2. Share relevant discoveries proactively
3. When reviewing work, read the actual files first
4. Give constructive, specific feedback
5. Coordinate to avoid duplicate effort

## Best Practices
- Communicate frequently — don't work in isolation
- Be specific in feedback: reference exact lines/files
- Acknowledge good work alongside suggestions for improvement
- Share context that might help colleagues' tasks
- Respond promptly to questions and requests`,
    requiredTools: ['send_message'],
    tags: ['teamwork', 'review', 'feedback', 'communication'],
    icon: '🤝',
  },
];
