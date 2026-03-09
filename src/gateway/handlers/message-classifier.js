/**
 * Message Classifier — 訊息完整性評分
 * 
 * 純函式模組，負責判斷一則訊息是「碎片」還是「完整訊息」。
 * 無狀態、無副作用，適合 property-based testing。
 * 
 * Requirements: R2.1, R2.2, R2.3, R2.4
 */

// ============================================================
// 常數
// ============================================================

/** 評分維度權重（加總 = 1.0） */
const WEIGHTS = {
    length: 0.3,
    punctuation: 0.3,
    timeDelta: 0.2,
    continuation: 0.2
};

/** 長度評分的邊界值（字元數） */
const LENGTH_MIN = 5;
const LENGTH_MAX = 20;

/** 時間差評分的邊界值（毫秒） */
const TIME_DELTA_MIN = 1000;   // 1 秒
const TIME_DELTA_MAX = 5000;   // 5 秒

/** 結尾標點符號（中英文句號、問號、驚嘆號） */
const ENDING_PUNCTUATION = /[。？！.?!]$/;

/** 延續詞列表（訊息開頭出現代表是碎片的延續） */
const CONTINUATION_WORDS = [
    '然後', '還有', '對了', '但是', '而且', '不過', '所以', '因為',
    '另外', '還是', '或者', '不然', '接著', '再來', '最後',
    '啊對', '欸對', '喔對', '話說', '順便'
];

/** URL 正則 */
const URL_REGEX = /https?:\/\//i;

/**
 * Emoji 正則 — 匹配常見 Unicode emoji 範圍
 * 包含：表情符號、符號、旗幟、修飾符、ZWJ 序列等
 */
const EMOJI_REGEX = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f\u20e3\s]+$/u;

// ============================================================
// 評分維度函式
// ============================================================

/**
 * 長度評分
 * < 5 字元 → 0.0，>= 20 字元 → 1.0，中間線性插值
 * @param {string} text
 * @returns {number} 0.0 ~ 1.0
 */
function scoreLength(text) {
    const len = text.length;
    if (len >= LENGTH_MAX) return 1.0;
    if (len < LENGTH_MIN) return 0.0;
    return (len - LENGTH_MIN) / (LENGTH_MAX - LENGTH_MIN);
}

/**
 * 標點評分
 * 結尾有句號/問號/驚嘆號 → 1.0，否則 → 0.0
 * @param {string} text
 * @returns {number} 0.0 或 1.0
 */
function scorePunctuation(text) {
    if (text.length === 0) return 0.0;
    return ENDING_PUNCTUATION.test(text) ? 1.0 : 0.0;
}

/**
 * 時間差評分
 * < 1 秒 → 0.0，> 5 秒 → 1.0，中間線性插值
 * @param {number} timeDeltaMs - 毫秒
 * @returns {number} 0.0 ~ 1.0
 */
function scoreTimeDelta(timeDeltaMs) {
    if (timeDeltaMs >= TIME_DELTA_MAX) return 1.0;
    if (timeDeltaMs < TIME_DELTA_MIN) return 0.0;
    return (timeDeltaMs - TIME_DELTA_MIN) / (TIME_DELTA_MAX - TIME_DELTA_MIN);
}

/**
 * 延續詞評分
 * 開頭有延續詞 → 0.0（碎片），否則 → 1.0（完整）
 * @param {string} text
 * @returns {number} 0.0 或 1.0
 */
function scoreContinuation(text) {
    const trimmed = text.trimStart();
    for (const word of CONTINUATION_WORDS) {
        if (trimmed.startsWith(word)) return 0.0;
    }
    return 1.0;
}

// ============================================================
// 主要函式
// ============================================================

/**
 * 評分一則訊息的完整性
 * 
 * @param {string} text - 訊息文字（null/undefined 視為空字串）
 * @param {number} timeDeltaMs - 距離上一則訊息的毫秒數（首則傳 Infinity）
 * @param {object} config - { threshold: number }（預設 0.6）
 * @returns {{ score: number, isComplete: boolean, breakdown: { length: number, punctuation: number, timeDelta: number, continuation: number } }}
 */
function classifyMessage(text, timeDeltaMs, config) {
    // 處理 null/undefined
    const safeText = (text == null) ? '' : String(text);
    // Infinity = 首則訊息（距離上一則很久），視為最大值 → timeDelta score = 1.0
    const safeTimeDelta = (timeDeltaMs == null || timeDeltaMs < 0) ? 0
        : (timeDeltaMs === Infinity) ? TIME_DELTA_MAX
        : (isNaN(timeDeltaMs)) ? 0
        : timeDeltaMs;
    const threshold = (config && typeof config.threshold === 'number') ? config.threshold : 0.6;

    // 空字串特殊處理
    if (safeText === '') {
        return {
            score: 0,
            isComplete: false,
            breakdown: { length: 0, punctuation: 0, timeDelta: 0, continuation: 0 }
        };
    }

    // 計算各維度分數
    const breakdown = {
        length: scoreLength(safeText),
        punctuation: scorePunctuation(safeText),
        timeDelta: scoreTimeDelta(safeTimeDelta),
        continuation: scoreContinuation(safeText)
    };

    // 加權總和
    const score = clamp(
        breakdown.length * WEIGHTS.length +
        breakdown.punctuation * WEIGHTS.punctuation +
        breakdown.timeDelta * WEIGHTS.timeDelta +
        breakdown.continuation * WEIGHTS.continuation
    );

    return {
        score,
        isComplete: score > threshold,
        breakdown
    };
}

/**
 * 檢查是否為特殊訊息（媒體、URL、純 emoji）→ 永遠立即 dispatch
 * 
 * @param {object} message - Gateway enriched message
 * @returns {boolean}
 */
function isSpecialMessage(message) {
    if (!message) return false;

    // 媒體訊息
    if (message.hasMedia === true) return true;

    const text = (message.text == null) ? '' : String(message.text);
    if (text === '') return false;

    // 包含 URL
    if (URL_REGEX.test(text)) return true;

    // 純 emoji（去掉空白後全部是 emoji）
    const trimmed = text.trim();
    if (trimmed.length > 0 && EMOJI_REGEX.test(trimmed)) return true;

    return false;
}

// ============================================================
// 工具函式
// ============================================================

/**
 * 將數值限制在 [0, 1] 範圍
 * @param {number} value
 * @returns {number}
 */
function clamp(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    classifyMessage,
    isSpecialMessage,
    // 匯出內部常數供測試使用
    _internals: {
        WEIGHTS,
        LENGTH_MIN,
        LENGTH_MAX,
        TIME_DELTA_MIN,
        TIME_DELTA_MAX,
        ENDING_PUNCTUATION,
        CONTINUATION_WORDS,
        URL_REGEX,
        EMOJI_REGEX,
        scoreLength,
        scorePunctuation,
        scoreTimeDelta,
        scoreContinuation,
        clamp
    }
};
