/**
 * BaseSttAdapter — STT adapter 抽象基底類別
 * 所有 STT provider adapter 都繼承這個類別
 */

const fs = require('fs');
const path = require('path');

class BaseSttAdapter {
  constructor(apiKey, modelId) {
    this.apiKey = apiKey;
    this.modelId = modelId;
  }

  /**
   * 轉寫音檔為文字
   * @param {string} audioFilePath - 音檔路徑
   * @param {string} mimetype - MIME type（可能含參數，如 'audio/ogg; codecs=opus'）
   * @returns {Promise<{text: string, language?: string, duration?: number}>}
   */
  async transcribe(audioFilePath, mimetype) {
    throw new Error('Not implemented');
  }

  /**
   * 讀取音檔為 Buffer
   * @param {string} filePath
   * @returns {Buffer}
   */
  _readAudioFile(filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Audio file not found: ${resolved}`);
    }
    return fs.readFileSync(resolved);
  }

  /**
   * 取得基礎 MIME type（去掉參數）
   * 'audio/ogg; codecs=opus' → 'audio/ogg'
   * @param {string} mimetype
   * @returns {string}
   */
  _getBaseMimeType(mimetype) {
    if (!mimetype) return 'audio/ogg';
    return mimetype.split(';')[0].trim();
  }

  /**
   * 取得檔案大小（bytes）
   * @param {string} filePath
   * @returns {number}
   */
  _getFileSize(filePath) {
    return fs.statSync(path.resolve(filePath)).size;
  }
}

module.exports = BaseSttAdapter;
