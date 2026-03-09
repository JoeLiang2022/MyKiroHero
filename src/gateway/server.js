/**
 * Message Gateway Server
 * Unified message gateway, supports WhatsApp
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getSessionLogger } = require('./session-logger');
const WorkerStats = require('./worker-stats');
const { extractLessons, saveLessons } = require('./review-learner');
const { t } = require('../i18n');
const { getNow } = require('../utils/timezone');
const { spawn } = require('child_process');

// Port file path (lets MCP Server know the actual port)
const PORT_FILE = path.join(__dirname, '../../.gateway-port');
const TUNNEL_URL_FILE = path.join(__dirname, '../../.tunnel-url');
const CLOUDFLARED_BIN = path.join(__dirname, '../../bin/cloudflared.exe');

// Dynamic Memory Engine URL (same pattern as mcp-server.js)
function getMemoryEngineUrl() {
    const portFile = path.join(__dirname, '../../.memory-engine-port');
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

// REST Control port file (lets Gateway remember Kiro's port after restart)
const REST_PORT_FILE = path.join(__dirname, '../../.rest-control-port');

class MessageGateway extends EventEmitter {
    constructor(port = config.serverPort) {
        super();
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.handlers = new Map();
        this.clients = { whatsapp: null };
        this.directRouter = null;   // Set by index.js
        this.taskExecutor = null;   // Set by index.js
        this.workerStats = new WorkerStats();
        
        this.setupExpress();
        this.setupWebSocket();
    }

    setupExpress() {
        this.app.use(express.json());

        // X-Kiro-Port header sync middleware
        // MCP 每次 call Gateway 都帶 Kiro REST port，Gateway 讀取後更新 KiroHandler
        // 但 Worker 的 port 不應覆蓋 Commander 的 port
        this.app.use((req, res, next) => {
            const kiroPort = req.headers['x-kiro-port'];
            const workerId = req.headers['x-worker-id'];
            if (kiroPort && !workerId) {
                const port = parseInt(kiroPort, 10);
                if (port > 0 && port < 65536) {
                    const currentPort = this.ideHandler && this.ideHandler.getPort ? this.ideHandler.getPort() : null;
                    if (!currentPort || currentPort === port) {
                        // 更新 IDE handler 的 port（ideHandler 實例存在 gateway 上）
                        if (this.ideHandler && this.ideHandler.updatePort) {
                            this.ideHandler.updatePort(port);
                        }
                        // 寫入檔案（fallback 用，Gateway 重啟時讀回）
                        try {
                            let existing = null;
                            try { existing = parseInt(fs.readFileSync(REST_PORT_FILE, 'utf-8').trim(), 10); } catch (e) {}
                            if (existing !== port) {
                                fs.writeFileSync(REST_PORT_FILE, port.toString(), 'utf-8');
                            }
                        } catch (err) {
                            // EPERM 也沒關係，header 是主要同步方式
                        }
                    } else {
                        console.warn(`[Gateway] ⚠️ Rejected Commander port update: ${port} (current: ${currentPort}) — possible misconfigured Kiro without X_WORKER_ID`);
                    }
                }
            }

            // X-Worker-Id header — Worker Kiro 自動註冊 + 心跳
            const workerPort = req.headers['x-worker-port'];
            if (workerId && workerPort && this.workerRegistry) {
                const wPort = parseInt(workerPort, 10);
                if (wPort > 0 && wPort < 65536) {
                    this.workerRegistry.register(workerId, wPort);
                }
            } else if (workerId && this.workerRegistry) {
                // 沒帶 port 但有 workerId → 更新心跳
                this.workerRegistry.heartbeat(workerId);
            }

            next();
        });

        // 發送回覆
        this.app.post('/api/reply', async (req, res) => {
            let { platform, chatId, message, replyToMessageId } = req.body;
            
            // Auto-detect platform: WhatsApp chatId is xxx@c.us or xxx@g.us
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

        // Send media file
        this.app.post('/api/reply/media', async (req, res) => {
            let { platform, chatId, filePath, caption, replyToMessageId } = req.body;
            
            // Auto-detect platform
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
                whatsapp: this.clients.whatsapp ? 'connected' : 'disconnected'
            });
        });

        // Tunnel URL 查詢
        this.app.get('/api/tunnel', (req, res) => {
            res.json({
                url: this.tunnelUrl || null,
                active: !!this.tunnelProcess,
            });
        });

        // AI Usage 查詢
        this.app.get('/api/ai-usage', (req, res) => {
            try {
                if (!this._usageTracker) {
                    const UsageTracker = require('./usage-tracker');
                    this._usageTracker = new UsageTracker();
                }
                const provider = req.query.provider;
                const usage = this._usageTracker.getToday(provider || undefined);
                const { getTodayDate } = require('../utils/timezone');
                res.json({ date: getTodayDate(), ...usage });
            } catch (e) {
                res.json({ totalCalls: 0, totalCost: 0, byProvider: {}, note: 'Usage tracking not available' });
            }
        });

        // ─── Task Dispatch Endpoints ───────────────────────────────────
        // POST /api/task — submit new task
        this.app.post('/api/task', async (req, res) => {
            try {
                if (!this.taskExecutor || !this.taskExecutor.taskQueue) {
                    return res.status(503).json({ error: 'Task system not initialized' });
                }
                const { type, action, params } = req.body;
                if (!action) {
                    return res.status(400).json({ error: 'Missing required field: action' });
                }
                const result = await this.taskExecutor.submitTask(req.body);
                res.json(result);
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // GET /api/task/:id — query task status
        this.app.get('/api/task/:id', (req, res) => {
            if (!this.taskExecutor || !this.taskExecutor.taskQueue) {
                return res.status(503).json({ error: 'Task system not initialized' });
            }
            const task = this.taskExecutor.taskQueue.getTask(req.params.id);
            if (!task) return res.status(404).json({ error: 'Task not found' });
            res.json(task);
        });

        // GET /api/tasks — list recent tasks
        this.app.get('/api/tasks', (req, res) => {
            if (!this.taskExecutor || !this.taskExecutor.taskQueue) {
                return res.status(503).json({ error: 'Task system not initialized' });
            }
            const limit = parseInt(req.query.limit) || 20;
            res.json(this.taskExecutor.taskQueue.listTasks(limit));
        });

        // POST /api/task/:id/cancel — cancel a task
        this.app.post('/api/task/:id/cancel', (req, res) => {
            if (!this.taskExecutor) {
                return res.status(503).json({ error: 'Task system not initialized' });
            }
            const result = this.taskExecutor.cancelTask(req.params.id);
            res.json(result);
        });

        // ─── Worker Registry Endpoints ─────────────────────────────────
        // POST /api/worker/register — Worker Kiro 註冊
        this.app.post('/api/worker/register', (req, res) => {
            if (!this.workerRegistry) {
                return res.status(503).json({ error: 'Worker registry not initialized' });
            }
            const { workerId, port } = req.body;
            if (!workerId || !port) {
                return res.status(400).json({ error: 'Missing workerId or port' });
            }
            this.workerRegistry.register(workerId, port);
            res.json({ success: true, workerId, port });
        });

        // POST /api/worker/unregister — Worker Kiro 主動下線
        this.app.post('/api/worker/unregister', (req, res) => {
            if (!this.workerRegistry) {
                return res.status(503).json({ error: 'Worker registry not initialized' });
            }
            const { workerId } = req.body;
            if (!workerId) {
                return res.status(400).json({ error: 'Missing workerId' });
            }
            this.workerRegistry.unregister(workerId);
            res.json({ success: true, workerId });
        });

        // POST /api/workers/:id/ops — Send ops command to Worker Kiro
        this.app.post('/api/workers/:id/ops', async (req, res) => {
            if (!this.workerRegistry) {
                return res.status(503).json({ error: 'Worker registry not initialized' });
            }
            const workerId = req.params.id;
            const { command, message } = req.body;
            if (!command && !message) {
                return res.status(400).json({ error: 'Missing command or message' });
            }

            // Predefined ops shortcuts
            const OPS_SHORTCUTS = {
                'git-pull': 'Run this shell command in your project root and report the output:\ngit checkout main && git pull origin main',
                'git-status': 'Run this shell command in your project root and report the output:\ngit status --short',
                'git-stash-pull': 'Run these shell commands in your project root and report the output:\ngit stash && git checkout main && git pull origin main',
                'pm2-restart': 'Run this shell command and report the output:\npm2 restart gateway',
                'pm2-status': 'Run this shell command and report the output:\npm2 list',
            };

            // cancel-task: cancel task in queue + MC, then send [CANCEL] to worker's current session
            if (command === 'cancel-task') {
                try {
                    // ① Cancel task in queue + sync MC (before sending message)
                    let cancelledTask = null;
                    const currentTaskId = this.workerRegistry.getTaskId(workerId);
                    if (currentTaskId && this.taskExecutor?.taskQueue) {
                        const task = this.taskExecutor.taskQueue.getTask(currentTaskId);
                        if (task && task.status === 'running') {
                            this.taskExecutor.taskQueue.updateStatus(currentTaskId, 'cancelled', {
                                success: false,
                                message: `Task cancelled via ops cancel-task (${workerId})`,
                            });
                            this.taskExecutor.taskQueue.saveResult(currentTaskId);
                            if (this.taskExecutor._syncToMC) {
                                this.taskExecutor._syncToMC(currentTaskId, 'cancelled', {
                                    message: `Task cancelled via ops cancel-task (${workerId})`,
                                    workerId,
                                });
                            }
                            cancelledTask = currentTaskId;
                            console.log(`[Gateway] Cancelled task ${currentTaskId} via ops cancel-task (${workerId})`);
                        }
                    }

                    // ② Send cancel message to worker's current session (no newSession)
                    const cancelMsg = message || 'STOP. Your task has been cancelled by Commander. Do NOT make any more code changes, do NOT commit, do NOT push. Follow the [CANCEL] procedure in your AGENTS.md.';
                    await this.workerRegistry.sendToWorker(workerId, `[CANCEL] ${cancelMsg}`);

                    // ③ Mark worker idle + reset session
                    this.workerRegistry.markIdle(workerId);
                    this._resetWorkerSession(workerId);

                    // ④ Drain queue so other workers can pick up pending tasks
                    if (this.taskExecutor) this.taskExecutor.drainQueue();

                    res.json({ success: true, workerId, command: 'cancel-task', cancelledTask, message: cancelMsg });
                } catch (err) {
                    res.status(500).json({ error: err.message, workerId });
                }
                return;
            }

            const opsMessage = OPS_SHORTCUTS[command] || message || command;

            try {
                const workerInfo = this.workerRegistry.workers.get(workerId);
                const isBusy = workerInfo && workerInfo.status === 'busy';

                // Always open new session to isolate ops from current task context
                await this.workerRegistry.sendCommandToWorker(workerId, 'kiroAgent.newSession');
                await this.workerRegistry.sendToWorker(workerId, `[OPS] ${opsMessage}`);

                if (isBusy) {
                    // Worker is mid-task: ops queues in new session, will execute after current task
                    const taskInfo = workerInfo.currentTaskId ? ` (running: ${workerInfo.currentTaskId})` : '';
                    res.json({
                        success: true,
                        workerId,
                        deferred: true,
                        command: command || 'custom',
                        message: `Worker busy${taskInfo}. Ops queued in new session — executes after current task.`,
                    });
                } else {
                    res.json({
                        success: true,
                        workerId,
                        command: command || 'custom',
                        message: opsMessage,
                    });
                }
            } catch (err) {
                res.status(500).json({ error: err.message, workerId });
            }
        });

        // POST /api/workers/:id/ops-report — Receive ops result from Worker
        this.app.post('/api/workers/:id/ops-report', async (req, res) => {
            const workerId = req.params.id;
            const { success, message, command } = req.body;
            if (typeof success === 'undefined' || !message) {
                return res.status(400).json({ error: 'Missing success or message' });
            }
            // Truncate long messages (max 500 chars)
            const truncMsg = message.length > 500 ? message.slice(0, 497) + '...' : message;
            const emoji = success ? '✅' : '❌';
            this._notifyCommander(`${emoji} Ops result (${workerId}): ${command || 'unknown'}\n${truncMsg}`);
            // Also broadcast to dashboard
            if (this.wss) {
                this.wss.clients.forEach(client => {
                    if (client.readyState === 1) {
                        client.send(JSON.stringify({ type: 'ops-result', workerId, success, message: truncMsg, command }));
                    }
                });
            }
            res.json({ received: true, workerId });
        });

        // GET /api/workers — list all workers
        this.app.get('/api/workers', (req, res) => {
            if (!this.workerRegistry) {
                return res.status(503).json({ error: 'Worker registry not initialized' });
            }
            res.json(this.workerRegistry.list());
        });

        // POST /api/workers/:id/reset — Force reset worker status to idle
        this.app.post('/api/workers/:id/reset', (req, res) => {
            if (!this.workerRegistry) {
                return res.status(503).json({ error: 'Worker registry not initialized' });
            }
            const workerId = req.params.id;

            // ① Get old taskId before markIdle clears it
            const oldTaskId = this.workerRegistry.getTaskId(workerId);

            // ② Cancel old task if still running
            let cancelledTask = null;
            if (oldTaskId && this.taskExecutor?.taskQueue) {
                const task = this.taskExecutor.taskQueue.getTask(oldTaskId);
                if (task && task.status === 'running') {
                    this.taskExecutor.taskQueue.updateStatus(oldTaskId, 'cancelled', {
                        success: false,
                        message: `Worker ${workerId} force-reset by Commander`,
                    });
                    this.taskExecutor.taskQueue.saveResult(oldTaskId);
                    if (this.taskExecutor._syncToMC) {
                        this.taskExecutor._syncToMC(oldTaskId, 'cancelled', {
                            message: `Worker ${workerId} force-reset by Commander`,
                            workerId,
                        });
                    }
                    cancelledTask = oldTaskId;
                    console.log(`[Gateway] Cancelled task ${oldTaskId} due to worker ${workerId} reset`);
                }
            }

            // ③ markIdle with forceReset (5s cooldown)
            this.workerRegistry.markIdle(workerId, { forceReset: true });

            // ④ Send newSession to clear Worker Kiro's old context
            this._resetWorkerSession(workerId);

            // ⑤ Drain immediately — cooldown makes findIdle skip this worker, others can pick up tasks
            if (this.taskExecutor) this.taskExecutor.drainQueue();

            // ⑥ Drain again after 5.5s — cooldown expired, reset worker can accept new tasks
            setTimeout(() => {
                if (this.taskExecutor) this.taskExecutor.drainQueue();
            }, 5500);

            res.json({
                success: true,
                workerId,
                status: 'idle',
                cancelledTask,
            });
        });

        // ─── Push Queue Endpoints ──────────────────────────────────
        // POST /api/push-queue/lock — request push lock
        this.app.post('/api/push-queue/lock', (req, res) => {
            if (!this.pushQueueManager) {
                return res.status(503).json({ error: 'Push queue not initialized' });
            }
            const { workerId, repoPath } = req.body;
            if (!workerId || !repoPath) {
                return res.status(400).json({ error: 'Missing workerId or repoPath' });
            }
            const result = this.pushQueueManager.requestLock(workerId, repoPath);
            res.json(result);
        });

        // POST /api/push-queue/release — release push lock
        this.app.post('/api/push-queue/release', (req, res) => {
            if (!this.pushQueueManager) {
                return res.status(503).json({ error: 'Push queue not initialized' });
            }
            const { workerId, repoPath } = req.body;
            if (!workerId || !repoPath) {
                return res.status(400).json({ error: 'Missing workerId or repoPath' });
            }
            const result = this.pushQueueManager.releaseLock(workerId, repoPath);
            res.json(result);
        });

        // GET /api/push-queue/status — get queue status
        this.app.get('/api/push-queue/status', (req, res) => {
            if (!this.pushQueueManager) {
                return res.status(503).json({ error: 'Push queue not initialized' });
            }
            const repoPath = req.query.repoPath;
            if (!repoPath) {
                return res.status(400).json({ error: 'Missing repoPath query param' });
            }
            res.json(this.pushQueueManager.getQueueStatus(repoPath));
        });

        // ─── Git Remote Ops Endpoint ──────────────────────────────
        // POST /api/git-ops — Execute git remote operations via child_process
        // Workaround: Kiro terminal pty crashes Git for Windows on remote ops
        this.app.post('/api/git-ops', (req, res) => {
            const { execFileSync, spawnSync } = require('child_process');
            const { operation, repoPath, branch, remote } = req.body;

            const ALLOWED_OPS = ['fetch', 'pull', 'push', 'clone', 'checkout-pull'];
            if (!operation || !ALLOWED_OPS.includes(operation)) {
                return res.status(400).json({ error: `Invalid operation. Allowed: ${ALLOWED_OPS.join(', ')}` });
            }
            if (!repoPath && operation !== 'clone') {
                return res.status(400).json({ error: 'Missing repoPath' });
            }

            // Validate repoPath is under allowed workspace (MyAIHero root)
            if (repoPath) {
                const resolved = path.resolve(repoPath);
                const allowedBase = path.resolve(path.join(__dirname, '..', '..', '..'));
                if (!resolved.startsWith(allowedBase + path.sep) && resolved !== allowedBase) {
                    return res.status(403).json({ error: 'repoPath outside allowed workspace' });
                }
            }

            // Sanitize: only allow safe chars in remote/branch names
            const SAFE_NAME = /^[a-zA-Z0-9._\-\/]+$/;
            const remoteName = remote || 'origin';
            const branchName = branch || 'main';
            if (!SAFE_NAME.test(remoteName) || !SAFE_NAME.test(branchName)) {
                return res.status(400).json({ error: 'Invalid characters in remote or branch name' });
            }

            const opts = { cwd: repoPath, timeout: 60000, encoding: 'utf-8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } };

            try {
                let output = '';
                switch (operation) {
                    case 'fetch':
                        output = execFileSync('git', ['fetch', remoteName], opts);
                        break;
                    case 'pull':
                        output = execFileSync('git', ['pull', remoteName, branchName], opts);
                        break;
                    case 'push':
                        output = execFileSync('git', ['push', remoteName, branchName], opts);
                        break;
                    case 'checkout-pull': {
                        // Two separate commands — no shell needed
                        execFileSync('git', ['checkout', branchName], opts);
                        output = execFileSync('git', ['pull', remoteName, branchName], opts);
                        break;
                    }
                    case 'clone': {
                        const { url, destPath } = req.body;
                        if (!url || !destPath) return res.status(400).json({ error: 'clone requires url and destPath' });
                        // Validate url format (https or git@)
                        if (!/^(https?:\/\/|git@)/.test(url)) {
                            return res.status(400).json({ error: 'Invalid git URL format' });
                        }
                        const resolvedDest = path.resolve(destPath);
                        const allowedBase = path.resolve(path.join(__dirname, '..', '..', '..'));
                        if (!resolvedDest.startsWith(allowedBase + path.sep) && resolvedDest !== allowedBase) {
                            return res.status(403).json({ error: 'destPath outside allowed workspace' });
                        }
                        output = execFileSync('git', ['clone', url, resolvedDest], { ...opts, cwd: undefined });
                        break;
                    }
                }
                res.json({ success: true, output: (output || '').trim() });
            } catch (err) {
                const stderr = err.stderr ? err.stderr.toString().trim() : '';
                const stdout = err.stdout ? err.stdout.toString().trim() : '';
                res.json({ success: false, error: err.message, stderr, stdout });
            }
        });

        // POST /api/task/:id/result — Worker progress update or final result
        this.app.post('/api/task/:id/result', (req, res) => {
            if (!this.taskExecutor || !this.taskExecutor.taskQueue) {
                return res.status(503).json({ error: 'Task system not initialized' });
            }
            const task = this.taskExecutor.taskQueue.getTask(req.params.id);
            if (!task) return res.status(404).json({ error: 'Task not found' });

            if (req.body.progress) {
                // Progress update — don't mark task as done
                this.taskExecutor.taskQueue.appendProgress(req.params.id, req.body.message || '');
                // MC sync progress
                if (this.taskExecutor._syncProgressToMC) {
                    this.taskExecutor._syncProgressToMC(req.params.id, req.body.message || '');
                }
                // Update worker heartbeat
                if (task.assignedTo && this.workerRegistry) {
                    this.workerRegistry.heartbeat(task.assignedTo);
                }
                // Notify Commander of progress
                this._notifyCommander(`📝 Progress (${task.assignedTo || 'unknown'}): ${req.body.message || ''}\ntaskId: ${req.params.id}`);
                return res.json({ received: true, workerId: task.assignedTo });
            }

            // Not a progress update — treat as final report, forward internally
            req.url = `/api/task/${req.params.id}/report`;
            this.app.handle(req, res);
        });

        // POST /api/task/:id/report — Worker 回報任務結果
        this.app.post('/api/task/:id/report', (req, res) => {
            if (!this.taskExecutor || !this.taskExecutor.taskQueue) {
                return res.status(503).json({ error: 'Task system not initialized' });
            }
            const task = this.taskExecutor.taskQueue.getTask(req.params.id);
            if (!task) return res.status(404).json({ error: 'Task not found' });

            // Guard: cancelled tasks don't accept reports (e.g. Worker was force-reset)
            if (task.status === 'cancelled') {
                console.log(`[Gateway] Ignoring report for cancelled task ${req.params.id} (worker was reset)`);
                return res.json({
                    success: true,
                    taskId: req.params.id,
                    status: 'cancelled',
                    message: 'Task was cancelled (worker reset), report ignored',
                });
            }

            const { success, message, commitHash, branch, outputPath } = req.body;
            const result = { success, message, commitHash, branch, outputPath };

            // Mark worker idle
            if (task.assignedTo && this.workerRegistry) {
                this.workerRegistry.markIdle(task.assignedTo);
            }

            if (!success) {
                this.taskExecutor.taskQueue.updateStatus(req.params.id, 'failed', result);
                // completedAt is set by updateStatus() via getNow() — no manual override needed
                this.taskExecutor.taskQueue.saveResult(req.params.id);
                // MC sync — include workerId
                if (this.taskExecutor._syncToMC) {
                    this.taskExecutor._syncToMC(req.params.id, 'failed', { ...result, workerId: task.assignedTo });
                }
                // Record worker stats — failed
                if (task.assignedTo && this.workerStats) {
                    const duration = task.startedAt ? getNow().getTime() - new Date(task.startedAt).getTime() : 0;
                    this.workerStats.recordTaskResult(task.assignedTo, req.params.id, { success: false, duration });
                }
                this.taskExecutor.notifyError(task, new Error(message || 'Worker reported failure')).catch(() => {});
                // Notify Commander Kiro
                this._notifyCommander(`❌ Task failed (${task.assignedTo || 'unknown'}): ${task.action}\n${message || ''}\ntaskId: ${req.params.id}`);
                // Reset Worker session (path 1: task failed)
                this._resetWorkerSession(task.assignedTo);
                // Worker freed — drain queued L3 tasks
                if (this.taskExecutor) this.taskExecutor.drainQueue();
                return res.json({ success: true, taskId: req.params.id, status: 'failed', workerId: task.assignedTo });
            }

            // Worker succeeded — trigger review pipeline if branch provided
            if (branch && task.type === 'layer3') {
                // Keep task in 'running' state during review
                console.log(`[Gateway] Worker ${task.assignedTo || 'unknown'} done on ${branch}, triggering code review...`);
                // Notify Commander Kiro
                this._notifyCommander(`📋 Task reviewing (${task.assignedTo || 'unknown'}): ${task.action}\nbranch: ${branch}\n${message || ''}\ntaskId: ${req.params.id}`);
                this._runReviewPipeline(req.params.id, task, result, branch).catch(err => {
                    console.error(`[Gateway] Review pipeline error: ${err.message}`);
                });
                return res.json({ success: true, taskId: req.params.id, status: 'reviewing', workerId: task.assignedTo });
            }

            // No branch or not layer3 — mark done directly
            this.taskExecutor.taskQueue.updateStatus(req.params.id, 'done', result);
            // completedAt is set by updateStatus() via getNow()
            this.taskExecutor.taskQueue.saveResult(req.params.id);
            // MC sync — include workerId
            if (this.taskExecutor._syncToMC) {
                this.taskExecutor._syncToMC(req.params.id, 'done', { ...result, workerId: task.assignedTo });
            }
            // Record worker stats — success (no review)
            if (task.assignedTo && this.workerStats) {
                const duration = task.startedAt ? getNow().getTime() - new Date(task.startedAt).getTime() : 0;
                this.workerStats.recordTaskResult(task.assignedTo, req.params.id, { success: true, duration });
            }
            this.taskExecutor.notifyCompletion(task, result).catch(() => {});
            // Notify Commander Kiro
            this._notifyCommander(`✅ Task done (${task.assignedTo || 'unknown'}): ${task.action}\n${message || ''}\ntaskId: ${req.params.id}`);
            // Reset Worker session (path 3: success, no review)
            this._resetWorkerSession(task.assignedTo);
            // Worker freed — drain queued L3 tasks
            if (this.taskExecutor) this.taskExecutor.drainQueue();
            res.json({ success: true, taskId: req.params.id, status: 'done', workerId: task.assignedTo });
        });
    }

    /**
     * Review pipeline: code-review → auto-merge or notify owner
     * Runs async after Worker reports success with a branch.
     */
    async _runReviewPipeline(taskId, task, workerResult, branch) {
        try {
            // Step 1: Code Review (Layer 2)
            console.log(`[ReviewPipeline] Reviewing ${branch}...`);
            const reviewHandler = this.taskExecutor?.taskHandlers?.get('code-review');
            if (!reviewHandler) {
                // No review handler — auto-pass and merge
                console.log('[ReviewPipeline] code-review handler not found, auto-passing');
            } else {
                const context = { projectDir: require('path').join(__dirname, '..', '..') };
                const reviewResult = await reviewHandler.execute({ branch, taskId }, context);

                if (!reviewResult.passed) {
                    // Review failed — check retry count, auto-dispatch back to Worker
                    // _reviewRetryCount may be in task.params (propagated from fix task) or on task itself
                    const reviewRetry = (task._reviewRetryCount || (task.params && task.params._reviewRetryCount) || 0);
                    const maxReviewRetries = 2; // max 2 rounds of review feedback

                    if (reviewRetry < maxReviewRetries && this.workerRegistry) {
                        // Auto-dispatch fix task to Worker
                        task._reviewRetryCount = reviewRetry + 1;
                        console.log(`[ReviewPipeline] Review failed (attempt ${reviewRetry + 1}/${maxReviewRetries}), dispatching fix to Worker...`);

                        try {
                            const fixDescription = `[REVIEW FIX] Code review failed on branch "${branch}". Fix the issues below, then commit and push to the SAME branch.\n\nReview feedback:\n${reviewResult.message}\n\nDo NOT create a new branch. Stay on "${branch}", fix the issues, commit, and push. Then use report_task_result with the same branch name.`;

                            const fixTask = await this.taskExecutor.submitTask({
                                type: 'layer3',
                                action: 'worker-dispatch',
                                params: {
                                    description: fixDescription,
                                    branch: branch,
                                    _parentTaskId: taskId,
                                    _reviewRetryCount: task._reviewRetryCount,
                                    workerId: task.assignedTo,  // Fix must go back to the same worker
                                },
                                notify: task.notify || 'wa',
                            });

                            // Link fix task to MC Dashboard (issue-1e9 fix)
                            if (this.taskExecutor.mcDB) {
                                try {
                                    const origMcTask = this.taskExecutor.mcDB.findByExecTaskId(taskId);
                                    if (origMcTask) {
                                        const existingTasks = this.taskExecutor.mcDB.listTasksByPlan(origMcTask.planId);
                                        const maxOrder = existingTasks.length > 0 ? Math.max(...existingTasks.map(t => t.orderIndex)) : 0;
                                        const mcFixTask = this.taskExecutor.mcDB.createTask({
                                            planId: origMcTask.planId,
                                            title: `Review Fix #${task._reviewRetryCount} — ${branch}`,
                                            description: `Auto-dispatched review fix for branch ${branch}`,
                                            type: 'layer3',
                                            action: 'worker-dispatch',
                                            orderIndex: maxOrder + 1,
                                        });
                                        this.taskExecutor.mcDB.updateTask(mcFixTask.id, { status: 'queued', execTaskId: fixTask.taskId });
                                    }
                                } catch (mcErr) {
                                    console.error(`[ReviewPipeline] MC link for fix task failed: ${mcErr.message}`);
                                }
                            }

                            // Mark original task as waiting for fix
                            const pendingResult = {
                                ...workerResult,
                                reviewPassed: false,
                                reviewMessage: reviewResult.message,
                                reviewMethod: reviewResult.method,
                                fixTaskId: fixTask.taskId,
                            };
                            this.taskExecutor.taskQueue.updateStatus(taskId, 'done', pendingResult);
                            this.taskExecutor.taskQueue.saveResult(taskId);
                            if (this.taskExecutor._syncToMC) {
                                this.taskExecutor._syncToMC(taskId, 'done', { ...pendingResult, workerId: task.assignedTo });
                            }
                            return;
                        } catch (fixErr) {
                            console.error(`[ReviewPipeline] Failed to dispatch fix task: ${fixErr.message}`);
                            // Fall through to manual review
                        }
                    }

                    // Max retries reached or dispatch failed — notify owner for manual review
                    const finalResult = {
                        ...workerResult,
                        reviewPassed: false,
                        reviewMessage: reviewResult.message,
                        reviewMethod: reviewResult.method,
                    };
                    this.taskExecutor.taskQueue.updateStatus(taskId, 'done', finalResult);
                    // completedAt is set by updateStatus() via getNow()
                    this.taskExecutor.taskQueue.saveResult(taskId);
                    if (this.taskExecutor._syncToMC) {
                        this.taskExecutor._syncToMC(taskId, 'done', { ...finalResult, workerId: task.assignedTo });
                    }
                    // Record worker stats — review failed
                    if (task.assignedTo && this.workerStats) {
                        const duration = task.startedAt ? getNow().getTime() - new Date(task.startedAt).getTime() : 0;
                        this.workerStats.recordTaskResult(task.assignedTo, taskId, { success: true, duration, reviewPassed: false });
                    }
                    // Learning loop — extract and save lessons from failed review
                    try {
                        const lessons = extractLessons(reviewResult.message, branch);
                        if (lessons.length > 0) {
                            const saved = saveLessons(taskId, branch, lessons);
                            console.log(`[ReviewPipeline] Saved ${saved} lessons from failed review`);
                        }
                    } catch (learnErr) {
                        console.error(`[ReviewPipeline] Learning loop error: ${learnErr.message}`);
                    }
                    this._notifyOwner(t('reviewFailed', { branch, retryCount: reviewRetry }));
                    // Reset Worker session (path 2d: review failed, max retries)
                    this._resetWorkerSession(task.assignedTo);
                    // Worker freed — drain queued L3 tasks
                    if (this.taskExecutor) this.taskExecutor.drainQueue();
                    return;
                }

                console.log(`[ReviewPipeline] Review passed (${reviewResult.method}): ${branch}`);
            }

            // Step 2: Review passed — notify Commander, do NOT auto-merge
            // Merge is Commander's decision, not Gateway's
            const finalResult = {
                ...workerResult,
                reviewPassed: true,
                merged: false,
                mergeMessage: 'Awaiting Commander merge decision',
            };
            this.taskExecutor.taskQueue.updateStatus(taskId, 'done', finalResult);
            this.taskExecutor.taskQueue.saveResult(taskId);
            if (this.taskExecutor._syncToMC) {
                this.taskExecutor._syncToMC(taskId, 'done', { ...finalResult, workerId: task.assignedTo });
            }

            // Record worker stats — review passed
            if (task.assignedTo && this.workerStats) {
                const duration = task.startedAt ? getNow().getTime() - new Date(task.startedAt).getTime() : 0;
                this.workerStats.recordTaskResult(task.assignedTo, taskId, { success: true, duration, reviewPassed: true });
            }

            // Wake Commander — review passed, awaiting merge decision
            this._notifyOwner(t('reviewPassed', { branch }));
            // Reset Worker session (path 2a: review passed, pending merge)
            this._resetWorkerSession(task.assignedTo);
            // Worker freed — drain queued L3 tasks
            if (this.taskExecutor) this.taskExecutor.drainQueue();

        } catch (err) {
            console.error(`[ReviewPipeline] Error: ${err.message}`);
            // Mark task done with error info
            const finalResult = {
                ...workerResult,
                reviewError: err.message,
            };
            this.taskExecutor.taskQueue.updateStatus(taskId, 'done', finalResult);
            // completedAt is set by updateStatus() via getNow()
            this.taskExecutor.taskQueue.saveResult(taskId);
            if (this.taskExecutor._syncToMC) {
                this.taskExecutor._syncToMC(taskId, 'done', { ...finalResult, workerId: task.assignedTo });
            }

            // Record worker stats — pipeline error (task itself succeeded, review errored)
            if (task.assignedTo && this.workerStats) {
                const duration = task.startedAt ? getNow().getTime() - new Date(task.startedAt).getTime() : 0;
                this.workerStats.recordTaskResult(task.assignedTo, taskId, { success: true, duration, reviewPassed: false });
            }

            // Wake Commander — pipeline had error, may need manual intervention
            this._notifyOwner(t('reviewError', { branch }));
            // Reset Worker session (path 2e: pipeline error)
            this._resetWorkerSession(task.assignedTo);
            // Worker freed — drain queued L3 tasks
            if (this.taskExecutor) this.taskExecutor.drainQueue();
        }
    }

    /**
     * Reset Worker Kiro session after task completion (fire-and-forget)
     */
    _resetWorkerSession(workerId) {
        if (!workerId || !this.workerRegistry) return;
        this.workerRegistry.sendCommandToWorker(workerId, 'kiroAgent.newSession').catch(() => {});
    }

    /**
     * Notify Commander Kiro chat about task events (Worker report, review result, etc.)
     * Uses ideHandler to send message into Commander's Kiro chat.
     * Fire-and-forget — failure only logs, never throws.
     */
    _notifyCommander(message) {
        try {
            if (this.ideHandler && this.ideHandler.sendToChat) {
                // Guard: verify ideHandler port isn't a Worker port (issue-d80 fix)
                const currentPort = this.ideHandler.getPort ? this.ideHandler.getPort() : null;
                if (currentPort && this.workerRegistry) {
                    const workers = this.workerRegistry.list();
                    const isWorkerPort = workers.some(w => w.port === currentPort && w.status !== 'offline');
                    if (isWorkerPort) {
                        console.warn(`[Gateway] _notifyCommander skipped: ideHandler port ${currentPort} belongs to a Worker`);
                        return;
                    }
                }
                this.ideHandler.sendToChat(`[Gateway Report] ${message}`).catch(err => {
                    console.error(`[Gateway] _notifyCommander failed: ${err.message}`);
                });
            }
        } catch (err) {
            console.error(`[Gateway] _notifyCommander error: ${err.message}`);
        }
    }

    /**
     * Notify owner about pipeline/system events.
     * Does NOT go through triggerHeartbeat — avoids handler chain + Commander AI chain reaction.
     * @param {string} message
     */
    _notifyOwner(message) {
        // 1. Commander Kiro chat (pure notification, [Gateway Report] prefix)
        this._notifyCommander(message);
        // 2. WA notification
        const ownerChatId = config.ownerChatId;
        if (ownerChatId) {
            this.sendDirectReply('whatsapp', ownerChatId, message).catch(err => {
                console.error(`[Gateway] _notifyOwner WA failed: ${err.message}`);
            });
        }
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

    // 接收新訊息（由 WhatsApp client 呼叫）
    receiveMessage(platform, message) {
        const { getNowISO } = require('../utils/timezone');
        const enrichedMessage = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            platform,
            timestamp: getNowISO(),
            ...message
        };

        this.emit('message', enrichedMessage);
        this.broadcast({ type: 'new_message', data: enrichedMessage });
        
        // 記錄 user 訊息到 session log
        // 排除系統訊息（heartbeat 等）
        if (platform !== 'system') {
            try {
                const sessionLogger = getSessionLogger();
                const media = message.mediaPath ? { path: message.mediaPath, type: message.mediaType } : null;
                
                // logUser 會呼叫 getSessionId()，如果 session 切換了，previousSessionId 會被設定
                sessionLogger.logUser(message.text || message.body || '', media);
                
                // 檢查是否有上一個 session 結束了
                // 通知 Memory Engine 重新索引該日期的 JSONL（不再發送系統訊息給 AI）
                const previousSession = sessionLogger.popPreviousSession();
                if (previousSession) {
                    console.log(`[Gateway] Session ${previousSession} ended, notifying Memory Engine to index`);
                    
                    const engineUrl = getMemoryEngineUrl();
                    if (engineUrl) {
                        // 從 session ID (YYYYMMDD-NNN) 提取日期 (YYYY-MM-DD)
                        const date = previousSession.substring(0, 4) + '-' + 
                                     previousSession.substring(4, 6) + '-' + 
                                     previousSession.substring(6, 8);
                        const sessionsDir = path.join(__dirname, '../../sessions');
                        const filePath = path.join(sessionsDir, `${date}.jsonl`);
                        
                        // Fire-and-forget：不阻塞，錯誤只記錄
                        fetch(`${engineUrl}/index/file`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filePath })
                        }).catch(err => console.error(`[Gateway] Memory Engine notify failed: ${err.message}`));
                    }
                }
            } catch (err) {
                console.error('[Gateway] Session log error:', err.message);
            }
        }
        
        // 執行註冊的 handlers（fire-and-forget，但捕捉未處理的 rejection）
        this.runHandlers(enrichedMessage).catch(err => {
            console.error('[Gateway] runHandlers unhandled error:', err.message);
        });
        
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

    // 直接回覆（不加 AI prefix，供 DirectRouter 使用）
    async sendDirectReply(platform, chatId, message) {
        const client = this.clients[platform];
        if (!client) {
            throw new Error(`${platform} client not connected`);
        }

        const maxLength = config.message?.maxLength || 1500;
        const parts = this.splitMessage(message, maxLength);

        for (let i = 0; i < parts.length; i++) {
            await client.sendMessage(chatId, parts[i]);
            if (i < parts.length - 1) {
                await new Promise(r => setTimeout(r, config.message?.splitDelay || 500));
            }
        }
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
        // DirectRouter 攔截（只處理 WhatsApp fromMe 訊息）
        if (this.directRouter && message.platform === 'whatsapp' && message.fromMe) {
            const handled = await this.directRouter.tryHandle(message);
            if (handled) return;  // Handled directly, skip remaining handlers
        }

        // Handler logic
        console.log(`[Gateway] Running ${this.handlers.size} handler(s)...`);
        for (const [name, handler] of this.handlers) {
            try {
                console.log(`[Gateway] Running handler: ${name}`);
                await handler(message, this);
            } catch (err) {
                console.error(`[Handler:${name}] Error:`, err.message);
            }
        }
    }


    // Register platform client
    registerClient(platform, client) {
        this.clients[platform] = client;
        console.log(`[Gateway] ${platform} client registered`);
    }

    // Read schedule config from HEARTBEAT.md
    readHeartbeatSchedules() {
        const heartbeatPath = config.heartbeatPath;
        
        if (!heartbeatPath) {
            console.log(`[Heartbeat] HEARTBEAT_PATH not configured`);
            return [];
        }
        
        try {
            if (!fs.existsSync(heartbeatPath)) {
                console.log(`[Heartbeat] HEARTBEAT.md not found: ${heartbeatPath}`);
                return [];
            }
            
            const content = fs.readFileSync(heartbeatPath, 'utf-8');
            
            // Find ```...``` block with schedule entries (supports both CN/EN headers)
            const match = content.match(/## (?:排程 \(schedules\)|Schedules)\s*```([\s\S]*?)```/i);
            if (!match) {
                console.log(`[Heartbeat] No schedule block found`);
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
                        task: task?.trim() || 'Execute HEARTBEAT.md task'
                    };
                })
                .filter(Boolean);
            
            return schedules;
        } catch (err) {
            console.error(`[Heartbeat] Failed to read schedules:`, err.message);
            return [];
        }
    }

    // Setup dynamic heartbeat schedules
    setupDynamicHeartbeat() {
        this.heartbeatTimers = this.heartbeatTimers || [];
        
        // 清除舊的 timers 和活躍排程記錄
        this.heartbeatTimers.forEach(timer => clearTimeout(timer));
        this.heartbeatTimers = [];
        this.activeSchedules = new Set();
        
        const schedules = this.readHeartbeatSchedules();
        
        if (schedules.length === 0) {
            console.log(`[Heartbeat] No schedules configured`);
            return;
        }
        
        console.log(`[Heartbeat] Loaded ${schedules.length} schedule(s): ${schedules.map(s => `${s.time} → ${s.task}`).join(', ')}`);
        
        schedules.forEach(schedule => {
            this.scheduleHeartbeat(schedule.hour, schedule.minute, schedule.task);
        });
    }

    // Schedule a single heartbeat
    scheduleHeartbeat(hour, minute, task) {
        const key = `${hour}:${minute}`;
        const { getNow } = require('../utils/timezone');
        
        const scheduleNext = () => {
            const now = getNow();
            const next = new Date(now.getTime());
            next.setHours(hour, minute, 0, 0);
            
            if (next <= now) {
                next.setDate(next.getDate() + 1);
            }
            
            const delay = next - now;
            console.log(`[Heartbeat] Next ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (${task}) → ${next.toLocaleString('en-US')}`);
            
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

    // Periodically reload schedules (check every hour)
    startScheduleWatcher() {
        // Clear old watcher if exists
        if (this.scheduleWatcherInterval) {
            clearInterval(this.scheduleWatcherInterval);
        }
        
        this.scheduleWatcherInterval = setInterval(() => {
            console.log(`[Heartbeat] Reloading schedules...`);
            this.setupDynamicHeartbeat();
        }, 60 * 60 * 1000); // every hour
    }
    /**
     * Start Cloudflare Tunnel (quick tunnel, no account needed)
     * Spawns cloudflared as child process, parses public URL from stderr
     */
    startTunnel(port) {
        if (!fs.existsSync(CLOUDFLARED_BIN)) {
            console.log('[Tunnel] cloudflared binary not found, skipping tunnel');
            return;
        }

        this.tunnelUrl = null;
        this.tunnelProcess = spawn(CLOUDFLARED_BIN, ['tunnel', '--url', `http://localhost:${port}`], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });

        const parseUrl = (data) => {
            const text = data.toString();
            // cloudflared prints the URL like: https://xxxxx.trycloudflare.com
            const match = text.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
            if (match && !this.tunnelUrl) {
                this.tunnelUrl = match[1];
                // Write to file for other tools to read
                try { fs.writeFileSync(TUNNEL_URL_FILE, this.tunnelUrl, 'utf-8'); } catch (e) {}
                console.log(`[Tunnel] ✅ Public URL: ${this.tunnelUrl}`);
                this.emit('tunnel-ready', this.tunnelUrl);
            }
        };

        this.tunnelProcess.stdout.on('data', parseUrl);
        this.tunnelProcess.stderr.on('data', parseUrl);

        this.tunnelProcess.on('exit', (code) => {
            console.log(`[Tunnel] cloudflared exited (code ${code})`);
            this.tunnelProcess = null;
            this.tunnelUrl = null;
            try { fs.unlinkSync(TUNNEL_URL_FILE); } catch (e) {}
        });

        this.tunnelProcess.on('error', (err) => {
            console.error(`[Tunnel] Failed to start cloudflared: ${err.message}`);
            this.tunnelProcess = null;
        });
    }

    stopTunnel() {
        if (this.tunnelProcess) {
            console.log('[Tunnel] Stopping cloudflared...');
            this.tunnelProcess.kill('SIGTERM');
            this.tunnelProcess = null;
            this.tunnelUrl = null;
            try { fs.unlinkSync(TUNNEL_URL_FILE); } catch (e) {}
        }
    }



    // Stop all schedules (for graceful shutdown)
    stopSchedules() {
        // Clear heartbeat timers
        if (this.heartbeatTimers) {
            this.heartbeatTimers.forEach(timer => clearTimeout(timer));
            this.heartbeatTimers = [];
        }
        
        // Clear schedule watcher
        if (this.scheduleWatcherInterval) {
            clearInterval(this.scheduleWatcherInterval);
            this.scheduleWatcherInterval = null;
        }
        
        console.log('[Heartbeat] All schedules stopped');
    }

    // Trigger heartbeat (try direct execution first, unknown tasks forwarded to AI)
    async triggerHeartbeat(task = 'Execute HEARTBEAT.md task') {
        const { getNow, getNowISO } = require('../utils/timezone');
        console.log(`[Gateway] 🫀 Heartbeat triggered: ${task} at ${getNow().toLocaleString('en-US')}`);
        
        // Try direct execution first (no AI)
        if (this.taskExecutor) {
            const executed = await this.taskExecutor.tryExecute(task);
            if (executed) return;
        }
        
        // Unknown task, forward to Kiro AI
        const heartbeatMessage = {
            platform: 'system',
            type: 'heartbeat',
            from: 'Gateway',
            body: `[Heartbeat] Execute task: ${task}`,
            task: task,
            chatId: 'system',
            timestamp: getNowISO()
        };
        
        this.receiveMessage('system', heartbeatMessage);
    }

    start() {
        const tryListen = (port, isRetry = false) => {
            const requestedPort = port === 'auto' ? 0 : port;
            
            this.server.listen(requestedPort, () => {
                // Get actual assigned port
                const actualPort = this.server.address().port;
                this.port = actualPort;
                
                // Only write port file when port changes (avoid EPERM)
                let existingPort = null;
                try {
                    existingPort = parseInt(fs.readFileSync(PORT_FILE, 'utf-8').trim(), 10);
                } catch (e) {
                    // File doesn't exist or read failed
                }
                
                if (existingPort !== actualPort) {
                    try {
                        fs.writeFileSync(PORT_FILE, actualPort.toString(), 'utf-8');
                        console.log(`[Gateway] Port written to ${PORT_FILE}`);
                    } catch (err) {
                        console.error(`[Gateway] Failed to write port file:`, err.message);
                    }
                }
                
                console.log(`[Gateway] Server running on http://localhost:${actualPort}`);
                console.log(`[Gateway] WebSocket on ws://localhost:${actualPort}`);
                console.log(`[Gateway] REST API:`);
                console.log(`  POST /api/reply         - Send text reply`);
                console.log(`  POST /api/reply/media   - Send media file`);
                console.log(`  GET  /api/health        - Health check`);
                
                // Start dynamic heartbeat schedules
                this.setupDynamicHeartbeat();
                this.startScheduleWatcher();
                
                // Start Cloudflare Tunnel
                this.startTunnel(actualPort);
                
                // Emit ready event
                this.emit('ready', actualPort);
            });
            
            // Listen for error event, handle port in use
            this.server.once('error', (err) => {
                if (err.code === 'EADDRINUSE' && !isRetry) {
                    console.log(`[Gateway] Port ${requestedPort} in use, trying auto port...`);
                    // 重新建立 server（因為 listen 失敗後不能重用）
                    this.server = http.createServer(this.app);
                    // 關閉舊的 WebSocket server 避免 memory leak
                    if (this.wss) {
                        this.wss.close();
                    }
                    this.wss = new WebSocket.Server({ server: this.server });
                    this.setupWebSocket();
                    tryListen('auto', true);
                } else {
                    console.error(`[Gateway] Server error:`, err.message);
                    process.exit(1);
                }
            });
        };
        
        tryListen(this.port);
        
        // Graceful shutdown: cleanup resources (don't delete port file, let new Gateway overwrite)
        const cleanup = () => {
            this.stopTunnel();
            this.stopSchedules();
            // Cleanup DispatchController timers (fragment collection)
            if (this.ideHandler && this.ideHandler.dispatchController) {
                this.ideHandler.dispatchController.cleanupAll();
            }
            if (this.workerRegistry) this.workerRegistry.destroy();
            if (this.workerStats) this.workerStats.destroy();
            if (this.taskExecutor) {
                // Flush task queue before stopping executor timers
                if (this.taskExecutor.taskQueue) this.taskExecutor.taskQueue.destroy();
                this.taskExecutor.destroy();
            }
        };
        
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    }
    
    // Get actual running port
    getPort() {
        return this.port;
    }
}


module.exports = MessageGateway;