# IdeaCo Architecture

> Internal architecture documentation for IdeaCo — the AI Employee Management System.

---

## System Overview

IdeaCo is a layered AI enterprise simulator where every component maps to a real-world company metaphor. The system is organized into five clear layers:

```
┌─────────────────────────────────────────────────────┐
│                   👤 User (Boss)                     │
│              Chat interface / Mailbox                │
├─────────────────────────────────────────────────────┤
│                 🧑‍💼 Secretary                        │
│      Intent parsing · HR coordination · Reporting   │
├─────────────────────────────────────────────────────┤
│              🏢 Organization Layer                   │
│     Company · Department · Team · Requirement       │
├─────────────────────────────────────────────────────┤
│               👥 Employee Layer                      │
│   Memory · Personality · Skills · Prompt · Lifecycle│
├─────────────────────────────────────────────────────┤
│               🤖 Agent Layer                         │
│        LLM Agent · CLI Agent · Web Agent            │
│       (Unified interface, zero business logic)      │
└─────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Module | Responsibility |
|-------|--------|----------------|
| **User** | Frontend / Mailbox | Boss gives orders, views progress, and manages the company |
| **Secretary** | `secretary.js` | Understands boss intent, coordinates HR, dispatches tasks, reports progress |
| **Organization** | `company.js` / `department.js` / `team.js` / `requirement.js` | Company structure, department lifecycle, requirement workflow, group chat containers |
| **Employee** | `base-employee.js` / `lifecycle.js` / `memory/` | The atomic management unit — wraps an Agent with memory, personality, skills, and autonomous behavior |
| **Agent** | `base-agent.js` → LLMAgent / CLIAgent / WebAgent | Pure LLM communication engine. Zero business logic. Uniform `chat()` interface |

---

## Agent Layer

The Agent layer is a **pure communication engine** — it only handles LLM input/output and is completely decoupled from business logic. All three agent types expose the same abstract interface:

```
BaseAgent (abstract)
  ├── LLMAgent     — OpenAI-compatible API (API key auth)
  ├── CLIAgent     — Local CLI tools (Claude Code, Codex, CodeBuddy)
  └── WebAgent     — Browser-based Web API (ChatGPT Web, Claude Web)
```

**Unified Interface:**
- `chat(messages, options)` — Send a conversation request
- `chatWithTools(messages, toolExecutor, options)` — Conversation with tool calling
- `isAvailable()` / `canChat()` — Availability check
- `switchProvider(newProvider)` — Runtime provider switching
- `serialize()` / `deserialize()` — State persistence

**Internal differentiation (not exposed):**
- **LLMAgent**: Native function calling via OpenAI SDK
- **CLIAgent**: Subprocess execution, stdout parsing, fallback to LLM
- **WebAgent**: Cookie session management, conversation ID tracking, tool-call simulation via prompt

---

## Employee Layer

An Employee is an Agent wrapped with **identity, memory, personality, and autonomous behavior**. It is the atomic management unit of the system.

### Employee Lifecycle

```
┌──────────┐    ┌───────────┐    ┌─────────┐    ┌──────────────┐
│ 1. Init  │───▶│2. Onboard │───▶│3. WakeUp│───▶│ 4. Poll Loop │◀─┐
└──────────┘    └───────────┘    └─────────┘    └──────┬───────┘  │
                                                       │          │
                                                       ▼          │
                                              ┌────────────────┐  │
                                              │ 5. Read Group  │  │
                                              │    Messages    │  │
                                              └───────┬────────┘  │
                                                      │           │
                                                      ▼           │
                                              ┌────────────────┐  │
                                              │ 6. Flow-of-    │  │
                                              │   Thought      │  │
                                              └───────┬────────┘  │
                                                      │           │
                                                ┌─────┴─────┐    │
                                                ▼           ▼    │
                                          ┌─────────┐ ┌────────┐ │
                                          │  Reply  │ │ Silent │ │
                                          └────┬────┘ └────┬───┘ │
                                               │          │      │
                                               ▼          │      │
                                          ┌──────────┐    │      │
                                          │ Trigger  │    │      │
                                          │  Others  │────┘──────┘
                                          └──────────┘
