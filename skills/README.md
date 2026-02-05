# Skills Directory

This folder contains Agent Skills that extend the AI assistant's capabilities.

## What are Skills?

Skills are modular capability packages following the [Claude Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) standard. Each skill is a folder containing:

- `SKILL.md` (required) - Instructions and metadata
- Additional reference files (optional)
- Scripts (optional)

## Creating a Skill

1. Create a new folder with your skill name
2. Add a `SKILL.md` file with this format:

```yaml
---
name: Your Skill Name
description: Brief description of what this skill does
triggers: [keyword1, keyword2, 關鍵字]
---

# Detailed Instructions

Write your skill instructions here...
```

## Installing Skills

Simply copy a skill folder into this `skills/` directory. The system will automatically detect and load it on startup.

## Available Skills

- **weather/** - Weather queries and forecasts
- **translator/** - Language translation

## Progressive Disclosure

Skills use progressive disclosure to save tokens:
1. Only `name` and `description` are loaded at startup
2. Full `SKILL.md` content is loaded when the skill is triggered
3. Additional files are loaded only when needed
