# TOOLS.md - Worker Environment & Lessons

## Environment
<!-- Auto-populated during setup or first session -->
<!-- OS, shell, and Node version will be detected on first run -->
- Git: always `cd` to absolute project path before git commands — `cwd` param is unreliable
- ffmpeg-static npm package available (bundled binary)

## Git Rules
- Commit message format: `[task-id] description`
- Never push to main — always use task branch
- If merge conflict: report failure, don't force push
- **NEVER run `git fetch`, `git pull`, or `git push` directly** — Kiro terminal crashes Git on remote ops
- Use MCP tool `git` for ALL remote git operations (old name `git_remote_ops` still works via alias):
  - Fetch: `git({ action: "remote", operation: "fetch", repoPath: "<abs-path>" })`
  - Pull: `git({ action: "remote", operation: "pull", repoPath: "<abs-path>", branch: "main" })`
  - Push: `git({ action: "remote", operation: "push", repoPath: "<abs-path>", branch: "<branch>" })`
  - Checkout + Pull: `git({ action: "remote", operation: "checkout-pull", repoPath: "<abs-path>", branch: "main" })`
- Local git commands (commit, checkout, log, status, diff, branch) are fine to run directly
- **git diff context management**: NEVER run bare `git diff` — output is huge and blows up context window
  - Use `git diff --stat` for overview first
  - Then `git diff -- <specific-file>` one file at a time if needed
  - Or redirect to file: `git diff > temp/diff-output.txt` and read with readFile
- Always use Push Queue before pushing (see AGENTS.md "Git Push Queue" section)

## Code Review Awareness
- Gemini code review sometimes false-positives on method deduplication (thinks removal = breaking change)
- When deduplicating: add clear JSDoc or comment explaining the original methods are kept, duplicates removed
- If review fails on something you're confident is correct: add explanatory comment, re-commit, push again

## Shell & Windows
- PowerShell TLS issues with some HTTPS (Invoke-WebRequest/irm may fail)
- Windows EPERM: files sometimes locked — retry or use a different path
- Don't run long-running commands (dev servers, watch mode) — they block execution

## Testing
- **ALWAYS use `run_tests` MCP tool** instead of `npm test` — it returns a compact pass/fail summary that won't blow up your context window
- Optional filter: `run_tests({ filter: "search-engine" })` to run specific test files
- NEVER run `npm test` directly — full jest output is 500+ lines and causes context transfer
- Always run tests before committing to verify nothing broke
- If you changed a function, check callers are still compatible

## Available Libraries
- exceljs — xlsx read/write (in deps, no extra install)
- cheerio — HTML parsing
- pdf-parse / pdfkit — PDF read/write
- better-sqlite3 — SQLite (always use busyTimeout)

## Coding Standards

### Error Handling
- All async functions: wrap in try/catch, log errors with context
- DB operations: always set `busyTimeout` (e.g. `new Database(path, { timeout: 5000 })`)
- External API calls: always set timeout + AbortController
- Never swallow errors silently — at minimum `console.error`
- Prefer specific error types over generic `throw new Error`

### Security
- Path traversal: validate all user-provided paths with `path.resolve()` + check prefix
- Input sanitization: never pass raw user input to `exec/execSync` — use array args or escape
- FTS5 queries: sanitize special characters before passing to SQLite FTS
- No `eval()` or `new Function()` with user input
- API keys: never in URLs — always in headers
- File downloads: validate URL scheme (http/https only), validate destination path

### Naming & Style
- Variables/functions: camelCase
- Classes: PascalCase
- Constants: UPPER_SNAKE_CASE
- Files: kebab-case.js
- JSDoc on all exported functions

### Patterns to Follow
- Use `path.join()` for all file paths — never string concatenation
- Use `getNow()` from `utils/timezone.js` instead of `new Date()` for consistent timezone
- Graceful shutdown: clean up timers, close DB connections, remove port files
- Config from env: never hardcode ports, paths, or API keys

### Hoisting & TDZ
- `const`/`let` declarations are NOT hoisted like `function` — accessing them before declaration causes a TDZ (Temporal Dead Zone) ReferenceError
- Never place `const` between hoisted `function` declarations that reference it — move all `const` to the top config section
- ESLint `no-use-before-define` catches this at lint time — keep it enabled

## Pre-Commit Checklist
Before committing, verify:
1. `npm test` passes
2. No hardcoded absolute paths (use path.join + __dirname)
3. All new async code has error handling
4. No console.log left from debugging (use console.error for real logs)
5. Changed function signatures → check all callers updated
6. Changed config/env → check .env.example updated
7. New file → check if index.js/loader needs updating

## Debugging
- Read error messages carefully before retrying
- If same approach fails twice, try a different strategy
- Report failure with details rather than retrying endlessly
- Check git diff before committing — make sure no unintended changes

