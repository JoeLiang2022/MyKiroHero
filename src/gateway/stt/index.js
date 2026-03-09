/**
 * SttService — STT 統一入口
 * 透過 AiRouter 的 fallback 鏈執行 STT 請求，
 * 移除「首次失敗後永久停用」行為。
 * 
 * Requirements: 5.1, 5.2, 5.3
 */

const fs = require('fs');
const path = require('path');

// Adapter class map
const ADAPTER_MAP = {
  gemini: () => require('./gemini'),
  openai: () => require('./openai'),
  elevenlabs: () => require('./elevenlabs'),
};

class SttService {
  /**
   * @param {Object} config
   * @param {string} [config.sttProvider] - 預設 provider（無 router 時使用）
   */
  constructor(config = {}) {
    this.router = null;
    this._fallbackAdapter = null;
    this._providerName = '';
    this._modelId = '';
    this._disabled = false;

    // 向後相容：無 router 時用舊邏輯初始化單一 adapter
    this._initLegacy(config);
  }

  /**
   * 注入 AiRouter 實例
   * 有 router 時，transcribe 會透過 router.execute 自動 fallback
   */
  setRouter(router) {
    this.router = router;
    // 有 router 就不再 disabled
    if (router) {
      this._disabled = false;
    }
  }

  /**
   * 向後相容初始化（無 router 時）
   */
  _initLegacy(config) {
    const provider = (config.sttProvider || '').toLowerCase().trim();
    if (!provider) {
      console.log('[STT] STT_PROVIDER 未設定，語音轉文字停用');
      this._disabled = true;
      return;
    }

    // 讀取 ai-providers.json 取得 default model
    let defaultModel = null;
    try {
      const providersPath = path.join(__dirname, '../../../ai-providers.json');
      const providers = JSON.parse(fs.readFileSync(providersPath, 'utf-8'));
      const providerDef = providers.providers.find(p => p.id === provider);
      if (providerDef) {
        const sttModel = providerDef.models.find(m => m.capability === 'stt' && m.default);
        if (sttModel) defaultModel = sttModel.id;
      }
    } catch (err) {
      console.warn(`[STT] 讀取 ai-providers.json 失敗: ${err.message}`);
    }

    // AI_MODEL_STT 格式: provider:modelId（優先）或直接 modelId
    const envModel = process.env.AI_MODEL_STT;
    let modelId = defaultModel;
    if (envModel) {
      modelId = envModel.includes(':') ? envModel.split(':')[1] : envModel;
    }

    // 取得 API key
    const keyMap = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY' };
    const envKey = keyMap[provider];
    if (!envKey) {
      console.warn(`[STT] 不支援的 provider: ${provider}`);
      this._disabled = true;
      return;
    }

    const apiKey = process.env[envKey];
    if (!apiKey) {
      console.warn(`[STT] ${envKey} 未設定，STT 停用`);
      this._disabled = true;
      return;
    }

    // 建立 fallback adapter（無 router 時使用）
    try {
      const AdapterClass = this._getAdapterClass(provider);
      this._fallbackAdapter = new AdapterClass(apiKey, modelId);
      this._providerName = provider;
      this._modelId = modelId || '';
      console.log(`[STT] 初始化完成: provider=${provider}, model=${modelId || 'default'}`);
    } catch (err) {
      console.error(`[STT] Adapter 初始化失敗: ${err.message}`);
      this._disabled = true;
    }
  }

  _getAdapterClass(provider) {
    const factory = ADAPTER_MAP[provider];
    if (!factory) throw new Error(`Unknown STT provider: ${provider}`);
    return factory();
  }

  /**
   * 是否可用
   * 有 router → 檢查 stt chain 是否有候選
   * 無 router → 檢查 fallback adapter
   */
  isEnabled() {
    if (this.router) {
      const status = this.router.getStatus('stt');
      return status && status.totalCount > 0;
    }
    return !this._disabled && this._fallbackAdapter !== null;
  }

  getProviderName() { return this._providerName; }
  getModelId() { return this._modelId; }

  /**
   * 轉寫音檔
   * @param {string} audioFilePath
   * @param {string} mimetype
   * @returns {Promise<{text: string, language?: string, duration?: number}|null>}
   */
  async transcribe(audioFilePath, mimetype) {
    // 有 router → 透過 fallback 鏈執行（不做 isEnabled 判斷，讓 router 統一處理成敗）
    if (this.router) {
      let usedCandidate = null;
      const result = await this.router.execute('stt', async (candidate) => {
        const AdapterClass = this._getAdapterClass(candidate.provider);
        const adapter = new AdapterClass(candidate.key, candidate.model);
        const res = await adapter.transcribe(audioFilePath, mimetype);
        usedCandidate = candidate;
        return res;
      });
      // 記錄實際使用的 provider/model（供 usage tracking）
      if (usedCandidate) {
        this._providerName = usedCandidate.provider;
        this._modelId = usedCandidate.model || '';
      }
      return result;
    }

    // 無 router → 用 fallback adapter（向後相容）
    if (this._disabled || !this._fallbackAdapter) {
      throw new Error('STT 未設定 provider 或 API key');
    }
    return await this._fallbackAdapter.transcribe(audioFilePath, mimetype);
  }
}

module.exports = { SttService };
