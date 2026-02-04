/**
 * @deprecated 此檔案已被 kiro-handler.js 取代
 * 保留此檔案僅為向後相容，新程式碼請使用 handlers/index.js
 * 
 * Kiro REST API Handler (Legacy)
 * 收到 WhatsApp 訊息後，用 vscode-rest-control extension 送到 Kiro chat
 * 
 * 需要安裝 vscode-rest-control extension:
 * https://github.com/dpar39/vscode-rest-control
 */

const http = require('http');
const config = require('../config');

// REST Control extension port
const KIRO_REST_PORT = config.ideRestPort || config.kiroRestPort || 55139;

function sendToKiroChat(message) {
    return new Promise((resolve, reject) => {
        const args = encodeURIComponent(JSON.stringify([message]));
        const url = `/?command=kiroAgent.sendMainUserInput&args=${args}`;
        
        const options = {
            hostname: '127.0.0.1',
            port: KIRO_REST_PORT,
            path: url,
            method: 'GET',
            timeout: 10000
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

module.exports = async function kiroRestHandler(message, gateway) {
    // 處理 system heartbeat 訊息
    if (message.platform === 'system' && message.type === 'heartbeat') {
        console.log(`[KiroREST] 🫀 收到 heartbeat: ${message.task || 'unknown'}`);
        
        // 直接傳任務名稱，不需要讀整份 HEARTBEAT.md
        const prompt = `[Heartbeat] 執行任務：${message.task}\n\n請根據 HEARTBEAT.md 中「${message.task}」的說明執行此任務。完成後簡短回報結果。`;
        
        try {
            await sendToKiroChat(prompt);
            console.log(`[KiroREST] ✓ Heartbeat 已送到 Kiro chat`);
        } catch (error) {
            console.error(`[KiroREST] ✗ Heartbeat 發送失敗: ${error.message}`);
        }
        return;
    }
    
    // 跳過空訊息
    if (!message.text || message.text.trim() === '') return;
    
    // 只處理主人自己發的訊息（fromMe = 登入 WhatsApp 的帳號）
    // 別人傳來的訊息不處理
    if (!message.fromMe) {
        return;
    }
    
    // 跳過 AI 的回覆（避免迴圈）
    if (message.text.startsWith(config.aiPrefix.split(' ')[0])) {
        return;
    }

    console.log(`[KiroREST] 準備送到 Kiro: ${message.text}`);

    // 組合訊息 - 格式讓 Kiro 知道這是 WhatsApp 來的
    const prompt = `[WhatsApp] ${message.sender}: ${message.text} (chatId: ${message.chatId})`;

    try {
        await sendToKiroChat(prompt);
        console.log(`[KiroREST] ✓ 已送到 Kiro chat (port ${KIRO_REST_PORT})`);
    } catch (error) {
        console.error(`[KiroREST] ✗ 發送失敗: ${error.message}`);
        console.error(`[KiroREST] 請確認 Kiro 已開啟且 vscode-rest-control extension 正在運行`);
        
        // 錯誤通知：告訴使用者訊息沒送到
        if (config.errorNotification !== false) {
            try {
                await gateway.sendReply(
                    message.platform,
                    message.chatId,
                    `⚠️ 訊息轉發失敗：${error.message}\n請確認 Kiro 有開啟。`
                );
            } catch (notifyError) {
                console.error(`[KiroREST] 無法發送錯誤通知: ${notifyError.message}`);
            }
        }
    }
};
