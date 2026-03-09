# Skills Directory

Custom skills for MyKiroHero AI assistant.

## Available Skills

| Skill | Version | Description |
|-------|---------|-------------|
| **codebase** | 2.0.0 | Global architecture overview — directory structure, data flow, domain index |
| **gateway** | 1.0.0 | Gateway core — message flow, WA adapter, routing, handlers |
| **tasks** | 1.0.0 | Task system — Task Dispatch, Worker management, Layer 1/2/3 |
| **ai** | 1.0.0 | AI system — Provider management, Router, STT, TTS |
| **memory** | 2.0.0 | Memory system — JSONL, Journal, Knowledge, Memory Engine |
| **mcp** | 1.0.0 | MCP Server — 22 tools definition and forwarding |
| **infra** | 1.0.0 | Infrastructure — deployment, PM2, install scripts, backup/restore |
| **tools** | 1.0.0 | Common tools — image analysis, weather query, translation |
| **url-handlers** | 1.0.0 | URL handling rules |
| **ami-bios** | 1.0.0 | AMI Aptio V BIOS knowledge — SDL/CIF/VEB formats, package structure, analysis SOP |

## Structure

Each domain skill contains:
- `SKILL.md` — Architecture document (with trigger keywords)
- `CHANGELOG.md` — Worker change log (Commander merges into SKILL.md during heartbeat)

## SKILL.md Format

```yaml
---
name: skill-name
description: >
  Description with trigger keywords.
version: 1.0.0
allowed-tools: [tool1, tool2]
---
```

## Maintenance Cycle

1. Worker completes task → append changes to corresponding domain's CHANGELOG.md
2. Commander heartbeat → merge CHANGELOG into SKILL.md
3. Next query loads the latest SKILL.md
