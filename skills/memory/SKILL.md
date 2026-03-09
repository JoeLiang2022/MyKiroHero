---
name: memory
description: >
  Complete memory system — JSONL conversation logs, Journal diary, Knowledge base, Memory Engine (SQLite+FTS5) search index.
  Triggers: memory, session, conversation, journal, diary, knowledge, recall, search, index
version: 2.0.0
allowed-tools: [recall, knowledge, session, journal]
---

# Memory System

Complete memory system for AI Agents, with four-layer architecture and unified search.

## Four-Layer Memory Architecture

```
┌─────────────────────────────────────────────────────┐
│  MEMORY.md (100 lines max)                          │
│  Curated long-term memory, auto-loaded each session │
└─────────────────────────────────────────────────────┘
                        ↑ curated
┌─────────────────────────────────────────────────────┐
│  Journal (memory/YYYY-MM-DD.md)                     │
│  Daily work log, last 2 days auto-loaded            │
└─────────────────────────────────────────────────────┘
                        ↑ summarized
┌─────────────────────────────────────────────────────┐
│  SQLite + FTS5 (data/memory.db)                     │
│  Full-text search index, L1/L2/L3 three-tier search │
└─────────────────────────────────────────────────────┘
                        ↑ indexed
┌─────────────────────────────────────────────────────┐
│  JSONL Store (sessions/YYYY-MM-DD.jsonl)            │
│  Complete conversation logs, permanent (Source of Truth) │
└─────────────────────────────────────────────────────┘
```

---

## MCP Tools

### Unified Search (Recommended Entry Point)

**recall** — Search sessions + knowledge + journals simultaneously
```javascript
{ query: "search keyword", days: 7, source: "all" }
// source: "all" | "session" | "knowledge" | "journal"
```

**recall_search** — Search session conversations (merged into recall, use source: "session" + level)
```javascript
// Now use recall instead:
{ query: "keyword", source: "session", level: "L2", days: 7 }
// level: "L1"(topic list) | "L2"(snippets+context) | "L3"(full conversation)
```

**session** — Unified session tool (history, pending, summarize)
```javascript
{ action: "history", sessionId: "20260207-001" }                    // GET session conversation
{ action: "pending", date: "2026-02-07" }                           // List unsummarized sessions
{ action: "summarize", sessionId: "20260207-001" }                  // GET: read summary
{ action: "summarize", sessionId: "20260207-001", summary: "..." }  // POST: save summary
```

### Knowledge Base

**knowledge** — Unified knowledge tool (search, get, save)
```javascript
{ action: "search", query: "keyword" }  // Search (BM25 + RRF fusion)
{ action: "get", id: "entry-id" }       // Read specific entry
{ action: "save", id: "my-entry", title: "Title", tags: ["a"], summary: "...", content: "..." }  // Save new entry
```

### Journal

**journal** — Unified journal tool
```javascript
{ action: "add", category: "event", content: "..." }  // Add entry
{ action: "list", date: "2026-02-07" }                 // List by date
{ action: "search", query: "keyword" }                  // Search journals
{ action: "complete", id: "todo-id" }                   // Mark todo complete
```

---

## Components

### 1. SessionLogger
Records conversations to daily JSONL files.
- **Location:** `src/gateway/session-logger.js`
- **Storage:** `sessions/YYYY-MM-DD.jsonl`
- **Record Types:** user, assistant, journal, operation
- **Session ID:** `YYYYMMDD-NNN` (new session after 30 min idle)

### 2. JournalManager
Manages structured journal entries.
- **Location:** `src/memory/journal-manager.js`
- **Storage:** `memory/journals/YYYY-MM-DD.jsonl`
- **Categories:** event, thought, lesson, todo

### 3. Knowledge Base
Knowledge store + lightweight hybrid search.
- **Location:** `skills/memory/`
- **Storage:** `skills/memory/entries/*.md`
- **Search tech:** BM25 + RRF fusion + stopwords + synonyms + N-gram + fuzzy matching

