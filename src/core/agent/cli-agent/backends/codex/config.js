/**
 * Codex (OpenAI) CLI backend configuration
 * OpenAI Codex CLI - AI coding assistant
 * 
 * @see ./README.md for full documentation
 */
export const codexConfig = {
  id: 'codex',
  name: 'Codex (OpenAI)',
  description: 'OpenAI Codex CLI - AI coding assistant',
  icon: '🧠',
  rating: 90,
  detectCommand: 'codex --version',
  execCommand: 'codex',
  execArgs: ['-p', '{prompt}', '--dangerously-skip-permissions'],
  interactiveArgs: [],
  memoryDir: '.codex',
  memoryFile: 'AGENTS.md',
  memoryFormat: 'markdown',
  workingDirSupport: true,
  pipeMode: 'args',
  outputMode: 'stdout',
  initCommand: null,
  customEnv: {},
  nvmNode: null,
  builtin: true,
};
