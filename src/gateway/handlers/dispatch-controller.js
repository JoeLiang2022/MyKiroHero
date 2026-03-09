/**
 * Dispatch Controller — 碎片訊息狀態機
 * 
 * 每個 chatId 獨立的狀態機，管理訊息收集與合併。
 * 碎片訊息進入 COLLECTING 狀態，在適當時機合併後一次 dispatch。
 * 
 * Requirements: R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R5.1, R5.2, R5.3
 */

// ============================================================
// 常數
// ============================================================

const STATES = {
    IDLE: 'IDLE',
    COLLECTING: 'COLLECTING',
    DISPATCHING: 'DISPATCHING'
};

// ============================================================
// DispatchController 類別
// ============================================================

class DispatchController {
    /**
     * @param {object} config - { collectTimeout, maxMessages, maxWait, threshold }
     * @param {function} onDispatch - 合併完成後的回呼 (chatId, mergedText, messages) => void
     */
    constructor(config, onDispatch) {
        if (typeof onDispatch !== 'function') {
            throw new Error('onDispatch must be a function');
        }

        this._config = {
            collectTimeout: (config && typeof config.collectTimeout === 'number') ? config.collectTimeout : 3000,
            maxMessages: (config && typeof config.maxMessages === 'number') ? config.maxMessages : 3,
            maxWait: (config && typeof config.maxWait === 'number') ? config.maxWait : 10000,
            threshold: (config && typeof config.threshold === 'number') ? config.threshold : 0.6
        };

        this._onDispatch = onDispatch;

        /** @type {Map<string, ChatState>} */
        this._chats = new Map();
    }

    // ============================================================
    // 公開方法
    // ============================================================

    /**
     * 處理一則新訊息
     * @param {string} chatId
     * @param {object} message - enriched message（至少有 text 屬性）
     * @param {{ score: number, isComplete: boolean }} classification
     */
    handleMessage(chatId, message, classification) {
        const text = (message && message.text != null) ? String(message.text) : '';
        const isComplete = !!(classification && classification.isComplete);
        const now = Date.now();

        const chatState = this._chats.get(chatId);
        const currentState = chatState ? chatState.state : STATES.IDLE;

        if (currentState === STATES.IDLE) {
            if (isComplete) {
                // 完整訊息 → 直接 dispatch（不進 buffer）
                // Catch errors to avoid unhandled promise rejection
                this._dispatch(chatId, text, [{ text, message, timestamp: now }]).catch(err => {
                    console.error(`[DispatchController] dispatch error for ${chatId}: ${err.message}`);
                });
            } else {
                // 碎片 → 開始收集
                this._startCollecting(chatId, { text, message, timestamp: now }, now);
            }
        } else if (currentState === STATES.COLLECTING) {
            // 加入 buffer
            chatState.buffer.push({ text, message, timestamp: now });
            chatState.lastMessageTime = now;

            if (isComplete) {
                // 收到完整訊息 → dispatch 所有 buffered 訊息
                this._dispatchBuffer(chatId).catch(err => {
                    console.error(`[DispatchController] complete dispatch error for ${chatId}: ${err.message}`);
                });
            } else if (chatState.buffer.length >= this._config.maxMessages) {
                // 達到上限 → dispatch
                this._dispatchBuffer(chatId).catch(err => {
                    console.error(`[DispatchController] maxMessages dispatch error for ${chatId}: ${err.message}`);
                });
            } else {
                // 還是碎片，重設 collectTimer（3s 無新訊息 timer）
                this._resetCollectTimer(chatId);
            }
        }
        // DISPATCHING 狀態下的訊息：dispatch 是同步的，理論上不會發生
        // 但如果真的發生了，忽略（dispatch 完會回到 IDLE，下一則訊息會正常處理）
    }

    /**
     * 取得指定 chatId 的當前狀態
     * @param {string} chatId
     * @returns {string} IDLE | COLLECTING | DISPATCHING
     */
    getState(chatId) {
        const chatState = this._chats.get(chatId);
        return chatState ? chatState.state : STATES.IDLE;
    }

    /**
     * 取得指定 chatId 的 buffer 內容
     * @param {string} chatId
     * @returns {Array}
     */
    getBuffer(chatId) {
        const chatState = this._chats.get(chatId);
        return chatState ? chatState.buffer.slice() : [];
    }

    /**
     * 清理指定 chatId 的所有狀態和 timer
     * @param {string} chatId
     */
    cleanup(chatId) {
        const chatState = this._chats.get(chatId);
        if (chatState) {
            this._clearTimers(chatState);
            this._chats.delete(chatId);
        }
    }

    /**
     * 清理所有 chatId 的狀態（Gateway 關閉時呼叫）
     */
    cleanupAll() {
        for (const [chatId, chatState] of this._chats) {
            this._clearTimers(chatState);
        }
        this._chats.clear();
    }

