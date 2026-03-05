# Codex CLI 使用文档

> OpenAI Codex CLI - AI coding assistant

## 概述

Codex 是 OpenAI 出品的 AI 编码助手 CLI 工具。

## 安装

```bash
npm install -g @openai/codex
```

安装后可通过 `codex --version` 验证。

## 基本用法

```bash
# 交互式模式
codex

# 非交互模式（带提示词）
codex -p "解释这个项目"

# 跳过权限提示
codex -p "修改代码" --dangerously-skip-permissions

# 处理管道内容
cat logs.txt | codex -p "分析日志"
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

## 在 AI Enterprise 中的配置

- **ID**: `codex`
- **执行命令**: `codex -p {prompt} --dangerously-skip-permissions`
- **Memory 目录**: `.codex/AGENTS.md`
- **评分**: 90 🧠
