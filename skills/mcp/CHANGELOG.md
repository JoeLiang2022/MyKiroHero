# MCP CHANGELOG

Workers append change records here after completing tasks. Commander consolidates into SKILL.md during heartbeat.

---

## 2026-02-16 [task-20260216-130317-45e]
- Modified src/mcp-server.js — Added reset_worker MCP tool for Commander to reset stuck workers via MCP

## 2026-02-16 [task-20260216-150107-93d]
- Modified src/mcp-server.js — Added request_push_lock and release_push_lock MCP tools
- Modified templates/worker-steering/AGENTS.md — Added Git Push Queue instructions
- Modified templates/worker-steering/TOOLS.md — Added push queue reference in Git Rules
- Added tests/mcp-push-queue-tools.test.js — Tests for push queue MCP tools

## 2026-02-19 [task-20260219-072631-d0d]
- Added src/alias-registry.js — Alias registry for backward-compatible old→new tool name resolution (Wave 1A: Issue 5→1, MC 5→1)
- Modified src/mcp-server.js — Merged create_issue/list_issues/update_issue/close_issue/issue_stats into unified `issue` tool; merged create_plan/get_plan_status/update_mc_task/set_plan_analysis/execute_plan into unified `mc` tool; added resolveAlias at handler entry
- Modified src/gateway/mission-control-routes.js — Updated set_plan_analysis hard dependency to mc({ action: "set-analysis" })

## 2026-02-20 [task-20260220-183122-d41]
- Modified src/mcp-server.js — Added ops-prefix detection in report_task_result to route ops commands to /api/workers/:id/ops-report endpoint
- Added tests/mcp/ops-report-routing.test.js — Tests for ops-prefix routing logic
