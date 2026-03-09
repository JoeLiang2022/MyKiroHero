/**
 * AI Router — 統一 AI 呼叫路由器
 * 
 * 管理 fallback 鏈與冷卻狀態，支援 TTS/STT 等 capability。
 * 每個 capability 維護一條有序候選鏈，請求從鏈頭開始嘗試，
 * 遇到暫時性錯誤自動 fallback，遇到永久性錯誤則停止或跳過同 Provider。
 */

const DEFAULT_COOLDOWN_DURATIONS = {
  transient: 5 * 60 * 1000,   // 5 分鐘
  permanent: 60 * 60 * 1000,  // 1 小時
};

// ─── Error Classification Tables ───────────────────────────────────
//
// 查表法：先查 provider-specific 表（處理各家怪癖），再查通用 HTTP code 表。
// 新增 provider 只要加一個 entry，不用改邏輯。

/**
 * Provider-specific 400 error patterns.
 * 各家 AI provider 在 HTTP 400 裡藏了不同語意，需要靠 message 內容區分。
 * 
 * 格式: { pattern: RegExp, type, reason }
 */
const PROVIDER_400_PATTERNS = [
  // Gemini: 400 + "API key not found/invalid" → 其實是 auth error（不是 401）
  { pattern: /api.?key.*(not found|invalid|missing)/i, type: 'permanent', reason: 'auth_error' },
  // xAI: 400 + "incorrect API key" → 也是 auth error
  { pattern: /incorrect.*(api.?key|token|authorization)/i, type: 'permanent', reason: 'auth_error' },
  // OpenAI/Gemini: billing/quota 400s → 視為 rate_limit 讓 fallback 繼續嘗試下一把 key
  { pattern: /billing|quota|exceeded.*limit/i, type: 'permanent', reason: 'rate_limit' },
  // Gemini: FAILED_PRECONDITION (地區不支援 / 未開通付費)
  { pattern: /failed.?precondition|location.*not.*supported/i, type: 'permanent', reason: 'region_blocked' },
];

/**
 * 通用 HTTP status code 查表
 * 格式: { type, reason, cooldownKey }
 *   cooldownKey: 'permanent' | 'transient' | 0 (不設冷卻)
 */
const HTTP_CODE_TABLE = {
  400: { type: 'permanent', reason: 'bad_request', cooldownKey: 0 },
  401: { type: 'permanent', reason: 'auth_error', cooldownKey: 'permanent' },
  403: { type: 'permanent', reason: 'permission_denied', cooldownKey: 'permanent' },
  404: { type: 'permanent', reason: 'not_found', cooldownKey: 0 },
  405: { type: 'permanent', reason: 'bad_request', cooldownKey: 0 },
  415: { type: 'permanent', reason: 'bad_request', cooldownKey: 0 },
  422: { type: 'permanent', reason: 'bad_request', cooldownKey: 0 },
  429: { type: 'transient', reason: 'rate_limit', cooldownKey: 'transient' },
  500: { type: 'transient', reason: 'server_error', cooldownKey: 'transient' },
  502: { type: 'transient', reason: 'server_error', cooldownKey: 'transient' },
  503: { type: 'transient', reason: 'server_error', cooldownKey: 'transient' },
  504: { type: 'transient', reason: 'server_error', cooldownKey: 'transient' },
};

/**
 * 錯誤分類函式（查表法）
 * 
 * 1. 若 HTTP 400 → 先掃 PROVIDER_400_PATTERNS（各家怪癖）
 * 2. 查 HTTP_CODE_TABLE（通用 code → reason）
 * 3. 5xx 範圍 fallback → server_error
 * 4. 都沒中 → network_error（timeout / ECONNREFUSED 等）
 * 
 * @param {Error} error - 帶有 statusCode 屬性的 Error
 * @param {Object} [cooldownDurations] - 自訂冷卻時間
 * @returns {Object} { type, reason, cooldown }
 */
