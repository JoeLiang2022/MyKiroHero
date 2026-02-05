/**
 * Kiro Handler - Kiro IDE 專屬
 * 透過 vscode-rest-control extension 將訊息送到 Kiro chat
 * 
 * 需要安裝 vscode-rest-control extension:
 * https://github.com/dpar39/vscode-rest-control
 * 
 * 這是 IDE 專屬層，實作 BaseHandler 介面
 */

const http = require('http');
const BaseHandler = require('./base-handler');

class KiroHandler extends BaseHandler {
    constructor(config) {
        super(config);
        this.port = config.ideRestPort || 55139;
        this.command = 'kiroAgent.sendMainUserInput';
    }

    getName() {
        return 'kiro';
    }

    async isAvailable() {
        return new Promise((resolve) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: this.port,
                path: '/',
                method: 'GET',
                timeout: 2000
            }, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.end();
        });
    }

    async sendToChat(message) {
        return new Promise((resolve, reject) => {
            const args = encodeURIComponent(JSON.stringify([message]));
            const url = `/?command=${this.command}&args=${args}`;
            
            const options = {
                hostname: '127.0.0.1',
                port: this.port,
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

    async handle(message, gateway) {
        // 處理 system heartbeat 訊息
        if (message.platform === 'system' && message.type === 'heartbeat') {
            console.log(`[Kiro] 🫀 收到 heartbeat: ${message.task || 'unknown'}`);
            
            const prompt = `[Heartbeat] 執行任務：${message.task}\n\n請根據 HEARTBEAT.md 中「${message.task}」的說明執行此任務。完成後簡短回報結果。`;
            
            try {
                await this.sendToChat(prompt);
                console.log(`[Kiro] ✓ Heartbeat 已送到 Kiro chat`);
            } catch (error) {
                console.error(`[Kiro] ✗ Heartbeat 發送失敗: ${error.message}`);
            }
            return;
        }
        
        // 跳過空訊息
        if (!message.text || message.text.trim() === '') return;
        
        // 只處理主人自己發的訊息
        if (!message.fromMe) return;
        
        // 跳過 AI 的回覆（避免迴圈）
        const prefixStart = this.config.aiPrefix.split(' ')[0];
        if (message.text.startsWith(prefixStart)) return;

        console.log(`[Kiro] 準備送到 Kiro: ${message.text}`);

        // 組合訊息
        let prompt = `[WhatsApp] ${message.sender}: ${message.text} (chatId: ${message.chatId})`;
        
        // 如果有媒體檔案，加入路徑資訊
        if (message.mediaPath) {
            prompt += `\n\n📎 附件: ${message.mediaPath} (${message.mediaMimeType || 'unknown'})`;
        }

        try {
            await this.sendToChat(prompt);
            console.log(`[Kiro] ✓ 已送到 Kiro chat (port ${this.port})`);
        } catch (error) {
            console.error(`[Kiro] ✗ 發送失敗: ${error.message}`);
            console.error(`[Kiro] 請確認 Kiro 已開啟且 vscode-rest-control extension 正在運行`);
            
            // 錯誤通知
            if (this.config.errorNotification !== false) {
                try {
                    await gateway.sendReply(
                        message.platform,
                        message.chatId,
                        `⚠️ 訊息轉發失敗：${error.message}\n請確認 Kiro 有開啟。`
                    );
                } catch (notifyError) {
                    console.error(`[Kiro] 無法發送錯誤通知: ${notifyError.message}`);
                }
            }
        }
    }
}

module.exports = KiroHandler;
