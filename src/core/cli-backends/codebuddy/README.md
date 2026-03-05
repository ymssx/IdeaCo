# CodeBuddy Code CLI 使用文档

> Tencent CodeBuddy Code - AI coding assistant CLI

## 概述

CodeBuddy Code 是腾讯出品的 AI 编码助手 CLI 工具，支持无头模式（Headless Mode）以编程方式运行，无需交互式 UI。

## 安装

请参考 CodeBuddy 官方文档安装 CLI 工具。安装后可通过 `codebuddy --version` 验证。

> ⚠️ CodeBuddy 需要 Node.js 20+，系统会自动通过 nvm 切换到 node 20 来执行。

## CLI 命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `codebuddy` | 启动交互式 REPL | `codebuddy` |
| `codebuddy "查询"` | 带初始提示词启动 REPL | `codebuddy "解释这个项目"` |
| `codebuddy -p "查询"` | 通过 SDK 查询后退出 | `codebuddy -p "解释这个函数"` |
| `cat 文件 \| codebuddy -p "查询"` | 处理管道内容 | `cat logs.txt \| codebuddy -p "分析日志"` |
| `codebuddy -c` | 继续最近的对话 | `codebuddy -c` |
| `codebuddy -r "<session-id>" "查询"` | 通过 ID 恢复会话 | `codebuddy -r "abc123" "完成这个 MR"` |
| `codebuddy update` | 更新到最新版本 | `codebuddy update` |
| `codebuddy mcp` | 配置 MCP 服务器 | 参见 MCP 文档 |

## CLI 参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--print, -p` | 打印响应后退出，不进入交互模式 | `codebuddy -p "查询"` |
| `-y / --dangerously-skip-permissions` | 跳过权限提示（非交互模式必需） | `codebuddy -p -y "查询"` |
| `--output-format` | 指定输出格式 (text, json, stream-json) | `codebuddy -p --output-format json` |
| `--input-format` | 指定输入格式 (text, stream-json) | `codebuddy -p --input-format stream-json` |
| `--resume, -r` | 通过会话 ID 恢复对话 | `codebuddy --resume abc123` |
| `--continue, -c` | 继续最近的对话 | `codebuddy --continue` |
| `--verbose` | 启用详细日志 | `codebuddy --verbose` |
| `--model` | 设置模型 | `codebuddy --model gpt-5` |
| `--max-turns` | 限制代理轮次数 | `codebuddy -p --max-turns 3` |
| `--system-prompt` | 替换整个系统提示词 | `codebuddy --system-prompt "你是专家"` |
| `--append-system-prompt` | 追加到系统提示词 | `codebuddy --append-system-prompt "自定义指令"` |
| `--allowedTools` | 允许的工具列表 | `codebuddy --allowedTools "Bash,Read"` |
| `--disallowedTools` | 拒绝的工具列表 | `codebuddy --disallowedTools "Bash(git commit)"` |
| `--tools` | 限制可用的内置工具集 | `codebuddy --tools "Bash,Read,Edit"` |
| `--agents` | 通过 JSON 定义自定义子代理 | 见下方示例 |
| `--settings` | 从 JSON 加载额外设置 | `codebuddy --settings '{"model":"gpt-5"}'` |
| `--setting-sources` | 指定设置源 (user, project, local) | `codebuddy --setting-sources project,local` |
| `--mcp-config` | 从 JSON 文件加载 MCP 服务器 | `codebuddy --mcp-config servers.json` |
| `--add-dir` | 添加额外工作目录 | `codebuddy --add-dir ../apps ../lib` |
| `--json-schema` | JSON Schema 验证结构化输出 | 见下方示例 |
| `--sandbox` | 沙箱模式 (Beta) | `codebuddy --sandbox "分析项目"` |
| `--permission-mode` | 指定权限模式 | `codebuddy --permission-mode plan` |

## 无头模式 (Headless Mode)

以编程方式运行 CodeBuddy Code，无需交互式 UI。

### 基本用法

```bash
codebuddy -p "暂存我的更改并为它们编写一组提交" \
  --allowedTools "Bash,Read" \
  --permission-mode acceptEdits
```

### ⚠️ 重要提示

`-y`（或 `--dangerously-skip-permissions`）是非交互模式的必需参数。在使用 `-p/--print` 参数进行非交互式执行时，必须添加此参数才能执行需要授权的操作（文件读写、命令执行、网络请求等），否则这些操作会被阻止。

## 输出格式

### 文本输出（默认）

```bash
codebuddy -p "解释文件 src/components/Header.tsx"
```

### JSON 输出

```bash
codebuddy -p "数据层是如何工作的?" --output-format json
```

