/**
 * DevOps Skills — Built-in skill definitions for deployment and operations.
 */

import { SkillCategory } from '../constants.js';

export const devopsSkills = [
  {
    id: 'devops',
    name: 'DevOps & Deployment',
    category: SkillCategory.DEVOPS,
    description: 'CI/CD pipelines, Docker, cloud deployment, infrastructure management',
    body: `# DevOps & Deployment Skill

## Workflow
1. Define infrastructure requirements
2. Write Dockerfiles with minimal, secure base images
3. Create CI/CD pipeline configuration
4. Set up deployment scripts with rollback capability
5. Configure monitoring and alerting
6. Document deployment procedures

## Best Practices
- Use multi-stage Docker builds to minimize image size
- Pin dependency versions in Dockerfiles
- Implement health checks and readiness probes
- Use environment variables for configuration
- Automate everything — manual deployment is a bug`,
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['docker', 'ci-cd', 'kubernetes', 'aws', 'deployment'],
    icon: '🚀',
  },

  {
    id: 'monitoring',
    name: 'Monitoring & Logging',
    category: SkillCategory.DEVOPS,
    description: 'Set up monitoring, alerting, and log analysis',
    body: `# Monitoring & Logging Skill

## Workflow
1. Define key metrics and SLOs
2. Instrument code with structured logging
3. Set up metric collection and dashboards
4. Configure alerting thresholds and escalation
5. Implement log aggregation and search

## Best Practices
- Use structured logging (JSON) with consistent fields
- Define SLOs before choosing what to monitor
- Alert on symptoms (latency, errors), not causes
- Include correlation IDs across services
- Set up on-call rotation and runbooks`,
    requiredTools: ['shell_exec', 'file_read'],
    tags: ['monitoring', 'logging', 'alerting', 'observability'],
    icon: '📡',
  },
];
