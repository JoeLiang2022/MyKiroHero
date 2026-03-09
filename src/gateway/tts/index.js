/**
 * TtsService — TTS 統一入口服務
 * 
 * 透過 AiRouter 的 fallback 鏈執行 TTS 請求，
 * 統一後處理：PCM → WAV header → ffmpeg → OGG；OGG → 直接寫入。
 * 管理輸出目錄 temp/audio/YYYY-MM-DD/
 * 
 * Requirements: 4.5
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getTodayDate } = require('../../utils/timezone');

// Adapter class map — lazy require to avoid circular deps
const ADAPTER_MAP = {
  gemini: () => require('./gemini'),
  openai: () => require('./openai'),
  elevenlabs: () => require('./elevenlabs'),
};

// PCM constants for WAV header construction
const PCM_SAMPLE_RATE = 24000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_BYTE_RATE = PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
const PCM_BLOCK_ALIGN = PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);

class TtsService {
  /**
   * @param {import('../../ai-router').AiRouter} router - AI Router 實例
   * @param {Object} config
   * @param {string} [config.projectDir] - 專案根目錄（用於輸出路徑），預設為 __dirname/../../..
   */
  constructor(router, config = {}) {
    this.router = router;
    this.projectDir = config.projectDir || path.join(__dirname, '..', '..', '..');
  }

  /**
   * 合成語音並輸出為 OGG Opus 檔案
   * 
   * @param {string} text - 要合成的文字
   * @param {string} voice - 語音名稱
   * @param {Object} [options]
   * @param {string} [options.outputDir] - 自訂輸出目錄（覆蓋預設）
   * @param {string} [options.filename] - 檔名（不含副檔名）
   * @returns {Promise<{filePath: string, size: number, duration: number, voice: string, format: string}>}
   */
  async synthesize(text, voice, options = {}) {
    // 1. 透過 router.execute 執行 TTS，自動 fallback
    const result = await this.router.execute('tts', async (candidate) => {
      const AdapterClass = this._getAdapterClass(candidate.provider);
      const adapter = new AdapterClass(candidate.key, candidate.model);
      return adapter.synthesize(text, voice, options);
    });

    // 2. 準備輸出目錄與檔名
    const today = getTodayDate();
    const outputDir = options.outputDir || path.join(this.projectDir, 'temp', 'audio', today);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const filename = options.filename || `tts_${Date.now()}`;
    const oggPath = path.join(outputDir, `${filename}.ogg`);

    // 3. 後處理：根據 format 決定路徑
    let duration = 0;

    if (result.format === 'pcm') {
      // PCM → WAV header → ffmpeg → OGG
      const sampleRate = result.sampleRate || PCM_SAMPLE_RATE;
      duration = this._pcmToOgg(result.buffer, oggPath, sampleRate);
    } else {
      // OGG (or other) → 直接寫入
      fs.writeFileSync(oggPath, result.buffer);
      // OGG 無法精確估算 duration，回傳 0
      duration = 0;
    }

    const oggSize = fs.statSync(oggPath).size;

    return {
      filePath: oggPath,
      size: oggSize,
      duration,
      voice,
      format: 'ogg',
    };
  }

  /**
   * 取得 adapter class
   * @param {string} provider - provider ID
   * @returns {typeof import('./base-adapter')}
   */
  _getAdapterClass(provider) {
    const factory = ADAPTER_MAP[provider];
    if (!factory) {
      throw new Error(`Unknown TTS provider: ${provider}`);
    }
    return factory();
  }

  /**
   * PCM buffer → WAV → ffmpeg → OGG Opus
   * 回傳估算的 duration（秒）
   * 
   * @param {Buffer} pcmBuffer - raw PCM data
   * @param {string} oggPath - 輸出 OGG 路徑
   * @param {number} [sampleRate=24000] - PCM sample rate
   * @returns {number} duration in seconds
   */
  _pcmToOgg(pcmBuffer, oggPath, sampleRate = PCM_SAMPLE_RATE) {
    const outputDir = path.dirname(oggPath);
    const basename = path.basename(oggPath, '.ogg');
    const wavPath = path.join(outputDir, `${basename}.wav`);

    // Build WAV header (44 bytes)
    const wavHeader = Buffer.alloc(44);
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);                              // PCM chunk size
    wavHeader.writeUInt16LE(1, 20);                               // PCM format
    wavHeader.writeUInt16LE(PCM_CHANNELS, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    const byteRate = sampleRate * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
    wavHeader.writeUInt32LE(byteRate, 28);
    wavHeader.writeUInt16LE(PCM_BLOCK_ALIGN, 32);
    wavHeader.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(pcmBuffer.length, 40);

    // Write WAV file
    fs.writeFileSync(wavPath, Buffer.concat([wavHeader, pcmBuffer]));

    // Convert WAV → OGG Opus via ffmpeg-static
    const ffmpegPath = require('ffmpeg-static');
    execSync(`"${ffmpegPath}" -y -i "${wavPath}" -c:a libopus -b:a 64k "${oggPath}"`, { stdio: 'pipe' });

    // Cleanup WAV temp file
    try { fs.unlinkSync(wavPath); } catch (e) { /* ignore */ }

    // Estimate duration from PCM data
    const bytesPerSample = PCM_BITS_PER_SAMPLE / 8;
    const duration = Math.round(pcmBuffer.length / (sampleRate * PCM_CHANNELS * bytesPerSample));

    return duration;
  }
}

module.exports = { TtsService };
