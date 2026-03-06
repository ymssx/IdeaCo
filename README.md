<p align="center">
  <img src="public/logo.jpeg" alt="IdeaCo" width="200" />
</p>

<h1 align="center">Idea Unlimited Company</h1>

<p align="center">
  <b>Hire AI employees. Run Claude Code, Codex, and others in one company.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js" />
  <img src="https://img.shields.io/badge/React-18-blue?logo=react" />
  <img src="https://img.shields.io/badge/TailwindCSS-3.4-38bdf8?logo=tailwindcss" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
</p>

IdeaCo is not another multi-agent framework. It's an **AI employee management system** — you run a virtual company, hire AI agents as employees, assign tasks, and they collaborate autonomously to produce real deliverables.

Each employee has persistent memory, a unique personality, and can be powered by different backends — from cloud LLMs to local CLI tools like **Claude Code**, **Codex**, and **CodeBuddy**.

> The name comes from *Idea Unlimited Company* (金点子无限公司), inspired by Yang Hongying's children's story, playfully turning a "Limited Company" into "Unlimited".

---

## Why IdeaCo?

Most agent frameworks create **workflows**. IdeaCo manages **long-living AI employees**.

| | Typical Agent Framework | IdeaCo |
|---|---|---|
| Agents | Ephemeral, per-task | Persistent employees with memory & personality |
| Orchestration | DAG / workflow graph | Company org structure — departments, teams, roles |
| Backend | Single LLM | Mix LLMs + CLI tools (Claude Code, Codex, CodeBuddy) |
| Interface | Code / YAML | Visual — pixel office, group chats, dashboards |

---

## Features

| Screenshot | Feature | Description |
|:---:|---|---|
| <img src="public/demo/dashboard.png" width="280" /> | **Dashboard** | Company overview — departments, employees, budget, requirements status, and task forces at a glance |
| <img src="public/demo/office.png" width="280" /> | **Office** | Pixel-art virtual office where AI agents wander, work at desks, and show real-time chat bubbles |
| <img src="public/demo/employee.png" width="280" /> | **Employee Profile** | Detailed agent card — role prompt, skills, personality, memory, performance, task history and cost tracking |
| <img src="public/demo/messages.png" width="280" /> | **Messages** | Internal messaging system with department group chats where agents discuss, debate, and collaborate autonomously |
| <img src="public/demo/requirement.png" width="280" /> | **Requirements** | Assign tasks to departments — agents auto-decompose into workflow nodes, execute with real tools, and produce deliverables |

---

## Download

Grab the latest release for your platform:

**[⬇ Download IdeaCo](https://github.com/ymssx/IdeaCo/releases/latest)**

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `IdeaCo-x.x.x-arm64.dmg` |
| macOS (Intel) | `IdeaCo-x.x.x-x64.dmg` |
| Windows | `IdeaCo-x.x.x-Setup.exe` |
| Linux | `IdeaCo-x.x.x.AppImage` / `.deb` |

### macOS Security Notice

Since IdeaCo is not signed with an Apple Developer certificate, macOS will show:

> "Apple cannot verify that IdeaCo is free of malware."

To open it:

1. **First time**: Right-click (or Control-click) the app → click **Open** → click **Open** again in the dialog
2. **Or**: Go to **System Settings → Privacy & Security**, scroll down to find the blocked message, click **Open Anyway**
3. **Or via Terminal**:
   ```bash
   xattr -cr /Applications/IdeaCo.app
   ```

---

## Quick Start (from source)

### Prerequisites

- **Node.js** >= 20 (`.nvmrc` included)
- **yarn**

### Development

```bash
git clone https://github.com/ymssx/IdeaCo.git
cd IdeaCo
nvm use 20
yarn install
yarn dev
```

Open **http://localhost:9999** — the Setup Wizard will guide you through company creation and LLM configuration.

### Production

```bash
yarn build
yarn start
```

---

## Configuration

### LLM Providers

Configure via the Setup Wizard on first launch, or later through the **Brain Providers** page.

| Provider | Endpoint | Notes |
|----------|----------|-------|
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | Best cost-effectiveness |
| OpenAI | [platform.openai.com](https://platform.openai.com) | GPT-4o / GPT-4 |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | Claude 3.5 / 4 |
| Any OpenAI-compatible | Custom base URL | Ollama, vLLM, etc. |

### CLI Coding Backends

IdeaCo can dispatch tasks to local CLI coding assistants. Install any of these and they'll be auto-detected:

| Backend | Command | Description |
|---------|---------|-------------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `claude` | Anthropic's AI coding assistant |
| [Codex](https://github.com/openai/codex) | `codex` | OpenAI's coding agent |
| [CodeBuddy](https://codebuddy.ai) | `codebuddy` | Tencent's AI coding assistant |

> No API key or CLI tool is strictly required — the system falls back to a built-in rule engine, but agents will only give mechanical responses.

---

## Deployment

### Docker (Recommended)

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Data is persisted via Docker volumes (`app-data`, `app-workspace`).

### One-click Deploy

```bash
./deploy.sh
```

The script detects Docker Compose version and runs `docker compose up -d --build`.

---

## Architecture

```
IdeaCo/
├── src/
│   ├── app/              # Next.js App Router + API Routes
│   ├── components/       # React UI components
│   ├── core/             # Core engine (agents, company, LLM client, tools...)
│   │   └── cli-backends/ # Claude Code, Codex, CodeBuddy integrations
│   ├── lib/              # Frontend utilities (Zustand store, i18n, avatar)
│   └── locales/          # i18n translations (zh/en/ja/ko/es/de/fr)
├── data/                 # Runtime data (auto-created)
├── workspace/            # Agent-produced files per department
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## License

[MIT](LICENSE)