### 流式 JSON 输出

```bash
codebuddy -p "构建一个应用程序" --output-format stream-json
```

### 结构化 JSON 输出

```bash
codebuddy -p "提取 auth.py 中的主要函数名称" \
  --output-format json \
  --json-schema '{"type":"object","properties":{"functions":{"type":"array","items":{"type":"string"}}},"required":["functions"]}'
```

## 输入格式

### 文本输入（默认）

```bash
# 直接参数
codebuddy -p "解释这段代码"

# 从 stdin
echo "解释这段代码" | codebuddy -p
```

### 流式 JSON 输入

```bash
echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"解释这段代码"}]}}' | \
  codebuddy -p --output-format=stream-json --input-format=stream-json --verbose
```

## 多轮对话

```bash
# 继续最近的对话
codebuddy --continue "现在重构以提高性能"

# 通过会话 ID 恢复特定对话
codebuddy --resume 550e8400-e29b-41d4-a716-446655440000 "更新测试"

# 在非交互模式下恢复
codebuddy --resume 550e8400-e29b-41d4-a716-446655440000 "修复所有 linting 问题" -p
```

## Agents 参数格式

`--agents` 参数接受 JSON 对象定义自定义子代理：

| 字段 | 必需 | 说明 |
|------|------|------|
| `description` | 是 | 何时应调用子代理的描述 |
| `prompt` | 是 | 指导子代理行为的系统提示词 |
| `tools` | 否 | 子代理可用的工具数组 |
| `model` | 否 | 模型别名 |

```bash
codebuddy --agents '{
  "code-reviewer": {
    "description": "专业代码审查员。代码更改后主动使用。",
    "prompt": "你是高级代码审查员。专注于代码质量、安全性和最佳实践。",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  }
}'
```

## 系统提示词参数

| 参数 | 行为 | 模式 | 使用场景 |
|------|------|------|----------|
| `--system-prompt` | 替换整个默认提示词 | 交互 + 打印 | 完全控制行为 |
| `--system-prompt-file` | 用文件内容替换 | 仅打印 | 版本控制 |
| `--append-system-prompt` | 追加到默认提示词 | 交互 + 打印 | 添加指令 |

> `--system-prompt` 和 `--system-prompt-file` 互斥，不能同时使用。

## 沙箱模式 (Beta)

```bash
# 容器沙箱（Docker/Podman）
codebuddy --sandbox "分析这个项目"

# E2B 云端沙箱
codebuddy --sandbox https://api.e2b.dev "创建 Python web 应用"

# 强制创建新沙箱
codebuddy --sandbox --sandbox-new "从头开始"
```

### 沙箱环境变量

| 变量 | 说明 |
|------|------|
| `E2B_API_KEY` | E2B API 密钥 |
| `E2B_TEMPLATE` | E2B 模板 ID（默认: base） |
| `CODEBUDDY_SANDBOX_IMAGE` | 自定义 Docker 镜像 |

## Agent 集成示例

### SRE 事件响应机器人

```bash
#!/bin/bash
investigate_incident() {
    local incident_description="$1"
    local severity="${2:-medium}"

    codebuddy -p "事件: $incident_description (严重性: $severity)" \
      --append-system-prompt "你是一名 SRE 专家。诊断问题，评估影响，并提供即时行动项。" \
      --output-format json \
      --allowedTools "Bash,Read,WebSearch,mcp__datadog" \
      --mcp-config monitoring-tools.json
}

investigate_incident "支付 API 返回 500 错误" "high"
```

### 自动化安全审查

```bash
audit_pr() {
    local pr_number="$1"

    gh pr diff "$pr_number" | codebuddy -p \
      --append-system-prompt "你是一名安全工程师。审查此 PR 的漏洞和合规问题。" \
      --output-format json \
      --allowedTools "Read,Grep,WebSearch"
}

audit_pr 123 > security-report.json
```

## 最佳实践

1. **使用 JSON 输出格式** 进行程序化解析响应
2. **优雅地处理错误** — 检查退出代码和 stderr
3. **使用会话管理** 在多轮对话中维护上下文
4. **考虑超时** 对于长时间运行的操作：`timeout 300 codebuddy -p ...`
5. **遵守速率限制** 在多个请求间添加延迟
6. **使用 `-y`** 在非交互模式下执行需要授权的操作

## 在 AI Enterprise 中的配置

本后端在 AI Enterprise 系统中的配置：

- **ID**: `codebuddy`
- **执行命令**: `codebuddy -p {prompt} -y`
- **Memory 目录**: `.codebuddy/MEMORY.md`
- **需要 Node 版本**: 20（通过 nvm 自动切换）
- **评分**: 100 🐧
