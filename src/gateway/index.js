/**
 * Gateway 主程式
 * 啟動 Gateway Server + WhatsApp + Telegram
 */

require('dotenv').config();
const MessageGateway = require('./server');
const WhatsAppAdapter = require('./whatsapp-adapter');
const TelegramAdapter = require('./telegram-adapter');
const kiroRestHandler = require('./handlers/kiro-cli-handler');

// 全局錯誤處理 - 防止程式崩潰
process.on('uncaughtException', (err) => {
    console.error('[系統] 未捕獲的異常:', err.message);
    // 不退出，繼續運行
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[系統] 未處理的 Promise rejection:', reason);
    // 不退出，繼續運行
});

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

console.log(colors.cyan + `
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     Message Gateway Server                                ║
║     訊息閘道伺服器                                         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
` + colors.reset);

async function main() {
    // 建立 Gateway
    const gateway = new MessageGateway(3000);

    // 監聽所有訊息（在終端顯示）
    gateway.on('message', (msg) => {
        const time = new Date().toLocaleTimeString();
        console.log(`\n${colors.gray}[${time}]${colors.reset} ${colors.cyan}[新訊息]${colors.reset}`);
        console.log(`  平台: ${msg.platform}`);
        console.log(`  來自: ${msg.sender}`);
        console.log(`  聊天: ${msg.chatName}`);
        console.log(`  內容: ${msg.text}`);
        console.log('-'.repeat(40));
    });

    // 註冊 Kiro REST API 處理器
    gateway.registerHandler('kiro-rest', kiroRestHandler);

    // 啟動 Gateway Server
    gateway.start();

    // 啟動 WhatsApp
    const whatsapp = new WhatsAppAdapter(gateway);
    await whatsapp.initialize();

    // 啟動 Telegram (如果有設定 token)
    const telegram = new TelegramAdapter(gateway);
    await telegram.initialize();

    // 優雅關閉
    process.on('SIGINT', () => {
        console.log('\n[系統] 正在關閉...');
        telegram.stop();
        process.exit(0);
    });
}

main().catch(console.error);
