/**
 * Memory Engine - 獨立的記憶管理程序
 * 
 * 以 PM2 recall-worker 運行，提供 HTTP API 給 MCP Server 呼叫。
 * 負責：索引建構、FTS5 搜尋、時間衰減、去重、健康檢查。
 * 
 * JSONL 仍為 source of truth；SQLite 只是索引層。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { initDatabase, getDatabase, closeDatabase, isDatabaseAvailable, isFallbackMode } = require('./database');
const { indexAllFiles, rebuildAll, indexJsonlFile } = require('./indexer');
const { searchAll } = require('./unified-search');
const { buildAutoRecallContext } = require('./auto-recall');
const { getNowISO } = require('../utils/timezone');

// 路徑設定
const PROJECT_ROOT = path.join(__dirname, '../..');
const SESSIONS_DIR = path.join(PROJECT_ROOT, 'sessions');
const KNOWLEDGE_PATH = path.join(PROJECT_ROOT, 'skills/memory');
const JOURNAL_DIR = path.join(PROJECT_ROOT, 'memory/journals');
const PORT_FILE = path.join(PROJECT_ROOT, '.memory-engine-port');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'memory.db');

// 索引間隔（毫秒）
const WEEKLY_INDEX_INTERVAL = 7 * 24 * 60 * 60 * 1000;  // 7 天 — safety net
const QUEUE_PROCESS_INTERVAL = 30 * 1000;  // 30 秒 — drain queue

// 健康檢查
let lastIndexTime = null;
let indexErrorCount = 0;
const MAX_INDEX_ERRORS = 3;

// Event-driven index queue
const indexQueue = new Set();
let lastQueueProcess = null;
let queueProcessCount = 0;

/**
 * 解析 request body (JSON)
 */
function parseBody(req, maxSize = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > maxSize) {
                req.destroy();
                reject(new Error(`Request body too large (>${Math.round(maxSize / 1024)}KB)`));
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * 回傳 JSON response
 */
function jsonResponse(res, data, statusCode = 200) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}


/**
 * 解析 URL query 參數
 */
function parseQuery(reqUrl) {
    const parsed = new URL(reqUrl, 'http://localhost');
    const query = {};
    for (const [key, value] of parsed.searchParams) {
        query[key] = value;
    }
    return { pathname: parsed.pathname, query };
}

/**
 * 執行定時索引
 */
function runPeriodicIndex() {
    if (!isDatabaseAvailable()) return;

    try {
        const result = indexAllFiles(SESSIONS_DIR);
        lastIndexTime = getNowISO();
        indexErrorCount = 0;
        if (result.totalIndexed > 0) {
            console.log(`[Engine] 定時索引: ${result.totalIndexed} sessions indexed`);
        }
    } catch (err) {
        indexErrorCount++;
        console.error(`[Engine] 索引失敗 (${indexErrorCount}/${MAX_INDEX_ERRORS}): ${err.message}`);

        if (indexErrorCount >= MAX_INDEX_ERRORS) {
            console.error('[Engine] 連續索引失敗，需要通知');
            // TODO: 透過 Gateway 發 WhatsApp 通知
        }
    }
}

/**
 * Process all queued index requests (drain the Set, call indexJsonlFile for each)
 */
function processIndexQueue() {
    if (indexQueue.size === 0) return;
    if (!isDatabaseAvailable()) return;

    const items = [...indexQueue];
    indexQueue.clear();

    let processed = 0;
    let errors = 0;
    for (const filePath of items) {
        try {
            indexJsonlFile(filePath);
            processed++;
        } catch (err) {
            errors++;
            console.error(`[Engine] Queue index failed for ${filePath}: ${err.message}`);
        }
    }

    lastQueueProcess = getNowISO();
    queueProcessCount++;
    if (processed > 0 || errors > 0) {
        console.log(`[Engine] Queue processed: ${processed} ok, ${errors} errors`);
    }
}

/**
 * 處理 HTTP 請求
 */
