/**
 * GeminiTtsAdapter — Google Gemini TTS
 * 使用 generateContent API 搭配 responseModalities: ['AUDIO']
 * 
 * 從 mcp-server.js 搬移的 Gemini TTS 邏輯
 * 回傳 raw PCM buffer，WAV/OGG 轉換由 TtsService 統一處理
 */

const BaseTtsAdapter = require('./base-adapter');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

class GeminiTtsAdapter extends BaseTtsAdapter {
  constructor(apiKey, modelId) {
    super(apiKey, modelId || 'gemini-2.5-flash-preview-tts');
  }

  /**
   * 合成語音
   * @param {string} text - 要合成的文字
   * @param {string} voice - 語音名稱（如 'Kore', 'Puck', 'Zephyr'）
   * @param {Object} [options] - 額外選項
   * @param {number} [options.timeout=30000] - 請求 timeout 毫秒數
   * @returns {Promise<{buffer: Buffer, format: string, sampleRate: number}>}
   */
  async synthesize(text, voice, options = {}) {
    const url = `${API_BASE}/models/${this.modelId}:generateContent`;
    const body = {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice }
          }
        }
      }
    };

    const { controller, timeout } = this._buildRequestTimeout(options.timeout || 30000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this._throwApiError('Gemini TTS', res.status, errText.substring(0, 200));
      }

      const data = await res.json();
      const audioPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!audioPart) {
        throw new Error('No audio in Gemini TTS response');
      }

      const pcmBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
      return { buffer: pcmBuffer, format: 'pcm', sampleRate: 24000 };
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = GeminiTtsAdapter;
