---
name: ai
description: >
  AI system architecture — AI Provider management, AI Router, STT speech-to-text, TTS text-to-speech.
  Triggers: ai, AI, provider, model, router, STT, stt, speech-to-text, TTS, tts, text-to-speech, gemini, openai, elevenlabs, whisper, voice, audio
version: 1.0.0
allowed-tools: []
---

# AI Architecture

## Overview

Multi AI Provider management + smart routing, supporting STT (speech-to-text) and TTS (text-to-speech) multi-engine switching.

---

## File List

| File | Description |
|------|-------------|
| ai-provider-manager.js | AI Provider management (multi-model switching) |
| ai-router.js | AI request routing (select best provider) |
| ai-router-init.js | AI Router initialization |
| ai-providers.json | Provider configuration file |
| stt/index.js | STT service entry point |
| stt/base-adapter.js | STT base class |
| stt/gemini.js | Gemini STT |
| stt/openai.js | OpenAI Whisper STT |
| stt/elevenlabs.js | ElevenLabs STT |

**TTS Note:** TTS functionality is handled by Layer 2 task handler `tasks/tts.js`, called via AiRouter. Pipeline: Gemini REST API → raw PCM → WAV header → ffmpeg → OGG Opus.

---

## AI Provider Management

`ai-providers.json` defines available AI providers, `ai-provider-manager.js` handles loading, switching, and health checks. `ai-router.js` selects the best provider based on task type.

---

## STT Architecture

```
Audio arrives (WhatsApp voice message)
  → whatsapp-adapter.js downloads media
  → stt/index.js route()
    → Select adapter based on config (gemini/openai/elevenlabs)
    → adapter.transcribe(audioPath)
    → Return text
```

**Adding a new STT Provider:**
1. `src/gateway/stt/` — Add adapter (extend base-adapter.js)
2. `src/gateway/stt/index.js` — Register
