/**
 * CodeBuddy Code CLI backend configuration
 * Tencent CodeBuddy Code - AI coding assistant CLI
 * 
 * @see ./README.md for full documentation
 */
export const codebuddyConfig = {
  id: 'codebuddy',
  name: 'CodeBuddy Code',
  description: 'Tencent CodeBuddy Code - AI coding assistant CLI',
  icon: '🐧',
  rating: 100,             // Full score! 🐧
  detectCommand: 'codebuddy --version',
  execCommand: 'codebuddy',
  execArgs: ['-p', '{prompt}', '-y'],
  interactiveArgs: [],
  memoryDir: '.codebuddy',
  memoryFile: 'MEMORY.md',
  memoryFormat: 'markdown',
  workingDirSupport: true,
  pipeMode: 'args',
  outputMode: 'stdout',
  initCommand: '/init',
  customEnv: {},
  nvmNode: '20',            // CodeBuddy is installed on node 20
  builtin: true,
};
