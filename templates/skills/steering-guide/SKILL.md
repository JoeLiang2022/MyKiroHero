---
name: steering-guide
description: >
  Guide for understanding the steering file system — where personality, memory, identity, and configuration files live.
  Use when: editing steering files, confused about file paths, modifying personality/soul/memory/identity/tools/errata,
  or when unsure whether to edit workspace root .kiro/steering/ vs MyKiroHero/.kiro/steering/.
---

# Steering Guide

## Key Rule

All steering files (personality, memory, identity, etc.) live at the **workspace root**:

```
.kiro/steering/          ← ✅ THIS is where Kiro reads steering from
```

NOT in the project subdirectory:

```
MyKiroHero/.kiro/steering/   ← ❌ WRONG — this is gitignored and NOT used by Kiro
```

## Why This Matters

Kiro IDE reads steering from the workspace root `.kiro/steering/`. The `MyKiroHero/` folder is a subdirectory within the workspace. Files inside `MyKiroHero/.kiro/` are gitignored and only exist as local copies — Kiro does not load them as steering.

## File Map

| File | Purpose |
|------|---------|
| `.kiro/steering/SOUL.md` | Personality, reply style, core principles, WhatsApp routing rules |
| `.kiro/steering/IDENTITY.md` | Name, creature type, emoji, voice settings |
| `.kiro/steering/MEMORY.md` | Architecture, tools, directories, rules, lessons |
| `.kiro/steering/USER.md` | Owner info (name, timezone, preferences) |
| `.kiro/steering/AGENTS.md` | Session workflow, memory system, knowledge base, safety rules |
| `.kiro/steering/TOOLS.md` | Environment info, shell lessons, media/TTS/diagram notes |
| `.kiro/steering/HEARTBEAT.md` | Scheduled tasks (HH:MM format) |
| `.kiro/steering/ERRATA.md` | Open issues / unsolved mysteries |
| `.kiro/steering/memory/` | Daily memory notes (YYYY-MM-DD.md) |

## Common Mistakes

- ❌ Editing `MyKiroHero/.kiro/steering/` — Kiro won't see the changes
- ❌ Editing `MyKiroHero/.soul-backup/steering/` — that's the backup copy, not the live one
- ❌ Editing `MyKiroHero/templates/steering/` — that's the template for new workers
- ✅ Always edit `.kiro/steering/` at workspace root

## Related Paths (NOT steering)

- `MyKiroHero/templates/steering/` — Template for new Worker setup (tracked in git)
- `MyKiroHero/.soul-backup/steering/` — Backup copy (gitignored)
- `MyKiroHero/.kiro/steering/` — Stale local copy (gitignored, not used)
