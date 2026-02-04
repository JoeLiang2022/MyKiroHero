/**
 * Message Gateway Server
 * 統一的訊息閘道，支援 WhatsApp 和 Telegram
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const EventEmitter = require('events');
const fs = require('fs');
const config = require('./config');

class MessageGateway extends EventEmitter {
    constructor(port = config.serverPort) {
        super();
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.messageQueue = [];
        this.handlers = new Map();
        this.clients = { whatsapp: null, telegram: null };
        
        this.setupExpress();
        this.setupWebSocket();
    }

    setupExpress() {
        this.app.use(express.json());

        // 取得所有待處理訊息
        this.app.get('/api/messages', (req, res) => {
            res.json({
                pending: this.messageQueue.length,
                messages: this.messageQueue
            });
        });

        // 取得下一則待處理訊息
        this.app.get('/api/messages/next', (req, res) => {
            const msg = this.messageQueue.shift();
            res.json(msg || { empty: true });
        });

        // 發送回覆
        this.app.post('/api/reply', async (req, res) => {
            let { platform, chatId, message, replyToMessageId } = req.body;
            
            // 自動判斷 platform：WhatsApp chatId 是 xxx@c.us 或 xxx@g.us
            if (!platform) {
                if (chatId && (chatId.endsWith('@c.us') || chatId.endsWith('@g.us'))) {
                    platform = 'whatsapp';
                }
            }
            
            try {
                await this.sendReply(platform, chatId, message, replyToMessageId);
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 發送媒體檔案
        this.app.post('/api/reply/media', async (req, res) => {
            let { platform, chatId, filePath, caption, replyToMessageId } = req.body;
            
            // 自動判斷 platform
            if (!platform) {
                if (chatId && (chatId.endsWith('@c.us') || chatId.endsWith('@g.us'))) {
                    platform = 'whatsapp';
                }
            }
            
            try {
                await this.sendMedia(platform, chatId, filePath, caption, replyToMessageId);
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 健康檢查
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'ok',
                whatsapp: this.clients.whatsapp ? 'connected' : 'disconnected',
                telegram: this.clients.telegram ? 'connected' : 'disconnected',
                pendingMessages: this.messageQueue.length
            });
        });

        // Webhook endpoint (for Telegram webhook mode)
        this.app.post('/webhook/telegram', (req, res) => {
            this.emit('telegram:webhook', req.body);
            res.sendStatus(200);
        });
    }

    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('[Gateway] WebSocket client connected');
            
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    this.handleWebSocketMessage(ws, msg);
                } catch (e) {
                    console.error('[Gateway] Invalid WebSocket message');
                }
            });

            ws.on('close', () => {
                console.log('[Gateway] WebSocket client disconnected');
            });
        });
    }

    handleWebSocketMessage(ws, msg) {
        switch (msg.type) {
            case 'subscribe':
                ws.subscribed = true;
                break;
            case 'reply':
                this.sendReply(msg.platform, msg.chatId, msg.message);
                break;
        }
    }

    // 廣播訊息給所有 WebSocket clients
    broadcast(data) {
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.subscribed) {
                client.send(JSON.stringify(data));
            }
        });
    }

    // 接收新訊息（由 WhatsApp/Telegram client 呼叫）
    receiveMessage(platform, message) {
        const enrichedMessage = {
            id: Date.now().toString(),
            platform,
            timestamp: new Date().toISOString(),
            ...message
        };

        this.messageQueue.push(enrichedMessage);
        this.emit('message', enrichedMessage);
        this.broadcast({ type: 'new_message', data: enrichedMessage });
        
        // 執行註冊的 handlers
        this.runHandlers(enrichedMessage);
        
        return enrichedMessage;
    }

    // 智慧分段：在段落、句號、換行處切割
    splitMessage(text, maxLength) {
        if (text.length <= maxLength) {
            return [text];
        }

        const parts = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                parts.push(remaining);
                break;
            }

            // 找最佳切割點（優先順序：段落 > 換行 > 句號 > 空格）
            let splitIndex = maxLength;
            const searchArea = remaining.substring(0, maxLength);
            
            // 找最後一個段落分隔（兩個換行）
            const paragraphIndex = searchArea.lastIndexOf('\n\n');
            if (paragraphIndex > maxLength * 0.5) {
                splitIndex = paragraphIndex + 2;
            } else {
                // 找最後一個換行
                const newlineIndex = searchArea.lastIndexOf('\n');
                if (newlineIndex > maxLength * 0.5) {
                    splitIndex = newlineIndex + 1;
                } else {
                    // 找最後一個句號（中文或英文）
                    const periodIndex = Math.max(
                        searchArea.lastIndexOf('。'),
                        searchArea.lastIndexOf('. ')
                    );
                    if (periodIndex > maxLength * 0.3) {
                        splitIndex = periodIndex + 1;
                    } else {
                        // 找最後一個空格
                        const spaceIndex = searchArea.lastIndexOf(' ');
                        if (spaceIndex > maxLength * 0.3) {
                            splitIndex = spaceIndex + 1;
                        }
                    }
                }
            }

            parts.push(remaining.substring(0, splitIndex).trim());
            remaining = remaining.substring(splitIndex).trim();
        }

        return parts;
    }

    // 發送回覆（支援自動分段）
    async sendReply(platform, chatId, message, replyToMessageId = null) {
        const client = this.clients[platform];
        if (!client) {
            throw new Error(`${platform} client not connected`);
        }

        // 自動加上 AI 標識前綴
        const prefixedMessage = `${config.aiPrefix} ${message}`;
        
        // 檢查是否需要分段
        const maxLength = config.message?.maxLength || 1500;
        const parts = this.splitMessage(prefixedMessage, maxLength);
        
        if (parts.length === 1) {
            return client.sendMessage(chatId, parts[0], replyToMessageId);
        }

        // 分段發送（所有段落都加標記）
        const delay = config.message?.splitDelay || 500;
        for (let i = 0; i < parts.length; i++) {
            const part = `(${i + 1}/${parts.length}) ${parts[i]}`;
            await client.sendMessage(chatId, part, i === 0 ? replyToMessageId : null);
            
            if (i < parts.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        return { sent: parts.length, parts };
    }

    // 發送媒體檔案
    async sendMedia(platform, chatId, filePath, caption = '', replyToMessageId = null) {
        const client = this.clients[platform];
        if (!client) {
            throw new Error(`${platform} client not connected`);
        }
        
        if (!client.sendMedia) {
            throw new Error(`${platform} client does not support media`);
        }
        
        // caption 加上 AI 前綴（如果有 caption 的話）
        const prefixedCaption = caption ? `${config.aiPrefix} ${caption}` : '';
        
        return client.sendMedia(chatId, filePath, prefixedCaption, replyToMessageId);
    }

    // 註冊訊息處理器
    registerHandler(name, handler) {
        this.handlers.set(name, handler);
    }

    // 執行所有處理器
    async runHandlers(message) {
        console.log(`[Gateway] 執行 ${this.handlers.size} 個 handlers...`);
        for (const [name, handler] of this.handlers) {
            try {
                console.log(`[Gateway] 執行 handler: ${name}`);
                await handler(message, this);
            } catch (err) {
                console.error(`[Handler:${name}] Error:`, err.message);
            }
        }
    }

    // 註冊平台 client
    registerClient(platform, client) {
        this.clients[platform] = client;
        console.log(`[Gateway] ${platform} client registered`);
    }

    // 從 HEARTBEAT.md 讀取排程設定
    readHeartbeatSchedules() {
        const heartbeatPath = config.heartbeatPath;
        
        if (!heartbeatPath) {
            console.log(`[Heartbeat] 未設定 HEARTBEAT_PATH`);
            return [];
        }
        
        try {
            if (!fs.existsSync(heartbeatPath)) {
                console.log(`[Heartbeat] HEARTBEAT.md 不存在: ${heartbeatPath}`);
                return [];
            }
            
            const content = fs.readFileSync(heartbeatPath, 'utf-8');
            
            // 找 ```...``` 區塊內的時間和任務
            const match = content.match(/## 排程 \(schedules\)\s*```([\s\S]*?)```/);
            if (!match) {
                console.log(`[Heartbeat] 找不到排程區塊`);
                return [];
            }
            
            const schedules = match[1]
                .split('\n')
                .map(line => line.trim())
                .filter(line => /^\d{2}:\d{2}/.test(line))
                .map(line => {
                    const timeMatch = line.match(/^(\d{2}):(\d{2})\s*(.*)?$/);
                    if (!timeMatch) return null;
                    const [, hourStr, minuteStr, task] = timeMatch;
                    return {
                        hour: parseInt(hourStr, 10),
                        minute: parseInt(minuteStr, 10),
                        time: `${hourStr}:${minuteStr}`,
                        task: task?.trim() || '執行 HEARTBEAT.md 任務'
                    };
                })
                .filter(Boolean);
            
            return schedules;
        } catch (err) {
            console.error(`[Heartbeat] 讀取排程失敗:`, err.message);
            return [];
        }
    }

    // 設定動態 heartbeat 排程
    setupDynamicHeartbeat() {
        this.heartbeatTimers = this.heartbeatTimers || [];
        
        // 清除舊的 timers 和活躍排程記錄
        this.heartbeatTimers.forEach(timer => clearTimeout(timer));
        this.heartbeatTimers = [];
        this.activeSchedules = new Set();
        
        const schedules = this.readHeartbeatSchedules();
        
        if (schedules.length === 0) {
            console.log(`[Heartbeat] 沒有設定排程`);
            return;
        }
        
        console.log(`[Heartbeat] 載入 ${schedules.length} 個排程: ${schedules.map(s => `${s.time} → ${s.task}`).join(', ')}`);
        
        schedules.forEach(schedule => {
            this.scheduleHeartbeat(schedule.hour, schedule.minute, schedule.task);
        });
    }

    // 排程單一 heartbeat
    scheduleHeartbeat(hour, minute, task) {
        const key = `${hour}:${minute}`;
        
        const scheduleNext = () => {
            const now = new Date();
            const next = new Date();
            next.setHours(hour, minute, 0, 0);
            
            if (next <= now) {
                next.setDate(next.getDate() + 1);
            }
            
            const delay = next - now;
            console.log(`[Heartbeat] 下次 ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (${task}) → ${next.toLocaleString('zh-TW')}`);
            
            const timer = setTimeout(() => {
                this.triggerHeartbeat(task);
                // 只有當這個排程還存在時才繼續
                if (this.activeSchedules && this.activeSchedules.has(key)) {
                    scheduleNext();
                }
            }, delay);
            
            this.heartbeatTimers.push(timer);
        };
        
        // 記錄活躍的排程
        this.activeSchedules = this.activeSchedules || new Set();
        this.activeSchedules.add(key);
        
        scheduleNext();
    }

    // 定期重新載入排程（每小時檢查一次）
    startScheduleWatcher() {
        // 清除舊的 watcher（如果有）
        if (this.scheduleWatcherInterval) {
            clearInterval(this.scheduleWatcherInterval);
        }
        
        this.scheduleWatcherInterval = setInterval(() => {
            console.log(`[Heartbeat] 重新載入排程...`);
            this.setupDynamicHeartbeat();
        }, 60 * 60 * 1000); // 每小時
    }

    // 停止所有排程（用於優雅關閉）
    stopSchedules() {
        // 清除 heartbeat timers
        if (this.heartbeatTimers) {
            this.heartbeatTimers.forEach(timer => clearTimeout(timer));
            this.heartbeatTimers = [];
        }
        
        // 清除 schedule watcher
        if (this.scheduleWatcherInterval) {
            clearInterval(this.scheduleWatcherInterval);
            this.scheduleWatcherInterval = null;
        }
        
        console.log('[Heartbeat] 所有排程已停止');
    }

    // 觸發 heartbeat（發送訊息給 Kiro）
    async triggerHeartbeat(task = '執行 HEARTBEAT.md 任務') {
        console.log(`[Gateway] 🫀 Heartbeat triggered: ${task} at ${new Date().toLocaleString('zh-TW')}`);
        
        const heartbeatMessage = {
            platform: 'system',
            type: 'heartbeat',
            from: 'Gateway',
            body: `[Heartbeat] 執行任務：${task}`,
            task: task,
            chatId: 'system',
            timestamp: new Date().toISOString()
        };
        
        // 透過 kiro-cli-handler 發送到 Kiro
        this.receiveMessage('system', heartbeatMessage);
    }

    start() {
        this.server.listen(this.port, () => {
            console.log(`[Gateway] Server running on http://localhost:${this.port}`);
            console.log(`[Gateway] WebSocket on ws://localhost:${this.port}`);
            console.log(`[Gateway] REST API:`);
            console.log(`  GET  /api/messages      - 取得所有待處理訊息`);
            console.log(`  GET  /api/messages/next - 取得下一則訊息`);
            console.log(`  POST /api/reply         - 發送文字回覆`);
            console.log(`  POST /api/reply/media   - 發送媒體檔案`);
            console.log(`  GET  /api/health        - 健康檢查`);
            
            // 啟動動態 heartbeat 排程
            this.setupDynamicHeartbeat();
            this.startScheduleWatcher();
        });
    }
}

module.exports = MessageGateway;