async function handleRequest(req, res) {
    const { pathname, query } = parseQuery(req.url);
    const method = req.method;

    try {
        // GET /health
        if (method === 'GET' && pathname === '/health') {
            const db = getDatabase();
            let sessionCount = 0;
            let messageCount = 0;
            let lastIndexed = '';

            if (db) {
                try {
                    sessionCount = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
                    messageCount = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;
                    const meta = db.prepare('SELECT value FROM meta WHERE key = ?').get('last_indexed');
                    lastIndexed = meta?.value || '';
                } catch (e) { /* ignore */ }
            }

            return jsonResponse(res, {
                status: 'ok',
                mode: isFallbackMode() ? 'json-fallback' : 'sqlite',
                database: isDatabaseAvailable(),
                sessionCount,
                messageCount,
                lastIndexed,
                lastIndexTime,
                indexErrorCount,
                queueSize: indexQueue.size,
                lastQueueProcess,
                queueProcessCount,
                memoryUsage: process.memoryUsage(),
                uptime: process.uptime()
            });
        }

        // GET /search?q=...&level=L2&days=7&source=all
        if (method === 'GET' && pathname === '/search') {
            const q = query.q;
            if (!q) {
                return jsonResponse(res, { error: 'Missing query parameter: q' }, 400);
            }

            const source = query.source || 'all';
            if (source === 'all' || source === 'session' || source === 'knowledge' || source === 'journal') {
                const results = await searchAll(q, {
                    source,
                    level: query.level || 'L2',
                    days: parseInt(query.days) || 7,
                    maxResults: parseInt(query.max) || 10,
                    decayRate: parseFloat(query.decay) || undefined,
                    sessionsDir: SESSIONS_DIR,
                    knowledgePath: KNOWLEDGE_PATH,
                    journalDir: JOURNAL_DIR
                });
                return jsonResponse(res, { query: q, results, count: results.length });
            }

            return jsonResponse(res, { error: 'Invalid source. Use: all, session, knowledge, journal' }, 400);
        }

        // GET /sessions?date=2026-02-07
        if (method === 'GET' && pathname === '/sessions') {
            if (!isDatabaseAvailable()) {
                return jsonResponse(res, { error: 'Database not available' }, 503);
            }

            const db = getDatabase();
            const date = query.date;
            let rows;
            if (date) {
                rows = db.prepare('SELECT * FROM sessions WHERE date = ? ORDER BY start_time').all(date);
            } else {
                rows = db.prepare('SELECT * FROM sessions ORDER BY date DESC, start_time DESC LIMIT 50').all();
            }

            const sessions = rows.map(r => {
                let keywords = [], files = [], tool_calls = [];
                try { keywords = JSON.parse(r.keywords || '[]'); } catch (e) { /* corrupt */ }
                try { files = JSON.parse(r.files || '[]'); } catch (e) { /* corrupt */ }
                try { tool_calls = JSON.parse(r.tool_calls || '[]'); } catch (e) { /* corrupt */ }
                return { ...r, keywords, files, tool_calls };
            });

            return jsonResponse(res, { sessions, count: sessions.length });
        }

        // POST /summary/auto  (auto-summary triggered by session end)
        if (method === 'POST' && pathname === '/summary/auto') {
            const body = await parseBody(req);
            const sessionId = body.sessionId;

            if (!sessionId) {
                return jsonResponse(res, { error: 'Missing sessionId in body' }, 400);
            }

            if (!isDatabaseAvailable()) {
                return jsonResponse(res, { error: 'Database not available' }, 503);
            }

            const db = getDatabase();

            // Skip if summary already exists
            const existing = db.prepare('SELECT session_id FROM summaries WHERE session_id = ?').get(sessionId);
            if (existing) {
                return jsonResponse(res, { sessionId, skipped: true, reason: 'already_summarized' });
            }

            // Read session messages from JSONL
            const date = `${sessionId.substring(0, 4)}-${sessionId.substring(4, 6)}-${sessionId.substring(6, 8)}`;
            const filePath = path.join(SESSIONS_DIR, `${date}.jsonl`);

            if (!fs.existsSync(filePath)) {
                return jsonResponse(res, { error: 'Session file not found' }, 404);
            }

            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim());
            const messages = [];
            for (const line of lines) {
                try {
                    const r = JSON.parse(line);
                    if (r.sessionId === sessionId && (r.role === 'user' || r.role === 'assistant')) {
                        messages.push({ role: r.role, content: r.text || '' });
                    }
                } catch (e) { /* skip malformed */ }
            }

            if (messages.length < 3) {
                return jsonResponse(res, { sessionId, skipped: true, reason: 'too_few_messages', messageCount: messages.length });
            }

            // Fire-and-forget: run extraction async, respond immediately
            const { extractStructuredSummary } = require('./summary-extractor');
            extractStructuredSummary(messages)
                .then(result => {
                    try {
                        const summaryText = JSON.stringify(result);
                        const now = getNowISO();
                        db.prepare('INSERT OR REPLACE INTO summaries (session_id, summary, created_at) VALUES (?, ?, ?)')
                            .run(sessionId, summaryText, now);
                        console.log(`[Engine] Auto-summary saved for ${sessionId}`);
                    } catch (saveErr) {
                        console.error(`[Engine] Auto-summary save failed for ${sessionId}: ${saveErr.message}`);
                    }
                })
                .catch(err => {
                    console.error(`[Engine] Auto-summary extraction failed for ${sessionId}: ${err.message}`);
                });

            return jsonResponse(res, { sessionId, accepted: true, messageCount: messages.length });
        }

        // GET /summary/:sessionId
        if (method === 'GET' && pathname.startsWith('/summary/')) {
            const sessionId = pathname.split('/')[2];
            if (!sessionId) {
                return jsonResponse(res, { error: 'Missing sessionId' }, 400);
            }

            if (!isDatabaseAvailable()) {
                return jsonResponse(res, { error: 'Database not available' }, 503);
            }

            const db = getDatabase();

            // 檢查是否已有摘要
            const existing = db.prepare('SELECT * FROM summaries WHERE session_id = ?').get(sessionId);
            if (existing) {
                return jsonResponse(res, {
                    sessionId,
                    summary: existing.summary,
                    createdAt: existing.created_at,
                    cached: true
                });
            }

            // 沒有摘要，回傳格式化的對話內容供 AI 產生
            const date = `${sessionId.substring(0, 4)}-${sessionId.substring(4, 6)}-${sessionId.substring(6, 8)}`;
            const filePath = path.join(SESSIONS_DIR, `${date}.jsonl`);

            if (!fs.existsSync(filePath)) {
                return jsonResponse(res, { error: 'Session file not found' }, 404);
            }

            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim());
            const records = [];
            for (const line of lines) {
                try {
                    const r = JSON.parse(line);
                    if (r.sessionId === sessionId) records.push(r);
                } catch (e) { /* skip */ }
            }

            if (records.length === 0) {
                return jsonResponse(res, { error: 'Session not found' }, 404);
            }

            // 格式化對話
            const conversation = records
                .filter(r => r.role === 'user' || r.role === 'assistant')
                .map(r => {
                    const text = (r.text || '').substring(0, 500);
                    return `${r.role === 'user' ? 'User' : 'Assistant'}: ${text}`;
                })
                .join('\n\n');

            return jsonResponse(res, {
                sessionId,
                summary: null,
                conversation,
                messageCount: records.length,
                cached: false
            });
        }

        // POST /summary/:sessionId  (儲存摘要)
        if (method === 'POST' && pathname.startsWith('/summary/')) {
            const sessionId = pathname.split('/')[2];
            const body = await parseBody(req);

            if (!body.summary) {
                return jsonResponse(res, { error: 'Missing summary in body' }, 400);
            }

            if (!isDatabaseAvailable()) {
                return jsonResponse(res, { error: 'Database not available' }, 503);
            }

            const db = getDatabase();
            const now = getNowISO();
            db.prepare('INSERT OR REPLACE INTO summaries (session_id, summary, created_at) VALUES (?, ?, ?)')
                .run(sessionId, body.summary, now);

            return jsonResponse(res, { sessionId, saved: true, createdAt: now });
        }

        // POST /index/queue  (event-driven: add file to index queue)
        if (method === 'POST' && pathname === '/index/queue') {
            const body = await parseBody(req);
            let filePath = body.filePath;

            if (!filePath && body.date) {
                // Resolve date to JSONL file path
                filePath = path.join(SESSIONS_DIR, `${body.date}.jsonl`);
            }

            if (!filePath) {
                return jsonResponse(res, { error: 'Missing filePath or date' }, 400);
            }

            indexQueue.add(filePath);
            return jsonResponse(res, { queued: true, queueSize: indexQueue.size });
        }

        // POST /index/rebuild
        if (method === 'POST' && pathname === '/index/rebuild') {
            if (!isDatabaseAvailable()) {
                return jsonResponse(res, { error: 'Database not available' }, 503);
            }

            const result = rebuildAll(SESSIONS_DIR);
            lastIndexTime = getNowISO();
            return jsonResponse(res, { ...result, rebuiltAt: lastIndexTime });
        }

        // POST /index/file  (索引特定檔案，Gateway 通知用)
        if (method === 'POST' && pathname === '/index/file') {
            const body = await parseBody(req);
            if (!body.filePath) {
                return jsonResponse(res, { error: 'Missing filePath' }, 400);
            }

            if (!isDatabaseAvailable()) {
                return jsonResponse(res, { error: 'Database not available' }, 503);
            }

            const result = indexJsonlFile(body.filePath);
            return jsonResponse(res, result);
        }

        // GET /recall/auto
        if (method === 'GET' && pathname === '/recall/auto') {
            const result = await buildAutoRecallContext();
            return jsonResponse(res, result);
        }

        // 404
        jsonResponse(res, { error: 'Not found' }, 404);

    } catch (err) {
        console.error(`[Engine] 請求處理失敗: ${err.message}`);
        jsonResponse(res, { error: err.message }, 500);
    }
}