```

#### Phase 1 — Initialization (Constructor)

- **Identity**: Name, gender, age, role, skill set
- **Agent Binding**: Attach an Agent instance (LLM / CLI / Web)
- **Personality Template**: Randomly assigned from 12 archetype pool (e.g., "Chatterbox", "Zen Slacker", "Anxious Perfectionist")
- **Memory System**: Initialize Memory instance (long-term + short-term + history summary + social impressions)
- **Toolbox**: Initialize AgentToolKit (shell, file I/O, search, etc.)

#### Phase 2 — Onboarding

The employee uses its own LLM capability to generate a self-introduction:

1. Build a prompt containing its persona settings (name, role, personality archetype)
2. Call `chat()` to have the LLM generate:
   - **Self-introduction** — a paragraph about themselves
   - **Signature** — a personal tagline
   - **Personality description** — behavioral traits
3. Persist generated content to employee state
4. Send a greeting message to the Boss (`sendMailToBoss`)

#### Phase 3 — Wake Up

Triggered on app startup or session refresh. Injects full identity into the Agent's conversation context:

- **System Message**: Personal info, behavioral norms, skill list
- **Long-term Memory**: Top 20 entries by importance
- **Short-term Memory**: Top 10 active (non-expired) entries
- Calls `agent.chat()` to warm up the session — the Agent "remembers who it is"

#### Phase 4 — Poll Cycle

Each employee runs an independent random-interval timer:

- **Interval**: 10 seconds ~ 5 minutes (simulates human-like irregular checking behavior)
- **Each Cycle**: Scan all joined groups (work groups + lounge groups), check for unread messages
- **Lounge Groups**: After idle threshold, 15% chance of initiating a topic spontaneously

#### Phase 5 — Read Group Messages

When unread messages are detected:

1. Separate **read messages** (old context) from **unread messages** (new, requiring response)
2. Wait 5–20s random jitter (simulates "thinking/typing" time)
3. Any messages arriving during jitter are absorbed into the unread batch
4. Enter flow-of-thought phase

#### Phase 6 — Flow-of-Thought (Agent Think)

Constructs a full prompt context and calls the LLM for decision-making.

**Input (injected into LLM):**

| # | Input | Description |
|---|-------|-------------|
| 1 | Personal Info | Name, role, personality, speaking style |
| 2 | Settings & Abilities | Behavioral norms, role definition, skills |
| 3 | Scene Context | Group name, members, department mission, requirement description |
| 4 | Chat History | Last 20 messages (read/unread markers) |
| 5 | Memory | Rolling history summary + Long-term (top 15) + Short-term (top 10) |
| 6 | Social Memory | Relationship impressions of message senders (name, impression, affinity) |
| 7 | Dedup Hint | If colleagues already replied with similar content → "don't repeat others" |
| 8 | Perspective Seed | Random thinking angle ("pragmatic", "innovative", "risk-focused") to prevent opinion convergence |

**LLM Structured Output (JSON):**

```json
{
  "innerThoughts": "Internal monologue with personality and emotion",
  "topicSaturation": 5,
  "shouldSpeak": true,
  "reason": "Why I decided to speak/stay silent",
  "messages": [{ "content": "The actual reply" }],
  "memorySummary": "Compressed summary of old messages",
  "memoryOps": [
    { "op": "add", "type": "long_term", "content": "...", "category": "fact", "importance": 8 },
    { "op": "add", "type": "short_term", "content": "...", "ttl": 3600 },
    { "op": "delete", "id": "mem_xxx" }
  ],
  "relationshipOps": [
    { "employeeId": "emp_123", "name": "Alice", "impression": "Strong coder, reliable", "affinity": 75 }
  ]
}
```

### Reply Decision Gates

After the LLM's flow-of-thought, the reply passes through multiple filter gates:

```
LLM returns shouldSpeak=true
        │
        ▼
┌─────────────────────┐     ┌──────────┐
│ Topic Saturation ≥7?│──▶  │ 🔇 Silent│
└─────────┬───────────┘     └──────────┘
          │ No
          ▼