function classifyError(error, cooldownDurations = DEFAULT_COOLDOWN_DURATIONS) {
  const code = error.statusCode || 0;
  const msg = error.message || '';

  // Step 1: HTTP 400 → 掃 provider-specific patterns
  if (code === 400) {
    for (const entry of PROVIDER_400_PATTERNS) {
      if (entry.pattern.test(msg)) {
        const cdKey = entry.reason === 'auth_error' ? 'permanent' : (entry.reason === 'rate_limit' ? 'permanent' : 0);
        return { type: entry.type, reason: entry.reason, cooldown: cdKey ? cooldownDurations[cdKey] : 0 };
      }
    }
  }

  // Step 2: 查通用 HTTP code 表
  const tableEntry = HTTP_CODE_TABLE[code];
  if (tableEntry) {
    const cooldown = tableEntry.cooldownKey === 0 ? 0 : cooldownDurations[tableEntry.cooldownKey];
    return { type: tableEntry.type, reason: tableEntry.reason, cooldown };
  }

  // Step 3: 5xx 範圍 fallback（表裡沒列到的 5xx）
  if (code >= 500 && code < 600) {
    return { type: 'transient', reason: 'server_error', cooldown: cooldownDurations.transient };
  }

  // Step 4: 無 statusCode → timeout / 網路錯誤
  return { type: 'transient', reason: 'network_error', cooldown: cooldownDurations.transient };
}

/**
 * 錯誤嚴重程度排序權重
 * 數字越小越嚴重
 */
const SEVERITY_ORDER = {
  auth_error: 0,        // 401 / Gemini 400 key invalid / xAI 400 key incorrect
  permission_denied: 1, // 403
  region_blocked: 2,    // Gemini 400 FAILED_PRECONDITION
  rate_limit: 3,        // 429 / billing 400
  server_error: 4,      // 5xx
  network_error: 5,     // timeout/network
  not_found: 6,         // 404
  bad_request: 7,       // 400 generic
};

/**
 * AiRouterError — 所有候選都失敗時拋出的錯誤
 */
class AiRouterError extends Error {
  /**
   * @param {string} capability - 'tts' | 'stt'
   * @param {Array<Object>} errors - 錯誤詳情陣列
   *   每個元素: { provider, keyIndex, reason, statusCode, message }
   * @param {Map} [cooldownMap] - 冷卻狀態 Map，用於計算恢復時間
   */
  constructor(capability, errors, cooldownMap) {
    const formattedMessage = AiRouterError.formatErrorMessage(capability, errors, cooldownMap);
    super(formattedMessage);
    this.name = 'AiRouterError';
    this.capability = capability;
    this.errors = errors;
  }

  /**
   * 格式化錯誤訊息
   * 1. 按嚴重程度排序：401 > 429 > 5xx > network
   * 2. 若有 401 → 加入「Key 有問題」提示
   * 3. 若有冷卻中的 Key → 計算最短剩餘時間，加入「最快約 X 分鐘後恢復」
   * 4. 每個錯誤條目包含：provider、keyIndex、reason、message
   * 
   * @param {string} capability
   * @param {Array<Object>} errors
   * @param {Map} [cooldownMap]
   * @returns {string}
   */
  static formatErrorMessage(capability, errors, cooldownMap) {
    if (!errors || errors.length === 0) {
      return `[${capability}] 所有候選都失敗`;
    }

    // 1. 按嚴重程度排序
    const sorted = [...errors].sort((a, b) => {
      const sa = SEVERITY_ORDER[a.reason] ?? 99;
      const sb = SEVERITY_ORDER[b.reason] ?? 99;
      return sa - sb;
    });

    // 2. 建構錯誤條目
    const lines = [`[${capability}] 所有候選都失敗：`];
    for (const err of sorted) {
      lines.push(`  - ${err.provider}[key${err.keyIndex}]: ${err.reason} (${err.statusCode || 'N/A'}) ${err.message}`);
    }

    // 3. 若有 401 → 加入「Key 有問題」提示
    const has401 = sorted.some(e => e.reason === 'auth_error');
    if (has401) {
      lines.push('  ⚠ Key 有問題，請檢查 API Key 是否正確');
    }

    // 4. 若有冷卻中的 Key → 計算最短剩餘時間
    if (cooldownMap && cooldownMap.size > 0) {
      const now = Date.now();
      let minRemaining = Infinity;
      for (const [, entry] of cooldownMap) {
        const remaining = entry.expiresAt - now;
        if (remaining > 0 && remaining < minRemaining) {
          minRemaining = remaining;
        }
      }
      if (minRemaining < Infinity) {
        const minutes = Math.ceil(minRemaining / 60000);
        lines.push(`  ⏱ 最快約 ${minutes} 分鐘後恢復`);
      }
    }

    return lines.join('\n');
  }
}

