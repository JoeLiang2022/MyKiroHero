---
name: codebase
description: >
  MyKiroHero global architecture overview — directory structure, data flow, domain index. Load corresponding domain skill for details.
  Triggers: code, source code, architecture, module, source, codebase, flow, overview, directory, structure
version: 2.0.0
allowed-tools: []
---

# MyKiroHero Architecture Overview

## Project Overview

Node.js WhatsApp AI assistant, connects to WhatsApp via whatsapp-web.js, routes through Gateway to Kiro IDE, and replies via MCP Server.

**Tech Stack:** Node.js 25, whatsapp-web.js 1.34.6, Puppeteer 24.x, Express, better-sqlite3, PM2

---

## Domain Skills Index

Load corresponding domain for details using `skill({ action: "load", name: "xxx" })`:

| Domain | Coverage |
|--------|----------|
| **gateway** | Message flow, WA/TG adapter, routing, handlers, dispatch controller |
| **tasks** | Task system, Worker management, Layer 1/2/3 handlers, code review |
| **ai** | AI Provider, Router, STT, TTS |
| **memory** | Memory engine, search, journal, session (standalone skill) |
| **mcp** | MCP Server 22 tools definition and forwarding |
| **infra** | Deployment, PM2, install scripts, backup/restore |

---

## Directory Structure

```
src/
├── mcp-server.js              # MCP Server (→ mcp skill)
├── ai-provider-manager.js     # AI Provider (→ ai skill)
├── gateway/
│   ├── index.js               # Entry point (→ gateway skill)
│   ├── server.js              # MessageGateway
│   ├── config.js              # Configuration
│   ├── whatsapp-adapter.js    # WhatsApp connection
│   ├── direct-router.js       # Direct reply router
│   ├── session-logger.js      # Session logging
│   ├── task-executor.js       # Task Dispatch (→ tasks skill)
│   ├── task-queue.js          # Task queue
│   ├── worker-registry.js     # Worker management
│   ├── task-splitter.js       # Task splitting
│   ├── review-learner.js      # Review learning
│   ├── handlers/              # Message handlers
│   ├── tasks/                 # Task handlers (Layer 1/2/3)
│   └── stt/                   # STT adapters (→ ai skill)
├── memory/                    # Memory engine (→ memory skill)
├── skills/                    # Skill system
├── utils/                     # Utilities
└── whatsapp/                  # WA client utilities
```

---

## Core Data Flow

```
WA message → whatsapp-adapter → server.js receiveMessage()
  → classifier → dispatch-controller → directRouter / kiro-handler
  → Kiro processes → MCP tool → Gateway → WA reply

Task dispatch:
  task MCP → Gateway /api/task → task-executor
  → Layer 1: direct execution | Layer 2: AI API | Layer 3: Worker Kiro
```

---

## Modification Guide

Load the corresponding domain skill for detailed guidance based on what you're changing:
- Message handling/WA/routing → `gateway`
- Tasks/Worker → `tasks`
- AI/STT/TTS → `ai`
- MCP tools → `mcp`
- Deployment/config → `infra`
- Memory/search → `memory` (standalone skill)
