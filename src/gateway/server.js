/**
 * Message Gateway Server
 * 統一的訊息閘道，支援 WhatsApp 和 Telegram
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const EventEmitter = require('events');

class MessageGateway extends EventEmitter {
    constructor(port = 3000) {
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

    // 發送回覆
    async sendReply(platform, chatId, message, replyToMessageId = null) {
        const client = this.clients[platform];
        if (!client) {
            throw new Error(`${platform} client not connected`);
        }

        // 自動加上叫小賀的標識（粗體 + emoji）
        const prefixedMessage = `*[叫小賀]* 🤪 ${message}`;
        
        return client.sendMessage(chatId, prefixedMessage, replyToMessageId);
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

    start() {
        this.server.listen(this.port, () => {
            console.log(`[Gateway] Server running on http://localhost:${this.port}`);
            console.log(`[Gateway] WebSocket on ws://localhost:${this.port}`);
            console.log(`[Gateway] REST API:`);
            console.log(`  GET  /api/messages      - 取得所有待處理訊息`);
            console.log(`  GET  /api/messages/next - 取得下一則訊息`);
            console.log(`  POST /api/reply         - 發送回覆`);
            console.log(`  GET  /api/health        - 健康檢查`);
        });
    }
}

module.exports = MessageGateway;
