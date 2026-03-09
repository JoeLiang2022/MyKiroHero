#!/usr/bin/env node
/**
 * MyKiroHero MCP Server
 * 讓 Kiro 直接呼叫 WhatsApp Gateway
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');

// AI Router
const { createRouter } = require('./ai-router-init');
// Alias registry for backward-compatible tool name resolution
const { resolveAlias } = require('./alias-registry');

// 初始化 AI Router（延遲到首次使用，避免啟動時 .env 尚未就緒）
let _aiRouter = null;
let _cachedKiroPort = null;

/**
 * 計算 workspace URI hash → port number
 * Shared logic used by both getKiroPort() and probeKiroPort()
 */
function _calcPortFromWorkspace() {
    let workspacePath = path.join(__dirname, '..');
    let current = workspacePath;
    while (current) {
        const parent = path.dirname(current);
        if (parent === current) break;
        if (fs.existsSync(path.join(parent, '.kiro'))) {
            workspacePath = parent;
            break;
        }
        current = parent;
    }
    let uriPath = workspacePath.replace(/\\/g, '/');
    if (/^[A-Za-z]:/.test(uriPath)) {
        uriPath = uriPath[0].toLowerCase() + '%3A' + uriPath.slice(2);
    }
    uriPath = uriPath.replace(/\/+$/, '');
    const identifier = 'file:///' + uriPath;
    let hash = 0;
    for (let i = 0; i < identifier.length; i++) {
        hash = ((hash << 5) - hash) + identifier.charCodeAt(i);
        hash = hash & hash;
    }
    return { port: 37100 + (Math.abs(hash) % (65535 - 37100)), identifier };
}

function getAiRouter() {
    if (!_aiRouter) {
        try {
            const { router } = createRouter({
                projectDir: path.join(__dirname, '..'),
                parentKiroDir: path.join(__dirname, '..', '..', '.kiro'),
            });
            _aiRouter = router;
        } catch (err) {
            console.error(`[MCP] AiRouter 初始化失敗: ${err.message}`);
        }
    }
    return _aiRouter;
}

// ============================================
// Gateway 自動啟動（MCP server 載入時檢查）
// ============================================
function isGatewayPortListening() {
    // 檢查 Gateway port 是否有人在監聽
    const portFile = path.join(__dirname, '../.gateway-port');
    const altPortFile = path.join(__dirname, 'gateway/.gateway-port');
    
    let port = null;
    for (const file of [portFile, altPortFile]) {
        try {
            if (fs.existsSync(file)) {
                port = fs.readFileSync(file, 'utf-8').trim();
                if (port && !isNaN(port)) break;
            }
        } catch (e) {
            // ignore
        }
    }
    
    if (!port) return false;
    
    // 嘗試連線確認 Gateway 是否在跑
    try {
        const http = require('http');
        return new Promise((resolve) => {
            const req = http.request({
                hostname: 'localhost',
                port: parseInt(port),
                path: '/health',
                method: 'GET',
                timeout: 2000
            }, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.end();
        });
    } catch (e) {
        return false;
    }
}

async function ensureGatewayRunning() {
    try {
        // 先檢查 PM2 是否存在
        try {
            execSync('pm2 --version', { stdio: 'pipe' });
        } catch (e) {
            console.error('[MCP] ERROR: PM2 not installed!');
            console.error('[MCP] Please install PM2 first: npm install -g pm2');
            return;
        }
        
        // 檢查 Gateway 是否已在跑（透過 port 檢查）
        const isRunning = await isGatewayPortListening();
        if (isRunning) {
            console.error('[MCP] Gateway already running');
        } else {
            // Gateway 沒在跑，用 PM2 啟動
            console.error('[MCP] Gateway not running, starting with PM2...');
            const projectRoot = path.join(__dirname, '..');
            const ecosystemPath = path.join(projectRoot, 'ecosystem.config.js');
            
            if (!fs.existsSync(ecosystemPath)) {
                console.error('[MCP] ecosystem.config.js not found at:', ecosystemPath);
                return;
            }
            
            // 用 PM2 啟動（會自動處理 cwd）
            exec(`pm2 start "${ecosystemPath}"`, { cwd: projectRoot }, (err, stdout, stderr) => {
                if (err) {
                    console.error('[MCP] PM2 start failed:', err.message);
                } else {
                    console.error('[MCP] Gateway started with PM2');
                }
            });
            
            // 等待 Gateway ready（polling .gateway-port 檔案更新）
            const startTime = Date.now();
            const timeout = 15000; // 15 秒
            let gatewayReady = false;
            while (Date.now() - startTime < timeout) {
                await new Promise(r => setTimeout(r, 1000));
                const running = await isGatewayPortListening();
                if (running) {
                    console.error('[MCP] Gateway is ready');
                    gatewayReady = true;
                    break;
                }
            }
            if (!gatewayReady) {
                console.warn('[MCP] Gateway started but not yet responding (timeout)');
            }
        }
    } catch (err) {
        console.error('[MCP] Failed to ensure Gateway running:', err.message);
    }
    
    // Gateway ready（或已經在跑）後，主動同步 Kiro port
    // 這樣 Gateway 不用等第一次 MCP tool call 就能拿到正確的 port
    syncKiroPortToGateway();
}

/**
 * 主動把 Kiro REST port 同步給 Gateway（透過 X-Kiro-Port header）
 * 在 ensureGatewayRunning 完成後呼叫，也可以獨立呼叫
 * 
 * 如果 getKiroPort() 回 null（新安裝、沒有 .rest-control-port），
 * 會用 workspace URI hash 算出候選 port 並 probe 確認
 */
async function syncKiroPortToGateway() {
    let kiroPort = getKiroPort();
    
    // 如果沒有已知的 port，嘗試用 hash 算法 probe
    if (!kiroPort) {
        console.error('[MCP] syncKiroPort: 沒有已知 port，嘗試 probe...');
        const probed = await probeKiroPort();
        if (probed) {
            kiroPort = probed.toString();
            // 寫入檔案供下次使用（Worker 不寫，避免覆蓋 Commander 的 port）
            if (!process.env.X_WORKER_ID) {
                try {
                    const restPortFile = path.join(__dirname, '..', '.rest-control-port');
                    fs.writeFileSync(restPortFile, kiroPort, 'utf-8');
                    console.error(`[MCP] syncKiroPort: probe 成功，寫入 .rest-control-port: ${kiroPort}`);
                } catch (e) {
                    console.error(`[MCP] syncKiroPort: 寫入 .rest-control-port 失敗: ${e.message}`);
                }
            } else {
                console.error(`[MCP] syncKiroPort: Worker mode，不寫 .rest-control-port (port=${kiroPort})`);
            }
        } else {
            console.error('[MCP] syncKiroPort: probe 失敗，跳過');
            return;
        }
    }
    
    try {
        const gwUrl = getGatewayUrl();
        console.error(`[MCP] syncKiroPort: ${gwUrl}/api/health (X-Kiro-Port: ${kiroPort})`);
        const resp = await fetch(`${gwUrl}/api/health`, {
            headers: { ...gatewayHeaders(), 'X-Kiro-Port': kiroPort },
            signal: AbortSignal.timeout(3000)
        });
        if (resp.ok) {
            console.error('[MCP] syncKiroPort: ✓ 成功');
        } else {
            console.error(`[MCP] syncKiroPort: Gateway 回應 ${resp.status}`);
        }
    } catch (e) {
        console.error(`[MCP] syncKiroPort: 失敗 (${e.message})`);
    }
}

/**
 * 用 workspace URI hash 算出候選 port 並 probe REST Control extension
 * @returns {number|null} 找到的 port 或 null
 */
async function probeKiroPort() {
    const http = require('http');

    const { port: calcPort, identifier } = _calcPortFromWorkspace();
    console.error(`[MCP] probeKiroPort: "${identifier}" → 候選 ${calcPort}`);

    // Probe 候選 port
    const tryPort = (port) => new Promise((resolve) => {
        const req = http.request({
            hostname: '127.0.0.1', port, path: '/', method: 'GET', timeout: 500
        }, (res) => resolve(res.statusCode === 200));
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });

    if (await tryPort(calcPort)) {
        console.error(`[MCP] probeKiroPort: ✓ port ${calcPort} 回應正常`);
        return calcPort;
    }

    console.error(`[MCP] probeKiroPort: port ${calcPort} 無回應`);
    return null;
}


// 啟動時檢查 Gateway（Worker 不需要啟動 Gateway）
if (!process.env.X_WORKER_ID) {
    ensureGatewayRunning();
} else {
    console.error(`[MCP] Worker mode (${process.env.X_WORKER_ID}) — skip Gateway auto-start`);
    // Worker 仍需同步 port header，然後主動向 Gateway 註冊
    syncKiroPortToGateway().then(() => registerWorkerWithGateway());
    // 定期重新註冊（Gateway 重啟後 registry 會清空）
    setInterval(() => registerWorkerWithGateway(), 30000);

    // Graceful shutdown: 通知 Gateway 下線
    async function unregisterWorkerFromGateway() {
        const workerId = process.env.X_WORKER_ID;
        if (!workerId) return;
        try {
            const gwUrl = getGatewayUrl();
            await fetch(`${gwUrl}/api/worker/unregister`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...gatewayHeaders() },
                body: JSON.stringify({ workerId }),
                signal: AbortSignal.timeout(3000),
            });
            console.error(`[MCP] unregisterWorker: ✓ ${workerId} unregistered`);
        } catch (e) {
            console.error(`[MCP] unregisterWorker: 失敗 (${e.message})`);
        }
    }
    process.on('SIGTERM', async () => { await unregisterWorkerFromGateway(); process.exit(0); });
    process.on('SIGINT', async () => { await unregisterWorkerFromGateway(); process.exit(0); });
}

