/**
 * OpenAISttAdapter — OpenAI Transcriptions API
 * 需要 ffmpeg 將 OGG 轉為 MP3（OpenAI 不支援 OGG）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const BaseSttAdapter = require('./base-adapter');

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const API_URL = 'https://api.openai.com/v1/audio/transcriptions';
// OpenAI 支援的格式（不含 ogg）
const SUPPORTED_FORMATS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'];

class OpenAISttAdapter extends BaseSttAdapter {
  constructor(apiKey, modelId) {
    super(apiKey, modelId || 'gpt-4o-transcribe');
  }

  async transcribe(audioFilePath, mimetype) {
    const fileSize = this._getFileSize(audioFilePath);
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(`Audio file too large for OpenAI: ${(fileSize / 1024 / 1024).toFixed(1)}MB (max 25MB)`);
    }

    const baseMime = this._getBaseMimeType(mimetype);
    const needsConversion = baseMime.includes('ogg') || baseMime === 'video/ogg';

    let uploadPath = audioFilePath;
    let tempMp3 = null;

    try {
      if (needsConversion) {
        tempMp3 = audioFilePath.replace(/\.[^.]+$/, '_stt.mp3');
        this._convertToMp3(audioFilePath, tempMp3);
        uploadPath = tempMp3;
      }

      // multipart/form-data 用 FormData
      const fileBuffer = this._readAudioFile(uploadPath);
      const fileName = path.basename(uploadPath);
      const blob = new Blob([fileBuffer], { type: needsConversion ? 'audio/mpeg' : baseMime });

      const formData = new FormData();
      formData.append('file', blob, fileName);
      formData.append('model', this.modelId);

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        body: formData
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err = new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 200)}`);
        err.statusCode = res.status;
        throw err;
      }

      const data = await res.json();
      return { text: (data.text || '').trim() };
    } finally {
      // 清理暫存 mp3
      if (tempMp3) {
        try { fs.unlinkSync(tempMp3); } catch (e) { /* ignore */ }
      }
    }
  }

  /**
   * 用 ffmpeg 將音檔轉為 MP3
   * @param {string} inputPath
   * @param {string} outputPath
   */
  _convertToMp3(inputPath, outputPath) {
    try {
      const ffmpegPath = require('ffmpeg-static');
      execSync(`"${ffmpegPath}" -i "${inputPath}" -y -q:a 2 "${outputPath}"`, {
        timeout: 3000,
        stdio: 'pipe'
      });
    } catch (err) {
      if (err.message && err.message.includes('ENOENT')) {
        throw new Error('ffmpeg-static not found. Run: npm install ffmpeg-static');
      }
      throw new Error(`ffmpeg conversion failed: ${err.message.slice(0, 100)}`);
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error('ffmpeg conversion produced no output file');
    }
  }
}

module.exports = OpenAISttAdapter;