    // ============================================================
    // 內部方法
    // ============================================================

    /**
     * 開始收集碎片
     * @param {string} chatId
     * @param {{ text: string, message: object, timestamp: number }} entry
     * @param {number} now
     */
    _startCollecting(chatId, entry, now) {
        const chatState = {
            state: STATES.COLLECTING,
            buffer: [entry],
            collectTimer: null,
            maxWaitTimer: null,
            firstMessageTime: now,
            lastMessageTime: now
        };

        this._chats.set(chatId, chatState);

        // 設定 collectTimer（3s 無新訊息 → dispatch）
        chatState.collectTimer = setTimeout(() => {
            this._onCollectTimeout(chatId);
        }, this._config.collectTimeout);

        // 設定 maxWaitTimer（10s 總 timeout → dispatch）
        chatState.maxWaitTimer = setTimeout(() => {
            this._onMaxWaitTimeout(chatId);
        }, this._config.maxWait);
    }

    /**
     * 重設 collectTimer（收到新碎片時呼叫）
     * @param {string} chatId
     */
    _resetCollectTimer(chatId) {
        const chatState = this._chats.get(chatId);
        if (!chatState) return;

        // 清除舊的 collectTimer
        if (chatState.collectTimer !== null) {
            clearTimeout(chatState.collectTimer);
            chatState.collectTimer = null;
        }

        // 設定新的 collectTimer
        chatState.collectTimer = setTimeout(() => {
            this._onCollectTimeout(chatId);
        }, this._config.collectTimeout);
    }

    /**
     * collectTimer 到期（3s 無新訊息）
     * @param {string} chatId
     */
    _onCollectTimeout(chatId) {
        const chatState = this._chats.get(chatId);
        // 檢查狀態是否還存在（可能已被 cleanup）
        if (!chatState || chatState.state !== STATES.COLLECTING) return;

        this._dispatchBuffer(chatId).catch(err => {
            console.error(`[DispatchController] collectTimeout dispatch error for ${chatId}: ${err.message}`);
        });
    }

    /**
     * maxWaitTimer 到期（10s 總 timeout）
     * @param {string} chatId
     */
    _onMaxWaitTimeout(chatId) {
        const chatState = this._chats.get(chatId);
        // 檢查狀態是否還存在（可能已被 cleanup）
        if (!chatState || chatState.state !== STATES.COLLECTING) return;

        this._dispatchBuffer(chatId).catch(err => {
            console.error(`[DispatchController] maxWaitTimeout dispatch error for ${chatId}: ${err.message}`);
        });
    }

    /**
     * Dispatch buffer 中的所有訊息
     * @param {string} chatId
     */
    async _dispatchBuffer(chatId) {
        const chatState = this._chats.get(chatId);
        if (!chatState) return;

        const messages = chatState.buffer.slice();
        const mergedText = this._mergeMessages(messages);

        await this._dispatch(chatId, mergedText, messages);
    }

    /**
     * 執行 dispatch：設定 DISPATCHING 狀態 → 呼叫回呼 → 清理
     * @param {string} chatId
     * @param {string} mergedText
     * @param {Array} messages
     */
    async _dispatch(chatId, mergedText, messages) {
        // 如果有 chatState，先設為 DISPATCHING
        const chatState = this._chats.get(chatId);
        if (chatState) {
            chatState.state = STATES.DISPATCHING;
        }

        // 呼叫回呼（可能是 async）
        try {
            await this._onDispatch(chatId, mergedText, messages);
        } catch (err) {
            // onDispatch 失敗不影響狀態清理
            console.error(`[DispatchController] onDispatch error for ${chatId}:`, err.message);
        }

        // 清理：清除 timer，移除 chatId
        if (chatState) {
            this._clearTimers(chatState);
        }
        this._chats.delete(chatId);
    }

    /**
     * 合併訊息文字
     * @param {Array<{ text: string }>} messages
     * @returns {string}
     */
    _mergeMessages(messages) {
        if (messages.length === 0) return '';
        if (messages.length === 1) return messages[0].text;

        // >= 2 則：加 [合併 N 則訊息] 標記
        const texts = messages.map(m => m.text);
        return `[合併 ${messages.length} 則訊息]\n${texts.join('\n')}`;
    }

    /**
     * 清除 chatState 的所有 timer
     * @param {object} chatState
     */
    _clearTimers(chatState) {
        if (chatState.collectTimer !== null) {
            clearTimeout(chatState.collectTimer);
            chatState.collectTimer = null;
        }
        if (chatState.maxWaitTimer !== null) {
            clearTimeout(chatState.maxWaitTimer);
            chatState.maxWaitTimer = null;
        }
    }
}

// ============================================================
// Exports
// ============================================================

module.exports = { DispatchController, STATES };
