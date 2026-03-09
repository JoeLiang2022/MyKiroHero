/**
 * summarize.js — Layer 2 Handler: Summarize text using Gemini API
 *
 * Params:
 *   text      (required) — the text to summarize
 *   language  (optional, default 'zh-TW') — output language
 *   maxLength (optional, default 500) — max chars for summary
 *   style     (optional, default 'concise') — 'concise' | 'detailed' | 'bullet'
 *
 * Returns:
 *   { success, message, outputPath }
 */

const path = require('path');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const SUMMARIZE_MODEL = 'gemini-2.5-flash';
const INPUT_MAX_CHARS = 50000;
const GEMINI_API_TIMEOUT_MS = 30000;

/**
 * Get Gemini API key via AiProviderManager
 */
function getGeminiKey(projectDir) {
  try {
    const AiProviderManager = require('../../ai-provider-manager');
    const parentKiroDir = path.join(projectDir, '..', '.kiro');
    const manager = new AiProviderManager(projectDir, parentKiroDir);
    const keys = manager.getProviderKeys('gemini');
    return keys[0] || null;
  } catch {
    return null;
  }
}

// ── Handler export ──────────────────────────────────────────────

module.exports = {
  name: 'summarize',
  description: 'Summarize text using Gemini API',
  type: 'layer2',

  execute: async (params, context) => {
    const {
      text,
      language = 'zh-TW',
      maxLength = 500,
      style = 'concise',
    } = params;

    if (!text) throw new Error('Missing required param: text');

    const truncatedText = text.substring(0, INPUT_MAX_CHARS);
    const cwd = (context && context.projectDir) || path.join(__dirname, '..', '..', '..');

    const apiKey = getGeminiKey(cwd);
    if (!apiKey) {
      return { success: false, message: 'No Gemini API key available', outputPath: null };
    }

    const styleInstructions = {
      concise: 'Write a concise summary in paragraph form.',
      detailed: 'Write a detailed summary covering all key points.',
      bullet: 'Write the summary as bullet points.',
    };

    const prompt = `Summarize the following text in ${language}.
${styleInstructions[style] || styleInstructions.concise}
Keep the summary within ${maxLength} characters.

Text:
${truncatedText}`;

    const url = `${GEMINI_API_BASE}/models/${SUMMARIZE_MODEL}:generateContent`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_API_TIMEOUT_MS);

    try {
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
        return {
          success: false,
          message: `Gemini API ${res.status}: ${errText.substring(0, 200)}`,
          outputPath: null,
        };
      }

      const data = await res.json();
      const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (!summary) {
        return { success: false, message: 'Gemini returned empty response', outputPath: null };
      }

      return { success: true, message: summary, outputPath: null };
    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'Gemini API request timed out (30s)'
        : `Gemini API error: ${err.message}`;
      return { success: false, message: msg, outputPath: null };
    } finally {
      clearTimeout(timer);
    }
  },
};
