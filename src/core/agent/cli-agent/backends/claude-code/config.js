/**
 * Claude Code CLI backend configuration
 * Anthropic Claude Code - AI coding assistant CLI
 * 
 * @see ./README.md for full documentation
 */
export const claudeCodeConfig = {
  id: 'claude-code',
  name: 'Claude Code',
  description: 'Anthropic Claude Code - AI coding assistant CLI',
  icon: '🤖',
  rating: 95,
  detectCommand: 'claude --version',
  execCommand: 'claude',
  execArgs: ['-p', '{prompt}', '--dangerously-skip-permissions'],
  interactiveArgs: [],
  memoryDir: '.claude',
  memoryFile: 'CLAUDE.md',
  memoryFormat: 'markdown',
  workingDirSupport: true,
  pipeMode: 'args',
  outputMode: 'stdout',
  initCommand: null,
  customEnv: {},
  nvmNode: null,
  builtin: true,
};