### 4. Memory Engine (recall-worker)
Standalone PM2 process, SQLite+FTS5 search index.
- **Location:** `src/memory/engine.js`
- **Database:** `data/memory.db`
- **PM2 name:** `recall-worker`

#### Three-Tier Search
| Level | Speed | Returns | Use Case |
|-------|-------|---------|----------|
| L1 | <10ms | Session topic list | Quick browse |
| L2 | <100ms | Matching messages + context | Default search |
| L3 | <500ms | Full session conversation | Deep review |

#### Fallback
Auto-switches to JSON fallback mode when SQLite is unavailable (`src/memory/json-fallback.js`).

---

## Knowledge Base Search Details

### Search Techniques
1. **Stopword filtering** — 130+ Chinese/English stopwords
2. **Synonym expansion** — 18 groups, max 5 per term (`synonyms.json`)
3. **BM25 scoring** — k1=1.5, b=0.75
4. **RRF rank fusion** — Title 0.5, Tag 0.3, Summary 0.2
5. **Position weighting** — Title-start match ×2
6. **N-gram** — English 3-gram, Chinese 2-gram
7. **Fuzzy matching** — Levenshtein (English) / contains match (Chinese)
8. **Coverage bonus** — More query terms matched → higher total score

### Entry Format
Each knowledge entry (`entries/*.md`) contains YAML frontmatter (title, tags, source) + content.

### When to Add Knowledge
- Found useful info from web search
- Learned a new technique or concept
- Any info that "might be useful next time"

---

## Correctness Properties

### Memory System (17 properties, fast-check)
1. JSONL Record Structure
2. Round-Trip Consistency
3. Append-Only Invariant
4. Malformed Line Handling
5. Journal Entry Structure
6. Journal Append Behavior
7. Journal-to-JSONL Sync
9. Old Journal Deletion Safety
10. MEMORY.md Line Limit
15. Write via appendFileSync (not rename — Windows EPERM)
16. Write Failure Retry (max 3)
17. MEMORY.md Backup Before Modify

### Memory Engine (7 properties, fast-check)
P1. Index completeness
P2. FTS5 search recall
P3. Time decay monotonicity
P4. Deduplication correctness
P5. Index idempotency
P6. Fallback functional equivalence
P7. Index rebuildability

---

## How Memory Works

1. **During conversation** → Messages written to `sessions/YYYY-MM-DD.jsonl`
2. **Every 5 minutes** → Memory Engine auto-indexes new sessions to SQLite
3. **End of day** → Important events organized into `memory/YYYY-MM-DD.md`
4. **Periodic curation** → Most important memories refined into `MEMORY.md`
5. **When recall needed** → Use `recall` to search all memory sources

---

## Backup

`src/memory-backup.js` auto-backs up to GitHub (repo specified by `.env` `MEMORY_REPO`):
1. steering (personality config + logs, excluding ONBOARDING.md)
2. sessions (JSONL conversation logs)
3. journals (structured diary)
4. knowledge (knowledge base entries + index)
5. summaries (session summaries)

Backup uses git clone → rsync → commit → push flow, supports incremental updates.
Restore uses `src/memory-restore.js`, pulls from GitHub and overwrites local files.
memory.db is not backed up (can be rebuilt from JSONL, loss is non-fatal).

---

## Related Files

- `src/gateway/session-logger.js` — SessionLogger
- `src/memory/journal-manager.js` — JournalManager
- `src/memory/jsonl-parser.js` — JSONL parser utility
- `src/memory/database.js` — SQLite connection management
- `src/memory/indexer.js` — JSONL → SQLite indexer
- `src/memory/search-engine.js` — FTS5 search (L1/L2/L3)
- `src/memory/unified-search.js` — Unified search (RRF fusion)
- `src/memory/engine.js` — Memory Engine HTTP server
- `src/memory/health-checker.js` — Health checker
- `src/memory/json-fallback.js` — JSON fallback
- `.kiro/specs/memory-system/` — Memory System spec
- `.kiro/specs/session-recall/` — Memory Engine spec