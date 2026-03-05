# Claude Code CLI 使用文档

> Anthropic Claude Code - AI coding assistant CLI

## 概述

Claude Code 是 Anthropic 出品的 AI 编码助手 CLI 工具，基于 Claude 模型。

## 安装

```bash
npm install -g @anthropic-ai/claude-code
```

安装后可通过 `claude --version` 验证。

## 基本用法

```bash
# 交互式模式
claude

# 非交互模式（带提示词）
claude -p "解释这个项目"

# 跳过权限提示
claude -p "修改代码" --dangerously-skip-permissions

# 处理管道内容
cat logs.txt | claude -p "分析日志"
```

## 常用参数

| 参数 | 说明 |
|------|------|
| `-p "查询"` | 非交互模式 |
| `--dangerously-skip-permissions` | 跳过权限提示 |
| `--output-format json` | JSON 输出 |
| `--resume <session-id>` | 恢复会话 |
| `--continue` | 继续最近对话 |
| `--verbose` | 详细日志 |
| `--max-turns N` | 限制轮次 |
| `--model <model>` | 指定模型 |
| `--allowedTools "tool1,tool2"` | 允许的工具 |

## 在 AI Enterprise 中的配置

- **ID**: `claude-code`
- **执行命令**: `claude -p {prompt} --dangerously-skip-permissions`
- **Memory 目录**: `.claude/CLAUDE.md`
- **评分**: 95 🤖
