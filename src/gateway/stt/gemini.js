/**
 * GeminiSttAdapter — Google Gemini STT
 * 使用 generateContent API 搭配 inline audio data
 */

const BaseSttAdapter = require('./base-adapter');

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB (inline limit ~20MB, 留 buffer)
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

class GeminiSttAdapter extends BaseSttAdapter {
  constructor(apiKey, modelId) {
    super(apiKey, modelId || 'gemini-3-flash-preview');
  }

  async transcribe(audioFilePath, mimetype) {
    const fileSize = this._getFileSize(audioFilePath);
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(`Audio file too large for Gemini inline: ${(fileSize / 1024 / 1024).toFixed(1)}MB (max 15MB)`);
    }

    const audioBuffer = this._readAudioFile(audioFilePath);
    const base64Audio = audioBuffer.toString('base64');
    const baseMime = this._getBaseMimeType(mimetype);

    const url = `${API_BASE}/models/${this.modelId}:generateContent`;
    const body = {
      contents: [{
        parts: [
          { text: 'Transcribe this audio. Return only the transcription text, nothing else.' },
          { inlineData: { mimeType: baseMime, data: base64Audio } }
        ]
      }]
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
      err.statusCode = res.status;
      throw err;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { text: text.trim() };
  }
}

module.exports = GeminiSttAdapter;
