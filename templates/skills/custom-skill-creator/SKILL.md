---
name: custom-skill-creator
description: >
  Guide for creating and managing Custom Skills (Gateway knowledge skills) in MyKiroHero.
  Use when user mentions: custom skill, knowledge skill, Gateway skill, study notes, research notes,
  or wants to document a system/architecture/tool they studied.
  NOT for Kiro Agent Skills (.kiro/skills/) — use the built-in "skill-creator" for those.
---

# Custom Skill Creator

Create and manage Custom Skills — project-specific knowledge documents loaded on-demand via Gateway's skill loader.

## Two Skill Systems — Know the Difference

| | Kiro Agent Skill | Custom Skill (this guide) |
|---|---|---|
| Purpose | Teach AI *how to do* something (workflow/SOP) | Record *what we learned* (knowledge/reference) |
| Location | `.kiro/skills/<name>/SKILL.md` | `src/skills/<name>/SKILL.md` |
| Loaded by | Kiro's `discloseContext` (auto-trigger) | Gateway's `skill({ action: "load" })` (on-demand) |
| Token cost | Metadata always in context | Zero until explicitly loaded |
| Trigger | Kiro infers from `description` | Gateway matches `triggers` keywords |
| Format | `name` + `description` in frontmatter | `name` + `description` (with Triggers:) + `version` |
| Creator skill | `skill-creator` (Kiro built-in) | `custom-skill-creator` (this skill) |

**Rule: Never put a Custom Skill in `.kiro/skills/`, never put a Kiro Agent Skill in `src/skills/`.**

## When to Create a Custom Skill

- Studied a system, architecture, or tool and want to save the knowledge
- Built a new subsystem and need to document its structure for future reference
- Any "I don't want to research this again" moment

## Custom Skill Format

### Directory Structure

```
src/skills/<skill-name>/
├── SKILL.md          (required — metadata + main content)
├── CHANGELOG.md      (optional — version history)
└── <references>.md   (optional — additional detail files)
```

### SKILL.md Template

```markdown
---
name: <skill-name>
description: >
  一句話描述這個 skill 的涵蓋範圍。
  Triggers: 關鍵字1, 關鍵字2, keyword3, keyword4
version: 1.0.0
allowed-tools: [tool1, tool2]
---

# <Skill Name>

簡短概覽。

## 架構 / 概念

核心內容。

## 元件 / API / 用法

細節。

## 修改指南

什麼情況改哪裡。

## Related Files

- `path/to/file.js` — 說明
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Skill 名稱（lowercase, dash-separated） |
| `description` | ✅ | 涵蓋範圍 + `Triggers:` 關鍵字列表 |
| `version` | ✅ | 語意版本號（default: 1.0.0） |
| `allowed-tools` | ❌ | 相關 MCP tools（陣列格式） |
| `source` | ❌ | 來源標記（default: custom） |
| `source-url` | ❌ | 參考來源 URL |

### Triggers 寫法

Triggers 寫在 description 裡，格式：`Triggers: 詞1, 詞2, 詞3`

好的 triggers：
- 中英文都列（`記憶, memory, 搜尋, search`）
- 具體名詞（`session-logger, FTS5, JSONL`）
- 使用者會怎麼問就怎麼寫

壞的 triggers：
- 太泛（`系統, code, 功能`）
- 跟其他 skill 重疊的詞

## Content Guidelines

- 寫給 AI 看的，不是寫給人看的文件
- 重點是「下次遇到相關問題能快速找到答案」
- 包含：架構圖、資料流、元件說明、API 參數、修改指南
- 不包含：安裝步驟、使用者教學、changelog（除非另開檔案）
- 中英文混用 OK，以清楚為主

## Workflow

1. 確認是 Custom Skill（知識型）不是 Agent Skill（行為型）
2. 在 `src/skills/` 建立目錄
3. 寫 SKILL.md（frontmatter + 內容）
4. 測試：`skill({ action: "find", query: "關鍵字" })` 確認能搜到
5. 測試：`skill({ action: "load", name: "xxx" })` 確認內容正確
6. 如果是重大架構變更，更新 `codebase` skill 的 domain 索引
