/**
 * CLI Backends 模块入口
 * 
 * 每个 CLI 模型有独立的文件夹，包含各自的配置（config.js）和使用文档（README.md）。
 * 
 * 目录结构：
 * cli-backends/
 * ├── index.js           - 本文件，模块入口
 * ├── registry.js        - CLIBackendRegistry 核心类 + 通用工具函数
 * ├── codebuddy/
 * │   ├── config.js      - CodeBuddy Code 配置
 * │   └── README.md      - CodeBuddy Code 使用文档
 * ├── claude-code/
 * │   ├── config.js      - Claude Code 配置
 * │   └── README.md      - Claude Code 使用文档
 * └── codex/
 *     ├── config.js      - Codex (OpenAI) 配置
 *     └── README.md      - Codex 使用文档
 */

// 核心导出：Registry 类、全局单例、状态枚举
export { CLIBackendRegistry, cliBackendRegistry, CLIBackendState, buildAgentMemoryContent } from './registry.js';

// 各 CLI 配置导出（方便外部直接访问单个配置）
export { codebuddyConfig } from './codebuddy/config.js';
export { claudeCodeConfig } from './claude-code/config.js';
export { codexConfig } from './codex/config.js';
