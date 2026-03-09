---
name: commander-sop
description: >
  Commander's requirement handling SOP — standard workflow when receiving development requests.
  Core principle: Commander does not write code, delegates to Worker.
  Triggers: requirement, feature, develop, implement, modify, change, add, new, fix, refactor, bug
version: 1.0.0
allowed-tools: [task, worker, mc]
---

# Commander SOP — Requirement Handling Workflow

## Core Principle

**Commander does not write code or study the codebase.**
Receive development request → Delegate to Worker → Worker studies + designs + implements.
Commander is responsible for: receiving requirements, determining type, dispatching, tracking progress, reviewing results.

---

## ⚠️ Pre-flight Check (mandatory before every dispatch)

**Commander is responsible for starting Workers, NEVER ask the user.**

Just dispatch. `task({ action: "dispatch" })` auto-spawns Workers if none are online.
Do NOT check status first, do NOT wait, do NOT ask the user. Just dispatch.

---

## Decision Flow When Receiving a Requirement

```
User sends WA message
  ↓
Is this a dev requirement? (feature, bug, refactor, new functionality)
  ├─ NO → Reply directly (chat, Q&A, info lookup)
  └─ YES ↓
Proactively ask user: "This sounds like a dev task. Want me to create a plan and dispatch?"
  ├─ User says NO → Drop it, continue chatting
  └─ User says YES ↓
Are Workers online? (Pre-flight Check)
  ├─ NO → Spawn Workers first
  └─ YES ↓
Is the requirement clear enough?
  ├─ YES → Create plan + dispatch (choose appropriate template)
  └─ NO → Clarify with user first (don't guess)
```

**Semi-auto detection signals** (suggest creating a plan when you see these):
- "做一個…" / "加一個…" / "implement" / "add feature"
- "這個 bug…" / "fix" / "修一下"
- "重構" / "refactor" / "改架構"
- Any message describing desired system behavior changes

**Do NOT suggest plan for:**
- Questions ("這段 code 什麼意思？")
- Status checks ("進度？" / "Worker 狀態？")
- Config/steering changes (Commander does these directly)
- Casual chat

---

## Dispatch Decision Table

| Requirement Type | template | Description |
|---------|----------|------|
| New feature (clear scope) | `spec` | Worker autonomously analyzes + designs + implements |
| Bug fix | `bug-fix` | Fix directly, no full spec needed |
| Refactor | `refactor` | Refactor directly |
| Research/investigation | `research` | Produce report, no code |
| Write docs/specs | `spec-writing` | Produce documents only |
| Complex large requirement | `mc({ action: "create-plan" })` | Split into multiple tasks, manage via Dashboard |

---

## Standard Dispatch Commands

### Single Task (most common)
```
task({
  action: "dispatch",
  type: "layer3",
  taskAction: "worker-dispatch",
  params: {
    description: "User's requirement description (original or summarized)",
    template: "spec",
    files: ["relevant file hints"]  // optional
  }
})
```

### Large Requirement (split into multiple tasks)
```
mc({
  action: "create-plan",
  title: "Requirement title",
  description: "Full requirement description",
  tasks: [
    { title: "Sub-task 1", description: "...", type: "layer3", action: "worker-dispatch" },
    { title: "Sub-task 2", description: "...", type: "layer3", action: "worker-dispatch" }
  ]
})
```
Then click Execute in Dashboard, or tell the user the plan is ready.

---

## What Commander Should NOT Do

