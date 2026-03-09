# MyKiroHero Installation Architecture

> Last updated: 2026-02-17

## Overview

MyKiroHero uses a 5-step interactive CLI installer (`node install.js`) that handles environment checks, project setup, personalization, AI provider configuration, and service launch. All user configuration lives in `.env` (dotenv), and the runtime is managed by PM2 via `ecosystem.config.js`.

No packaging tools (pkg, Inno Setup, electron-builder) are used. The project is distributed as a Git repository and run directly with Node.js.

---

## Installation Methods

### One-liner (recommended)

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/NorlWu-TW/MyKiroHero/main/install.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/NorlWu-TW/MyKiroHero/main/install.sh | bash
```

These bootstrap scripts:
1. Check that `node` and `git` exist
2. `git clone` the repo (or `git pull` if already installed)
3. Run `node install.js` to start the interactive installer

### Manual

```bash
git clone https://github.com/NorlWu-TW/MyKiroHero.git
cd MyKiroHero
node install.js
```

---

## 5-Step Install Flow (`install.js`)

### Step 1: Language + Environment Check
- Prompt user to choose language (zh / en)
- Detect OS (Windows / macOS / Linux)
- Check Node.js version (>= 18 required)
- Check Git availability (with fallback to user-provided path)
- Locate Kiro CLI (searches known install paths)

### Step 2: Get Project + Install Dependencies
- If not already cloned, `git clone` the repo
- If already present, `git pull` to update
- Run `npm install`
- Install `vscode-rest-control` extension into Kiro (if Kiro CLI found)
- Auto-install `uvx` (uv tool runner) for AI MCP servers that need it

### Step 3: Personalization
- Copy `.env.example` → `.env` (if `.env` doesn't exist)
- Prompt for AI_PREFIX (display name + emoji for bot replies)
- Prompt for LANGUAGE preference
- Write values into `.env`

### Step 4: AI Provider Setup
- Show available providers from `ai-providers.json` registry
- User pastes API key → installer auto-detects provider via regex patterns
- Enable provider: writes API key to `.env`, sets `AI_PROVIDERS`, syncs MCP config
- Supports multiple keys (loop until user is done)
- Can be re-run later: `node install.js --manage-ai`

### Step 5: Launch + Install Report
- Start Gateway via PM2 (`pm2 start ecosystem.config.js`)
- Display QR code instructions for WhatsApp pairing
- Show install report: completed items, warnings, next steps

---

## Additional Modes

| Flag | Purpose |
|------|---------|
| `--test` | Auto-answer all prompts with defaults (CI/testing) |
| `--upgrade` | Pull latest code, npm install, backfill new .env vars, restart PM2 |
| `--manage-ai` | Re-run AI provider setup (add/remove keys, change models) |
| `--restore` | Restore memory from GitHub backup repo |

---

## Configuration

### `.env` (primary config file)

All runtime configuration is driven by environment variables loaded via `dotenv`. Key sections:

| Section | Variables | Purpose |
|---------|-----------|---------|
| General | `LANGUAGE`, `AI_PREFIX`, `GATEWAY_PORT`, `MESSAGE_MAX_LENGTH` | Core behavior |
| Fragment | `FRAGMENT_SCORE_THRESHOLD`, `FRAGMENT_COLLECT_TIMEOUT`, etc. | Message coalescing |
| IDE | `IDE_TYPE`, `IDE_REST_PORT` | IDE integration (kiro/cursor/windsurf) |
| Owner | `OWNER_CHAT_ID` | WhatsApp owner identification |
| AI Providers | `AI_PROVIDERS`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, etc. | External AI services |
| AI Models | `AI_MODEL_IMAGE`, `AI_MODEL_TTS`, `AI_MODEL_STT` | Model selection per capability |
| STT | `STT_PROVIDER` | Speech-to-text provider choice |
| Memory | `MEMORY_REPO`, `GITHUB_TOKEN` | Soul/memory backup to GitHub |
| Tasks | `TASK_OUTPUT_DIR`, `WORKER_MODE` | Task dispatch system |

See `.env.example` for the full list with comments.

### `ai-providers.json` (AI provider registry)

Declarative registry of supported AI providers. Used by:
- `install.js` — auto-detect provider from pasted API key
- `AiProviderManager` — enable/disable providers, sync MCP config, validate keys
- `--upgrade` — check for deprecated models, suggest alternatives

Each provider entry includes: key pattern (regex), capabilities, MCP server config, and available models with status.

### `ecosystem.config.js` (PM2 process config)

Defines two PM2 processes:

| Process | Script | Purpose |
|---------|--------|---------|
| `gateway` | `src/gateway/index.js` | Main Gateway server (WhatsApp, REST API, handlers, task dispatch) |
| `recall-worker` | `src/memory/engine.js` | Background memory indexing engine |

Both run with `autorestart: true` and `NODE_ENV: production`.

### `src/gateway/config.js` (runtime config loader)

Reads `.env` via dotenv and exports a structured config object. Handles:
- Port resolution (env → `.gateway-port` file → auto)
- Path resolution (relative → absolute via `path.resolve`)
- Type coercion (string env vars → numbers/booleans)

---

## Runtime Architecture

```
WhatsApp ──→ Gateway (Express) ──→ IDE Handler ──→ Kiro/Cursor/Windsurf
                │
                ├── DirectRouter (weather, URL handlers)
                ├── TaskExecutor (task dispatch to Workers)
                ├── Mission Control (SQLite DB, dashboard)
                ├── STT Service (voice → text)
                ├── AI Router (provider rotation, cooldown)
                ├── Worker Registry (track Worker Kiro instances)
                ├── Session Logger (conversation history)
                └── Push Queue Manager (outbound message queue)