/**
 * 取得上次使用的 port（跟 Gateway 一樣的策略）
 */
function getLastUsedPort() {
    try {
        if (fs.existsSync(PORT_FILE)) {
            const port = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim());
            if (port > 0 && port < 65536) return port;
        }
    } catch (e) { /* ignore */ }
    return 0;
}

/**
 * 啟動 Memory Engine
 */
function start() {
    console.log('[Engine] Memory Engine 啟動中...');

    // 確保 data 資料夾存在
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // 初始化 SQLite
    const db = initDatabase(DB_PATH);
    if (db) {
        console.log('[Engine] SQLite 初始化成功');
    } else {
        console.warn('[Engine] SQLite 不可用，使用 JSON fallback 模式');
    }

    // 初始索引
    if (isDatabaseAvailable() && fs.existsSync(SESSIONS_DIR)) {
        try {
            const result = indexAllFiles(SESSIONS_DIR);
            lastIndexTime = getNowISO();
            console.log(`[Engine] 初始索引完成: ${result.totalIndexed} sessions`);
        } catch (err) {
            console.error(`[Engine] 初始索引失敗: ${err.message}`);
        }
    }

    // 建立 HTTP server
    const server = http.createServer(handleRequest);

    // 嘗試綁定 port
    const lastPort = getLastUsedPort();

    function listen(port) {
        server.listen(port, '127.0.0.1', () => {
            const actualPort = server.address().port;
            console.log(`[Engine] Memory Engine 啟動在 port ${actualPort}`);

            // 寫入 port 檔案
            try {
                fs.writeFileSync(PORT_FILE, String(actualPort), 'utf8');
            } catch (err) {
                console.warn(`[Engine] 寫入 port 檔案失敗: ${err.message}`);
            }
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE' && port !== 0) {
                console.log(`[Engine] Port ${port} 被佔用，改用自動分配`);
                listen(0);
            } else {
                console.error(`[Engine] Server 啟動失敗: ${err.message}`);
                process.exit(1);
            }
        });
    }

    listen(lastPort || 0);

    // Weekly safety-net index (was 5min, now 7 days)
    const indexTimer = setInterval(runPeriodicIndex, WEEKLY_INDEX_INTERVAL);

    // Queue drain timer — process queued items every 30s
    const queueTimer = setInterval(processIndexQueue, QUEUE_PROCESS_INTERVAL);

    // Graceful shutdown
    function shutdown() {
        console.log('[Engine] 正在關閉...');
        // Clear timers
        clearInterval(indexTimer);
        clearInterval(queueTimer);
        // Clean up port file
        try { if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE); } catch (e) { /* ignore */ }
        closeDatabase();
        server.close(() => {
            process.exit(0);
        });
        // 如果 server.close 超過 5 秒沒完成，強制退出
        setTimeout(() => process.exit(0), 5000);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

// 如果直接執行（不是被 require）
if (require.main === module) {
    start();
}

module.exports = { start, handleRequest, runPeriodicIndex, processIndexQueue, indexQueue };