class AiRouter {
  /**
   * @param {Object} config
   * @param {Object} config.chains - { tts: [{provider, key, model, keyIndex}], stt: [...] }
   * @param {Object} [config.cooldownDurations] - { transient: 300000, permanent: 3600000 }
   */
  constructor(config) {
    if (!config || !config.chains) {
      throw new Error('AiRouter: config.chains is required');
    }
    this.chains = config.chains;
    this.cooldownDurations = {
      ...DEFAULT_COOLDOWN_DURATIONS,
      ...(config.cooldownDurations || {}),
    };

    // cooldownMap: Map<string, CooldownEntry>
    // key 格式: `${capability}:${provider}:${keyIndex}`
    this.cooldownMap = new Map();

    // lastSuccess: Map<string, number>
    // key 格式: `${capability}:${provider}:${keyIndex}`
    this.lastSuccess = new Map();
  }

  /**
   * 產生冷卻 Map 的 key
   * @param {string} capability
   * @param {string} provider
   * @param {number} keyIndex
   * @returns {string}
   */
  _cooldownKey(capability, provider, keyIndex) {
    return `${capability}:${provider}:${keyIndex}`;
  }

  /**
   * 設定冷卻
   * @param {string} capability
   * @param {string} provider
   * @param {number} keyIndex
   * @param {string} reason
   * @param {number} statusCode
   * @param {number} duration - 冷卻時間 (ms)
   */
  _setCooldown(capability, provider, keyIndex, reason, statusCode, duration) {
    if (duration <= 0) return; // 不設冷卻（如 400）
    const key = this._cooldownKey(capability, provider, keyIndex);
    const now = Date.now();
    this.cooldownMap.set(key, {
      reason,
      statusCode,
      expiresAt: now + duration,
      failedAt: now,
    });
  }

