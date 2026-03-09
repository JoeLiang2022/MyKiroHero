/**
 * translate.js — Layer 2 Handler: Text Translation
 *
 * Translates text using Gemini API.
 *
 * Params:
 *   text       (required) — the text to translate
 *   targetLang (required) — target language code or name (e.g. 'en', 'zh-TW', 'ja')
 *   sourceLang (optional) — source language (auto-detect if not specified)
 */

const path = require('path');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';
const MAX_INPUT = 50000;

/**
 * Get Gemini API key via AiProviderManager.
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

module.exports = {
  name: 'translate',
  description: 'Translate text using Gemini API',
  type: 'layer2',

  execute: async (params, context) => {
    const { text, targetLang, sourceLang } = params;
    if (!text) throw new Error('Missing required param: text');
    if (!targetLang) throw new Error('Missing required param: targetLang');

    const projectDir = (context && context.projectDir) || path.join(__dirname, '..', '..', '..');
    const apiKey = getGeminiKey(projectDir);
    if (!apiKey) {
      return { success: false, message: 'No Gemini API key available', outputPath: null };
    }

    const truncatedText = text.length > MAX_INPUT ? text.slice(0, MAX_INPUT) : text;

    const sourcePart = sourceLang ? ` from ${sourceLang}` : '';
    const prompt = `Translate the following text${sourcePart} to ${targetLang}. Preserve the original formatting. Do not add any explanations, notes, or extra text. Output only the translated text.\n\n${truncatedText}`;

    const url = `${GEMINI_API_BASE}/models/${MODEL}:generateContent`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

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
        return { success: false, message: `Gemini API ${res.status}: ${errText.substring(0, 200)}`, outputPath: null };
      }

      const data = await res.json();
      const translated = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (!translated) {
        return { success: false, message: 'Empty response from Gemini API', outputPath: null };
      }

      return { success: true, message: translated, outputPath: null };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, message: 'Gemini API request timed out (30s)', outputPath: null };
      }
      return { success: false, message: `Translation failed: ${err.message}`, outputPath: null };
    } finally {
      clearTimeout(timer);
    }
  },
};
