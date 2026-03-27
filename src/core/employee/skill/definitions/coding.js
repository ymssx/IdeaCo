/**
 * Coding Skills — Built-in skill definitions for development tasks.
 */

import { SkillCategory } from '../constants.js';

export const codingSkills = [
  {
    id: 'web-development',
    name: 'Web Development',
    category: SkillCategory.CODING,
    description: 'Full-stack web development with modern frameworks (React, Vue, Next.js, Node.js)',
    body: `# Web Development Skill

## Workflow
1. Analyze the requirements and identify the tech stack
2. Set up project structure with proper folder hierarchy
3. Implement backend APIs with proper error handling and validation
4. Build frontend components with responsive design
5. Write tests for critical paths
6. Verify all files exist using file_list before reporting completion

## Best Practices
- Follow modern React/Vue patterns (hooks, composition API)
- Use TypeScript when possible for type safety
- Implement proper error boundaries and loading states
- Ensure responsive design across breakpoints
- Write semantic HTML with accessibility in mind`,
    requiredTools: ['file_write', 'file_read', 'shell_exec'],
    tags: ['react', 'vue', 'nextjs', 'nodejs', 'html', 'css', 'javascript'],
    icon: '🌐',
  },

  {
    id: 'api-development',
    name: 'API Development',
    category: SkillCategory.CODING,
    description: 'Design and build RESTful and GraphQL APIs with authentication and documentation',
    body: `# API Development Skill

## Workflow
1. Design API endpoints following REST conventions
2. Define request/response schemas
3. Implement proper HTTP methods and status codes
4. Add authentication and authorization middleware
5. Write OpenAPI/Swagger documentation
6. Implement rate limiting and input validation

## Best Practices
- Use proper HTTP status codes (200, 201, 400, 401, 403, 404, 500)
- Implement pagination for list endpoints
- Version your API (v1, v2)
- Add request validation and sanitization
- Return consistent error response format`,
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['rest', 'graphql', 'api', 'swagger', 'openapi'],
    icon: '🔌',
  },

  {
    id: 'testing',
    name: 'Testing & QA',
    category: SkillCategory.CODING,
    description: 'Write unit tests, integration tests, and end-to-end tests',
    body: `# Testing & QA Skill

## Workflow
1. Analyze code under test — identify critical paths and edge cases
2. Choose appropriate testing framework (Jest, Mocha, Cypress, Playwright)
3. Write unit tests for individual functions/components
4. Write integration tests for API endpoints and data flows
5. Add edge case coverage (null inputs, boundary values, error states)
6. Run tests and verify coverage

## Best Practices
- Aim for >80% code coverage on critical paths
- Use descriptive test names that explain the expected behavior
- Follow AAA pattern: Arrange, Act, Assert
- Mock external dependencies properly
- Test both success and failure scenarios`,
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['jest', 'mocha', 'cypress', 'testing', 'qa'],
    icon: '🧪',
  },

  {
    id: 'code-refactoring',
    name: 'Code Refactoring',
    category: SkillCategory.CODING,
    description: 'Improve code quality, reduce complexity, and optimize performance',
    body: `# Code Refactoring Skill

## Workflow
1. Read and understand the existing codebase
2. Identify code smells (long methods, duplicated code, god classes)
3. Plan refactoring steps — small, incremental changes
4. Apply SOLID principles and design patterns
5. Verify behavior is preserved after each change
6. Run existing tests to ensure no regressions

## Best Practices
- Refactor in small steps, verifying after each
- Extract methods/classes when functions exceed ~50 lines
- Replace magic numbers with named constants
- Reduce nesting depth (early returns, guard clauses)
- Improve naming for clarity`,
    requiredTools: ['file_read', 'file_write'],
    tags: ['refactoring', 'optimization', 'clean-code', 'solid'],
    icon: '🔧',
  },

  {
    id: 'database-design',
    name: 'Database Design',
    category: SkillCategory.CODING,
    description: 'Design database schemas, write migrations, optimize queries',
    body: `# Database Design Skill

## Workflow
1. Analyze data requirements and relationships
2. Design normalized schema (3NF minimum)
3. Define indexes for common query patterns
4. Write migration scripts
5. Implement data access layer with proper connection pooling
6. Test query performance

## Best Practices
- Normalize to 3NF, denormalize only with clear performance justification
- Always add indexes on foreign keys and frequently queried columns
- Use transactions for multi-table operations
- Implement soft deletes for audit trails
- Write idempotent migrations`,
    requiredTools: ['file_write', 'shell_exec'],
    tags: ['sql', 'mongodb', 'postgresql', 'mysql', 'redis'],
    icon: '🗄️',
  },
];
