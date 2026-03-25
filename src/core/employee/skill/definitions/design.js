/**
 * Design Skills — Built-in skill definitions for UI/UX design.
 */

import { SkillCategory } from '../constants.js';

export const designSkills = [
  {
    id: 'ui-design',
    name: 'UI/UX Design',
    category: SkillCategory.DESIGN,
    description: 'Design user interfaces, wireframes, and interactive prototypes',
    body: `# UI/UX Design Skill

## Workflow
1. Understand user needs and use cases
2. Create information architecture and user flows
3. Design wireframes with clear layout hierarchy
4. Apply visual design: typography, color, spacing
5. Ensure accessibility (WCAG 2.1 AA)
6. Create responsive layouts for all breakpoints

## Best Practices
- Follow established design system conventions
- Maintain visual hierarchy with consistent spacing scale
- Use 8px grid for alignment
- Ensure sufficient color contrast (4.5:1 minimum)
- Design for touch targets (44px minimum)`,
    requiredTools: ['file_write'],
    tags: ['ui', 'ux', 'wireframe', 'prototype', 'design-system'],
    icon: '🎨',
  },
];
