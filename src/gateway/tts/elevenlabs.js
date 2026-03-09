/**
 * ElevenLabsTtsAdapter — ElevenLabs TTS
 * 使用 /v1/text-to-speech/{voice_id} API，請求 ogg_opus 格式
 * 
 * 回傳 OGG Opus buffer，不需額外轉換
 * ElevenLabs 使用 voice ID（非名稱），但部分預設語音可直接用名稱
 * 不認識的 voice 直接 pass through，ElevenLabs 會回傳 404
 */

const BaseTtsAdapter = require('./base-adapter');

const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

class ElevenLabsTtsAdapter extends BaseTtsAdapter {
  constructor(apiKey, modelId) {
    super(apiKey, modelId || 'eleven_v3');
  }

  /**
   * 合成語音
   * @param {string} text - 要合成的文字
   * @param {string} voice - 語音名稱或 voice ID（如 'Rachel', 'Domi', 'Bella'）
   * @param {Object} [options] - 額外選項
   * @param {number} [options.timeout=30000] - 請求 timeout 毫秒數
   * @returns {Promise<{buffer: Buffer, format: string}>}
   */
  async synthesize(text, voice, options = {}) {
    const voiceId = voice || 'Rachel';
    const url = `${API_BASE}/${encodeURIComponent(voiceId)}?output_format=ogg_opus`;

    const body = {
      text,
      model_id: this.modelId
    };

    const { controller, timeout } = this._buildRequestTimeout(options.timeout || 30000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this._throwApiError('ElevenLabs TTS', res.status, errText.substring(0, 200));
      }

      const arrayBuffer = await res.arrayBuffer();
      const oggBuffer = Buffer.from(arrayBuffer);

      return { buffer: oggBuffer, format: 'ogg' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = ElevenLabsTtsAdapter;
