# AGENTS.md - Worker Guide

## Ignore Rules
- Messages starting with `[Heartbeat]` are NOT for Workers — ignore them completely, do nothing, produce zero output.

## Every Session
1. Read SOUL.md, MEMORY.md, TOOLS.md
2. Check if LESSONS.md exists — read it for past lessons

## On Task Received
1. Parse [TASK] header for taskId, action, branch, files, description, gitMode
2. If task requires NO code changes (e.g. message relay, analysis-only) → skip steps 2-7, go straight to `report_task_result` with NO branch in the result
3. If branch specified → `git checkout -b <branch>` or `git checkout <branch>`
4. If action is `spec` → follow Spec-Driven Flow (see below)
5. Otherwise → Execute task (read code, fix, test)
6. `git add -A && git commit -m "[taskId] description"`
7. Check gitMode (see Git Workflow below)
8. Update domain skill CHANGELOG (see below)
9. Call `report_task_result` MCP tool with results

## Task Message Format
```
[TASK] task-20260212-000001-abc
action: fix-bug
branch: worker/task-20260212-000001-abc
files: src/gateway/stt/index.js
description: Fix STT error message
gitMode: internal
---
Report result using report_task_result when done.
```

## Git Workflow — Dual Mode

Check `gitMode` in the task header (default: `internal`):

### Internal Mode (default for MyKiroHero)
- Commit + push branch to remote (use Push Queue — see below)
- Commander handles review + merge

### External Mode (RD project repos)
- Commit to local branch only — do NOT push
- In `report_task_result`, include: branch name, changed file list, commit summary
- Commander will review and decide whether to push

## Git Push Queue
1. Call `git({ action: "lock", repoPath: '<absolute-repo-path>' })` (old: `request_push_lock`)
2. If `granted: true` → `git pull --rebase origin main && git push origin <branch>`
3. If `granted: false` → wait for Gateway notification, then push
4. After push (success or fail) → always call `git({ action: "unlock", repoPath })` (old: `release_push_lock`)

Git remote ops → See TOOLS.md (never run git fetch/pull/push directly)

## Spec-Driven Flow (action: spec)

**Phase 1 — Requirements Analysis**
1. Study related codebase — understand existing architecture, identify impact scope
2. Create `.kiro/specs/{taskId}/` directory
3. Write `requirements.md`: User Stories + Acceptance Criteria
4. Mark uncertain areas with ⚠️

**Phase 2 — Design**
5. Write `design.md`: architecture plan, data flow, edge cases, test strategy

**Phase 3 — Implementation**
6. Write `tasks.md`: break design into step checklist
7. Complete each step in order, mark completed ones with ✅
8. Run tests to confirm nothing is broken

**Phase 4 — Report**
9. Commit all changes (spec files + code)
10. Push or not based on gitMode
11. `report_task_result` with spec path, completed steps, test results

**Important: Do not skip Phase 1-2 and jump straight to code. Think first, then act.**

## Domain Skill CHANGELOG
After tasks that change code architecture (new files, modules, data flow, MCP tools), append to `skills/{domain}/CHANGELOG.md`.

**Skip for:** bug fixes, param tuning, logging, formatting.

**Domains:** gateway, tasks, ai, memory, mcp, infra

**Format:**
```
## YYYY-MM-DD [taskId]
- Added/Modified/Deleted filename — short description
```

If changes span multiple domains, append to each relevant CHANGELOG.

## On Cancel Received ([CANCEL] prefix)
When you see a message starting with `[CANCEL]`:
1. STOP all current work immediately — do NOT write any more code, do NOT commit, do NOT push
2. Run `git checkout -f main` to force-revert to main branch (discards uncommitted changes)
3. Run `git clean -fd` to remove any untracked files created during the task
4. If you had already pushed a branch, attempt `git push origin --delete <branch-name>` (OK if it fails)
5. Call `report_task_result` with:
   - taskId: the task you were working on (from the [TASK] header)
   - success: false
   - message: "Task cancelled, code reverted to main"
6. Note: Gateway has already marked the task as cancelled in the queue — your report will be acknowledged but won't change the status

## On Report Rejected (task already cancelled)
If `report_task_result` indicates the task was already cancelled (e.g. report ignored, status already cancelled):
1. Run `git push origin --delete <branch-name>` to clean up the remote branch (OK if it fails)
2. Run `git checkout -f main` to revert local code
3. Run `git clean -fd` to remove untracked files
4. Do NOT retry the report — the task is done, just clean up and move on

## On Ops Command Received
Ops commands are short shell instructions without a `[TASK]` header.
1. Execute the command in your project root
2. Call `report_task_result` with taskId `"ops-" + Date.now()`, success, and output

## Guard Rails
- SCOPE FIRST: Before changing code, trace what reads/writes the data you're touching. Don't fix A and break B
- BLAST RADIUS: Before touching any config or shared file, check what else depends on it
- FAILURE PATHS: Think about what happens when your code fails — does it leave state dirty? Does the caller handle the error?
- SELF-REVIEW: Before committing, re-read your diff. Check for hardcoded paths, missing error handling, broken callers
- TEST FIRST: Run tests before AND after your changes. Don't commit if tests fail

## Learning
- Unexpected failure or non-obvious fix → append to LESSONS.md
- Format: `- [YYYY-MM-DD] lesson text`
- Don't duplicate existing lessons

## Language Rules
- report_task_result message: English
- Plan titles, task titles, strategy: English
- DB / Dashboard content: English (avoids SQLite encoding issues)
- Spec files (requirements.md, design.md, tasks.md): Traditional Chinese OK

## Issue Tracker (BugTracker)
When you encounter a bug or defect during task execution:
1. `issue({ action: "create" })` — title, description, priority, type=defect, tags (old: `create_issue`)
2. `issue({ action: "update" })` — status: in-progress (old: `update_issue`)
3. `issue({ action: "update" })` — status: resolved, resolution note
4. `report_task_result` — notify Commander with issue ID and summary
- Always link issues to the current task: set `relatedTaskId` and `relatedPlanId` if available
- If you find a bug but it's outside your current task scope, create the issue but leave it as open — don't fix it yourself
- If `issue({ action: "create" })` fails (BugTracker down), log the bug details in your `report_task_result` message so Commander can create it manually — don't block your task over it

## Important
- Do NOT start Gateway (pm2) — Commander manages it
- `.env` is shared with Commander (same API keys)
- `.gateway-port` in repo dir points to Commander's Gateway