```

### Key Components

- **AiProviderManager** (`src/ai-provider-manager.js`): Manages provider enable/disable, API key storage in `.env`, MCP config sync to `.kiro/settings/mcp.json`, model selection.
- **AI Router** (`src/ai-router.js`): Routes AI capability requests (image/tts/stt) to enabled providers with cooldown, rate limiting, and fallback.
- **Gateway Server** (`src/gateway/server.js`): Express HTTP server with WebSocket support for dashboard.
- **Mission Control DB** (`src/gateway/mission-control-db.js`): SQLite database for plans, tasks, issues.
- **Task Queue** (`src/gateway/task-queue-sqlite.js`): SQLite-backed task queue sharing the MC database.

---

## File Structure (actual)

```
MyKiroHero/
├── .env                        # User config (created by installer)
├── .env.example                # Config template with all variables
├── .gateway-port               # Last-used port (for stability across restarts)
├── ai-providers.json           # AI provider registry
├── ecosystem.config.js         # PM2 process definitions
├── install.js                  # Interactive CLI installer (5-step)
├── install.ps1                 # Windows one-liner bootstrap
├── install.sh                  # macOS/Linux one-liner bootstrap
├── package.json                # Dependencies and scripts
├── scripts/
│   ├── open-dashboard.js       # Open Mission Control dashboard
│   ├── setup-worker.js         # Setup Worker Kiro instance
│   └── sync-worker-steering.js # Sync steering files to workers
├── skills/                     # Domain knowledge and skill definitions
├── memory/                     # Local memory storage (journals, etc.)
├── data/                       # SQLite databases (mission-control.db)
├── temp/                       # Task output, downloads
└── src/
    ├── ai-provider-manager.js  # Provider lifecycle management
    ├── ai-router.js            # AI capability routing
    ├── ai-router-init.js       # Router factory
    ├── alias-registry.js       # MCP tool alias resolution (old → new names)
    ├── mcp-server.js           # MCP tool definitions (20 unified tools)
    ├── memory-backup.js        # GitHub memory backup
    ├── memory-restore.js       # GitHub memory restore
    ├── utils/                  # Shared utilities (timezone, etc.)
    ├── whatsapp/               # WhatsApp client management
    ├── memory/                 # SQLite+FTS5 engine, indexer, journal, search
    ├── skills/                 # Skill loader, search engine
    └── gateway/
        ├── config.js           # Runtime config (reads .env)
        ├── index.js            # Entry point (starts everything)
        ├── server.js           # Express + WebSocket server
        ├── whatsapp-adapter.js # WhatsApp Web.js integration
        ├── direct-router.js    # Direct command routing
        ├── direct-routes.json  # Route definitions
        ├── task-executor.js    # Task dispatch engine
        ├── task-queue.js       # In-memory task queue
        ├── task-queue-sqlite.js# SQLite task queue
        ├── task-splitter.js    # Task splitting logic
        ├── task-templates.js   # Task template engine
        ├── mission-control-db.js # Mission Control database
        ├── mission-control-routes.js # MC REST API
        ├── worker-registry.js  # Worker Kiro tracking
        ├── worker-spawner.js   # Auto-spawn Worker Kiro
        ├── worker-stats.js     # Worker statistics
        ├── push-queue-manager.js # Outbound message queue
        ├── session-logger.js   # Conversation logging
        ├── review-learner.js   # Code review learning
        ├── usage-tracker.js    # AI usage tracking
        ├── weather-handler.js  # Weather queries
        ├── handlers/           # IDE-specific message handlers
        ├── stt/                # Speech-to-text adapters
        ├── tts/                # Text-to-speech adapters
        ├── tasks/              # Task handlers (tts, image-gen, git-ops, worker-dispatch…)
        ├── task-templates/     # Task template definitions
        └── dashboard/          # Mission Control web UI
```

---

## Upgrade Flow (`node install.js --upgrade`)

1. Backup memories to GitHub (if `MEMORY_REPO` configured)
2. `git pull origin main`
3. `npm install`
4. Backfill new `.env` variables from `.env.example` (preserves existing values)
5. Check AI provider updates (deprecated models, new providers)
6. `pm2 restart gateway && pm2 restart recall-worker`
7. Show changelog (recent git commits)