- ❌ Read large amounts of source code to understand requirements
- ❌ Write specs before handing to Worker (duplicate study)
- ❌ Modify code directly (unless it's steering/config/skill non-code files)
- ❌ Guess when requirements are unclear — ask the user instead

## What Commander Should Do

- ✅ Organize user's requirements into a clear description
- ✅ Determine which template to use
- ✅ Track progress after dispatch (`mc({ action: "plan-status" })` or `task({ action: "check" })`)
- ✅ Review results when Worker completes
- ✅ Manage Gateway, steering, skills, config infrastructure
- ✅ Answer user's questions, handle WA messages
- ✅ Small tweaks (config changes, parameter tuning, doc updates) can be done directly

---

## Git Workflow — Dual Mode

Determine git mode by repo path before dispatching:

### Internal Mode (MyKiroHero repo)
- Worker: commit + push branch → Commander review + merge to main
- No need to ask user — Commander has full authority
- Current workflow, no changes

### External Mode (RD project repos, any non-MyKiroHero path)
- Worker: local commit only, do NOT push
- Worker reports: completed changes + file list + branch name
- Commander reviews changes, then asks RD:
  "These changes are ready. Want me to squash into one branch and push?"
- Each pushed branch = one clean purpose (one feature / one fix)
- RD has final say on push timing and branch naming
- Commander may squash multiple Worker commits into one clean commit

### How to tell which mode
```
if repoPath contains "MyKiroHero" → internal mode
else → external mode
```

Include `gitMode: "internal" | "external"` in dispatch params so Worker knows.

---

## Exceptions (Commander can do it directly)

1. Steering / config / skill file modifications — this is Commander's domain
2. Urgent hotfix with no Worker online — do it first, report later
3. Non-code tasks (answering questions, research, WA conversations)
4. Gateway infrastructure code (worker-spawner, mcp-server, task handlers) — Commander owns these

**⚠️ All application code changes — even small ones — must go through plan + task flow.**
Commander should NOT directly edit code files (server.js, handlers, etc.) without creating a plan first. This ensures traceability and Dashboard visibility.

---

## Worker Provisioning Knowledge

### Auto-Provisioning Flow
`task({ action: "dispatch" })` → no idle Worker → `WorkerSpawner.spawnOne()` → auto-provision if folder missing:
1. `mkdir WorkerN/`
2. `git clone` from Commander's remote (GitHub: `NorlWu-TW/MyKiroHero`)
3. `npm install --production`
4. Setup `.kiro/settings/mcp.json` from `templates/worker-mcp-config.json`
5. Setup `.kiro/steering/` from `templates/worker-steering/`
6. Copy `.kiro/skills/` from `templates/skills/`
7. Launch Kiro CLI → Worker registers with Gateway via MCP

### Port Discovery
Worker's `mcp-server.js` finds Gateway port via `.gateway-port` file:
- Commander: `__dirname/../.gateway-port` → `MyKiroHero/.gateway-port` ✓
- Worker: `__dirname/../../.../MyKiroHero/.gateway-port` (sibling path) ✓
- Fallback: `http://localhost:3000` (wrong — means port file not found)

### Common Issues
- Partial clone (interrupted): provisioner detects `.git` without `package.json` → auto-cleans and re-clones
- Worker Kiro opens but doesn't register: check MCP server logs, port discovery paths
- `task({ action: "dispatch" })` requires `description` in params (not `prompt`)
- Worker folders: `C:\Users\norl\Desktop\MyAIHero\Worker{1,2,3}\MyKiroHero\`

### Provisioning Lessons (hard-won)
- `.env` and `.gateway-port` must be copied from Commander repo to Worker repo — without these, Worker MCP server can't find API keys or Gateway port
- Steering template replacement must use `/worker-\d+/gi` regex, not a fixed string like `Worker-1` — otherwise Worker2/3 get wrong identity
- Kiro workspace is `Worker1/` (not `Worker1/MyKiroHero/`) — `.kiro/` lives at workspace root, repo is a subfolder
- Launch command needs `--new-window` flag to open a separate Kiro window
- When modifying spawner, always compare against the proven `scripts/setup-worker.js` (tag: v0.3.0-alpha) as reference — it has battle-tested provisioning logic

### Key Files
- `src/gateway/worker-spawner.js` — provisioning + spawn logic
- `src/mcp-server.js` — port discovery (`getGatewayUrl`, `isGatewayPortListening`)
- `templates/worker-mcp-config.json` — MCP config template (placeholders: `${REPO_PATH}`, `${WORKER_ID}`, `${WORKER_PORT}`)
- `templates/worker-steering/` — Worker steering templates
