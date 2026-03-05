/**
 * CodeBuddy Code CLI 后端配置
 * Tencent CodeBuddy Code - AI coding assistant CLI
 * 
 * @see ./README.md 查看完整使用文档
 */
export const codebuddyConfig = {
  id: 'codebuddy',
  name: 'CodeBuddy Code',
  description: 'Tencent CodeBuddy Code - AI coding assistant CLI',
  icon: '🐧',
  rating: 100,             // 满分！🐧
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
  nvmNode: '20',            // CodeBuddy 安装在 node 20
  builtin: true,
};