┌─────────────────────┐     ┌──────────┐
│ Anti-spam: Too many │──▶  │ 🔇 Silent│
│ messages in window? │     └──────────┘
└─────────┬───────────┘
          │ No
          ▼
┌─────────────────────┐     ┌──────────┐
│ Cooldown active?    │──▶  │ 🔇 Silent│
└─────────┬───────────┘     └──────────┘
          │ No
          ▼
     ┌──────────┐
     │ ✅ Speak │
     └──────────┘
```

| Gate | Mechanism | Parameters |
|------|-----------|------------|
| **Topic Saturation** | LLM self-rates 1–10; ≥ 7 forces silence | threshold = 7 |
| **Anti-spam (Work)** | Max 2 messages per 5-minute window | window=5min, max=2 |
| **Anti-spam (Lounge)** | Max 4 messages per 10-minute window | window=10min, max=4 |
| **Cooldown (Work)** | 60s silence after speaking | cooldown=60s |
| **Cooldown (Lounge)** | 30s silence after speaking | cooldown=30s |

### Chain Reaction

After an employee sends a message:

1. Message is written to the group chat log
2. Send timestamp is recorded (for anti-spam)
3. **Nudge all other group members** with random delay → triggers their `_processGroupMessages`, creating an autonomous conversation loop

---

## Memory System

### Memory Architecture

```
Memory
  ├── 📜 historySummary    — Rolling AI-compressed summary of old messages (per-group)
  ├── 💾 longTerm          — Permanent storage, sorted by importance (1–10), cap: 200
  ├── ⚡ shortTerm          — TTL-based auto-expiry, default 24h, cap: 20
  └── 👥 relationships     — Social impression table: Map<employeeId, {name, impression, affinity}>
```

### Per-Conversation Memory Input

| # | Input | Description |
|---|-------|-------------|
| 1 | Personal Info | Name, role, age, gender, personality, signature |
| 2 | Settings & Abilities | System prompt, skill list, behavioral norms |
| 3 | Scene Context | Group name, members, department mission, requirement |
| 4 | Chat History | Last 20 messages (read/unread markers) |
| 5 | Layered Memory | Long-term (top 15) + Short-term (top 10) + Rolling summary |
| 6 | Social Memory | Relationship impressions of message senders |

### LLM Output → Memory Updates

| # | Output | Description |
|---|--------|-------------|
| 1 | Reply | `messages[]` — actual messages sent to group chat |
| 2 | Memory Ops | `memoryOps[]` — add/delete long-term & short-term entries with importance and category |
| 3 | History Summary | `memorySummary` — compressed key points, incrementally appended |
| 4 | Social Memory | `relationshipOps[]` — update impressions (≤30 chars) and affinity (1–100) |
| 5 | Actions | Tool calls (shell, file ops) or command execution |

### Social Memory (Relationships)

Each employee maintains an impression table for every other employee (including the Boss):

| Field | Description |
|-------|-------------|
| `employeeId` | Target employee ID |
| `name` | Target name |
| `impression` | ≤30 characters (e.g., "Great coder, helped me debug, reliable") |
| `affinity` | 1–100 scale (1=hostile, 50=neutral, 100=best friend), ±5–15 per interaction |

- Social memories are only injected when the corresponding employee appears in the chat
- Affinity displayed as emoji: ❤️(≥80) 😊(≥60) 😐(≥40) 😒(≥20) 💢(<20)
- Token cost is minimal: ~30 chars per person, 10 colleagues ≈ 150 tokens

### Memory Management Strategies

| Strategy | Description |
|----------|-------------|
| **Incremental Ops** | AI uses `memoryOps` (add/delete/update), never full replacement — prevents accidental data loss |
| **Dedup Check** | New entries are checked against existing first 80 characters |
| **TTL Auto-cleanup** | Short-term memories expire automatically |
| **Importance Pruning** | When long-term exceeds 200 entries, lowest importance entries are dropped |
| **Rolling Compression** | When history summary grows too long, oldest summary segments are discarded |
| **Persistence** | All memory is serialized via `Memory.serialize()` to local storage |

---

## Project Structure

```
IdeaCo/
├── src/
│   ├── app/                        # Next.js App Router + API Routes
│   │   └── api/                    # RESTful endpoints for all features
│   ├── components/                 # React UI components
│   │   ├── PixelOffice.jsx         # Pixel-art virtual office
│   │   ├── GroupChatView.jsx       # Group chat interface
│   │   ├── AgentDetailModal.jsx    # Employee profile card
│   │   ├── RequirementDetail.jsx   # Requirement workflow view
│   │   └── ...
│   ├── core/                       # Core engine
│   │   ├── agent/                  # Agent layer (LLM communication)
│   │   │   ├── base-agent.js       # Abstract base class
│   │   │   ├── llm-agent/          # OpenAI-compatible API agent
│   │   │   ├── cli-agent/          # CLI tool agent (Claude Code, Codex, CodeBuddy)
│   │   │   └── web-agent/          # Browser-based web agent (ChatGPT Web)
│   │   ├── employee/               # Employee layer
│   │   │   ├── base-employee.js    # Core employee logic
│   │   │   ├── lifecycle.js        # Autonomous behavior (poll, think, reply)
│   │   │   ├── memory/             # Memory system (long/short-term, social)
│   │   │   ├── secretary.js        # Secretary — boss's AI assistant
│   │   │   ├── skills.js           # Skill management
│   │   │   ├── knowledge.js        # Knowledge base integration
│   │   │   └── performance.js      # Performance tracking
│   │   ├── organization/           # Organization layer
│   │   │   ├── company.js          # Company entity & state machine
│   │   │   ├── department.js       # Department lifecycle
│   │   │   ├── team.js             # Cross-department task forces
│   │   │   ├── group-chat-loop.js  # Group chat event loop
│   │   │   └── workforce/          # HR, talent market, role archetypes
│   │   ├── system/                 # System services
│   │   │   ├── audit.js            # Cost & usage auditing
│   │   │   ├── cron.js             # Scheduled tasks
│   │   │   └── plugin.js           # Plugin system
│   │   ├── prompts.js              # All LLM prompt templates
│   │   ├── requirement.js          # Requirement workflow engine
│   │   └── workspace.js            # File workspace management
│   ├── lib/                        # Frontend utilities
│   │   └── store.js                # Zustand global state
│   └── locales/                    # i18n (zh/en/ja/ko/es/de/fr)
├── data/                           # Runtime data (auto-created)
├── workspace/                      # Agent-produced files per department
├── electron/                       # Electron desktop app shell
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## Data Flow

