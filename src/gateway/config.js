/**
 * Gateway Configuration
 * 使用者可以在這裡自訂設定
 */

const path = require('path');

module.exports = {
    // AI 回覆的前綴（用來識別 AI 發的訊息，避免迴圈）
    // 格式：*[名字]* emoji
    aiPrefix: '*[叫小賀]* 🤪',
    
    // Kiro REST Control extension port
    kiroRestPort: process.env.KIRO_REST_PORT || 55139,
    
    // Gateway server port
    serverPort: process.env.GATEWAY_PORT || 3000,
    
    // 訊息分段設定
    message: {
        // 單則訊息最大字元數（超過會自動分段）
        maxLength: 1500,
        // 分段之間的延遲（毫秒），避免訊息順序錯亂
        splitDelay: 500
    },
    
    // 錯誤通知：Kiro 沒回應時自動通知使用者（true/false）
    errorNotification: true,
    
    // Heartbeat 設定檔路徑（HEARTBEAT.md）
    heartbeatPath: process.env.HEARTBEAT_PATH || path.join(__dirname, '../../../.kiro/steering/HEARTBEAT.md')
};
