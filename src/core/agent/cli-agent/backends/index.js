/**
 * CLI Backends module entry point
 * 
 * Each CLI backend has its own folder containing configuration (config.js) and documentation (README.md).
 * 
 * Directory structure:
 * backends/
 * ├── index.js           - This file, module entry point
 * ├── registry.js        - CLIBackendRegistry core class + utility functions
 * ├── codebuddy/
 * │   ├── config.js      - CodeBuddy Code configuration
 * │   └── README.md      - CodeBuddy Code documentation
 * ├── claude-code/
 * │   ├── config.js      - Claude Code configuration
 * │   └── README.md      - Claude Code documentation
 * └── codex/
 *     ├── config.js      - Codex (OpenAI) configuration
 *     └── README.md      - Codex documentation
 */

// Core exports: Registry class, global singleton, state enums
export { CLIBackendRegistry, cliBackendRegistry, CLIBackendState, buildAgentMemoryContent } from './registry.js';

// Individual CLI config exports (for direct external access to specific configs)
export { codebuddyConfig } from './codebuddy/config.js';
export { claudeCodeConfig } from './claude-code/config.js';
export { codexConfig } from './codex/config.js';
