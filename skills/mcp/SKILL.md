---
name: mcp
description: >
  MCP Server architecture — all MCP tool definitions, parameters, forwarding logic. Kiro ↔ Gateway bridge.
  Triggers: mcp, MCP, tool, tools, mcp-server, bridge, send_whatsapp, recall, journal, knowledge, task, report_task, skill
version: 1.0.0
allowed-tools: []
---

# MCP Server Architecture

## Overview

`src/mcp-server.js` is the bridge between Kiro and Gateway. After Wave 1 consolidation, tools are organized as:

## Consolidated Tools (Wave 1A+1B+2)

| Tool | Actions | Replaces |
|------|---------|----------|
| issue | create, list, update, close, stats | create_issue, list_issues, update_issue, close_issue, issue_stats |
| mc | create-plan, plan-status, update-task, set-analysis, execute | create_plan, get_plan_status, update_mc_task, set_plan_analysis, execute_plan |
| task | dispatch, check, cancel | dispatch_task, check_task, cancel_task |
| git | remote, lock, unlock | git_remote_ops, request_push_lock, release_push_lock |
| whatsapp | send, send-media | send_whatsapp, send_whatsapp_media |
| knowledge | search, get, save | knowledge, save_knowledge |
| session | history, pending, summarize | get_session_history, get_pending_sessions, summarize_session |
| ai | usage, status, reset | ai_usage, ai_status |
| worker | ops, reset | worker_ops, reset_worker |

> Old tool names still work via alias layer (`src/alias-registry.js`).

## Independent Tools

| Tool | Description | Forwards to |
|------|-------------|-------------|
| get_gateway_status | Gateway status | Gateway /api/health |
| skill | Manage skills | Local skill-loader |
| get_weather | Weather query | Gateway /api/weather |
| restart_gateway | PM2 restart | Local exec |
| download_file | Download file | Gateway /api/download |
| analyze_image | Image analysis | Gateway /api/analyze-image |
| journal | Journal management | Memory Engine |
| recall | Memory search | Memory Engine |
| report_task_result | Worker report result | Gateway /api/task/:id/report |
| run_tests | Run tests | Local npm test |

---

## Forwarding Logic

MCP Server reads `.gateway-port` and `.memory-engine-port` on startup to get dynamic ports. All Gateway API calls go through `http://localhost:{gatewayPort}`, Memory Engine through `http://localhost:{memoryPort}`.

**Worker auto-registration:** MCP Server POSTs to `/api/worker/register` on startup, re-registers every 30s.

---

## Modification Guide

**Adding a new MCP tool:**
1. `src/mcp-server.js` — Add tool definition in ListToolsRequestSchema
2. `src/mcp-server.js` — Add handler in CallToolRequestSchema switch case
3. If Gateway API needed → `src/gateway/server.js` setupExpress() add route
