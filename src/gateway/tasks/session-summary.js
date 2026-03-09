/**
 * session-summary.js — Layer 2 Handler: Session Conversation Summarizer
 *
 * Reads a session's JSONL log and summarizes it using Gemini API.
 *
 * Params:
 *   sessionId (required) — e.g. '20260212-001'
 *   date      (optional) — e.g. '2026-02-12' (derived from sessionId if omitted)
 *
 * JSONL entry format: { sessionId, role, content, timestamp, media? }
 */

const fs = require('fs');
const path = require('path');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const SUMMARIZE_MODEL = 'gemini-2.5-flash';
const MAX_TRANSCRIPT = 30000;

/**
 * Get Gemini API key via AiProviderManager (consistent with other handlers).
 * Falls back to reading .env directly if AiProviderManager is unavailable.
 */
function getGeminiKey(projectDir) {
  try {
    const AiProviderManager = require('../../ai-provider-manager');
    const parentKiroDir = path.join(projectDir, '..', '.kiro');
    const manager = new AiProviderManager(projectDir, parentKiroDir);
    const keys = manager.getProviderKeys('gemini');
    if (keys[0]) return keys[0];
  } catch { /* fall through to .env */ }
  // Fallback: read from .env directly
  try {
    const envContent = fs.readFileSync(path.join(projectDir, '.env'), 'utf-8');
    const match = envContent.match(/^GEMINI_API_KEY=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

module.exports = {
  name: 'session-summary',
  description: 'Summarize session conversations',
  type: 'layer2',

  execute: async (params, context) => {
    const { sessionId, date: dateParam } = params;
    if (!sessionId) throw new Error('Missing required param: sessionId');

    const projectDir = (context && context.projectDir) || path.join(__dirname, '..', '..', '..');

    // Derive date from sessionId (first 8 chars: YYYYMMDD → YYYY-MM-DD)
    const raw = sessionId.substring(0, 8);
    const date = dateParam || `${raw.substring(0, 4)}-${raw.substring(4, 6)}-${raw.substring(6, 8)}`;

    // Read JSONL file
    const jsonlPath = path.join(projectDir, 'sessions', `${date}.jsonl`);
    if (!fs.existsSync(jsonlPath)) {
      return { success: false, message: 'Session file not found' };
    }

    const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(l => l.trim());
    const entries = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.sessionId === sessionId) entries.push(entry);
      } catch { /* skip malformed lines */ }
    }

    if (entries.length === 0) {
      return { success: false, message: 'Session not found' };
    }

    // Build transcript
    let transcript = entries
      .map(e => `[${e.role}] ${e.content || ''}`)
      .join('\n');

    if (transcript.length > MAX_TRANSCRIPT) {
      transcript = transcript.slice(0, MAX_TRANSCRIPT);
    }

    // Get API key
    const apiKey = getGeminiKey(projectDir);
    if (!apiKey) {
      return { success: false, message: 'GEMINI_API_KEY not found in .env' };
    }

    const prompt = 'Summarize this conversation in 2-3 sentences in Traditional Chinese. Focus on what was discussed and any decisions made.\n\n' + transcript;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const url = `${GEMINI_API_BASE}/models/${SUMMARIZE_MODEL}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { success: false, message: `Gemini API ${res.status}: ${errText.substring(0, 200)}` };
      }

      const data = await res.json();
      const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (!summary) {
        return { success: false, message: 'Empty response from Gemini API' };
      }

      return { success: true, message: summary };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, message: 'Gemini API request timed out (30s)' };
      }
      return { success: false, message: `Summary failed: ${err.message}` };
    } finally {
      clearTimeout(timer);
    }
  },
};
