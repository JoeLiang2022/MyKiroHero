/**
 * HealthChecker - 健康檢查 + 通知
 * 
 * 監控 Memory Engine 狀態，連續失敗時透過 Gateway 發 WhatsApp 通知。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const PROJECT_ROOT = path.join(__dirname, '../..');
const GATEWAY_PORT_FILE = path.join(PROJECT_ROOT, '.gateway-port');

/**
 * 讀取 Gateway port
 */
function getGatewayPort() {
    try {
        if (fs.existsSync(GATEWAY_PORT_FILE)) {
            return parseInt(fs.readFileSync(GATEWAY_PORT_FILE, 'utf8').trim());
        }
    } catch (e) { /* ignore */ }
    return null;
}

/**
 * 透過 Gateway 發送 WhatsApp 通知
 * @param {string} message
 * @param {string} chatId
 */
function notifyViaWhatsApp(message, chatId) {
    const port = getGatewayPort();
    if (!port) {
        console.error('[HealthChecker] 無法取得 Gateway port，跳過通知');
        return;
    }

    const data = JSON.stringify({ chatId, message });
    const options = {
        hostname: '127.0.0.1',
        port,
        path: '/api/reply',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        },
        timeout: 5000
    };

    const req = http.request(options, (res) => {
        // Consume response body to free up resources
        res.resume();
        if (res.statusCode === 200) {
            console.log('[HealthChecker] WhatsApp 通知已發送');
        } else {
            console.error(`[HealthChecker] 通知失敗: HTTP ${res.statusCode}`);
        }
    });

    req.on('error', (err) => {
        console.error(`[HealthChecker] 通知失敗: ${err.message}`);
    });

    req.on('timeout', () => {
        req.destroy();
        console.error('[HealthChecker] 通知超時');
    });

    req.write(data);
    req.end();
}

/**
 * 檢查 SQLite 資料庫健康狀態
 * @param {object} db - better-sqlite3 連線
 * @returns {object} { healthy, details }
 */
function checkDatabaseHealth(db) {
    if (!db) {
        return { healthy: false, details: 'Database not initialized' };
    }

    try {
        // 簡單查詢測試
        db.prepare('SELECT 1').get();

        // 檢查 integrity（輕量版，只檢查第一個錯誤）
        const integrity = db.pragma('quick_check(1)');
        const isOk = integrity && integrity[0] && integrity[0].quick_check === 'ok';

        if (!isOk) {
            return { healthy: false, details: 'Database integrity check failed' };
        }

        return { healthy: true, details: 'ok' };
    } catch (err) {
        return { healthy: false, details: err.message };
    }
}

module.exports = {
    getGatewayPort,
    notifyViaWhatsApp,
    checkDatabaseHealth
};