/**
 * Worker 啟動時主動向 Gateway 註冊（POST /api/worker/register）
 * 這樣不用等第一次 MCP tool call 才註冊
 */
async function registerWorkerWithGateway() {
    const workerId = process.env.X_WORKER_ID;
    if (!workerId) return;
    const workerPort = getKiroPort();
    if (!workerPort) {
        console.error('[MCP] registerWorker: 沒有 workerPort，跳過');
        return;
    }
    try {
        const gwUrl = getGatewayUrl();
        const resp = await fetch(`${gwUrl}/api/worker/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...gatewayHeaders() },
            body: JSON.stringify({ workerId, port: parseInt(workerPort, 10) }),
            signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
            console.error(`[MCP] registerWorker: ✓ ${workerId} registered (port ${workerPort})`);
        } else {
            console.error(`[MCP] registerWorker: Gateway 回應 ${resp.status}`);
        }
    } catch (e) {
        console.error(`[MCP] registerWorker: 失敗 (${e.message})`);
    }
}

const SkillLoader = require('./skills/skill-loader.js');
const SearchEngine = require('./skills/search-engine.js');
const { getSessionLogger } = require('./gateway/session-logger.js');
const { JournalManager } = require('./memory/journal-manager.js');

// 初始化 JournalManager
const journalDir = path.join(__dirname, '../memory/journals');
const journalManager = new JournalManager(journalDir);

// 初始化 Skill Loader
const skillsPath = path.join(__dirname, '../skills');
const skillLoader = new SkillLoader(skillsPath);
skillLoader.scan();

// 初始化 Search Engine（用於知識庫搜尋）
const searchEngine = new SearchEngine();

// 延遲初始化搜尋引擎（等知識庫載入）
function initSearchEngine() {
    const knowledgePath = path.join(__dirname, '../skills/memory');
    const indexPath = path.join(knowledgePath, 'index.json');
    const synonymsPath = path.join(knowledgePath, 'synonyms.json');
    
    if (fs.existsSync(indexPath)) {
        try {
            const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
            searchEngine.init(index.entries || [], synonymsPath);
            console.error(`[MCP] SearchEngine initialized with ${index.entries?.length || 0} documents`);
        } catch (err) {
            console.error('[MCP] Failed to init SearchEngine:', err.message);
        }
    }
}
initSearchEngine();

// 動態取得 Gateway URL
// 取得 Kiro REST Control port（用於 X-Kiro-Port header 同步給 Gateway）
// 快取 probe 結果，避免每次 tool call 都重算

function getKiroPort() {
    // 1. 環境變數（最優先）
    if (process.env.REMOTE_CONTROL_PORT) {
        return process.env.REMOTE_CONTROL_PORT;
    }
    // 2. 從 .rest-control-port 檔案讀取（上次成功偵測到的 port）
    const restPortFile = path.join(__dirname, '..', '.rest-control-port');
    try {
        const p = parseInt(fs.readFileSync(restPortFile, 'utf-8').trim(), 10);
        if (p > 0 && p < 65536) return p.toString();
    } catch (e) { /* ignore */ }
    // 3. 用 workspace URI hash 算出（使用共用 _calcPortFromWorkspace）
    if (_cachedKiroPort) return _cachedKiroPort;
    try {
        const { port } = _calcPortFromWorkspace();
        _cachedKiroPort = port.toString();
        return _cachedKiroPort;
    } catch (e) { /* ignore */ }
    return null;
}


// 建立帶 X-Kiro-Port header 的 headers 物件
function gatewayHeaders(extra = {}) {
    const headers = { ...extra };
    const kiroPort = getKiroPort();
    if (kiroPort) {
        headers['X-Kiro-Port'] = kiroPort;
    }
    // Worker Kiro: 自動帶 X-Worker-Id + X-Worker-Port header
    // X-Worker-Port 用 getKiroPort() 自動偵測（Worker 的 REST Control port）
    if (process.env.X_WORKER_ID) {
        headers['X-Worker-Id'] = process.env.X_WORKER_ID;
        // Worker port = 這個 Kiro instance 的 REST Control port
        const workerPort = getKiroPort();
        if (workerPort) {
            headers['X-Worker-Port'] = workerPort;
        }
    }
    return headers;
}

function getGatewayUrl() {
    // 優先使用環境變數
    if (process.env.GATEWAY_URL) {
        return process.env.GATEWAY_URL;
    }
    
    // 嘗試從 port 檔案讀取
    const portFile = path.join(__dirname, 'gateway/.gateway-port');
    const altPortFile = path.join(__dirname, '../.gateway-port');
    
    for (const file of [portFile, altPortFile]) {
        try {
            if (fs.existsSync(file)) {
                const port = fs.readFileSync(file, 'utf-8').trim();
                if (port && !isNaN(port)) {
                    return `http://localhost:${port}`;
                }
            }
        } catch (err) {
            // ignore
        }
    }
    
    // 預設
    return 'http://localhost:3000';
}

// 動態取得 Memory Engine URL
function getMemoryEngineUrl() {
    const portFile = path.join(__dirname, '../.memory-engine-port');
    try {
        if (fs.existsSync(portFile)) {
            const port = fs.readFileSync(portFile, 'utf-8').trim();
            if (port && !isNaN(port)) {
                return `http://127.0.0.1:${port}`;
            }
        }
    } catch (err) {
        // ignore
    }
    return null;
}

