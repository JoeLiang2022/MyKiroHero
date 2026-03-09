/**
 * Gateway Main Entry
 * Start Gateway Server + WhatsApp
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const MessageGateway = require('./server');
const WhatsAppAdapter = require('./whatsapp-adapter');
const DirectRouter = require('./direct-router');
const TaskExecutor = require('./task-executor');
const { registerWeatherHandler } = require('./weather-handler');
const config = require('./config');
const { createHandler } = require('./handlers');
const { t } = require('../i18n');
const ideHandlerInstance = createHandler();

// Windows UTF-8 encoding fix
if (process.platform === 'win32') {
    try {
        require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
    } catch (e) {
        // ignore
    }
}

// Global error handling - prevent crashes
process.on('uncaughtException', (err) => {
    console.error('[System] Uncaught exception:', err.message);
    // Don't exit, keep running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[System] Unhandled Promise rejection:', reason);
    // Don't exit, keep running
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
    // Build Gateway (using config port)
    const gateway = new MessageGateway(config.serverPort);

    // Initialize DirectRouter (before handler registration)
    const directRouter = new DirectRouter(gateway, config);
    registerWeatherHandler(directRouter, config);
    gateway.directRouter = directRouter;

    // Build shared AiRouter (all task handlers share cooldown state)
    const { createRouter } = require('../ai-router-init');
    const projectDir = path.join(__dirname, '../..');
    const parentKiroDir = path.join(projectDir, '..', '.kiro');
    const { router: sharedRouter } = createRouter({
        projectDir,
        parentKiroDir,
        capabilities: ['tts', 'stt', 'image'],
    });

    // Initialize TaskQueue (SQLite) + TaskExecutor (Heartbeat + Task Dispatch)
    const TaskQueueSQLite = require('./task-queue-sqlite');
    const WorkerRegistry = require('./worker-registry');
    const workerRegistry = new WorkerRegistry();

    // Initialize WorkerSpawner (auto-open Worker Kiro)
    try {
        const WorkerSpawner = require('./worker-spawner');
        const workerSpawner = new WorkerSpawner(workerRegistry, path.join(__dirname, '../..'));
        workerSpawner.gateway = gateway; // for WA notifications
        gateway.workerSpawner = workerSpawner;
        console.log(`[Gateway] WorkerSpawner initialized (max ${workerSpawner.getCapacity().canSpawn} spawnable)`);
    } catch (err) {
        console.error(`[Gateway] WorkerSpawner init failed: ${err.message}`);
    }

    // ─── Mission Control + TaskQueue (shared SQLite DB) ────
    let mcDB = null;
    try {
        const MissionControlDB = require('./mission-control-db');
        mcDB = new MissionControlDB(path.join(__dirname, '../../data/mission-control.db'));
        gateway.mcDB = mcDB;

        // TaskQueue shares the same SQLite DB as Mission Control
        const taskQueue = new TaskQueueSQLite({ db: mcDB.db, taskOutputDir: config.taskOutputDir });
        const taskExecutor = new TaskExecutor(gateway, config, taskQueue, sharedRouter);
        taskExecutor.mcDB = mcDB;
        gateway.taskExecutor = taskExecutor;
        gateway.workerRegistry = workerRegistry;

        // Initialize PushQueueManager
        const PushQueueManager = require('./push-queue-manager');
        gateway.pushQueueManager = new PushQueueManager({ workerRegistry });

        // Mount Dashboard static files
        const express = require('express');
        gateway.app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

        // Root redirect → dashboard (for tunnel access)
        gateway.app.get('/', (req, res) => res.redirect('/dashboard'));

        // Mount REST API routes
        const createMCRoutes = require('./mission-control-routes');
        gateway.app.use('/api/mc', createMCRoutes(mcDB, taskExecutor, gateway));

        console.log('[Gateway] Mission Control + TaskQueue (SQLite) initialized (/dashboard)');
    } catch (err) {
        console.error(`[Gateway] Mission Control init failed, falling back to standalone TaskQueue: ${err.message}`);
        // Fallback: standalone TaskQueue without MC
        const taskQueue = new TaskQueueSQLite({ taskOutputDir: config.taskOutputDir });
        const taskExecutor = new TaskExecutor(gateway, config, taskQueue, sharedRouter);
        gateway.taskExecutor = taskExecutor;
        gateway.workerRegistry = workerRegistry;
        // Initialize PushQueueManager (fallback path)
        const PushQueueManager = require('./push-queue-manager');
        gateway.pushQueueManager = new PushQueueManager({ workerRegistry });
        console.log('[Gateway] TaskQueue (SQLite standalone) initialized');
    }

    // Worker registration notification — drain queue when new Worker comes online
    workerRegistry.onRegister((workerId, port) => {
        const total = workerRegistry.list().filter(w => w.status !== 'offline').length;
        console.log(`[Gateway] 🆕 Worker registered: ${workerId} (port ${port}), total: ${total}`);
        // Use _notifyOwner — pure notification, no handler chain / Commander AI chain reaction
        if (gateway._notifyOwner) {
            gateway._notifyOwner(t('workerOnline', { workerId, port, total }));
        }
        // New worker available — drain queued L3 tasks
        if (gateway.taskExecutor) gateway.taskExecutor.drainQueue();
    });

    // Worker state change → broadcast mc:worker_status
    workerRegistry.onChange((workerId, status, currentTaskId) => {
        gateway.broadcast({
            type: 'mc:worker_status',
            data: { workerId, status, currentTaskId },
        });
    });

    // Initialize STT Service (Speech-to-Text)
    const { SttService } = require('./stt');
    gateway.sttService = new SttService(config);
    gateway.sttService.setRouter(sharedRouter);

    // Listen for all messages (display in terminal)
    gateway.on('message', (msg) => {
        const time = new Date().toLocaleTimeString();
        console.log(`\n${colors.gray}[${time}]${colors.reset} ${colors.cyan}[New Message]${colors.reset}`);
        console.log(`  Platform: ${msg.platform}`);
        console.log(`  From: ${msg.sender}`);
        console.log(`  Chat: ${msg.chatName}`);
        console.log(`  Content: ${msg.text}`);
        console.log('-'.repeat(40));
    });

    // Register IDE handler (auto-selects based on config.ideType)
    // Store handler instance on gateway for middleware to call updatePort
    gateway.ideHandler = ideHandlerInstance;
    gateway.registerHandler('ide', async (message, gw) => {
        return ideHandlerInstance.handle(message, gw);
    });

    // Start Gateway Server
    gateway.start();

    // Start WhatsApp (failure doesn't crash Gateway, other features keep working)
    const whatsapp = new WhatsAppAdapter(gateway);
    try {
        await whatsapp.initialize();
    } catch (err) {
        console.error('[System] WhatsApp initialization failed, Gateway continues:', err.message);
        console.error('[System] Try: pm2 restart gateway --update-env');
    }

    // Graceful shutdown (server.js cleanup also triggers, no duplication needed)
    process.on('SIGINT', async () => {
        console.log('\n[System] Shutting down...');
        if (mcDB) { try { mcDB.close(); } catch (e) {} }
        try { await whatsapp.destroy(); } catch (e) {}
        // 給 server.js cleanup 一點時間執行
        setTimeout(() => process.exit(0), 500);
    });
}

main().catch(console.error);
