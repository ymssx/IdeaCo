/**
 * Basic Operations Skill — Foundational tool skill for all employees.
 *
 * Bundles the essential file-system, shell, and search tools that every
 * employee needs to do real work. This skill is auto-installed and pinned
 * for all concrete employee classes (GeneralEmployee, Leader, Secretary).
 *
 * When this skill is loaded/pinned, its requiredTools are auto-disclosed
 * to the agent via the Skill→Tool linkage mechanism.
 */

import { SkillCategory, SkillSource } from '../constants.js';

export const basicOperationsSkills = [
  {
    id: 'basic-operations',
    name: 'Basic Operations',
    version: '1.0.0',
    category: SkillCategory.CODING,
    tags: ['file', 'shell', 'search', 'workspace', 'foundational'],
    author: 'Built-in',
    icon: '🛠️',
    description: 'Foundational workspace operations: file read/write/patch, shell commands, grep/glob search, and directory management. Every employee has this skill.',
    source: SkillSource.BUILTIN,

    // These tools will be auto-disclosed when the skill is active (pinned or loaded)
    requiredTools: [
      // File tools
      'file_read', 'file_write', 'file_append', 'file_patch', 'multi_patch',
      'file_delete', 'file_list', 'file_stats', 'file_search', 'mkdir',
      'workspace_files',
      // Search tools
      'grep_search', 'glob_search',
      // Shell tools
      'shell_exec',
    ],

    body: `## Basic Operations — Workspace Toolkit

### Workflow Patterns

**Explore → Understand → Modify → Verify** — this is your fundamental loop.

1. **Exploring a codebase**: Start with workspace_files for the big picture, then grep_search or glob_search to locate relevant files, then file_read to understand them.
2. **Making changes**: Always file_read first, then file_patch (single edit) or multi_patch (multiple edits in one file). Use file_write only for new files or full rewrites.
3. **Creating structure**: mkdir to create directories, then file_write to populate files. Always file_list afterward to confirm.
4. **Running & testing**: Use shell_exec for build, test, lint, or any CLI command. Read the output carefully before proceeding.

### Tool Combinations

- **Find & Replace across files**: grep_search to locate occurrences → file_read each match → file_patch or multi_patch to apply changes → grep_search again to verify no remaining occurrences.
- **Scaffold a project**: mkdir for directory tree → file_write for each file → shell_exec to install dependencies → file_list to verify structure.
- **Debug an issue**: grep_search for error messages or symbols → file_read surrounding context → shell_exec to reproduce → file_patch to fix → shell_exec to verify.
- **Bulk file operations**: glob_search to collect target files → loop file_read + file_patch → shell_exec tests to validate.

### Rules
- **Read before modify**: Never patch a file you haven't read. You need the exact content for accurate edits.
- **Verify after create**: After creating files/dirs, use file_list or file_read to confirm they exist on disk. Never assume.
- **Prefer patch over write**: Use file_patch/multi_patch for existing files. file_write overwrites everything — only use it for new files.
- **Batch related operations**: Plan all needed operations at once rather than one at a time.
- **All paths are workspace-relative**: Every file operation is scoped to your workspace root.`,
  },
];
