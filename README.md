<p align="center">
  <img src="docs/hero-banner.png" width="700" alt="MyKiroHero — Your AI WhatsApp Assistant" />
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/tag/NorlWu-TW/MyKiroHero?label=version&style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/node-18%2B-brightgreen?style=flat-square&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" />
</p>

<h1 align="center">MyKiroHero</h1>

<p align="center">
  <strong>Your Kiro AI, now living inside WhatsApp.</strong><br/>
  Zero cloud. Zero servers. Just you, Kiro, and a QR code away from magic.
</p>

<p align="center">
  🌐 <a href="README.md">English</a> · <a href="README-zh.md">繁體中文</a>
</p>

<p align="center">
  🎬 <a href="https://github.com/user-attachments/assets/7112a3c9-b43b-4638-b56f-582383651c7f"><b>Feature Overview ▶️</b></a>
</p>

https://github.com/user-attachments/assets/7112a3c9-b43b-4638-b56f-582383651c7f

---

> **⚠️ Hold up — read this before you install.**
>
> - Your WhatsApp links via QR code (same as WhatsApp Web). Only **one** web session at a time — open WhatsApp Web elsewhere and this one drops.
> - Everything stays **on your machine**. Nothing phones home. But your machine needs to stay awake for the AI to reply.
> - Built on [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) (Puppeteer). WhatsApp can change their web interface without notice — the Gateway self-heals through most hiccups, but prolonged outages can happen.
> - **Windows folks**: Install under your user folder (e.g., `%USERPROFILE%\MyHero`). System-protected paths like `C:\` root will cause headaches.

---

## 🚀 Up and Running in 3 Steps

**Prerequisites:** [Node.js 18+](https://nodejs.org/) and [Kiro IDE](https://kiro.dev/). That's the whole shopping list.

```bash
git clone https://github.com/NorlWu-TW/MyKiroHero.git
cd MyKiroHero
node install.js
```

The installer guides you through 5 stages: environment check → project setup → personality → AI providers (optional) → launch. About 3 minutes, coffee not included.

**Scan the QR code** when it pops up → boom, your AI is live on WhatsApp. 🎉

### Already installed? Upgrade:

```bash
node install.js --upgrade
```

Pulls the latest code, updates dependencies, and keeps your config, data, and personality intact.

---

## 🏗️ Architecture

<p align="center">
  <img src="docs/architecture.png" width="600" alt="MyKiroHero Architecture" />
</p>

---

## What's in the Box?

| | Feature | |
|---|---------|---|
| 🗣️ | **WhatsApp Chat** | Talk to your AI from anywhere — phone, tablet, desktop |
| 🧠 | **Persistent Memory** | Conversations, journals, full-text search — it actually remembers |
| ⏰ | **Heartbeat Scheduler** | Morning greetings, backup routines, reminders — runs while you sleep |
| 🎭 | **Custom Personality** | Name it, style it, give it an emoji — make it yours |
| 🖼️ | **Image & Voice** | Generate images, text-to-speech, transcribe voice messages |
| 📨 | **Send Queue** | Messages never collide — text, images, voice all flow in order |
| 🔄 | **Self-Healing** | Disconnected? It reconnects. Stuck? It recovers. Automatically. |
| 🔌 | **Extensible Skills** | Weather, knowledge base, web browsing, and whatever you build next |
| 👷 | **Multi-Worker** | Spin up multiple Kiro instances to tackle tasks in parallel |
| 🔒 | **100% Local** | Your data never leaves your machine. Period. |

---

## 👷 Worker System — Think Bigger, Build Faster

<p align="center">
  <img src="docs/worker-system.png" width="600" alt="Worker System Architecture" />
</p>

One Kiro is smart. Multiple Kiros working together? That's a squad. MyKiroHero lets you spin up Worker instances that take on coding tasks while the Commander orchestrates everything.

```bash
node scripts/setup-worker.js          # Interactive setup
node scripts/setup-worker.js worker-4  # Quick setup with ID
```

### Under the hood

- **3-Layer Task Engine** — Layer 1 runs instantly (git, crawl), Layer 2 calls LLM APIs (TTS, image-gen), Layer 3 dispatches to Workers (code tasks)
- **Round-Robin Dispatch** — Work gets spread evenly across idle Workers
- **Health Pulse** — Gateway pings every 30s; 90s silence = marked offline
- **Auto-Rejoin** — Workers that come back online slot right back in
- **Failover Retry** — If one Worker chokes, the task bounces to another
- **Watchdog Timer** — Stuck tasks auto-fail after timeout (default 300s)
- **Clean Cancel** — Cancelled tasks trigger a clean revert (branch cleanup, code reset to main)
- **Result Pipeline** — Workers report back via `report_task_result()`, Commander stays in the loop

Each Worker gets its own personality, tools, and lessons — and can independently commit, push, and merge code.

---

## 💓 Heartbeat — Your AI's Daily Routine

Edit `.kiro/steering/HEARTBEAT.md`:

```markdown
## Schedules
09:00 Morning greeting
14:00 Check my to-do list
04:00 Backup memories
```

Gateway picks it up automatically. No restart, no fuss.

---

## 🌐 Remote Dashboard — Access from Your Phone

Gateway auto-starts a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) on boot, giving you a public HTTPS URL to your dashboard — no port forwarding needed.

- URL prints to console on startup and saves to `.tunnel-url`
- Free tier: URL changes on every restart
- WebSocket works over wss:// automatically
- `cloudflared` binary required in `bin/` (auto-downloaded on first install, or grab it from [cloudflare/cloudflared releases](https://github.com/cloudflare/cloudflared/releases))
- If `cloudflared` is missing, Gateway starts normally without tunnel — no crash

> Tip: Tell your AI "tunnel URL" and it'll send you the link on WhatsApp.

---

## 🔄 Backup & Restore — Your AI's Soul is Portable

Back up your AI's entire personality and memory to a private GitHub repo. Switch machines, restore in seconds.

**Setup:** Create a private repo, grab a [Personal Access Token](https://github.com/settings/tokens) (`repo` scope), drop it in `.env`:

```env
MEMORY_REPO=https://github.com/YourName/SoulAndMemory
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

