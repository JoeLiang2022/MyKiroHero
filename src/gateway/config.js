/**
 * Gateway Configuration
 * 使用者可以在這裡自訂設定
 * 
 * 分層設計：
 * - 通用設定：所有 AI 工具都能用
 * - IDE 專屬設定：透過環境變數覆蓋
 */

const path = require('path');

// 確保 dotenv 在讀取環境變數前載入
const envPath = path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

// Debug: 顯示載入的 AI_PREFIX
console.log(`[Config] .env path: ${envPath}`);
console.log(`[Config] AI_PREFIX: ${process.env.AI_PREFIX}`);

// ============================================================
// 通用設定（任何 AI 工具都能用）
// ============================================================
module.exports = {
    // 語言設定（zh 或 en）
    language: process.env.LANGUAGE || 'en',
    
    // AI 回覆的前綴（用來識別 AI 發的訊息，避免迴圈）
    // 可透過 AI_PREFIX 環境變數自訂
    aiPrefix: process.env.AI_PREFIX || '▸ *🤖 AI Assistant :*',
    
    // Gateway server port
    // 優先順序：
    // 1. 環境變數 GATEWAY_PORT（如果是數字且非 auto）
    // 2. .gateway-port 檔案（上次使用的 port，避免每次重啟都變）
    // 3. auto（系統自動分配）
    serverPort: (() => {
        const envPort = process.env.GATEWAY_PORT;
        if (envPort && envPort !== 'auto') {
            const parsed = parseInt(envPort);
            if (parsed > 0 && parsed < 65536) {
                console.log(`[Config] 使用環境變數 GATEWAY_PORT: ${parsed}`);
                return parsed;
            }
        }
        // 嘗試讀取上次使用的 port（穩定性：避免每次重啟都拿新 port）
        try {
            const fs = require('fs');
            const portFile = path.join(__dirname, '../../.gateway-port');
            const lastPort = parseInt(fs.readFileSync(portFile, 'utf-8').trim(), 10);
            if (lastPort > 0 && lastPort < 65536) {
                console.log(`[Config] 使用上次 port: ${lastPort}`);
                return lastPort;
            }
        } catch (e) {
            // 檔案不存在或讀取失敗，用 auto
        }
        console.log(`[Config] 使用 auto port`);
        return 'auto';
    })(),
    
    // 訊息分段設定
    message: {
        // 單則訊息最大字元數（超過會自動分段）
        maxLength: parseInt(process.env.MESSAGE_MAX_LENGTH) || 1500,
        // 分段之間的延遲（毫秒），避免訊息順序錯亂
        splitDelay: parseInt(process.env.MESSAGE_SPLIT_DELAY) || 500
    },

    // 碎片訊息處理設定
    fragment: {
        // 完整性評分門檻（> threshold 視為完整訊息，<= threshold 視為碎片）
        scoreThreshold: parseFloat(process.env.FRAGMENT_SCORE_THRESHOLD) || 0.6,
        // 收集碎片的靜默超時（毫秒）：最後一則碎片後等多久沒新訊息就 dispatch
        collectTimeout: parseInt(process.env.FRAGMENT_COLLECT_TIMEOUT) || 3000,
        // 碎片收集上限（則數）：累積超過就 dispatch
        maxMessages: parseInt(process.env.FRAGMENT_MAX_MESSAGES) || 3,
        // 碎片收集總超時（毫秒）：從第一則碎片開始計算的最長等待時間
        maxWait: parseInt(process.env.FRAGMENT_MAX_WAIT) || 7000
    },
    
    // 錯誤通知：AI 沒回應時自動通知使用者
    errorNotification: process.env.ERROR_NOTIFICATION !== 'false',
    
    // Heartbeat 設定檔路徑
    // 預設：專案根目錄的 HEARTBEAT.md
    // Kiro 使用者可設為 .kiro/steering/HEARTBEAT.md
    // 支援相對路徑（從 cwd 解析）和絕對路徑
    heartbeatPath: process.env.HEARTBEAT_PATH 
        ? path.resolve(process.env.HEARTBEAT_PATH)
        : path.join(__dirname, '../../HEARTBEAT.md'),

    // ============================================================
    // IDE 專屬設定（透過環境變數配置）
    // ============================================================
    
    // IDE REST API port（用於訊息轉發）
    // Kiro/VS Code: vscode-rest-control extension (預設 55139)
    // Cursor: 待定
    // Windsurf: 待定
    ideRestPort: parseInt(process.env.IDE_REST_PORT || process.env.KIRO_REST_PORT, 10) || 55139,
    
    // 天氣查詢預設地點（DirectRouter WeatherHandler 使用）
    defaultLocation: process.env.DEFAULT_LOCATION || '',

    // 使用者的 WhatsApp chatId（TaskExecutor 發送提醒用）
    // 空字串 = 尚未設定（onboarding 時會填入）
    ownerChatId: process.env.OWNER_CHAT_ID || '',

    // Memory backup repo URL (for soul/memory sync to GitHub)
    // null = not configured (backup will graceful skip)
    memoryRepo: process.env.MEMORY_REPO || null,

    // STT 設定（語音轉文字）
    // 可選: gemini, openai, elevenlabs，空值=停用
    sttProvider: process.env.STT_PROVIDER || '',

    // IDE 類型（用於選擇對應的 handler）
    // 支援: 'kiro', 'cursor', 'windsurf', 'generic'
    ideType: process.env.IDE_TYPE || 'kiro',
    
    // Steering 檔案路徑（AI 人格設定）
    // Kiro: .kiro/steering/
    // 其他: 可自訂
    // 支援相對路徑（從 cwd 解析）和絕對路徑
    steeringPath: process.env.STEERING_PATH
        ? path.resolve(process.env.STEERING_PATH)
        : path.join(__dirname, '../../.kiro/steering'),

    // Task Dispatch 設定
    taskOutputDir: process.env.TASK_OUTPUT_DIR
        ? path.resolve(process.env.TASK_OUTPUT_DIR)
        : path.join(__dirname, '../../temp/tasks'),
    
    // Worker 模式（main = 主 Kiro, worker = Worker Kiro）
    workerMode: process.env.WORKER_MODE || 'main',
};
