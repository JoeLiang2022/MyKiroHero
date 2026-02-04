/**
 * Base Handler - 抽象基類
 * 定義訊息處理器的介面，讓不同 IDE 可以實作自己的 handler
 * 
 * 分層設計：
 * - 這是通用層，定義介面
 * - 具體實作（kiro-handler, cursor-handler 等）是 IDE 專屬層
 */

class BaseHandler {
    constructor(config) {
        this.config = config;
    }

    /**
     * 取得 handler 名稱
     * @returns {string}
     */
    getName() {
        return 'base';
    }

    /**
     * 檢查此 handler 是否可用
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        return false;
    }

    /**
     * 發送訊息到 IDE 的 AI chat
     * @param {string} message - 要發送的訊息
     * @returns {Promise<void>}
     */
    async sendToChat(message) {
        throw new Error('sendToChat() must be implemented by subclass');
    }

    /**
     * 處理收到的訊息
     * @param {object} message - 訊息物件
     * @param {object} gateway - Gateway 實例
     * @returns {Promise<void>}
     */
    async handle(message, gateway) {
        throw new Error('handle() must be implemented by subclass');
    }
}

module.exports = BaseHandler;