**What travels:** steering (personality & rules), knowledge base, journals, sessions, summaries — the whole soul.

**Backup** happens automatically on `--upgrade`, or just tell your AI: "backup memories".

**Restore** during fresh install (Step 3 asks), or anytime: `node install.js --restore`

---

## 🤖 AI Providers — Optional Superpowers

Kiro handles chat, memory, and skills on its own. Plug in external AI to unlock more:

| Capability | Providers |
|------------|-----------|
| 🖼️ Image Generation | Gemini, OpenAI, Stability AI, xAI Grok |
| 🗣️ Text-to-Speech | Gemini, OpenAI, ElevenLabs |
| 🎤 Speech-to-Text | Gemini, OpenAI, ElevenLabs |

During install, just paste an API key — auto-detected, auto-configured. Manage later with `node install.js --manage-ai`.

> Skip this entirely? No problem. Chat, memory, and skills work perfectly without external AI. Zero cost.

---

<details>
<summary><h2>📖 Under the Hood</h2></summary>

### MCP Tools (19)

| Tool | What it does |
|------|-------------|
| `whatsapp` | Send text messages or media (images, files, voice) |
| `get_gateway_status` | Gateway health check |
| `analyze_image` | Vision — understand what's in an image |
| `get_weather` | Weather lookup |
| `skill` | Manage skills (list / find / load) |
| `knowledge` | Knowledge base — search, read, or save entries |
| `journal` | Journal entries (events, thoughts, lessons, todos) |
| `recall` | Search across all memory layers |
| `session` | Session management — history, pending summaries, save summary |
| `summarize_session` | Get or save a session summary |
| `download_file` | Download files from URLs |
| `ai` | AI provider management — usage stats and provider status/reset |
| `task` | Manage tasks — dispatch (Layer 1/2/3), check status, or cancel |
| `report_task_result` | Worker reports completion |
| `run_tests` | Run project tests with compact pass/fail summary |
| `worker` | Worker management — send ops commands or force-reset stuck workers |
| `git` | Git remote ops (fetch/pull/push/clone) and push queue (lock/unlock) |
| `issue` | Issue Tracker — create, list, update, close, stats |
| `mc` | Mission Control — plans, tasks, analysis, execution |
| `restart_gateway` | Restart the Gateway process |

### WhatsApp Reliability

- **Send Queue** — Every outbound message serialized. Zero race conditions.
- **Smart Retry** — Transient errors back off and retry. Permanent errors fail fast.
- **Auto-Reconnect** — Exponential backoff with cache cleanup for stuck sessions.
- **Health Monitor** — Periodic heartbeat catches zombie connections before you notice.

### Memory Architecture

| Layer | Where it lives |
|-------|---------------|
| Conversations | `sessions/YYYY-MM-DD.jsonl` |
| Journal | `memory/journals/` |
| Knowledge | `skills/memory/` |
| Search Index | `data/memory.db` (SQLite + FTS5) |

### Project Layout

```
MyKiroHero/
├── src/
│   ├── gateway/          # Server, WhatsApp adapter, config
│   │   ├── handlers/     # Message classifier, dispatch, IDE handlers
│   │   ├── tasks/        # Task handlers (tts, image-gen, git-ops, worker-dispatch…)
│   │   └── stt/          # Speech-to-text adapters
│   ├── memory/           # SQLite+FTS5 engine, indexer, journal, search
│   ├── skills/           # Skill loader, search engine
│   └── mcp-server.js     # MCP tool definitions
├── scripts/
│   └── setup-worker.js   # Worker installer
├── skills/               # Extensible agent skills
├── templates/            # Steering templates for new installs
├── install.js            # Interactive installer
└── ecosystem.config.js   # PM2 configuration
```

</details>

---

## 🤝 Contributing

Found a bug? Got a wild idea? [Open an issue](https://github.com/NorlWu-TW/MyKiroHero/issues) — let's talk.

---

## Third-Party Licenses

- **vscode-rest-control** (MIT) © 2024 Darien Pardinas Diaz — [GitHub](https://github.com/dpar39/vscode-rest-control)
- **whatsapp-web.js** (Apache-2.0) — [GitHub](https://github.com/pedroslopez/whatsapp-web.js)

---

<p align="center">
  MIT License · Made with ❤️ in Taiwan
</p>