  /**
   * 檢查是否在冷卻中
   * @param {string} capability
   * @param {string} provider
   * @param {number} keyIndex
   * @returns {boolean}
   */
  _isInCooldown(capability, provider, keyIndex) {
    const entry = this._getCooldownEntry(capability, provider, keyIndex);
    if (!entry) return false;
    if (Date.now() >= entry.expiresAt) {
      // 冷卻已過期，清除
      const key = this._cooldownKey(capability, provider, keyIndex);
      this.cooldownMap.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 取得冷卻條目
   * @param {string} capability
   * @param {string} provider
   * @param {number} keyIndex
   * @returns {Object|null}
   */
  _getCooldownEntry(capability, provider, keyIndex) {
    const key = this._cooldownKey(capability, provider, keyIndex);
    return this.cooldownMap.get(key) || null;
  }

  /**
   * 執行 AI 呼叫，自動 fallback
   * 
   * @param {string} capability - 'tts' | 'stt'
   * @param {Function} callFn - async (candidate) => result
   * @returns {Promise<any>}
   * @throws {AiRouterError}
   */
  async execute(capability, callFn) {
    const chain = this.chains[capability];
    if (!chain || chain.length === 0) {
      throw new AiRouterError(capability, [{
        provider: 'none',
        keyIndex: 0,
        reason: 'bad_request',
        statusCode: 0,
        message: `No chain configured for capability: ${capability}`,
      }]);
    }

    // 過濾掉冷卻中的候選
    const activeCandidates = chain.filter(
      c => !this._isInCooldown(capability, c.provider, c.keyIndex)
    );

    // 若全部冷卻中 → 使用完整 chain（從頭重試）
    const candidates = activeCandidates.length > 0 ? activeCandidates : chain;

    const errors = [];
    let i = 0;

    while (i < candidates.length) {
      const candidate = candidates[i];

      try {
        const result = await callFn(candidate);
        // 成功 → 記錄最後成功時間
        const successKey = this._cooldownKey(capability, candidate.provider, candidate.keyIndex);
        this.lastSuccess.set(successKey, Date.now());
        return result;
      } catch (error) {
        const classification = classifyError(error, this.cooldownDurations);

        errors.push({
          provider: candidate.provider,
          keyIndex: candidate.keyIndex,
          reason: classification.reason,
          statusCode: error.statusCode || 0,
          message: error.message || 'Unknown error',
        });

        if (classification.reason === 'bad_request' || classification.reason === 'not_found') {
          // 參數錯誤 / 資源不存在：不設冷卻，直接拋出（不該 fallback）
          throw new AiRouterError(capability, errors, this.cooldownMap);
        }

        // skipCandidate: 呼叫端主動跳過（如 user 指定 provider），不設冷卻直接跳下一個
        if (error.skipCandidate) {
          i++;
          continue;
        }

        // 設定冷卻
        this._setCooldown(
          capability,
          candidate.provider,
          candidate.keyIndex,
          classification.reason,
          error.statusCode || 0,
          classification.cooldown
        );

        if (['auth_error', 'permission_denied', 'region_blocked'].includes(classification.reason)) {
          // provider 層級問題：跳到下一個不同 Provider 的候選
          const currentProvider = candidate.provider;
          i++;
          while (i < candidates.length && candidates[i].provider === currentProvider) {
            i++;
          }
        } else {
          // transient: 繼續下一個候選
          i++;
        }
      }
    }

    // 全部失敗
    throw new AiRouterError(capability, errors, this.cooldownMap);
  }

  /**
   * 取得指定 capability 的狀態
   * @param {string} [capability] - 不指定則回傳全部
   * @returns {Object}
   */
  getStatus(capability) {
    const capabilities = capability
      ? [capability]
      : Object.keys(this.chains);

    const result = {};
    const now = Date.now();

    for (const cap of capabilities) {
      const chain = this.chains[cap] || [];
      const chainStatus = chain.map(entry => {
        const cdKey = this._cooldownKey(cap, entry.provider, entry.keyIndex);
        const cdEntry = this.cooldownMap.get(cdKey);
        const successTime = this.lastSuccess.get(cdKey);

        const isInCooldown = cdEntry && now < cdEntry.expiresAt;

        const status = {
          provider: entry.provider,
          keyIndex: entry.keyIndex,
          model: entry.model,
          status: isInCooldown ? 'cooling' : 'normal',
        };

        if (isInCooldown) {
          status.cooldownReason = cdEntry.reason;
          status.cooldownRemaining = Math.ceil((cdEntry.expiresAt - now) / 1000);
        }

        if (successTime) {
          status.lastSuccess = successTime;
        }

        return status;
      });

      const activeCount = chainStatus.filter(s => s.status === 'normal').length;

      result[cap] = {
        chain: chainStatus,
        activeCount,
        totalCount: chain.length,
      };
    }

    return result;
  }

  /**
   * 清除冷卻狀態
   * @param {string} [capability] - 不指定則清除全部
   */
  resetCooldowns(capability) {
    if (!capability) {
      this.cooldownMap.clear();
      return;
    }

    const prefix = `${capability}:`;
    for (const key of [...this.cooldownMap.keys()]) {
      if (key.startsWith(prefix)) {
        this.cooldownMap.delete(key);
      }
    }
  }
}

module.exports = { AiRouter, AiRouterError, classifyError, DEFAULT_COOLDOWN_DURATIONS, SEVERITY_ORDER, PROVIDER_400_PATTERNS, HTTP_CODE_TABLE };
