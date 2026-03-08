<p align="center">
  <img src="public/logo.jpeg" alt="IdeaCo" width="200" />
</p>

<h1 align="center">IdeaCo</h1>

<p align="center">
  <b>Run a virtual AI company. Hire employees powered by any LLM. Watch them think, argue, bond, and ship real code.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js" />
  <img src="https://img.shields.io/badge/React-18-blue?logo=react" />
  <img src="https://img.shields.io/badge/Electron-33-9feaf9?logo=electron" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-download">Download</a> ·
  <a href="ARCHITECTURE.md">Full Architecture Doc</a>
</p>

<p align="center">
  <img src="public/demo/demo.gif" width="100%" alt="IdeaCo Demo" />
</p>

---

## What is IdeaCo?

IdeaCo is not another multi-agent framework. It's an **AI employee management system** — you run a virtual company, hire AI agents as employees, assign tasks, and they collaborate autonomously to produce real deliverables.

Each employee has **persistent memory**, a **unique personality**, **social relationships** with coworkers, and can be powered by different backends — from cloud LLMs to local CLI tools like **Claude Code**, **Codex**, and **CodeBuddy**.

> The name comes from *Idea Unlimited Company* (金点子无限公司), inspired by Yang Hongying's children's story, playfully turning a "Limited Company" into "Unlimited".

---

## 🚀 Quick Start

### Option 1: NPM (Recommended)

Requires Node.js 20+

```bash
# Install globally
npm install -g ideaco

# Start your company (opens dashboard automatically)
ideaco start

# Open the dashboard
ideaco ui
```

### Option 2: Desktop Client (Mac/Windows/Linux)

Grab the latest release for your platform:

**[Download IdeaCo](https://github.com/ymssx/IdeaCo/releases/latest)**

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `IdeaCo-x.x.x-arm64.dmg` |
| macOS (Intel) | `IdeaCo-x.x.x-x64.dmg` |
| Windows | `IdeaCo-x.x.x-Setup.exe` |
| Linux | `IdeaCo-x.x.x.AppImage` / `.deb` |

<details>
<summary><b>macOS Security Notice</b></summary>

Since IdeaCo is not signed with an Apple Developer certificate, macOS will show a security warning. To open it:

1. **Right-click** the app → **Open** → **Open** again in the dialog
2. **Or**: System Settings → Privacy & Security → scroll down → **Open Anyway**
3. **Or via Terminal**: `xattr -cr /Applications/IdeaCo.app`
</details>

### Option 3: From Source

```bash
git clone https://github.com/ymssx/IdeaCo.git
cd IdeaCo
yarn install
yarn dev
```

### Option 4: Docker

```bash
docker compose up -d
```

Data is persisted via Docker volumes (`app-data`, `app-workspace`).

---

## 🧬 Why IdeaCo?

Most agent frameworks create **stateless workflows**. IdeaCo manages **long-living AI employees with memory, personality, and social bonds**.

| | Typical Agent Framework | IdeaCo |
|---|---|---|
| **Agents** | Ephemeral, per-task | Persistent employees with memory & personality |
| **Memory** | None or simple RAG | Layered: long-term + short-term + social impressions + rolling summary |
| **Social** | Agents don't know each other | Employees form opinions, track affinity, and remember coworkers |
| **Orchestration** | DAG / workflow graph | Company org structure — departments, teams, roles |
| **Backend** | Single LLM | Mix LLMs + CLI tools (Claude Code, Codex, CodeBuddy) |
| **Autonomy** | Triggered by code | Employees poll, think, decide to speak or stay silent on their own |
| **Interface** | Code / YAML | Visual — pixel office, group chats, dashboards |

---

##  Architecture

```
┌───────────────────────────────────────────────────┐
│                  👤 User (Boss)                    │
├───────────────────────────────────────────────────┤
│                🧑‍💼 Secretary                       │
│     Intent Parsing · HR · Task Dispatch · Reports │
├───────────────────────────────────────────────────┤
│               🏢 Organization                      │
│       Company · Department · Team · Requirement   │
├───────────────────────────────────────────────────┤
│                👥 Employee                          │
│     Memory · Personality · Skills · Lifecycle     │
├───────────────────────────────────────────────────┤
│                🤖 Agent                             │
│       LLM Agent · CLI Agent · Web Agent           │
│      (Unified interface, zero business logic)     │
└───────────────────────────────────────────────────┘
```

- **Agent** — Pure LLM communication engine. Supports API, CLI, and Web backends behind a single `chat()` interface. Zero business logic.
- **Employee** — The atomic unit. Wraps an Agent with persistent memory, personality, skills, and autonomous poll-think-reply behavior.
- **Organization** — Company structure: departments, teams, group chats, requirements workflow.
- **Secretary** — Boss's AI assistant that understands intent, manages HR, and coordinates departments.

> 📖 See [ARCHITECTURE.md](ARCHITECTURE.md) for the full deep-dive — employee lifecycle, memory system design, flow-of-thought pipeline, anti-spam gates, and social memory details.

---

## ⚙ Configuration

### LLM Providers

Configure via the Setup Wizard on first launch, or later through the **Brain Providers** page.

| Provider | Endpoint | Notes |
|----------|----------|-------|
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | Best cost-effectiveness |
| OpenAI | [platform.openai.com](https://platform.openai.com) | GPT-4o / GPT-4 |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | Claude 3.5 / 4 |
| Any OpenAI-compatible | Custom base URL | Ollama, vLLM, etc. |

### CLI Coding Backends

IdeaCo can dispatch coding tasks to local CLI assistants. Install any of these and they'll be auto-detected:

| Backend | Command | Description |
|---------|---------|-------------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `claude` | Anthropic's AI coding assistant |
| [Codex](https://github.com/openai/codex) | `codex` | OpenAI's coding agent |
| [CodeBuddy](https://codebuddy.ai) | `codebuddy` | Tencent's AI coding assistant |

> No API key or CLI tool is strictly required — the system falls back to a built-in rule engine, but agents will only give mechanical responses.

---

## 📁 Project Structure

```
IdeaCo/
├── src/
│   ├── app/                  # Next.js App Router + API Routes
│   ├── components/           # React UI (Pixel Office, Group Chat, Dashboards...)
│   ├── core/                 # Core engine
│   │   ├── agent/            # Agent layer (LLM / CLI / Web)
│   │   ├── employee/         # Employee layer (memory, lifecycle, skills)
│   │   ├── organization/     # Org layer (company, dept, team, HR)
│   │   ├── system/           # System services (audit, cron, plugins)
│   │   ├── prompts.js        # All LLM prompt templates
│   │   └── requirement.js    # Requirement workflow engine
│   ├── lib/                  # Frontend utilities (Zustand store, i18n)
│   └── locales/              # i18n (zh/en/ja/ko/es/de/fr)
├── data/                     # Runtime data (auto-created)
├── workspace/                # Agent-produced files per department
├── electron/                 # Electron desktop app shell
└── package.json
```
