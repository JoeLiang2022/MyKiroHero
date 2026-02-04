/**
 * Handler Factory
 * 根據 IDE 類型選擇對應的 handler
 * 
 * 分層設計：
 * - 這是通用層的入口點
 * - 根據 config.ideType 動態載入對應的 IDE 專屬 handler
 */

const config = require('../config');

// IDE Handler 映射表
const handlers = {
    kiro: () => require('./kiro-handler'),
    // 未來擴展：
    // cursor: () => require('./cursor-handler'),
    // windsurf: () => require('./windsurf-handler'),
    // generic: () => require('./generic-handler'),
};

/**
 * 建立 handler 實例
 * @returns {BaseHandler} handler 實例
 */
function createHandler() {
    const ideType = config.ideType || 'kiro';
    
    if (!handlers[ideType]) {
        console.warn(`[Handler] 未知的 IDE 類型: ${ideType}，使用 kiro 作為預設`);
        const KiroHandler = handlers.kiro();
        return new KiroHandler(config);
    }
    
    const Handler = handlers[ideType]();
    console.log(`[Handler] 使用 ${ideType} handler`);
    return new Handler(config);
}

/**
 * 建立相容舊版的 handler function
 * 讓現有程式碼不需要修改
 * @returns {Function} handler function
 */
function createLegacyHandler() {
    const handler = createHandler();
    return async (message, gateway) => {
        return handler.handle(message, gateway);
    };
}

module.exports = {
    createHandler,
    createLegacyHandler,
    // 直接匯出 legacy handler 以保持向後相容
    default: createLegacyHandler()
};
