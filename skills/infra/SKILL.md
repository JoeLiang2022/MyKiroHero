---
name: infra
description: >
  Infrastructure architecture — deployment, PM2 config, install scripts, Worker templates, backup & restore.
  Triggers: infra, deploy, deployment, PM2, pm2, install, ecosystem, script, template, backup, restore, setup, worker-setup
version: 1.0.0
allowed-tools: []
---

# Infra Architecture

## Overview

Deployment config, PM2 process management, Worker install scripts, steering templates, memory backup & restore.

---

## File List

| File | Description |
|------|-------------|
| ecosystem.config.js | PM2 config |
| install.js | Install script |
| scripts/setup-worker.js | Worker install script |
| templates/worker-steering/ | Worker steering templates |
| src/memory/memory-backup.js | Memory backup |
| src/memory/memory-restore.js | Memory restore |

---

## PM2 Processes

| Process | Entry | Description |
|---------|-------|-------------|
| gateway | src/gateway/index.js | Main Gateway |
| recall-worker | src/memory/engine.js | Memory Engine |

---

## Config Files

| File | Description |
|------|-------------|
| .env | Environment variables (API keys, port, etc.) |
| .gateway-port | Gateway dynamic port |
| .memory-engine-port | Memory Engine dynamic port |
| .rest-control-port | Kiro REST Control port |
| ecosystem.config.js | PM2 config |
| ai-providers.json | AI Provider config |

---

## Worker Deployment

```
C:\Users\norl\Desktop\MyAIHero\
├── MyKiroHero/     # Commander
├── Worker1/        # Worker Kiro 1
├── Worker2/        # Worker Kiro 2
└── Worker3/        # Worker Kiro 3
```

Worker install: `scripts/setup-worker.js` copies required files + steering templates to Worker directory.
