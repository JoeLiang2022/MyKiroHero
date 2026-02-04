/**
 * WhatsApp Adapter for Gateway
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

class WhatsAppAdapter {
    constructor(gateway) {
        this.gateway = gateway;
        this.client = new Client({
            authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });
        
        this.setupEvents();
    }

    setupEvents() {
        this.client.on('qr', (qr) => {
            console.log('\n[WhatsApp] 請掃描 QR Code 登入:');
            qrcode.generate(qr, { small: true });
        });

        this.client.on('ready', () => {
            console.log('[WhatsApp] 已連線，開始監聽訊息');
            this.gateway.registerClient('whatsapp', this);
        });

        // message_create 會捕捉所有訊息，包括自己發的
        this.client.on('message_create', async (msg) => {
            // 直接使用 msg.from 作為預設值，不調用可能出錯的 API
            let contactName = msg.from;
            let chatName = msg.from;
            
            // 嘗試從 msg._data 取得更多資訊（不需要額外 API 調用）
            try {
                if (msg._data && msg._data.notifyName) {
                    contactName = msg._data.notifyName;
                }
            } catch (e) {
                // 忽略
            }
            
            try {
                this.gateway.receiveMessage('whatsapp', {
                    chatId: msg.from,
                    chatName: chatName,
                    isGroup: false,
                    sender: contactName,
                    senderId: msg.author || msg.from,
                    text: msg.body,
                    hasMedia: msg.hasMedia,
                    messageId: msg.id._serialized,
                    fromMe: msg.fromMe,
                    raw: msg
                });
            } catch (err) {
                console.error('[WhatsApp] 處理訊息錯誤:', err.message);
            }
        });

        this.client.on('disconnected', (reason) => {
            console.log('[WhatsApp] 已斷線:', reason);
        });
    }

    async sendMessage(chatId, message, replyToMessageId = null) {
        const options = {};
        if (replyToMessageId) {
            options.quotedMessageId = replyToMessageId;
        }
        return this.client.sendMessage(chatId, message, options);
    }

    /**
     * 發送媒體檔案
     * @param {string} chatId - 聊天 ID
     * @param {string} filePath - 檔案路徑（本地路徑或 URL）
     * @param {string} caption - 檔案說明文字（可選）
     * @param {string} replyToMessageId - 回覆的訊息 ID（可選）
     */
    async sendMedia(chatId, filePath, caption = '', replyToMessageId = null) {
        let media;
        
        // 判斷是 URL 還是本地檔案
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
            // 從 URL 載入
            console.log(`[WhatsApp] 從 URL 載入媒體: ${filePath}`);
            media = await MessageMedia.fromUrl(filePath, { unsafeMime: true });
        } else {
            // 從本地檔案載入
            const absolutePath = path.resolve(filePath);
            if (!fs.existsSync(absolutePath)) {
                throw new Error(`檔案不存在: ${absolutePath}`);
            }
            console.log(`[WhatsApp] 從本地載入媒體: ${absolutePath}`);
            media = MessageMedia.fromFilePath(absolutePath);
        }
        
        const options = { caption };
        if (replyToMessageId) {
            options.quotedMessageId = replyToMessageId;
        }
        
        return this.client.sendMessage(chatId, media, options);
    }

    async initialize() {
        console.log('[WhatsApp] 正在初始化...');
        await this.client.initialize();
    }
}

module.exports = WhatsAppAdapter;
