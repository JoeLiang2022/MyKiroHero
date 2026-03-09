# MyKiroHero Setup Guide

> Last updated: 2026-02-17

## Architecture

```
WhatsApp ──→ Gateway (Express + PM2) ──→ IDE Handler ──→ Kiro / Cursor / Windsurf
                │
                ├── AI Router (image/tts/stt via external providers)
                ├── Task Dispatch (Worker Kiro instances)
                ├── Mission Control (plans, tasks, dashboard)
                └── Memory Engine (session logs, journals, knowledge base)
```

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | >= 18 | Recommended: latest LTS |
| Git | any | For cloning and updates |
| Kiro IDE | latest | With `vscode-rest-control` extension |
| PM2 | latest | `npm install -g pm2` (process manager) |
| WhatsApp | mobile app | For QR code pairing |

## Quick Install

### Manual (recommended)
```bash
git clone https://github.com/NorlWu-TW/MyKiroHero.git
cd MyKiroHero
node install.js
```

The installer walks through 5 steps: environment check, dependency install, personalization, AI provider setup, and launch.

## Post-Install Verification

### 1. Check PM2 processes
```bash
pm2 list
```
You should see `gateway` (online) and `recall-worker` (online).

### 2. Check Gateway health
```bash
curl http://localhost:<port>/api/health
```
The port is stored in `.gateway-port` or set via `GATEWAY_PORT` in `.env`.

### 3. Check WhatsApp connection
Look for in PM2 logs:
```
[WhatsApp] Client ready
```
```bash
pm2 logs gateway --lines 20
```

### 4. Check Kiro REST API
Kiro status bar should show "RC Port: 55139" (or your configured `IDE_REST_PORT`).

## Configuration

All config lives in `.env`. Copy from `.env.example` if not created by installer:
```bash
cp .env.example .env
```

Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `LANGUAGE` | `en` | Interface language (zh/en) |
| `AI_PREFIX` | `▸ *🤖 AI Assistant :*` | Bot reply prefix (name + emoji) |
| `GATEWAY_PORT` | `auto` | Gateway port (auto = random available) |
| `IDE_TYPE` | `kiro` | IDE type: kiro, cursor, windsurf, generic |
| `IDE_REST_PORT` | `55139` | IDE REST API port (auto-detected by extension) |
| `OWNER_CHAT_ID` | (empty) | Your WhatsApp chat ID (886...@c.us) |
| `AI_PROVIDERS` | (empty) | Enabled AI providers (comma-separated) |
| `STT_PROVIDER` | (empty) | Speech-to-text provider |
| `MEMORY_REPO` | (empty) | GitHub repo URL for memory backup |

See `.env.example` for the complete list with descriptions.

## AI Provider Setup

Run the AI setup wizard:
```bash
node install.js --manage-ai
```

Or manually edit `.env`:
1. Set API key: `GEMINI_API_KEY=AIza...`
2. Add to enabled list: `AI_PROVIDERS=gemini`
3. Optionally select models: `AI_MODEL_IMAGE=gemini:gemini-3-pro-image-preview`

Supported providers: Gemini (free tier), OpenAI, ElevenLabs (free tier), Stability AI, xAI Grok (free tier).

Provider details are in `ai-providers.json`.

## PM2 Management

```bash
# Start all services
pm2 start ecosystem.config.js

# Restart Gateway
pm2 restart gateway

# View logs
pm2 logs gateway
pm2 logs recall-worker

# Stop all
pm2 stop all

# Auto-start on boot
pm2 startup
pm2 save
```

## Upgrade

```bash
node install.js --upgrade
```

This pulls latest code, updates dependencies, backfills new `.env` variables, checks for deprecated AI models, and restarts PM2 services.

## Troubleshooting

### Gateway won't start
- Check `pm2 logs gateway` for errors
- Verify `.env` exists and has valid values
- Check port conflicts: `GATEWAY_PORT=auto` avoids this

### WhatsApp disconnected
- Delete `.wwebjs_auth/` and restart to re-pair: `pm2 restart gateway`
- Check `pm2 logs gateway` for QR code output

### Kiro REST API unreachable
- Verify `vscode-rest-control` extension is installed in Kiro
- Check Kiro status bar shows "RC Port: 55139"
- Try: Ctrl+Shift+P → "Reload Window" in Kiro

### AI features not working
- Run `node install.js --manage-ai` to verify provider setup
- Check API key validity in provider's dashboard
- Check `pm2 logs gateway` for API error messages

### Memory backup failing
- Verify `MEMORY_REPO` and `GITHUB_TOKEN` in `.env`
- Token needs repo write access

---

*For architecture details, see [INSTALLER-PLAN.md](INSTALLER-PLAN.md).*
