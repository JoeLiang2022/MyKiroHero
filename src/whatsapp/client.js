/**
 * WhatsApp Terminal Client
 * 使用 whatsapp-web.js 在終端接收 WhatsApp 訊息
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// 顏色輸出
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

function log(color, prefix, message) {
    const time = new Date().toLocaleTimeString();
    console.log(`${colors.gray}[${time}]${colors.reset} ${color}${prefix}${colors.reset} ${message}`);
}

// 建立 WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '.wwebjs_auth'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// QR Code 事件 - 掃描登入
client.on('qr', (qr) => {
    console.log('\n' + '='.repeat(50));
    console.log(colors.yellow + '請用 WhatsApp 掃描以下 QR Code 登入:' + colors.reset);
    console.log('='.repeat(50) + '\n');
    qrcode.generate(qr, { small: true });
});

// 認證成功
client.on('authenticated', () => {
    log(colors.green, '[認證]', '登入成功！');
});

// 準備就緒
client.on('ready', () => {
    console.log('\n' + '='.repeat(50));
    log(colors.green, '[系統]', 'WhatsApp Client 已就緒，開始監聽訊息...');
    console.log('='.repeat(50) + '\n');
});

// 接收訊息
client.on('message', async (msg) => {
    const contact = await msg.getContact();
    const chat = await msg.getChat();
    
    const sender = contact.pushname || contact.number || msg.from;
    const chatName = chat.name || (chat.isGroup ? '群組' : '私訊');
    const isGroup = chat.isGroup;
    
    console.log('\n' + '-'.repeat(40));
    log(colors.cyan, '[新訊息]', '');
    console.log(`  ${colors.blue}來自:${colors.reset} ${sender}`);
    console.log(`  ${colors.blue}聊天:${colors.reset} ${chatName} ${isGroup ? '(群組)' : '(私訊)'}`);
    console.log(`  ${colors.blue}內容:${colors.reset} ${msg.body}`);
    
    if (msg.hasMedia) {
        console.log(`  ${colors.magenta}[包含媒體檔案]${colors.reset}`);
    }
    console.log('-'.repeat(40));
});

// 訊息已讀回執
client.on('message_ack', (msg, ack) => {
    const ackStatus = {
        '-1': '錯誤',
        '0': '等待中',
        '1': '已發送',
        '2': '已送達',
        '3': '已讀'
    };
    // 只顯示自己發送的訊息狀態
    if (msg.fromMe) {
        log(colors.gray, '[狀態]', `訊息 ${ackStatus[ack] || ack}`);
    }
});

// 斷線事件
client.on('disconnected', (reason) => {
    log(colors.yellow, '[斷線]', `已斷開連線: ${reason}`);
});

// 錯誤處理
client.on('auth_failure', (msg) => {
    log(colors.red, '[錯誤]', `認證失敗: ${msg}`);
});

console.log(colors.cyan + `
╔═══════════════════════════════════════════════╗
║     WhatsApp Terminal Client                  ║
║     終端 WhatsApp 訊息接收器                   ║
╚═══════════════════════════════════════════════╝
` + colors.reset);

log(colors.yellow, '[系統]', '正在初始化 WhatsApp Client...');

// 啟動 client
client.initialize().catch(err => {
    console.error('初始化失敗:', err);
});

// 優雅關閉
process.on('SIGINT', async () => {
    console.log('\n');
    log(colors.yellow, '[系統]', '正在關閉...');
    await client.destroy();
    process.exit(0);
});