// 建立 MCP Server
const server = new Server(
    {
        name: 'mykiro-gateway',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// 定義可用的 tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'whatsapp',
                description: 'Send WhatsApp message or media. Replaces: send_whatsapp, send_whatsapp_media.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['send', 'send-media'],
                            description: 'Action: send (text message), send-media (file/image/audio)',
                        },
                        chatId: {
                            type: 'string',
                            description: 'Chat ID (e.g. 886...@c.us)',
                        },
                        message: {
                            type: 'string',
                            description: 'Message content (required for send)',
                        },
                        filePath: {
                            type: 'string',
                            description: 'File path (required for send-media)',
                        },
                        caption: {
                            type: 'string',
                            description: 'Caption (optional, send-media only)',
                        },
                    },
                    required: ['action', 'chatId'],
                },
            },
            {
                name: 'get_gateway_status',
                description: 'Get Gateway status',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'skill',
                description: 'Manage skills (list/find/load)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['list', 'find', 'load'],
                            description: 'Action: list (all skills), find (search), load (read content)',
                        },
                        query: {
                            type: 'string',
                            description: 'Search query (required for find)',
                        },
                        name: {
                            type: 'string',
                            description: 'Skill name (required for load)',
                        },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'get_weather',
                description: 'Get weather for location',
                inputSchema: {
                    type: 'object',
                    properties: {
                        location: {
                            type: 'string',
                            description: 'Location (e.g. Taipei, Tokyo)',
                        },
                    },
                    required: ['location'],
                },
            },
            {
                name: 'restart_gateway',
                description: 'Restart Gateway via PM2',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'knowledge',
                description: 'Search, read, or save knowledge base entries. Replaces: knowledge (search/get) + save_knowledge.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['search', 'get', 'save'],
                            description: 'Action: search (query knowledge base), get (read entry by ID), save (create/update entry)',
                        },
                        query: {
                            type: 'string',
                            description: 'Search query (required for search)',
                        },
                        id: {
                            type: 'string',
                            description: 'Entry ID (required for get and save)',
                        },
                        title: {
                            type: 'string',
                            description: 'Title (required for save)',
                        },
                        tags: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Tags array (required for save)',
                        },
                        source: {
                            type: 'string',
                            description: 'Source URL (save only)',
                        },
                        summary: {
                            type: 'string',
                            description: 'One-line summary (required for save)',
                        },
                        content: {
                            type: 'string',
                            description: 'Content in Markdown (required for save)',
                        },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'download_file',
                description: 'Download URL to temp/',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'File URL',
                        },
                        filename: {
                            type: 'string',
                            description: 'Filename (optional, auto-detect)',
                        },
                    },
                    required: ['url'],
                },
            },
            {
                name: 'analyze_image',
                description: 'Analyze image (base64)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        imagePath: {
                            type: 'string',
                            description: 'Image file path',
                        },
                        question: {
                            type: 'string',
                            description: 'Question about image (optional)',
                        },
                    },
                    required: ['imagePath'],
                },
            },
            {
                name: 'session',
                description: 'Session management: view history, list pending summaries, or save summary. Replaces: get_session_history, get_pending_sessions, summarize_session.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['history', 'pending', 'summarize'],
                            description: 'Action: history (view session records), pending (list unsummarized), summarize (get/save summary)',
                        },
                        date: {
                            type: 'string',
                            description: 'Date YYYY-MM-DD (default: today)',
                        },
                        sessionId: {
                            type: 'string',
                            description: 'Session ID (e.g. 20260206-001)',
                        },
                        count: {
                            type: 'number',
                            description: 'Recent N records (default: 20, history only)',
                        },
                        summary: {
                            type: 'string',
                            description: 'Summary text to save (summarize only)',
                        },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'journal',
                description: 'Manage journal entries (add/list/search/complete)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['add', 'list', 'search', 'complete'],
                            description: 'Action: add, list, search, complete (todo)',
                        },
                        category: {
                            type: 'string',
                            enum: ['event', 'thought', 'lesson', 'todo'],
                            description: 'Category (required for add, optional filter for list)',
                        },
                        content: {
                            type: 'string',
                            description: 'Content (required for add)',
                        },
                        query: {
                            type: 'string',
                            description: 'Search query (required for search)',
                        },
                        id: {
                            type: 'string',
                            description: 'Todo ID (required for complete)',
                        },
                        date: {
                            type: 'string',
                            description: 'Date YYYY-MM-DD (optional, default: today)',
                        },
                        metadata: {
                            type: 'object',
                            description: 'Extra metadata (optional, for add)',
                        },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'recall',
                description: 'Search memory (sessions/knowledge/journals). Use source=session + level for detailed session search.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Search query',
                        },
                        source: {
                            type: 'string',
                            description: 'Source: all/session/knowledge/journal (default: all)',
                        },
                        level: {
                            type: 'string',
                            description: 'Session search depth: L1/L2/L3 (only when source=session, default: L2)',
                        },
                        days: {
                            type: 'number',
                            description: 'Search days (default: 7)',
                        },
                    },
                    required: ['query'],
                },
            },
            {
                name: 'summarize_session',
                description: 'Get/save session summary',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sessionId: {
                            type: 'string',
                            description: 'Session ID (e.g. 20260207-001)',
                        },
                        summary: {
                            type: 'string',
                            description: 'Summary text to save (optional)',
                        },
                    },
                    required: ['sessionId'],
                },
            },
            {
                name: 'ai',
                description: 'AI provider management: usage stats or provider status/reset. Replaces: ai_usage, ai_status.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['usage', 'status'],
                            description: 'Action: usage (get usage stats from Gateway), status (get provider status/cooldowns from AiRouter, or reset cooldowns)',
                        },
                        provider: {
                            type: 'string',
                            description: 'Filter by provider ID. For status action: "reset" to clear all cooldowns, "reset:<capability>" (e.g. "reset:tts") for specific.',
                        },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'task',
                description: 'Manage tasks: dispatch (Layer 1/2/3), check status, or cancel. Replaces: dispatch_task, check_task, cancel_task.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['dispatch', 'check', 'cancel'],
                            description: 'Task operation: dispatch (create+run), check (get status), cancel (abort)',
                        },
                        // dispatch params
                        type: {
                            type: 'string',
                            enum: ['layer1', 'layer2', 'layer3'],
                            description: 'Task layer (required for dispatch)',
                        },
                        taskAction: {
                            type: 'string',
                            description: 'Task action name, e.g. crawl, tts, image-gen, worker-dispatch (required for dispatch)',
                        },
                        params: {
                            type: 'object',
                            description: 'Task parameters (required for dispatch)',
                        },
                        notify: {
                            type: 'string',
                            enum: ['wa', 'wa+file', 'silent'],
                            description: 'Notification method (default: wa, dispatch only)',
                        },
                        timeout: {
                            type: 'number',
                            description: 'Task timeout in seconds (default: 300, dispatch only)',
                        },
                        // check/cancel params
                        taskId: {
                            type: 'string',
                            description: 'Task ID (required for check and cancel)',
                        },
                    },
                    required: ['action'],
                },
            },
            {
                name: 'report_task_result',
                description: 'Report task completion result (used by Worker Kiro)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        taskId: {
                            type: 'string',
                            description: 'Task ID to report',
                        },
                        success: {
                            type: 'boolean',
                            description: 'Whether the task succeeded',
                        },
                        message: {
                            type: 'string',
                            description: 'Result description',
                        },
                        commitHash: {
                            type: 'string',
                            description: 'Git commit hash (if applicable)',
                        },
                        branch: {
                            type: 'string',
                            description: 'Git branch name (if applicable)',
                        },
                        progress: {
                            type: 'boolean',
                            description: 'If true, send as progress update instead of final result (default: false)',
                        },
                    },
                    required: ['taskId', 'success', 'message'],
                },
            },
            {
                name: 'run_tests',
                description: 'Run project tests and return compact pass/fail summary (prevents context bloat)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        filter: {
                            type: 'string',
                            description: 'Test file or pattern filter (optional, e.g. "task-template")',
                        },
                    },
                },
            },

            // ─── Worker ────────────────────────────────────
            {
                name: 'worker',
                description: 'Worker management: send ops commands or force-reset stuck workers. Replaces: worker_ops, reset_worker.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['ops', 'reset'],
                            description: 'Action: ops (send command to worker), reset (force-reset stuck worker to idle)',
                        },
                        workerId: {
                            type: 'string',
                            description: 'Worker ID (e.g. worker-1) or "all" for broadcast (ops only)',
                        },
                        command: {
                            type: 'string',
                            description: 'Predefined command: git-pull, git-status, git-stash-pull, pm2-restart, pm2-status, cancel-task (ops only). cancel-task sends to current session without opening new one.',
                        },
                        message: {
                            type: 'string',
                            description: 'Custom message (ops only, used if command not provided)',
                        },
                    },
                    required: ['action', 'workerId'],
                },
            },
            {
                name: 'git',
                description: 'Git operations: remote ops (fetch/pull/push/clone) and push queue (lock/unlock). Replaces: git_remote_ops, request_push_lock, release_push_lock. Workers MUST use this instead of running git fetch/pull/push directly.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['remote', 'lock', 'unlock'],
                            description: 'Git operation type: remote (fetch/pull/push/clone), lock (request push lock), unlock (release push lock)',
                        },
                        // remote params
                        operation: {
                            type: 'string',
                            enum: ['fetch', 'pull', 'push', 'checkout-pull', 'clone'],
                            description: 'Git remote operation (required for action=remote)',
                        },
                        repoPath: {
                            type: 'string',
                            description: 'Absolute path to the git repo (required for all actions)',
                        },
                        branch: {
                            type: 'string',
                            description: 'Branch name (default: main, remote only)',
                        },
                        remote: {
                            type: 'string',
                            description: 'Remote name (default: origin, remote only)',
                        },
                        url: {
                            type: 'string',
                            description: 'Git clone URL (required for clone operation)',
                        },
                        destPath: {
                            type: 'string',
                            description: 'Destination path (required for clone operation)',
                        },
                    },
                    required: ['action'],
                },
            },

            // ─── Issue Tracker (unified) ───────────────────────
            {
                name: 'issue',
                description: 'Manage Issue Tracker entries (replaces create_issue, list_issues, update_issue, close_issue, issue_stats)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['create', 'list', 'update', 'close', 'stats'],
                            description: 'Action: create, list, update, close, stats',
                        },
                        // create/update fields
                        title: { type: 'string', description: 'Issue title' },
                        description: { type: 'string', description: 'Detailed description' },
                        type: { type: 'string', enum: ['defect', 'improvement', 'task'], description: 'Issue type (default: defect)' },
                        priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Priority (default: medium)' },
                        tags: { type: 'array', items: { type: 'string' }, description: 'Tags array' },
                        reporter: { type: 'string', description: 'Who reported it' },
                        assignee: { type: 'string', description: 'Assigned to' },
                        relatedTaskId: { type: 'string', description: 'Related MC task ID' },
                        relatedPlanId: { type: 'string', description: 'Related MC plan ID' },
                        // update/close fields
                        id: { type: 'string', description: 'Issue ID (required for update/close)' },
                        status: { type: 'string', enum: ['open', 'in-progress', 'resolved', 'closed'], description: 'Issue status' },
                        resolution: { type: 'string', description: 'Resolution note (for close)' },
                        // list filters
                        limit: { type: 'number', description: 'Max results (default: 20, for list)' },
                    },
                    required: ['action'],
                },
            },

            // ─── Mission Control (unified) ─────────────────────
            {
                name: 'mc',
                description: 'Mission Control operations (replaces create_plan, get_plan_status, update_mc_task, set_plan_analysis, execute_plan)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['create-plan', 'plan-status', 'update-task', 'set-analysis', 'execute'],
                            description: 'Action: create-plan, plan-status, update-task, set-analysis, execute',
                        },
                        // create-plan fields
                        title: { type: 'string', description: 'Plan title (required for create-plan)' },
                        description: { type: 'string', description: 'Requirement description' },
                        projectId: { type: 'string', description: 'Project ID (default: "default")' },
                        strategy: { type: 'string', description: 'AI strategy analysis (markdown)' },
                        source: { type: 'string', description: 'Source: dashboard/whatsapp/mcp' },
                        tasks: {
                            type: 'array',
                            description: 'Tasks array (for create-plan or set-analysis)',
                            items: {
                                type: 'object',
                                properties: {
                                    title: { type: 'string' },
                                    description: { type: 'string' },
                                    type: { type: 'string', enum: ['layer1', 'layer2', 'layer3'] },
                                    action: { type: 'string' },
                                    params: { type: 'object' },
                                },
                                required: ['title'],
                            },
                        },
                        // plan-status / set-analysis / execute fields
                        planId: { type: 'string', description: 'Plan ID (required for plan-status, set-analysis, execute)' },
                        // update-task fields
                        taskId: { type: 'string', description: 'MC Task ID (mctask-..., required for update-task)' },
                        status: { type: 'string', description: 'New status (for update-task)' },
                        output: { type: 'string', description: 'Output message (for update-task)' },
                        result: { type: 'string', description: 'JSON result (for update-task)' },
                    },
                    required: ['action'],
                },
            },

        ],
    };
});

