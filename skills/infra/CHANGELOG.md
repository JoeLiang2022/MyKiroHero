# Infra CHANGELOG

Workers append change records here after completing tasks. Commander consolidates into SKILL.md during heartbeat.

---

## 2026-02-17 [task-20260217-031659-817]
- Added src/utils/git-helpers.js — shared git utilities (buildAuthUrl, gitExec, safeGitClone)
- Added src/utils/env-helpers.js — shared .env utilities (readEnvKeys, backfillEnv, writeEnv)
- Added src/utils/fs-helpers.js — shared filesystem utilities (copyDir with exclude, copyFile, ensureDirs)
- Modified src/memory-backup.js — migrated to use shared git-helpers and fs-helpers
- Modified src/memory-restore.js — migrated to use shared git-helpers and fs-helpers

## 2026-02-17 [task-20260217-031659-df6]
- Modified scripts/setup-worker.js — added LESSONS.md preservation in --update mode (PRESERVE_FILES)
- Modified scripts/sync-worker-steering.js — converted to thin wrapper calling setup-worker.js --update (deprecated)

## 2026-02-17 [task-20260217-031659-965]
- Added install/i18n.js — extracted i18n strings from install.js
- Added install/utils.js — shared utilities (log, exec, ask, commandExists, etc.)
- Added install/uvx.js — uvx auto-install helper (ensureUvx, findUvx)
- Added install/steps/env-check.js — Step 1: language + environment check
- Added install/steps/project-setup.js — Step 2: clone/update project + npm install
- Added install/steps/personalize.js — Step 3: steering templates, .env, MCP config
- Added install/steps/ai-setup.js — Step 4: AI Provider quick setup
- Added install/steps/launch.js — Step 5: PM2 launch + install report + test verification
- Modified install.js — refactored to orchestrator (~350 lines) calling step modules
