/**
 * BaseTtsAdapter — TTS adapter 抽象基底類別
 * 所有 TTS provider adapter 都繼承這個類別
 * 
 * 鏡像 STT 的 base-adapter.js 模式
 */

class BaseTtsAdapter {
  constructor(apiKey, modelId) {
    this.apiKey = apiKey;
    this.modelId = modelId;
  }

  /**
   * 合成語音
   * @param {string} text - 要合成的文字
   * @param {string} voice - 語音名稱
   * @param {Object} [options] - 額外選項
   * @returns {Promise<{buffer: Buffer, format: string}>}
   *   format: 'pcm' | 'mp3' | 'ogg' | 'wav'
   */
  async synthesize(text, voice, options) {
    throw new Error('Not implemented');
  }

  /**
   * 建立帶有 timeout 的 AbortController（預設 30 秒）
   * @param {number} [ms=30000] - timeout 毫秒數
   * @returns {{ controller: AbortController, timeout: NodeJS.Timeout }}
   */
  _buildRequestTimeout(ms = 30000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    return { controller, timeout };
  }

  /**
   * 拋出帶有 statusCode 屬性的 API 錯誤
   * @param {string} providerName - Provider 名稱（如 'Gemini', 'OpenAI'）
   * @param {number} statusCode - HTTP 狀態碼
   * @param {string} errorText - 錯誤訊息文字
   * @throws {Error} 帶有 statusCode 屬性的 Error
   */
  _throwApiError(providerName, statusCode, errorText) {
    const err = new Error(`${providerName} API error ${statusCode}: ${errorText}`);
    err.statusCode = statusCode;
    throw err;
  }
}

module.exports = BaseTtsAdapter;
