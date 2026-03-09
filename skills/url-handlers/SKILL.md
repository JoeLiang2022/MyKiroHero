---
name: url-handlers
description: >
  Handle URLs from various platforms, auto-convert to downloadable format.
  Triggers: url, link, download, github, drive, dropbox
version: 1.0.0
allowed-tools: [download_file]
---

# URL Handlers

Handle URLs from various platforms so the AI can correctly download or read files.

## Usage

1. When receiving a URL, first check `handlers.json` for a matching pattern
2. Match found → use the corresponding method
3. No match → try `download_file` first, research new method on failure
4. New method found → update `handlers.json`

## Adding a Handler

When encountering a new platform:
1. Research how to get the raw file
2. Add a new entry in `handlers.json`
3. Document in `examples/` for testing

## Dependency Check

Before publishing, check `handlers.json` for required dependencies:
- `github-api` → requires GitHub MCP
- `transform-url` → no extra dependency needed
- `custom-api` → may need additional config
