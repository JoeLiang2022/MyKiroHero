---
name: tools
description: >
  Common tools — image analysis, weather query, language translation.
  Triggers: image, photo, analyze, analysis, weather, temperature, forecast, translate, translation, meaning
version: 1.0.0
allowed-tools: [analyze_image, get_weather]
---

# Tools — Common Utilities

## Image Analysis

When receiving a WhatsApp message with an image:
1. Image is auto-downloaded to `temp/`
2. Message includes `mediaPath` and `mediaMimeType`
3. Use `analyze_image` MCP tool to analyze

**analyze_image parameters:**
- `imagePath` (required): Image file path
- `question` (optional): Question about the image

**Supported formats:** JPEG, PNG, GIF, WebP

---

## Weather Query

Use `get_weather` MCP tool to query weather.

**get_weather parameters:**
- `location` (required): Location name (e.g. Taipei, Tokyo)

**Response format:**
- Temperature (Celsius)
- Weather conditions
- Humidity
- Related warnings

Default location: Taiwan/Taipei (if user doesn't specify)

---

## Translator

No MCP tool needed — translate directly.

**Capabilities:**
- Auto-detect source language
- Provide multiple translation options
- Explain cultural context and nuance

**Default target language:** Traditional Chinese (Taiwan users)

**Response format:**
- Clear translation result
- Pronunciation hints for non-Latin scripts
- Relevant cultural context
