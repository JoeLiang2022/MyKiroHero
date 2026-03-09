# Memory CHANGELOG

Workers append change records here after completing tasks. Commander consolidates into SKILL.md during heartbeat.

---

## 2026-02-20 [task-20260220-054359-44e]
- Modified src/memory/engine.js — Added POST /summary/auto route for auto-summary on session end (Wave 3.3)
- Added tests/auto-summary.test.js — Tests for auto-summary trigger, skip logic, and engine route

## 2026-02-17 [task-20260217-031659-e25]
- Added src/utils/git-helpers.js — shared buildAuthUrl + gitExec extracted from memory-backup/restore
- Added src/utils/fs-helpers.js — unified copyDir with optional excludeFiles, copyFile helper
- Added src/utils/backup-config.js — shared getDataSources, getDbPath, validateSourcePaths for backup/restore consistency
- Modified src/memory-backup.js — imports shared helpers, uses data-driven source loop with validation
- Modified src/memory-restore.js — imports shared helpers, uses data-driven source loop with validation

## 2026-02-20 [task-20260220-041934-17d]
- Modified src/memory/database.js — Added structured summary columns (topic, decisions, actions, next_steps, entities, tags, importance) to summaries table, bumped schema to v2
- Modified src/memory/summary-extractor.js — Rewrote to use AiRouter with flash capability for key rotation/cooldown, rule-based fallback, schema validation

## 2026-02-20 [task-20260220-054359-733]
- Modified src/memory/indexer.js — Enhanced tokenize() with CamelCase splitting (splitCamelCase), number preservation (l3/v2/fts5), domain stopwords (DOMAIN_STOPWORDS), English bigrams (word_word pairs)
- Added tests/memory/indexer-tokenize.test.js — 47 tests covering all new tokenizer features + backward compatibility

## 2026-02-20 [task-20260220-054359-84f]
- Modified src/memory/search-engine.js — searchL3 now async, uses readline stream + early termination (50 consecutive misses) instead of readFileSync. Added readSessionFromJsonl helper (exported).
- Modified src/memory/unified-search.js — searchAll now async to await searchSessions
- Modified src/memory/engine.js — await searchAll in HTTP handler
- Added tests/search-engine-l3.test.js — 12 tests for readSessionFromJsonl and async searchL3

## 2026-02-20 [task-20260220-060417-a85]
- Modified src/memory/summary-extractor.js — Enhanced extractEntities() with people (@mentions, named refs), files, tools (MCP tools, npm packages, require), projects (repo refs, branches). Updated AI prompt entity schema from concepts→projects.
- Added tests/memory/summary-extractor-entities.test.js — 18 tests covering all 4 entity categories + combined extraction

## 2026-02-20 [task-20260220-060417-6b8]
- Modified src/memory/database.js — Added summary_fts FTS5 virtual table with weighted columns (topic/tags/decisions/actions/summary_text), parseSummaryForFts, populateSummaryFts, syncSummaryFts helpers, bumped schema to v3
- Modified src/memory/search-engine.js — searchL2 now queries summary_fts with 1.2x boost and merges into results; fixed NEAR/5 syntax error fallback for bigram tokens
- Added tests/summary-fts.test.js — 19 tests covering FTS5 table creation, populate/sync, BM25 weighting, and searchL2 integration

## 2026-02-20 [task-20260220-063600-c15]
- Modified src/memory/engine.js — Replaced 5-min periodic timer with event-driven index queue: POST /index/queue route, 30s queue drain timer, weekly fallback, queue stats in /health
- Added tests/memory/index-queue.test.js — 10 tests covering queue add/dedup, batch process, health stats, error handling

## 2026-02-20 [task-20260220-070621-d6f]
- Added src/memory/auto-recall.js — Auto-recall context builder for cold-start sessions: loads last summary + L1 related sessions, token-budgeted output
- Modified src/memory/engine.js — Added GET /recall/auto route calling buildAutoRecallContext
- Added tests/memory/auto-recall.test.js — 19 tests covering enabled/disabled, with/without summary, DB unavailable, token budget, self-exclusion

## 2026-02-20 [task-20260220-071434-85b]
- Modified src/gateway/handlers/kiro-handler.js — Auto-recall context injection on new session (timeDelta > 30min): calls Memory Engine GET /recall/auto, prepends context block to message prompt
- Added tests/gateway/kiro-handler-recall.test.js — 8 tests covering injection, empty context, non-new-session skip, disabled config, timeout, connection error, missing port file, heartbeat bypass
