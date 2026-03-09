/**
 * ElevenLabsSttAdapter — ElevenLabs Scribe STT
 * 直接支援 OGG，不需要 ffmpeg
 */

const path = require('path');
const BaseSttAdapter = require('./base-adapter');

const API_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

class ElevenLabsSttAdapter extends BaseSttAdapter {
  constructor(apiKey, modelId) {
    super(apiKey, modelId || 'scribe_v2');
  }

  async transcribe(audioFilePath, mimetype) {
    const fileBuffer = this._readAudioFile(audioFilePath);
    const baseMime = this._getBaseMimeType(mimetype);
    const fileName = path.basename(audioFilePath);

    const blob = new Blob([fileBuffer], { type: baseMime });
    const formData = new FormData();
    formData.append('model_id', this.modelId);
    formData.append('file', blob, fileName);

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: formData
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`ElevenLabs API error ${res.status}: ${errText.slice(0, 200)}`);
      err.statusCode = res.status;
      throw err;
    }

    const data = await res.json();
    return { text: (data.text || '').trim() };
  }
}

module.exports = ElevenLabsSttAdapter;
