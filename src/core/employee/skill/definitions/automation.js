/**
 * Automation Skills — Built-in skill definitions for scripting and automation.
 */

import { SkillCategory } from '../constants.js';

export const automationSkills = [
  {
    id: 'task-automation',
    name: 'Task Automation',
    category: SkillCategory.AUTOMATION,
    description: 'Create automated workflows, scripts, and scheduled tasks',
    body: `# Task Automation Skill

## Workflow
1. Identify repetitive manual processes
2. Design automation workflow with clear triggers and actions
3. Write scripts with proper error handling and logging
4. Test with edge cases and failure scenarios
5. Document how to run and maintain the automation

## Best Practices
- Make scripts idempotent (safe to re-run)
- Add comprehensive error handling and logging
- Use cron expressions for scheduling
- Include a dry-run mode for safe testing
- Document all dependencies and environment requirements`,
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['automation', 'scripts', 'cron', 'workflow'],
    icon: '🤖',
  },

  {
    id: 'web-scraping',
    name: 'Web Scraping',
    category: SkillCategory.AUTOMATION,
    description: 'Extract and process data from websites',
    body: `# Web Scraping Skill

## Workflow
1. Analyze target website structure
2. Choose appropriate extraction method (API, HTML parsing, browser automation)
3. Implement data extraction with proper selectors
4. Handle pagination, rate limiting, and error recovery
5. Structure and validate extracted data
6. Export in requested format (JSON, CSV, etc.)

## Best Practices
- Check for an official API before scraping HTML
- Respect robots.txt and rate limits
- Handle dynamic content with browser automation when needed
- Validate extracted data against expected schema
- Implement retry logic for transient failures`,
    requiredPlugins: ['builtin-browser', 'builtin-web-fetch'],
    tags: ['scraping', 'extraction', 'crawling'],
    icon: '🕷️',
  },
];
