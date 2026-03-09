---
name: tasks
description: >
  Task system architecture — Task Dispatch, Worker management, Layer 1/2/3 task handlers, task templates, code review pipeline.
  Triggers: task, worker, dispatch, queue, executor, retry, layer, handler, review, code-review, merge, split, template, watchdog, failover, round-robin, health-check
version: 1.0.0
allowed-tools: []
---

# Tasks Architecture

## Overview

Three-layer task system: Layer 1 (zero token, direct execution), Layer 2 (LLM API), Layer 3 (Worker Kiro). Includes Worker management, auto retry, code review pipeline.

---

## File List

| File | Description |
|------|-------------|
| task-executor.js | Heartbeat + Task Dispatch executor (with retry + watchdog) |
| task-queue.js | Task queue (FIFO + state management) |
| worker-registry.js | Worker Kiro registration & management (idle/busy) |
| task-splitter.js | Task splitter (large task → sub-task array) |
| review-learner.js | Review failure learner (extract lessons → knowledge base) |
| tasks/index.js | Plugin handler auto-loader |
| tasks/tts.js | Layer 2: TTS |
| tasks/image-gen.js | Layer 2: Image generation |
| tasks/crawl.js | Layer 1: Web crawling |
| tasks/pdf-to-md.js | Layer 1: PDF to Markdown |
| tasks/git-ops.js | Layer 1: Git commit+push (zero token) |
| tasks/code-review.js | Layer 2: Code review |
| tasks/lint-test.js | Layer 1: ESLint + npm test |
| tasks/summarize.js | Layer 2: Text summarization |
| tasks/translate.js | Layer 2: Translation |
| tasks/health-report.js | Layer 1: System health report |
| tasks/session-summary.js | Layer 2: Session summary |
| tasks/worker-dispatch.js | Layer 3: Worker task dispatch |
| tasks/split-dispatch.js | Layer 3: Split sub-task batch dispatch |

---

## Task Dispatch Architecture (Layer 1/2/3)

```
Layer 1: Zero token (direct execution)
  git-ops, crawl, pdf-to-md, lint-test, health-report

Layer 2: LLM API (Gateway internal AiRouter)
  tts, image-gen, code-review, summarize, translate, session-summary

Layer 3: Worker Kiro (standalone Kiro IDE)
  worker-dispatch → WorkerRegistry.findIdle() → sendToWorker()
  Worker completes → report_task_result → Gateway /api/task/:id/report
```

---

## Code Review Pipeline

```
Worker push branch (worker/{taskId})
  → Gateway /api/task/:id/report (success + branch)
    → server.js _runReviewPipeline() async
      → Step 1: code-review.js (Layer 2)
        → Gemini API review diff
        → Fallback: ESLint + npm test
        → No diff: auto-pass
      → Step 2: git-ops.js merge (Layer 1)
        → fetch → merge --no-ff → push main → delete remote branch
      → Notify owner via WhatsApp
```

Review fail → auto-dispatch fix task to Worker with feedback (max 2 rounds)
Review Learning: `review-learner.js` auto-extracts lessons into knowledge base

---

## Task Splitting

```
task({ action: "dispatch", type: "layer3", taskAction: "worker-dispatch", params: { description: "large task..." } })
  → task-splitter.js splitTask(description)
    → Gemini API analysis → split into 2-5 sub-tasks
  → split-dispatch.js execute()
    → dispatch sub-tasks sequentially/in parallel to Workers
```


---

## Key Classes

### WorkerRegistry (worker-registry.js)
- `register(workerId, port)` — Register/update Worker
- `findIdle()` — Round-robin find idle Worker
- `findIdleExcluding(workerId)` — Exclude specified Worker (for retry)
- `markBusy/markIdle` — State toggle
- `heartbeat(workerId)` — Update lastSeen
- `sendToWorker(workerId, message)` — HTTP send message to Worker
- `startHealthCheck()` — Ping every 30s, 90s no response → offline

### TaskExecutor (task-executor.js)
- `startTaskWatchdog()` — Check running tasks timeout every 30s
- Retry with `_excludeWorker` to skip failed Worker
- `_isTransient` detects 503 → auto retry

---

## Worker Flow

```
Commander task({ action: "dispatch", type: "layer3", taskAction: "worker-dispatch", params })
  → WorkerRegistry.findIdle() (round-robin) → markBusy()
  → sendToWorker(workerId, taskMessage)
  Worker: checkout branch → work → commit → push
  → report_task_result → markIdle() → notifyCompletion()
```

**Auto-registration:** Worker MCP POSTs to `/api/worker/register` on startup, re-registers every 30s
**Health check:** Gateway pings every 30s, 90s no heartbeat → offline
**Task Watchdog:** Checks timeout every 30s (default 300s) → auto fail + release Worker
**Retry Failover:** `findIdleExcluding()` skips failed Worker

**Worker deployment paths:**
```
C:\Users\norl\Desktop\MyAIHero\
├── MyKiroHero/     # Commander
├── Worker1/        # Worker Kiro 1
├── Worker2/        # Worker Kiro 2
└── Worker3/        # Worker Kiro 3
```

---

## Modification Guide

**Adding a new Task Handler:**
1. `src/gateway/tasks/` — Add handler.js (export name, type, execute)
2. `tasks/index.js` auto-scans and loads
3. Restart Gateway to take effect

**Worker related:**
1. Registration/health check → `worker-registry.js`
2. Task dispatch/failover → `tasks/worker-dispatch.js`
3. Result reporting → `server.js` POST /api/task/:id/report
4. Watchdog/retry → `task-executor.js`
5. Worker templates → `templates/worker-steering/`
6. Worker install → `scripts/setup-worker.js`