```
👤 Boss
 │
 │  Chat message
 ▼
🧑‍💼 Secretary ──────────────────────────────────┐
 │                                              │
 │  Understands intent                          │  Simple task
 │                                              │  → handles directly
 ▼                                              ▼
┌─────────────┐   ┌──────────────┐    ┌─────────────────┐
│ Create Dept │   │ Create Team  │    │ Direct Response  │
└──────┬──────┘   └──────┬───────┘    └─────────────────┘
       │                 │
       ▼                 ▼
┌─────────────┐   ┌──────────────┐
│  HR Hiring  │   │  Assign Req  │
└──────┬──────┘   └──────┬───────┘
       │                 │
       ▼                 ▼
┌─────────────────────────────────────────┐
│            💬 Group Chat                 │
│                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ Emp A   │  │ Emp B   │  │ Emp C   │ │
│  │ (poll)  │  │ (poll)  │  │ (poll)  │ │
│  └────┬────┘  └────┬────┘  └────┬────┘ │
│       │            │            │       │
│       ▼            ▼            ▼       │
│  ┌─────────────────────────────────┐    │
│  │      🧠 Flow-of-Thought        │    │
│  │  ┌────────┐ ┌───────┐ ┌──────┐ │    │
│  │  │ Memory │ │ Social│ │ Anti │ │    │
│  │  │ System │ │ Memory│ │ Spam │ │    │
│  │  └────────┘ └───────┘ └──────┘ │    │
│  └─────────────────────────────────┘    │
│       │                                 │
│       ▼                                 │
│  Reply → Nudge Others → Chain Reaction  │
└─────────────────────────────────────────┘
       │
       ▼
  📁 Deliverables (workspace/)
```
