/**
 * Gateway Configuration
 * 使用者可以在這裡自訂設定
 * 
 * 分層設計：
 * - 通用設定：所有 AI 工具都能用
 * - IDE 專屬設定：透過環境變數覆蓋
 */

const path = require('path');

// ============================================================
// 通用設定（任何 AI 工具都能用）
// ============================================================
module.exports = {
    // AI 回覆的前綴（用來識別 AI 發的訊息，避免迴圈）
    // 可透過 AI_PREFIX 環境變數自訂
    aiPrefix: process.env.AI_PREFIX || '*[AI Assistant]* 🤖',
    
    // Gateway server port
    serverPort: process.env.GATEWAY_PORT || 3000,
    
    // 訊息分段設定
    message: {
        // 單則訊息最大字元數（超過會自動分段）
        maxLength: parseInt(process.env.MESSAGE_MAX_LENGTH) || 1500,
        // 分段之間的延遲（毫秒），避免訊息順序錯亂
        splitDelay: parseInt(process.env.MESSAGE_SPLIT_DELAY) || 500
    },
    
    // 錯誤通知：AI 沒回應時自動通知使用者
    errorNotification: process.env.ERROR_NOTIFICATION !== 'false',
    
    // Heartbeat 設定檔路徑
    // 預設：專案根目錄的 HEARTBEAT.md
    // Kiro 使用者可設為 .kiro/steering/HEARTBEAT.md
    heartbeatPath: process.env.HEARTBEAT_PATH || path.join(__dirname, '../../HEARTBEAT.md'),

    // ============================================================
    // IDE 專屬設定（透過環境變數配置）
    // ============================================================
    
    // IDE REST API port（用於訊息轉發）
    // Kiro/VS Code: vscode-rest-control extension (預設 55139)
    // Cursor: 待定
    // Windsurf: 待定
    ideRestPort: process.env.IDE_REST_PORT || process.env.KIRO_REST_PORT || 55139,
    
    // IDE 類型（用於選擇對應的 handler）
    // 支援: 'kiro', 'cursor', 'windsurf', 'generic'
    ideType: process.env.IDE_TYPE || 'kiro',
    
    // Steering 檔案路徑（AI 人格設定）
    // Kiro: .kiro/steering/
    // 其他: 可自訂
    steeringPath: process.env.STEERING_PATH || path.join(__dirname, '../../.kiro/steering')
};
