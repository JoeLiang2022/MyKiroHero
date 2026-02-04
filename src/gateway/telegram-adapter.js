/**
 * Telegram Bot Adapter for Gateway
 */

require('dotenv').config();
const { Telegraf } = require('telegraf');

class TelegramAdapter {
    constructor(gateway) {
        this.gateway = gateway;
        
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            console.warn('[Telegram] 未設定 TELEGRAM_BOT_TOKEN，跳過 Telegram');
            return;
        }

        this.bot = new Telegraf(token);
        this.setupEvents();
    }

    setupEvents() {
        if (!this.bot) return;

        this.bot.on('message', (ctx) => {
            const msg = ctx.message;
            const user = ctx.from;
            const chat = ctx.chat;

            this.gateway.receiveMessage('telegram', {
                chatId: chat.id,
                chatName: chat.title || `${user.first_name} ${user.last_name || ''}`.trim(),
                isGroup: chat.type === 'group' || chat.type === 'supergroup',
                sender: `${user.first_name} ${user.last_name || ''}`.trim(),
                senderId: user.id,
                username: user.username,
                text: msg.text || '[非文字訊息]',
                hasMedia: !!(msg.photo || msg.document || msg.video || msg.voice),
                messageId: msg.message_id,
                raw: msg
            });
        });

        this.bot.catch((err) => {
            console.error('[Telegram] Error:', err.message);
        });
    }

    async sendMessage(chatId, message, replyToMessageId = null) {
        if (!this.bot) throw new Error('Telegram bot not initialized');
        
        const options = {};
        if (replyToMessageId) {
            options.reply_to_message_id = replyToMessageId;
        }
        return this.bot.telegram.sendMessage(chatId, message, options);
    }

    async initialize() {
        if (!this.bot) return;
        
        console.log('[Telegram] 正在啟動 Bot...');
        await this.bot.launch();
        console.log('[Telegram] Bot 已啟動');
        this.gateway.registerClient('telegram', this);
    }

    stop() {
        if (this.bot) {
            this.bot.stop();
        }
    }
}

module.exports = TelegramAdapter;
