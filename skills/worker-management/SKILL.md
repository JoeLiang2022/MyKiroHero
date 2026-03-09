---
name: worker-management
description: >
  Worker Kiro management complete guide — lifecycle, task dispatch, Dashboard integration, Ops commands, health checks, failover.
  Triggers: worker, spawn, dispatch, ops, command, remote, idle, busy, online, offline, health check, health, mission control, dashboard, plan
version: 1.0.0
allowed-tools: [worker, task, mc]
---

# Worker Management

## Overview

Commander (main Kiro) manages multiple Worker Kiro instances through Gateway. Each Worker is an independent Kiro IDE window with its own MCP server, auto-registering with Gateway on startup.

```
Commander Kiro
  ↓ MCP tool call
Gateway (auto port)
  ↓ HTTP
Worker Kiro 1..N (each independent IDE)
```

---

## Worker Lifecycle

```
[not exists] → spawn → [starting] → auto-register → [idle]
[idle] → receive task → [busy] → complete/fail → [idle]
[idle/busy] → 90s no heartbeat → [offline]
[offline] → ping recovers → [idle]
```

States: `idle` / `busy` / `offline`

---

## 1. Spawn Worker

### MCP Method
```
worker({ action: "ops", workerId: "worker-1", message: "ping" })
```
> Note: worker can only operate on registered Workers. To spawn new ones, use Dashboard or API.

### Dashboard Method
Dashboard → Workers section → Spawn button
→ `POST /api/mc/workers/spawn`

### API Method
```
POST /api/mc/workers/spawn
```
Returns `{ success: true, workerId: "worker-2" }`

### Auto Spawn
When `task({ action: "dispatch", type: "layer3" })` can't find an idle Worker, WorkerSpawner auto-attempts spawn.

### Limits
- Each Kiro ≈ 2.7GB RAM
- Reserve 6GB for OS
- Hard limit 3 Workers (Worker1, Worker2, Worker3)
- Spawn cooldown 60 seconds
- Registration wait timeout 90 seconds

### Worker Deployment Paths
```
C:\Users\norl\Desktop\MyAIHero\
├── MyKiroHero/     # Commander (workspace = this folder)
├── Worker1/                # ← Worker 1 workspace (Kiro opens here)
│   ├── MyKiroHero/         #    repo (git clone)
│   └── .kiro/              #    mcp.json + steering + skills
├── Worker2/                # ← Worker 2 workspace
│   ├── MyKiroHero/
│   └── .kiro/
└── Worker3/                # ← Worker 3 workspace
    ├── MyKiroHero/
    └── .kiro/
```

> **Workspace layer note:** Kiro opens `Worker1/`, NOT `Worker1/MyKiroHero/`.
> `.kiro/settings/mcp.json` and `.kiro/steering/` live under `Worker1/.kiro/`, repo is inside `Worker1/MyKiroHero/`.
> `provisionWorkerFolder()` auto-creates the entire structure (mkdir → git clone → npm install → write configs).

---

## 2. Assign Task (Dispatch)

### Method A: MCP task tool (direct dispatch)
```
task({
  action: "dispatch",
  type: "layer3",
  taskAction: "worker-dispatch",
  params: {
    description: "Implement user login API",
    template: "feature",        // optional: bug-fix, feature, refactor, study
    files: ["src/auth.js"],     // optional: relevant file hints
    branch: "feat/login"        // optional: auto-generates worker/{taskId}
  }
})
```

### Method B: Dashboard Plan Execution (Dashboard integration)
1. Create Plan (manual or AI analysis)
2. Add Tasks
3. Click Execute → dispatch to Workers sequentially
4. Worker completes → `report_task_result` → Dashboard updates in real-time

### Method C: MCP mc tool (programmatic creation)
```
mc({
  action: "create-plan",
  title: "Refactor auth module",
  strategy: "Split middleware first, then modify routes",
  tasks: [
    { title: "Split middleware", description: "...", type: "layer3", action: "worker-dispatch" },
    { title: "Modify routes", description: "...", type: "layer3", action: "worker-dispatch" }
  ]
})
```

### Dispatch Flow
```
task({ action: "dispatch", type: "layer3", taskAction: "worker-dispatch" })
  → WorkerRegistry.findIdle() (round-robin)
  → markBusy(workerId, taskId)
  → sendCommandToWorker(newSession)  ← new session to avoid pollution
  → sendToWorker(taskMessage)
  → Worker working...
  → report_task_result({ taskId, success, message, branch, commitHash })
  → markIdle(workerId)
  → Code Review Pipeline (if branch exists)
```

---

## 3. Ops Commands (Remote Operations)

### MCP worker({ action: "ops" })
```
worker({ action: "ops", workerId: "worker-1", command: "git-pull" })
worker({ action: "ops", workerId: "all", command: "git-pull" })  // broadcast to all non-offline Workers
```

### Predefined Commands
| command | Actual Action |
|---------|---------------|
| `git-pull` | `git checkout main && git pull origin main` |
| `git-status` | `git status --short` |
| `git-stash-pull` | `git stash && git checkout main && git pull origin main` |
| `pm2-restart` | `pm2 restart gateway` |
| `pm2-status` | `pm2 list` |

