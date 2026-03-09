---
name: gateway
description: >
  Gateway core architecture — message flow, WhatsApp adapter, routing, handlers, dispatch controller, message classifier.
  Triggers: gateway, server, message, whatsapp, WA, adapter, router, handler, dispatch, fragment, classifier, classify, connection, reconnect, QR, receive message, send message, reply
version: 1.0.0
allowed-tools: []
---

# Gateway Architecture

## Overview

Gateway is MyKiroHero's core message hub, responsible for WhatsApp connection, message send/receive, and routing dispatch.

**Entry point:** `src/gateway/index.js` → Start Gateway + WhatsApp

---

## File List

| File | Description |
|------|-------------|
| index.js | Main entry point |
| server.js | MessageGateway class (Express + WebSocket + Heartbeat) |
| config.js | Configuration (reads .env) |
| whatsapp-adapter.js | WhatsApp connection (QR/auth/send-receive/auto-reconnect) |
| direct-router.js | Direct reply router (bypasses Kiro) |
| session-logger.js | Session JSONL logger |
| usage-tracker.js | AI usage tracking |
| weather-handler.js | Weather query (used by DirectRouter) |
| handlers/index.js | Handler factory |
| handlers/base-handler.js | Handler base class |
| handlers/kiro-handler.js | Kiro IDE Handler (REST API forwarding) |
| handlers/kiro-cli-handler.js | Kiro CLI Handler |
| handlers/dispatch-controller.js | Fragment message coalescing state machine |
| handlers/message-classifier.js | Message completeness scoring (weighted model) |


---

## Core Data Flow

```
WhatsApp message arrives:
  whatsapp-adapter.js (message_create event)
    → Dedup (processedMessages Set)
    → Download media (if hasMedia)
    → gateway/server.js receiveMessage()
      → message-classifier.js classifyMessage() scoring
      → dispatch-controller.js handleMessage() fragment coalescing
        → Complete message: dispatch directly
        → Fragment: buffer → 3s timeout or maxMessages then coalesce
      → directRouter.tryHandle() attempt direct reply
        → Match: reply directly (bypasses Kiro)
        → No match: continue
      → runHandlers() → kiro-handler.js
        → POST /api/message to Kiro REST Control
        → Kiro processes then replies via MCP tool

Kiro reply:
  mcp-server.js (whatsapp tool, action: "send")
    → POST /api/reply to Gateway
    → server.js sendReply()
      → whatsapp-adapter.js sendMessage()
        → whatsapp-web.js client.sendMessage()
```

---

## Key Classes

### WhatsAppAdapter (whatsapp-adapter.js)
- `_createClient()` — Create Puppeteer Client (protocolTimeout: 180000)
- `sendMessage(chatId, message)` — Send text
- `sendMedia(chatId, filePath, caption)` — Send media (auto-convert to OGG, with retry x2)
- `_reconnect(reason, clearCache)` — Auto-reconnect (exponential backoff, max 10 attempts)
- `_startHealthCheck()` — Health check every 2 minutes

### MessageGateway (server.js)
- `receiveMessage(platform, message)` — Message receive entry point
- `sendReply(platform, chatId, message)` — Send reply
- `sendMedia(platform, chatId, filePath)` — Send media
- `registerHandler(name, handler)` — Register message handler
- `setupDynamicHeartbeat()` — Read HEARTBEAT.md to configure schedule
- `splitMessage(text, maxLength)` — Split long messages (2000 chars)

### DispatchController (dispatch-controller.js)
- Fragment message coalescing state machine (IDLE → COLLECTING → DISPATCHING)
- collectTimeout: 3s (dispatch when no new messages)
- maxWait: 7s (total timeout)
- maxMessages: 3 (upper limit)

### MessageClassifier (message-classifier.js)
- Four-dimension weighted scoring: length(0.3) + punctuation(0.3) + timeDelta(0.2) + continuation(0.2)
- threshold: 0.6 (> 0.6 = complete message)
- Special messages (media/URL/pure emoji) always dispatch immediately

---

## Modification Guide

**Modifying message processing flow:**
1. Classification logic → `message-classifier.js`
2. Coalescing logic → `dispatch-controller.js`
3. Routing logic → `server.js` receiveMessage()

**Modifying WhatsApp behavior:**
1. Connection/reconnection → `whatsapp-adapter.js` _createClient() / _reconnect()
2. Receive messages → `whatsapp-adapter.js` setupEvents() message_create
3. Send messages → `whatsapp-adapter.js` sendMessage() / sendMedia()

**Adding new DirectRouter rules:**
1. `src/gateway/direct-routes.json` — Add matching rules
2. Or `src/gateway/direct-router.js` — Programmatic registration