// 處理 tool 呼叫
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Resolve aliases (old tool names → new consolidated names)
    const { name: rawName, arguments: rawArgs } = request.params;
    const { name, args } = resolveAlias(rawName, rawArgs || {});
    const GATEWAY_URL = getGatewayUrl();

    // Helper: fetch with default timeout to prevent hanging when Gateway is down
    const GW_TIMEOUT = 15000; // 15s default for Gateway calls
    const gwFetch = (url, opts = {}) => {
        if (!opts.signal) {
            opts.signal = AbortSignal.timeout(GW_TIMEOUT);
        }
        return fetch(url, opts);
    };

    try {
        switch (name) {
            case 'whatsapp': {
                const waAction = args.action;
                if (!waAction) {
                    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: action (send|send-media)' }) }], isError: true };
                }
                // 驗證 chatId 格式
                if (!/^\d+@(c|g)\.us$/.test(args.chatId)) {
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ error: `Invalid chatId format: ${args.chatId}. Expected: digits@c.us or digits@g.us` }) }],
                    };
                }
                switch (waAction) {
                    case 'send': {
                        const response = await gwFetch(`${GATEWAY_URL}/api/reply`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify({
                                platform: 'whatsapp',
                                chatId: args.chatId,
                                message: args.message,
                            }),
                        });
                        const result = await response.json();
                        
                        // 記錄 assistant 回覆到 session log（使用跨 process 安全版本）
                        try {
                            const sessionLogger = getSessionLogger();
                            sessionLogger.logAssistantSafe(args.message);
                        } catch (err) {
                            console.error('[MCP] Session log error:', err.message);
                        }
                        
                        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
                    }
                    case 'send-media': {
                        const response = await gwFetch(`${GATEWAY_URL}/api/reply/media`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify({
                                platform: 'whatsapp',
                                chatId: args.chatId,
                                filePath: args.filePath,
                                caption: args.caption || '',
                            }),
                        });
                        const result = await response.json();
                        
                        // 記錄 tool call（發送媒體是重要操作）
                        try {
                            const sessionLogger = getSessionLogger();
                            sessionLogger.logToolCall('whatsapp', { action: 'send-media', filePath: args.filePath }, 'sent');
                        } catch (err) {}
                        
                        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
                    }
                    default:
                        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown whatsapp action: ${waAction}. Valid: send, send-media` }) }], isError: true };
                }
            }

            case 'get_gateway_status': {
                const response = await gwFetch(`${GATEWAY_URL}/api/health`, {
                    headers: gatewayHeaders(),
                });
                const result = await response.json();
                return {
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                };
            }

            case 'skill': {
                // Only rescan on 'find' to discover new skills; list/load use cached data
                if (args.action === 'find') {
                    skillLoader.scan();
                }
                switch (args.action) {
                    case 'list': {
                        const skills = skillLoader.getSkillList();
                        const summary = skillLoader.getSkillSummary();
                        return {
                            content: [{ 
                                type: 'text', 
                                text: `Found ${skills.length} skills:\n${summary}` 
                            }],
                        };
                    }
                    case 'find': {
                        if (!args.query) {
                            return {
                                content: [{ type: 'text', text: 'Missing required parameter: query (for action "find")' }],
                                isError: true,
                            };
                        }
                        const results = skillLoader.searchSkills(args.query);
                        
                        if (results.length === 0) {
                            return {
                                content: [{ 
                                    type: 'text', 
                                    text: `找不到與「${args.query}」相關的 skill。\n\n可用 skill({ action: "list" }) 查看所有 skills。` 
                                }],
                            };
                        }
                        
                        const text = results.map((r, i) => {
                            const tools = r.allowedTools.length > 0 ? ` [${r.allowedTools.join(', ')}]` : '';
                            const matchType = r.matchType === 'exact' ? '🎯' : 
                                             r.matchType === 'token' ? '🔤' : '🔍';
                            return `${i + 1}. ${matchType} **${r.name}** (${r.score.toFixed(2)})${tools}\n   ${r.description}`;
                        }).join('\n\n');
                        
                        const best = results[0];
                        const confidence = best.score >= 0.7 ? '高' : best.score >= 0.4 ? '中' : '低';
                        const suggestion = `\n\n💡 最佳匹配: \`${best.name}\` (信心度: ${confidence})\n用 \`skill({ action: "load", name: "${best.name}" })\` 載入完整內容`;
                        
                        const legend = '\n\n---\n🎯 精準匹配 | 🔤 Token 匹配 | 🔍 語意搜尋';
                        
                        return {
                            content: [{ 
                                type: 'text', 
                                text: `找到 ${results.length} 個相關 skills：\n\n${text}${suggestion}${legend}` 
                            }],
                        };
                    }
                    case 'load': {
                        if (!args.name) {
                            return {
                                content: [{ type: 'text', text: 'Missing required parameter: name (for action "load")' }],
                                isError: true,
                            };
                        }
                        const skill = skillLoader.loadSkill(args.name);
                        if (!skill) {
                            return {
                                content: [{ type: 'text', text: `Skill not found: ${args.name}` }],
                                isError: true,
                            };
                        }
                        return {
                            content: [{ 
                                type: 'text', 
                                text: `# ${skill.name}\n\n${skill.content}\n\n---\nAdditional files: ${skill.files.join(', ') || 'none'}` 
                            }],
                        };
                    }
                    default:
                        return {
                            content: [{ type: 'text', text: `Invalid action "${args.action}" for skill tool. Valid actions: list, find, load` }],
                            isError: true,
                        };
                }
            }

            case 'get_weather': {
                const location = encodeURIComponent(args.location);
                const weatherController = new AbortController();
                const weatherTimeout = setTimeout(() => weatherController.abort(), 8000);
                let data;
                try {
                    const response = await fetch(`https://wttr.in/${location}?format=j1`, {
                        signal: weatherController.signal,
                    });
                    
                    if (!response.ok) {
                        throw new Error(`wttr.in API error: ${response.status}`);
                    }
                    
                    data = await response.json();
                } finally {
                    clearTimeout(weatherTimeout);
                }
                
                const current = data?.current_condition?.[0];
                const area = data?.nearest_area?.[0];
                if (!current || !area) {
                    throw new Error('wttr.in returned unexpected data format');
                }
                
                // 格式化天氣資訊
                const weather = {
                    location: area.areaName[0].value,
                    country: area.country[0].value,
                    temperature: `${current.temp_C}°C`,
                    feelsLike: `${current.FeelsLikeC}°C`,
                    condition: current.weatherDesc[0].value,
                    humidity: `${current.humidity}%`,
                    windSpeed: `${current.windspeedKmph} km/h`,
                    windDir: current.winddir16Point,
                    visibility: `${current.visibility} km`,
                    uvIndex: current.uvIndex,
                    observationTime: current.observation_time,
                };
                
                const text = `📍 ${weather.location}, ${weather.country}
🌡️ 溫度: ${weather.temperature} (體感 ${weather.feelsLike})
☁️ 天氣: ${weather.condition}
💧 濕度: ${weather.humidity}
💨 風速: ${weather.windSpeed} ${weather.windDir}
👁️ 能見度: ${weather.visibility}
☀️ UV 指數: ${weather.uvIndex}`;
                
                return {
                    content: [{ type: 'text', text }],
                };
            }

            case 'restart_gateway': {
                return new Promise((resolve) => {
                    exec('pm2 restart gateway', (error, stdout, stderr) => {
                        if (error) {
                            resolve({
                                content: [{ type: 'text', text: `重啟失敗: ${error.message}\n\n可能原因：\n1. PM2 未安裝 (npm install -g pm2)\n2. Gateway 未用 PM2 啟動` }],
                                isError: true,
                            });
                            return;
                        }
                        resolve({
                            content: [{ type: 'text', text: `Gateway 重啟成功！\n${stdout}` }],
                        });
                    });
                });
            }

            case 'ai': {
                const aiAction = args.action;
                if (!aiAction) {
                    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: action (usage|status)' }) }], isError: true };
                }
                switch (aiAction) {
                    case 'usage': {
                        try {
                            const response = await gwFetch(`${GATEWAY_URL}/api/ai-usage${args.provider ? `?provider=${args.provider}` : ''}`, {
                                headers: gatewayHeaders(),
                            });
                            const data = await response.json();
                            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
                        } catch (e) {
                            return { content: [{ type: 'text', text: JSON.stringify({ error: e.message, hint: 'Gateway may not be running or usage tracking not available' }) }], isError: true };
                        }
                    }
                    case 'status': {
                        const router = getAiRouter();
                        if (!router) {
                            return { content: [{ type: 'text', text: JSON.stringify({ error: 'AiRouter 未初始化' }) }] };
                        }
                        // reset 功能：透過 provider 參數帶 "reset" 或 "reset:tts" 等
                        if (args.provider && args.provider.startsWith('reset')) {
                            const cap = args.provider.includes(':') ? args.provider.split(':')[1] : undefined;
                            router.resetCooldowns(cap);
                            return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: cap ? `已重置 ${cap} 冷卻` : '已重置所有冷卻' }) }] };
                        }
                        const status = router.getStatus(args.provider || undefined);
                        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
                    }
                    default:
                        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown ai action: ${aiAction}. Valid: usage, status` }) }], isError: true };
                }
            }

            case 'knowledge': {
                switch (args.action) {
                    case 'search': {
                        if (!args.query) {
                            return {
                                content: [{ type: 'text', text: 'Missing required parameter: query (for action "search")' }],
                                isError: true,
                            };
                        }
                        // 使用獨立的 SearchEngine 模組
                        if (!searchEngine.initialized) {
                            return {
                                content: [{ type: 'text', text: '知識庫尚未建立' }],
                            };
                        }
                        
                        const { results, expandedTerms } = searchEngine.search(args.query, { limit: 10 });
                        
                        if (results.length === 0) {
                            const hint = expandedTerms 
                                ? `\n（已擴展：${expandedTerms.slice(0, 5).join(', ')}${expandedTerms.length > 5 ? '...' : ''}）` 
                                : '';
                            return {
                                content: [{ type: 'text', text: `找不到「${args.query}」相關的知識。${hint}\n可能需要上網查詢。` }],
                            };
                        }
                        
                        const text = results.map(r => 
                            `- **${r.id}** [${r.score}]: ${r.title}\n  ${r.summary}`
                        ).join('\n\n');
                        
                        return {
                            content: [{ type: 'text', text: `找到 ${results.length} 筆相關知識：\n\n${text}\n\n用 knowledge({ action: "get", id: "..." }) 讀取完整內容` }],
                        };
                    }
                    case 'get': {
                        if (!args.id) {
                            return {
                                content: [{ type: 'text', text: 'Missing required parameter: id (for action "get")' }],
                                isError: true,
                            };
                        }
                        // Sanitize id to prevent path traversal
                        const safeId = String(args.id).replace(/[^a-zA-Z0-9_-]/g, '');
                        if (safeId !== args.id) {
                            return {
                                content: [{ type: 'text', text: `Invalid knowledge id: ${args.id} (only alphanumeric, dash, underscore allowed)` }],
                                isError: true,
                            };
                        }
                        const entryPath = path.join(__dirname, '../skills/memory/entries', `${safeId}.md`);
                        
                        if (!fs.existsSync(entryPath)) {
                            return {
                                content: [{ type: 'text', text: `找不到知識條目: ${args.id}` }],
                                isError: true,
                            };
                        }
                        
                        const content = fs.readFileSync(entryPath, 'utf-8');
                        return {
                            content: [{ type: 'text', text: content }],
                        };
                    }
                    case 'save': {
                        const knowledgePath = path.join(__dirname, '../skills/memory');
                        const indexPath = path.join(knowledgePath, 'index.json');
                        const entriesPath = path.join(knowledgePath, 'entries');
                        
                        if (!fs.existsSync(entriesPath)) {
                            fs.mkdirSync(entriesPath, { recursive: true });
                        }
                        
                        const tags = Array.isArray(args.tags) ? args.tags : [];
                        const knowledgeId = String(args.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
                        if (!knowledgeId) {
                            return { content: [{ type: 'text', text: 'Invalid or missing id for knowledge save' }], isError: true };
                        }
                        
                        const { getTodayDate } = require('./utils/timezone');
                        const today = getTodayDate();
                        
                        const DEDUP_SCORE_THRESHOLD = 0.05;
                        let mergeTarget = null;
                        
                        if (searchEngine.initialized) {
                            const searchQuery = `${args.title || ''} ${tags.join(' ')}`.trim();
                            if (searchQuery) {
                                const { results } = searchEngine.search(searchQuery, { limit: 3 });
                                const similar = results.find(r => r.id !== knowledgeId && r.score >= DEDUP_SCORE_THRESHOLD);
                                if (similar) mergeTarget = similar;
                            }
                        }
                        
                        const existingFilePath = path.join(entriesPath, `${knowledgeId}.md`);
                        const isSameIdUpdate = fs.existsSync(existingFilePath);
                        
                        if (mergeTarget && !isSameIdUpdate) {
                            const targetFilePath = path.join(entriesPath, `${mergeTarget.id}.md`);
                            if (fs.existsSync(targetFilePath)) {
                                const existingContent = fs.readFileSync(targetFilePath, 'utf-8');
                                const createdMatch = existingContent.match(/created:\s*(.+)/);
                                const existingCreated = createdMatch ? createdMatch[1].trim() : today;
                                const existingTags = mergeTarget.tags || [];
                                const mergedTags = [...new Set([...existingTags, ...tags])];
                                const bodyMatch = existingContent.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
                                const existingBody = bodyMatch ? bodyMatch[1].trim() : '';
                                
                                const mergedContent = `---\ntitle: ${mergeTarget.title}\ntags: [${mergedTags.join(', ')}]\nsource: ${args.source || ''}\ncreated: ${existingCreated}\nupdated: ${today}\n---\n\n${existingBody}\n\n---\n\n# 更新 (${today})\n\n## 摘要\n\n${args.summary || ''}\n\n## 內容\n\n${args.content || ''}\n`;
                                
                                fs.writeFileSync(targetFilePath, mergedContent);
                                
                                let index = { version: '1.0.0', entries: [] };
                                if (fs.existsSync(indexPath)) {
                                    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
                                    if (Array.isArray(raw)) { index.entries = raw; } else { index = { ...index, ...raw }; if (!Array.isArray(index.entries)) index.entries = []; }
                                }
                                const targetIdx = index.entries.findIndex(e => e.id === mergeTarget.id);
                                if (targetIdx >= 0) index.entries[targetIdx].tags = mergedTags;
                                fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
                                
                                searchEngine.addDocument({ id: mergeTarget.id, title: mergeTarget.title, tags: mergedTags, summary: `${mergeTarget.summary || ''} | ${args.summary || ''}` });
                                
                                try { const sessionLogger = getSessionLogger(); sessionLogger.logToolCall('knowledge', { action: 'save', id: knowledgeId, mergedInto: mergeTarget.id }, 'merged'); } catch (err) {}
                                
                                return { content: [{ type: 'text', text: `🔄 找到相似條目「${mergeTarget.title}」(${mergeTarget.id})，已合併新內容\n\n合併後 tags: ${mergedTags.join(', ')}` }] };
                            }
                        }
                        
                        const entryContent = `---\ntitle: ${args.title || ''}\ntags: [${tags.join(', ')}]\nsource: ${args.source || ''}\ncreated: ${today}\nupdated: ${today}\n---\n\n# 摘要\n\n${args.summary || ''}\n\n# 內容\n\n${args.content || ''}\n`;
                        
                        fs.writeFileSync(path.join(entriesPath, `${knowledgeId}.md`), entryContent);
                        
                        let index = { version: '1.0.0', entries: [] };
                        if (fs.existsSync(indexPath)) {
                            const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
                            if (Array.isArray(raw)) { index.entries = raw; } else { index = { ...index, ...raw }; if (!Array.isArray(index.entries)) index.entries = []; }
                        }
                        index.entries = index.entries.filter(e => e.id !== knowledgeId);
                        index.entries.push({ id: knowledgeId, title: args.title || '', tags: tags, summary: args.summary || '' });
                        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
                        
                        searchEngine.addDocument({ id: knowledgeId, title: args.title || '', tags: tags, summary: args.summary || '' });
                        
                        try { const sessionLogger = getSessionLogger(); sessionLogger.logToolCall('knowledge', { action: 'save', id: knowledgeId, title: args.title }, isSameIdUpdate ? 'updated' : 'created'); } catch (err) {}
                        
                        return { content: [{ type: 'text', text: `✅ 知識已${isSameIdUpdate ? '更新' : '儲存'}: ${knowledgeId}\n\n下次遇到相關問題可以用 knowledge({ action: "search" }) 找到` }] };
                    }
                    default:
                        return {
                            content: [{ type: 'text', text: `Invalid action "${args.action}" for knowledge tool. Valid actions: search, get, save` }],
                            isError: true,
                        };
                }
            }

            case 'download_file': {
                const MAX_SIZE = 50 * 1024 * 1024; // 50MB 限制
                const tempDir = path.join(__dirname, '../temp');
                
                // 確保 temp 目錄存在
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                // Validate URL
                let parsedUrl;
                try {
                    parsedUrl = new URL(args.url);
                } catch (e) {
                    return {
                        content: [{ type: 'text', text: `無效的 URL: ${args.url}` }],
                        isError: true,
                    };
                }
                
                // Only allow http/https protocols
                if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                    return {
                        content: [{ type: 'text', text: `不支援的 URL 協定: ${parsedUrl.protocol}（只允許 http/https）` }],
                        isError: true,
                    };
                }
                
                // 從 URL 推斷檔名
                let filename = args.filename;
                if (!filename) {
                    filename = path.basename(parsedUrl.pathname) || `download_${Date.now()}`;
                }
                // Sanitize filename to prevent path traversal
                filename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
                if (!filename || filename.startsWith('.')) {
                    filename = `download_${Date.now()}`;
                }
                
                const filePath = path.join(tempDir, filename);
                
                // Verify resolved path is within tempDir
                const resolvedFilePath = path.resolve(filePath);
                if (!resolvedFilePath.startsWith(path.resolve(tempDir))) {
                    return {
                        content: [{ type: 'text', text: `檔名不安全: ${args.filename}` }],
                        isError: true,
                    };
                }
                
                // 下載檔案
                const response = await fetch(args.url, {
                    signal: AbortSignal.timeout(60000), // 60s timeout for downloads
                });
                
                if (!response.ok) {
                    throw new Error(`下載失敗: HTTP ${response.status}`);
                }
                
                // 檢查檔案大小
                const contentLength = response.headers.get('content-length');
                if (contentLength && parseInt(contentLength) > MAX_SIZE) {
                    throw new Error(`檔案太大: ${Math.round(parseInt(contentLength) / 1024 / 1024)}MB，上限 50MB`);
                }
                
                // 取得檔案內容並寫入
                const buffer = Buffer.from(await response.arrayBuffer());
                
                if (buffer.length > MAX_SIZE) {
                    throw new Error(`檔案太大: ${Math.round(buffer.length / 1024 / 1024)}MB，上限 50MB`);
                }
                
                fs.writeFileSync(filePath, buffer);
                
                // 取得檔案類型
                const contentType = response.headers.get('content-type') || 'unknown';
                const fileSize = Math.round(buffer.length / 1024);
                
                return {
                    content: [{ 
                        type: 'text', 
                        text: `✅ 檔案已下載\n\n📁 路徑: ${filePath}\n📦 大小: ${fileSize} KB\n📄 類型: ${contentType}` 
                    }],
                };
            }

            case 'analyze_image': {
                const imagePath = args.imagePath;
                
                // 支援相對路徑和絕對路徑
                let fullPath = imagePath;
                if (!path.isAbsolute(imagePath)) {
                    fullPath = path.join(__dirname, '..', imagePath);
                }
                
                // Path traversal protection: ensure path stays within project
                const projectRoot = path.resolve(path.join(__dirname, '..'));
                const resolvedPath = path.resolve(fullPath);
                if (!resolvedPath.startsWith(projectRoot)) {
                    throw new Error(`Path traversal blocked: ${imagePath}`);
                }
                
                if (!fs.existsSync(resolvedPath)) {
                    throw new Error(`找不到圖片: ${imagePath}`);
                }
                
                // 讀取圖片並轉成 base64
                const imageBuffer = fs.readFileSync(resolvedPath);
                const base64 = imageBuffer.toString('base64');
                
                // 判斷 MIME type
                const ext = path.extname(resolvedPath).toLowerCase();
                const mimeTypes = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                };
                const mimeType = mimeTypes[ext] || 'image/jpeg';
                
                // 檔案大小
                const fileSize = Math.round(imageBuffer.length / 1024);
                
                // 回傳圖片資訊和 base64
                // Kiro 可以直接用這個 base64 來分析圖片
                return {
                    content: [
                        { 
                            type: 'text', 
                            text: `📷 圖片資訊：\n- 路徑: ${resolvedPath}\n- 大小: ${fileSize} KB\n- 格式: ${mimeType}\n${args.question ? `- 問題: ${args.question}` : ''}\n\n以下是圖片的 base64 編碼，請分析這張圖片：`
                        },
                        {
                            type: 'image',
                            data: base64,
                            mimeType: mimeType,
                        }
                    ],
                };
            }

            case 'session': {
                const sessionAction = args.action;
                if (!sessionAction) {
                    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: action (history|pending|summarize)' }) }], isError: true };
                }
                switch (sessionAction) {
                    case 'history': {
                        const sessionLogger = getSessionLogger();
                        
                        if (args.sessionId) {
                            const records = sessionLogger.getSession(args.sessionId);
                            if (records.length === 0) {
                                return { content: [{ type: 'text', text: `找不到 session: ${args.sessionId}` }] };
                            }
                            const formatted = records.map(r => {
                                const time = new Date(r.ts).toLocaleTimeString('zh-TW');
                                const role = r.role === 'user' ? '👤' : '🤖';
                                return `[${time}] ${role} ${r.text}`;
                            }).join('\n');
                            return { content: [{ type: 'text', text: `📜 Session ${args.sessionId} (${records.length} 筆):\n\n${formatted}` }] };
                        }
                        
                        if (args.date) {
                            const records = sessionLogger.read(args.date);
                            if (records.length === 0) {
                                return { content: [{ type: 'text', text: `${args.date} 沒有對話記錄` }] };
                            }
                            const sessions = new Map();
                            for (const r of records) {
                                if (!sessions.has(r.sessionId)) {
                                    sessions.set(r.sessionId, { count: 0, firstMsg: r.text });
                                }
                                sessions.get(r.sessionId).count++;
                            }
                            const summary = Array.from(sessions.entries())
                                .map(([id, info]) => `- ${id}: ${info.count} 筆 - "${info.firstMsg?.substring(0, 30)}..."`)
                                .join('\n');
                            return { content: [{ type: 'text', text: `📅 ${args.date} 的對話 (${sessions.size} 個 session):\n\n${summary}\n\n用 sessionId 參數查看特定 session` }] };
                        }
                        
                        const count = args.count || 20;
                        const records = sessionLogger.getRecent(count);
                        if (records.length === 0) {
                            return { content: [{ type: 'text', text: '今天還沒有對話記錄' }] };
                        }
                        const formatted = records.map(r => {
                            const time = new Date(r.ts).toLocaleTimeString('zh-TW');
                            const role = r.role === 'user' ? '👤' : '🤖';
                            return `[${time}] ${role} ${r.text?.substring(0, 100)}${r.text?.length > 100 ? '...' : ''}`;
                        }).join('\n');
                        return { content: [{ type: 'text', text: `📜 最近 ${records.length} 筆對話:\n\n${formatted}` }] };
                    }
                    case 'pending': {
                        const sessionLogger = getSessionLogger();
                        const { getTodayDate: getTodayDateForPending } = require('./utils/timezone');
                        const date = args.date || getTodayDateForPending();
                        const unsummarized = sessionLogger.listUnsummarizedSessions(date);
                        if (unsummarized.length === 0) {
                            return { content: [{ type: 'text', text: `${date} 沒有待摘要的 session` }] };
                        }
                        const details = unsummarized.map(sessionId => {
                            const data = sessionLogger.formatSessionForSummary(sessionId);
                            if (!data) return `- ${sessionId}: (無資料)`;
                            return `- ${sessionId}: ${data.messageCount} 筆訊息`;
                        }).join('\n');
                        return { content: [{ type: 'text', text: `📋 ${date} 待摘要的 session (${unsummarized.length} 個):\n\n${details}\n\n用 session({ action: "history", sessionId }) 查看內容，然後用 session({ action: "summarize" }) 摘要` }] };
                    }
                    case 'summarize': {
                        const engineUrl = getMemoryEngineUrl();
                        if (!engineUrl) {
                            return { content: [{ type: 'text', text: 'Memory Engine 未啟動（找不到 .memory-engine-port）' }], isError: true };
                        }
                        const { sessionId, summary } = args;
                        try {
                            if (summary) {
                                const response = await fetch(`${engineUrl}/summary/${sessionId}`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ summary }),
                                    signal: AbortSignal.timeout(GW_TIMEOUT),
                                });
                                const data = await response.json();
                                return { content: [{ type: 'text', text: `摘要已儲存: ${sessionId}` }] };
                            } else {
                                const response = await fetch(`${engineUrl}/summary/${sessionId}`, {
                                    signal: AbortSignal.timeout(GW_TIMEOUT),
                                });
                                const data = await response.json();
                                if (data.error) {
                                    return { content: [{ type: 'text', text: `取得摘要失敗: ${data.error}` }], isError: true };
                                }
                                if (data.summary) {
                                    return { content: [{ type: 'text', text: `Session ${sessionId} 摘要:\n\n${data.summary}` }] };
                                }
                                return { content: [{ type: 'text', text: `Session ${sessionId} 尚無摘要（${data.messageCount} 條訊息）。\n\n對話內容:\n${data.conversation}\n\n請根據以上內容產生摘要，然後用 session({ action: "summarize" }) 儲存。` }] };
                            }
                        } catch (err) {
                            return { content: [{ type: 'text', text: `Memory Engine 連線失敗: ${err.message}` }], isError: true };
                        }
                    }
                    default:
                        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown session action: ${sessionAction}. Valid: history, pending, summarize` }) }], isError: true };
                }
            }

            case 'journal': {
                switch (args.action) {
                    case 'add': {
                        if (!args.category || !args.content) {
                            return {
                                content: [{ type: 'text', text: 'Missing required parameters: category and content (for action "add")' }],
                                isError: true,
                            };
                        }
                        const { category, content, metadata } = args;
                        const entry = journalManager.create(category, content, metadata || {});
                        
                        // 也記錄到 SessionLogger
                        try {
                            const sessionLogger = getSessionLogger();
                            sessionLogger.logJournal(category, content, 'mcp_tool');
                        } catch (err) {}
                        
                        const emoji = { event: '📅', thought: '💭', lesson: '📚', todo: '✅' };
                        return {
                            content: [{ 
                                type: 'text', 
                                text: `${emoji[category] || '📝'} Journal 已新增\n\nID: ${entry.id}\n類別: ${category}\n內容: ${content}` 
                            }],
                        };
                    }

                    case 'list': {
                        const { category, date } = args;
                        let entries;
                        
                        // For todos without date, show all pending across all dates
                        if (category === 'todo' && !date) {
                            entries = journalManager.getPendingTodos();
                        } else if (category) {
                            entries = journalManager.readByCategory(category, date);
                        } else {
                            entries = journalManager.getLatestVersions(date);
                        }
                        
                        if (entries.length === 0) {
                            return {
                                content: [{ type: 'text', text: `沒有找到 journal 記錄${category ? ` (類別: ${category})` : ''}` }],
                            };
                        }
                        
                        const emoji = { event: '📅', thought: '💭', lesson: '📚', todo: '✅' };
                        const list = entries.map(e => {
                            const status = e.category === 'todo' ? ` [${e.status}]` : '';
                            const dateTag = e._date ? ` (${e._date})` : '';
                            return `${emoji[e.category] || '📝'} ${e.content}${status}${dateTag}\n   ID: ${e.id}`;
                        }).join('\n\n');
                        
                        return {
                            content: [{ type: 'text', text: `📋 Journal 記錄 (${entries.length} 筆):\n\n${list}` }],
                        };
                    }

                    case 'search': {
                        if (!args.query) {
                            return {
                                content: [{ type: 'text', text: 'Missing required parameter: query (for action "search")' }],
                                isError: true,
                            };
                        }
                        const { query, date } = args;
                        const results = journalManager.search(query, date);
                        
                        if (results.length === 0) {
                            return {
                                content: [{ type: 'text', text: `找不到包含「${query}」的 journal 記錄` }],
                            };
                        }
                        
                        const emoji = { event: '📅', thought: '💭', lesson: '📚', todo: '✅' };
                        const list = results.map(e => {
                            return `${emoji[e.category] || '📝'} ${e.content}\n   ID: ${e.id}`;
                        }).join('\n\n');
                        
                        return {
                            content: [{ type: 'text', text: `🔍 搜尋「${query}」結果 (${results.length} 筆):\n\n${list}` }],
                        };
                    }

                    case 'complete': {
                        if (!args.id) {
                            return {
                                content: [{ type: 'text', text: 'Missing required parameter: id (for action "complete")' }],
                                isError: true,
                            };
                        }
                        const { id, date } = args;
                        const result = journalManager.completeTodo(id, date);
                        
                        if (!result) {
                            return {
                                content: [{ type: 'text', text: `找不到 todo: ${id}（或不是 todo 類別）` }],
                                isError: true,
                            };
                        }
                        
                        return {
                            content: [{ type: 'text', text: `✅ Todo 已完成！\n\n${result.content}` }],
                        };
                    }

                    default:
                        return {
                            content: [{ type: 'text', text: `Invalid action "${args.action}" for journal tool. Valid actions: add, list, search, complete` }],
                            isError: true,
                        };
                }
            }

            case 'recall': {
                const engineUrl = getMemoryEngineUrl();
                if (!engineUrl) {
                    return {
                        content: [{ type: 'text', text: 'Memory Engine 未啟動（找不到 .memory-engine-port）' }],
                        isError: true,
                    };
                }

                const source = args.source || 'all';

                // When source=session and level is specified, use session-specific search (old recall_search)
                if (source === 'session' && args.level) {
                    const params = new URLSearchParams({
                        q: args.query,
                        source: 'session',
                        level: args.level || 'L2',
                        days: String(args.days || 7),
                    });

                    try {
                        const response = await fetch(`${engineUrl}/search?${params}`, {
                            signal: AbortSignal.timeout(GW_TIMEOUT),
                        });
                        const data = await response.json();

                        if (data.error) {
                            return { content: [{ type: 'text', text: `搜尋失敗: ${data.error}` }], isError: true };
                        }

                        if (data.results.length === 0) {
                            return { content: [{ type: 'text', text: `Session 搜尋「${args.query}」沒有找到結果` }] };
                        }

                        const level = (args.level || 'L2').toUpperCase();
                        const list = data.results.map((r, i) => {
                            if (level === 'L1') {
                                return `${i + 1}. Session ${r.sessionId} (${r.date}) — ${r.keywords?.join(', ')}`;
                            } else if (level === 'L3' && r.conversation) {
                                const preview = r.conversation.slice(0, 3).map(m => `  ${m.role}: ${m.text?.substring(0, 100)}`).join('\n');
                                return `${i + 1}. Session ${r.sessionId} (${r.messageCount} msgs)\n${preview}`;
                            }
                            return `${i + 1}. [${r.sessionId}] ${r.role || ''}: ${(r.content || '').substring(0, 200)}`;
                        }).join('\n\n');

                        return { content: [{ type: 'text', text: `Session 搜尋「${args.query}」(${level}) 找到 ${data.count} 筆:\n\n${list}` }] };
                    } catch (err) {
                        return { content: [{ type: 'text', text: `Memory Engine 連線失敗: ${err.message}` }], isError: true };
                    }
                }

                // Default: unified search (old recall logic)
                const params = new URLSearchParams({
                    q: args.query,
                    source: source,
                    days: String(args.days || 7),
                });

                try {
                    const response = await fetch(`${engineUrl}/search?${params}`, {
                        signal: AbortSignal.timeout(GW_TIMEOUT),
                    });
                    const data = await response.json();

                    if (data.error) {
                        return { content: [{ type: 'text', text: `搜尋失敗: ${data.error}` }], isError: true };
                    }

                    if (data.results.length === 0) {
                        return { content: [{ type: 'text', text: `搜尋「${args.query}」沒有找到結果` }] };
                    }

                    const list = data.results.map((r, i) => {
                        const source = r.source || 'unknown';
                        if (source === 'session') {
                            return `${i + 1}. [Session ${r.sessionId}] ${r.content ? r.content.substring(0, 200) : r.keywords?.join(', ')}`;
                        } else if (source === 'knowledge') {
                            return `${i + 1}. [Knowledge] ${r.title}: ${r.summary || ''}`;
                        } else if (source === 'journal') {
                            return `${i + 1}. [Journal ${r.category}] ${r.content?.substring(0, 200)}`;
                        }
                        return `${i + 1}. [${source}] ${JSON.stringify(r).substring(0, 200)}`;
                    }).join('\n\n');

                    return { content: [{ type: 'text', text: `搜尋「${args.query}」找到 ${data.count} 筆結果:\n\n${list}` }] };
                } catch (err) {
                    return { content: [{ type: 'text', text: `Memory Engine 連線失敗: ${err.message}` }], isError: true };
                }
            }

            case 'task': {
                const taskAction = args.action;
                if (!taskAction) {
                    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: action (dispatch|check|cancel)' }) }], isError: true };
                }
                switch (taskAction) {
                    case 'dispatch': {
                        const response = await gwFetch(`${GATEWAY_URL}/api/task`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify({
                                type: args.type,
                                action: args.taskAction,
                                params: args.params,
                                notify: args.notify || 'wa',
                                timeout: args.timeout || undefined,
                            }),
                        });
                        const result = await response.json();
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }
                    case 'check': {
                        const response = await gwFetch(`${GATEWAY_URL}/api/task/${encodeURIComponent(args.taskId)}`, {
                            headers: gatewayHeaders(),
                        });
                        const result = await response.json();
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }
                    case 'cancel': {
                        const response = await gwFetch(`${GATEWAY_URL}/api/task/${encodeURIComponent(args.taskId)}/cancel`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                        });
                        const result = await response.json();
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }
                    default:
                        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown task action: ${taskAction}. Valid: dispatch, check, cancel` }) }], isError: true };
                }
            }

            case 'worker': {
                const workerAction = args.action;
                if (!workerAction) {
                    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: action (ops|reset)' }) }], isError: true };
                }
                switch (workerAction) {
                    case 'ops': {
                        const { workerId, command, message } = args;
                        if (workerId === 'all') {
                            const listRes = await gwFetch(`${GATEWAY_URL}/api/workers`, { headers: gatewayHeaders() });
                            const workers = await listRes.json();
                            const results = [];
                            for (const w of workers) {
                                if (w.status === 'offline') continue;
                                try {
                                    const r = await gwFetch(`${GATEWAY_URL}/api/workers/${encodeURIComponent(w.workerId)}/ops`, {
                                        method: 'POST',
                                        headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                                        body: JSON.stringify({ command, message }),
                                    });
                                    results.push({ workerId: w.workerId, ...(await r.json()) });
                                } catch (e) {
                                    results.push({ workerId: w.workerId, error: e.message });
                                }
                            }
                            return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
                        }
                        const response = await gwFetch(`${GATEWAY_URL}/api/workers/${encodeURIComponent(workerId)}/ops`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify({ command, message }),
                        });
                        const result = await response.json();
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }
                    case 'reset': {
                        const { workerId } = args;
                        const response = await gwFetch(`${GATEWAY_URL}/api/workers/${encodeURIComponent(workerId)}/reset`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                        });
                        const result = await response.json();
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }
                    default:
                        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown worker action: ${workerAction}. Valid: ops, reset` }) }], isError: true };
                }
            }

            case 'git': {
                const gitAction = args.action;
                if (!gitAction) {
                    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: action (remote|lock|unlock)' }) }], isError: true };
                }
                switch (gitAction) {
                    case 'remote': {
                        const { operation, repoPath, branch, remote, url, destPath } = args;
                        // Git operations can take longer than default — use 65s timeout (server-side is 60s)
                        const response = await gwFetch(`${GATEWAY_URL}/api/git-ops`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify({ operation, repoPath, branch, remote, url, destPath }),
                            signal: AbortSignal.timeout(65000),
                        });
                        const result = await response.json();
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }
                    case 'lock': {
                        const workerId = process.env.X_WORKER_ID;
                        console.error(`[MCP] git lock — X_WORKER_ID=${workerId || '(empty)'}`);
                        if (!workerId) {
                            return { content: [{ type: 'text', text: JSON.stringify({ error: 'X_WORKER_ID env var not set' }) }], isError: true };
                        }
                        const response = await fetch(`${GATEWAY_URL}/api/push-queue/lock`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify({ workerId, repoPath: args.repoPath }),
                        });
                        const result = await response.json();
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }
                    case 'unlock': {
                        const workerId = process.env.X_WORKER_ID;
                        if (!workerId) {
                            return { content: [{ type: 'text', text: JSON.stringify({ error: 'X_WORKER_ID env var not set' }) }], isError: true };
                        }
                        const response = await fetch(`${GATEWAY_URL}/api/push-queue/release`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify({ workerId, repoPath: args.repoPath }),
                        });
                        const result = await response.json();
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }
                    default:
                        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown git action: ${gitAction}. Valid: remote, lock, unlock` }) }], isError: true };
                }
            }

            case 'report_task_result': {
                // Ops result routing: detect ops- prefix and route to ops-report endpoint
                if (args.taskId && args.taskId.startsWith('ops-') && process.env.X_WORKER_ID) {
                    const opsEndpoint = `${GATEWAY_URL}/api/workers/${encodeURIComponent(process.env.X_WORKER_ID)}/ops-report`;
                    const opsResponse = await gwFetch(opsEndpoint, {
                        method: 'POST',
                        headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify({
                            success: args.success,
                            message: args.message,
                            command: args.taskId.replace('ops-', ''),
                        }),
                    });
                    const opsResult = await opsResponse.json();
                    return {
                        content: [{ type: 'text', text: JSON.stringify(opsResult, null, 2) }],
                    };
                }

                // Original task report logic (unchanged)
                const endpoint = args.progress
                    ? `${GATEWAY_URL}/api/task/${encodeURIComponent(args.taskId)}/result`
                    : `${GATEWAY_URL}/api/task/${encodeURIComponent(args.taskId)}/report`;
                const response = await gwFetch(endpoint, {
                    method: 'POST',
                    headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        success: args.success,
                        message: args.message,
                        commitHash: args.commitHash,
                        branch: args.branch,
                        progress: args.progress || false,
                    }),
                });
                const result = await response.json();
                return {
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                };
            }

            // ─── Issue Tracker (unified) ─────────────────────
            case 'issue': {
                // Read Issue Tracker port dynamically
                const itPortFile = path.join(process.cwd(), '..', 'BugTracker', '.issue-tracker-port');
                let itPort;
                try {
                    itPort = parseInt(fs.readFileSync(itPortFile, 'utf-8').trim(), 10);
                } catch (e) {
                    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Issue Tracker not running (port file not found)' }) }] };
                }
                const IT_URL = `http://localhost:${itPort}`;

                let itResponse;
                switch (args.action) {
                    case 'create':
                        itResponse = await fetch(`${IT_URL}/api/issues`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(args),
                            signal: AbortSignal.timeout(GW_TIMEOUT),
                        });
                        break;
                    case 'list': {
                        const params = new URLSearchParams();
                        if (args.status) params.set('status', args.status);
                        if (args.type) params.set('type', args.type);
                        if (args.priority) params.set('priority', args.priority);
                        if (args.limit) params.set('limit', String(args.limit));
                        itResponse = await fetch(`${IT_URL}/api/issues?${params}`, {
                            signal: AbortSignal.timeout(GW_TIMEOUT),
                        });
                        break;
                    }
                    case 'update':
                        itResponse = await fetch(`${IT_URL}/api/issues/${encodeURIComponent(args.id)}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(args),
                            signal: AbortSignal.timeout(GW_TIMEOUT),
                        });
                        break;
                    case 'close':
                        itResponse = await fetch(`${IT_URL}/api/issues/${encodeURIComponent(args.id)}/close`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ resolution: args.resolution }),
                            signal: AbortSignal.timeout(GW_TIMEOUT),
                        });
                        break;
                    case 'stats':
                        itResponse = await fetch(`${IT_URL}/api/stats`, {
                            signal: AbortSignal.timeout(GW_TIMEOUT),
                        });
                        break;
                    default:
                        return { content: [{ type: 'text', text: `Invalid action "${args.action}" for issue tool. Valid: create, list, update, close, stats` }], isError: true };
                }
                const itResult = await itResponse.json();
                return { content: [{ type: 'text', text: JSON.stringify(itResult, null, 2) }] };
            }

            // ─── Mission Control (unified) ─────────────────────
            case 'mc': {
                switch (args.action) {
                    case 'create-plan': {
                        const response = await gwFetch(`${GATEWAY_URL}/api/mc/plans`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify(args),
                        });
                        const result = await response.json();
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }

                    case 'plan-status': {
                        const response = await gwFetch(`${GATEWAY_URL}/api/mc/plans/${encodeURIComponent(args.planId)}`, {
                            headers: gatewayHeaders(),
                        });
                        const result = await response.json();
                        if (result.tasks) {
                            const done = result.tasks.filter(t => t.status === 'done').length;
                            const total = result.tasks.length;
                            const summary = {
                                planId: result.id,
                                title: result.title,
                                status: result.status,
                                progress: `${done}/${total}`,
                                tasks: result.tasks.map(t => ({
                                    id: t.id, title: t.title, status: t.status,
                                    assignedTo: t.assignedTo, output: t.output,
                                })),
                            };
                            return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
                        }
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }

                    case 'update-task': {
                        const { taskId, ...fields } = args;
                        const response = await gwFetch(`${GATEWAY_URL}/api/mc/tasks/${encodeURIComponent(taskId)}`, {
                            method: 'PATCH',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify(fields),
                        });
                        const result = await response.json();
                        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                    }

                    case 'set-analysis': {
                        const { planId, strategy, tasks } = args;
                        const response = await gwFetch(`${GATEWAY_URL}/api/mc/plans/${encodeURIComponent(planId)}/analysis`, {
                            method: 'PATCH',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify({ strategy, tasks }),
                        });
                        const result = await response.json();
                        if (result.error) {
                            return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
                        }
                        const taskCount = (result.tasks || []).filter(t => t.action !== 'plan-analyze').length;
                        return { content: [{ type: 'text', text: `✅ Plan ${planId} updated: strategy set, ${taskCount} tasks created. Plan is now ready for execution.` }] };
                    }

                    case 'execute': {
                        const response = await gwFetch(`${GATEWAY_URL}/api/mc/plans/${encodeURIComponent(args.planId)}/execute`, {
                            method: 'POST',
                            headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
                        });
                        const result = await response.json();
                        if (result.error) {
                            return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
                        }
                        const errCount = (result.errors || []).length;
                        const msg = errCount > 0
                            ? `⚠️ Plan ${args.planId} executed: ${result.submitted} submitted, ${errCount} failed`
                            : `✅ Plan ${args.planId} executed: ${result.submitted} task(s) dispatched`;
                        return { content: [{ type: 'text', text: msg }] };
                    }

                    default:
                        return { content: [{ type: 'text', text: `Invalid action "${args.action}" for mc tool. Valid: create-plan, plan-status, update-task, set-analysis, execute` }], isError: true };
                }
            }

            case 'run_tests': {
                const { execSync } = require('child_process');
                const projectDir = require('path').join(__dirname, '..');
                const filter = args.filter || '';
                const cmd = filter
                    ? `npx jest --no-coverage --forceExit --silent "${filter}" 2>&1`
                    : `npx jest --no-coverage --forceExit --silent 2>&1`;

                try {
                    const output = execSync(cmd, {
                        cwd: projectDir,
                        encoding: 'utf-8',
                        timeout: 120000,
                        stdio: 'pipe',
                    });
                    // Extract just the summary lines (last few lines)
                    const lines = output.trim().split('\n');
                    const summary = lines.slice(-5).join('\n');
                    return {
                        content: [{ type: 'text', text: `✅ Tests passed\n${summary}` }],
                    };
                } catch (err) {
                    const output = (err.stdout || err.stderr || err.message || '').toString();
                    const lines = output.trim().split('\n');
                    // Find FAIL lines and summary
                    const failLines = lines.filter(l => /^(FAIL|PASS)\s/.test(l) || /Tests:|Test Suites:/.test(l));
                    const summary = failLines.length > 0
                        ? failLines.join('\n')
                        : lines.slice(-10).join('\n');
                    return {
                        content: [{ type: 'text', text: `❌ Tests failed\n${summary}` }],
                    };
                }
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});

// 啟動 server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] MyKiro Gateway MCP Server running');
}


main().catch(console.error);