### Custom Message
```
worker({ action: "ops", workerId: "worker-1", message: "Check src/auth.js for bugs" })
```

### Notes
- Ops opens a newSession first before sending message, won't pollute Worker's current work
- `"all"` only sends to non-offline Workers
- Gateway needs restart to load new worker features (commit 7c25944)

---

## 4. Dashboard Integration (Mission Control)

### AI Requirement Analysis
```
POST /api/mc/plans/analyze
{ "requirement": "I need a user login feature" }
```
→ Create Plan (planning state) → Dispatch analysis task to Worker → Worker calls `mc({ action: "set-analysis" })` to write back strategy and sub-tasks

### Plan Execution
```
POST /api/mc/plans/:id/execute
```
→ Sequentially call `taskExecutor.submitTask` for each pending task → Worker receives → Reports on completion

### WebSocket Real-time Updates
Gateway broadcasts the following events via WebSocket:
- `mc:plan_created` / `mc:plan_updated`
- `mc:task_status` (queued / running / done / failed)
- `mc:worker_status` (idle / busy / offline / spawned)

---

## 5. Worker Communication Mechanism

### sendToWorker (chat message)
Send message to Kiro chat via Worker's REST Control port:
```
GET /?command=kiroAgent.sendMainUserInput&args=[encoded_message]
```
- Double URL encode handling (vscode-rest-control double decodes)

### sendCommandToWorker (IDE command)
```
GET /?command=kiroAgent.newSession  // open new session
```

### Worker Reporting
Worker calls MCP tool `report_task_result` after completing task:
```
report_task_result({
  taskId: "xxx",
  success: true,
  message: "Completed login API",
  branch: "worker/xxx",
  commitHash: "abc1234"
})
```
→ Gateway `POST /api/task/:id/report` → markIdle → Code Review Pipeline

---

## 6. Health Check & Failover

### Health Check
- Ping all Workers every 30 seconds
- 90 seconds no response → offline
- Offline Worker recovers on ping → auto back to idle

### Task Watchdog
- Check running tasks every 30 seconds
- Timeout (default 300 seconds) → auto fail + release Worker

### Retry Failover
- Task failure (503) → auto retry
- `findIdleExcluding(failedWorkerId)` skips failed Worker
- If all Workers fail → back to queue to wait

---

## 7. Common Workflows

### Deploy new code to all Workers
```
worker({ action: "ops", workerId: "all", command: "git-pull" })
```

### Check all Worker status
```
worker({ action: "ops", workerId: "all", command: "git-status" })
```

### Dispatch a spec-driven task (Worker autonomously analyzes + designs + implements)
```
task({
  action: "dispatch",
  type: "layer3",
  taskAction: "worker-dispatch",
  params: {
    description: "Implement user login feature with JWT token and refresh token",
    template: "spec"
  }
})
```
Worker will: study codebase → write requirements → write design → break down tasks → implement step by step → report

### Dispatch a bug fix
```
task({
  action: "dispatch",
  type: "layer3",
  taskAction: "worker-dispatch",
  params: {
    description: "Fix login 500 error",
    template: "bug-fix",
    files: ["src/auth.js"]
  }
})
```

### Batch tasks (via Plan)
```
mc({
  action: "create-plan",
  title: "v2.0 refactor",
  tasks: [
    { title: "Task 1", description: "...", type: "layer3", action: "worker-dispatch" },
    { title: "Task 2", description: "...", type: "layer3", action: "worker-dispatch" }
  ]
})
// Then click Execute in Dashboard, or API: POST /api/mc/plans/:id/execute
```

---

## File List

| File | Description |
|------|-------------|
| `worker-registry.js` | Worker registration, state management, communication, health check |
| `worker-spawner.js` | Auto spawn Worker (RAM check, cooldown, wait for registration) |
| `tasks/worker-dispatch.js` | Layer 3 task dispatch handler |
| `mission-control-routes.js` | Dashboard REST API (plans, tasks, spawn, analyze) |
| `server.js` | Ops endpoint (`/api/workers/:id/ops`), Worker list |
| `mcp-server.js` | MCP tools: `worker`, `task`, `mc` etc. |
| `task-executor.js` | Watchdog, retry, failover logic |
| `task-templates.js` | Task templates (spec, bug-fix, feature, refactor, study etc.) |

---

## MCP Tools Quick Reference

| Tool | Purpose |
|------|---------|
| `task` | Unified task tool: dispatch/check/cancel (actions: dispatch, check, cancel) |
| `worker` | Unified Worker tool: ops/reset (actions: ops, reset) |
| `mc` | Unified Mission Control: create-plan/plan-status/update-task/set-analysis/execute |
| `issue` | Unified Issue Tracker: create/list/update/close/stats |
| `git` | Unified Git: remote/lock/unlock |
| `report_task_result` | Worker reports task completion |

> Old tool names (dispatch_task, create_plan, etc.) still work via alias layer for backward compatibility.
