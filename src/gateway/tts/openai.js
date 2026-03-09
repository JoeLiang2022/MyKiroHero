/**
 * OpenAiTtsAdapter — OpenAI TTS
 * 使用 /v1/audio/speech API，請求 opus 格式
 * 
 * 回傳 OGG Opus buffer，不需額外轉換
 */

const BaseTtsAdapter = require('./base-adapter');

const API_URL = 'https://api.openai.com/v1/audio/speech';

// OpenAI 支援的語音名稱（全小寫）
const VALID_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'];
const DEFAULT_VOICE = 'alloy';

class OpenAiTtsAdapter extends BaseTtsAdapter {
  constructor(apiKey, modelId) {
    super(apiKey, modelId || 'gpt-4o-mini-tts');
  }

  /**
   * 合成語音
   * @param {string} text - 要合成的文字
   * @param {string} voice - 語音名稱（如 'alloy', 'nova'）
   * @param {Object} [options] - 額外選項
   * @param {number} [options.timeout=30000] - 請求 timeout 毫秒數
   * @returns {Promise<{buffer: Buffer, format: string}>}
   */
  async synthesize(text, voice, options = {}) {
    const resolvedVoice = this._resolveVoice(voice);

    const body = {
      model: this.modelId,
      input: text,
      voice: resolvedVoice,
      response_format: 'opus'
    };

    const { controller, timeout } = this._buildRequestTimeout(options.timeout || 30000);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this._throwApiError('OpenAI TTS', res.status, errText.substring(0, 200));
      }

      const arrayBuffer = await res.arrayBuffer();
      const oggBuffer = Buffer.from(arrayBuffer);

      return { buffer: oggBuffer, format: 'ogg' };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 將語音名稱對應到 OpenAI 支援的語音
   * 不認識的名稱一律 fallback 到 'alloy'
   * @param {string} voice
   * @returns {string}
   */
  _resolveVoice(voice) {
    if (!voice) return DEFAULT_VOICE;
    const lower = voice.toLowerCase();
    return VALID_VOICES.includes(lower) ? lower : DEFAULT_VOICE;
  }
}

module.exports = OpenAiTtsAdapter;
