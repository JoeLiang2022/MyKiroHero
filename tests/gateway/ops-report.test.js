/**
 * Tests for:
 * 1. POST /api/workers/:id/ops-report — new endpoint
 * 2. POST /api/workers/:id/ops — modified session handling (busy vs idle)
 *
 * Uses lightweight mock req/res to test the route handler logic directly,
 * extracted from server.js patterns.
 */

// ── Helpers ──────────────────────────────────────────────────────────

function mockReq(params = {}, body = {}) {
    return { params, body };
}

function mockRes() {
    const res = {
        _status: 200,
        _body: null,
        status(code) { res._status = code; return res; },
        json(data) { res._body = data; return res; },
    };
    return res;
}

function createContext() {
    const notified = [];
    const wsBroadcasts = [];
    const sentCommands = [];
    const sentMessages = [];

    const workers = new Map();
    workers.set('worker-1', { port: 3001, status: 'idle', currentTaskId: null });
    workers.set('worker-2', { port: 3002, status: 'busy', currentTaskId: 'task-123' });

    return {
        notified,
        wsBroadcasts,
        sentCommands,
        sentMessages,
        workerRegistry: {
            workers,
            async sendCommandToWorker(wid, cmd) { sentCommands.push({ wid, cmd }); },
            async sendToWorker(wid, msg) { sentMessages.push({ wid, msg }); },
        },
        wss: {
            clients: new Set(),
        },
        _notifyCommander(msg) { notified.push(msg); },
    };
}

// ── Route handler extracted from server.js (ops-report) ─────────────

async function opsReportHandler(ctx, req, res) {
    const workerId = req.params.id;
    const { success, message, command } = req.body;
    if (typeof success === 'undefined' || !message) {
        return res.status(400).json({ error: 'Missing success or message' });
    }
    const truncMsg = message.length > 500 ? message.slice(0, 497) + '...' : message;
    const emoji = success ? '✅' : '❌';
    ctx._notifyCommander(`${emoji} Ops result (${workerId}): ${command || 'unknown'}\n${truncMsg}`);
    if (ctx.wss) {
        ctx.wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(JSON.stringify({ type: 'ops-result', workerId, success, message: truncMsg, command }));
            }
        });
    }
    res.json({ received: true, workerId });
}

// ── Route handler extracted from server.js (ops — modified) ─────────

async function opsHandler(ctx, req, res) {
    const workerId = req.params.id;
    const { command, message } = req.body;
    if (!command && !message) {
        return res.status(400).json({ error: 'Missing command or message' });
    }
    const opsMessage = message || command;
    try {
        const workerInfo = ctx.workerRegistry.workers.get(workerId);
        const isBusy = workerInfo && workerInfo.status === 'busy';

        // Always open new session to isolate ops from current task context
        await ctx.workerRegistry.sendCommandToWorker(workerId, 'kiroAgent.newSession');
        await ctx.workerRegistry.sendToWorker(workerId, `[OPS] ${opsMessage}`);

        if (isBusy) {
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
}

// ── Tests: ops-report endpoint ──────────────────────────────────────

describe('POST /api/workers/:id/ops-report', () => {
    let ctx;
    beforeEach(() => { ctx = createContext(); });

    test('success report notifies commander with ✅', async () => {
        const req = mockReq({ id: 'worker-1' }, { success: true, message: 'git pull done', command: 'git-pull' });
        const res = mockRes();
        await opsReportHandler(ctx, req, res);
        expect(res._status).toBe(200);
        expect(res._body).toEqual({ received: true, workerId: 'worker-1' });
        expect(ctx.notified[0]).toContain('✅');
        expect(ctx.notified[0]).toContain('worker-1');
        expect(ctx.notified[0]).toContain('git-pull');
    });

    test('failure report notifies commander with ❌', async () => {
        const req = mockReq({ id: 'worker-2' }, { success: false, message: 'merge conflict', command: 'git-pull' });
        const res = mockRes();
        await opsReportHandler(ctx, req, res);
        expect(res._status).toBe(200);
        expect(ctx.notified[0]).toContain('❌');
        expect(ctx.notified[0]).toContain('merge conflict');
    });

    test('returns 400 when missing success', async () => {
        const req = mockReq({ id: 'worker-1' }, { message: 'hello' });
        const res = mockRes();
        await opsReportHandler(ctx, req, res);
        expect(res._status).toBe(400);
        expect(res._body.error).toContain('Missing');
    });

    test('returns 400 when missing message', async () => {
        const req = mockReq({ id: 'worker-1' }, { success: true });
        const res = mockRes();
        await opsReportHandler(ctx, req, res);
        expect(res._status).toBe(400);
    });

    test('truncates messages longer than 500 chars', async () => {
        const longMsg = 'x'.repeat(600);
        const req = mockReq({ id: 'worker-1' }, { success: true, message: longMsg, command: 'test' });
        const res = mockRes();
        await opsReportHandler(ctx, req, res);
        expect(res._status).toBe(200);
        // Notification should contain truncated message (497 chars + '...')
        const notification = ctx.notified[0];
        expect(notification).toContain('...');
        expect(notification).not.toContain('x'.repeat(500));
    });

    test('defaults command to unknown when not provided', async () => {
        const req = mockReq({ id: 'worker-1' }, { success: true, message: 'done' });
        const res = mockRes();
        await opsReportHandler(ctx, req, res);
        expect(ctx.notified[0]).toContain('unknown');
    });

    test('broadcasts to websocket clients', async () => {
        const sent = [];
        ctx.wss.clients.add({ readyState: 1, send(data) { sent.push(JSON.parse(data)); } });
        const req = mockReq({ id: 'worker-1' }, { success: true, message: 'ok', command: 'git-status' });
        const res = mockRes();
        await opsReportHandler(ctx, req, res);
        expect(sent).toHaveLength(1);
        expect(sent[0].type).toBe('ops-result');
        expect(sent[0].workerId).toBe('worker-1');
        expect(sent[0].command).toBe('git-status');
    });

    test('skips websocket clients that are not open', async () => {
        const sent = [];
        ctx.wss.clients.add({ readyState: 3, send(data) { sent.push(data); } }); // CLOSED
        const req = mockReq({ id: 'worker-1' }, { success: true, message: 'ok' });
        const res = mockRes();
        await opsReportHandler(ctx, req, res);
        expect(sent).toHaveLength(0);
    });
});

// ── Tests: ops endpoint session handling ────────────────────────────

describe('POST /api/workers/:id/ops — session handling', () => {
    let ctx;
    beforeEach(() => { ctx = createContext(); });

    test('idle worker gets newSession before ops message', async () => {
        const req = mockReq({ id: 'worker-1' }, { command: 'git-status' });
        const res = mockRes();
        await opsHandler(ctx, req, res);
        expect(res._status).toBe(200);
        expect(res._body.deferred).toBeUndefined();
        expect(res._body.command).toBe('git-status');
        expect(ctx.sentCommands).toHaveLength(1);
        expect(ctx.sentCommands[0].cmd).toBe('kiroAgent.newSession');
        expect(ctx.sentMessages).toHaveLength(1);
    });

    test('busy worker gets newSession + deferred response', async () => {
        const req = mockReq({ id: 'worker-2' }, { command: 'git-status' });
        const res = mockRes();
        await opsHandler(ctx, req, res);
        expect(res._status).toBe(200);
        expect(res._body.deferred).toBe(true);
        expect(res._body.message).toContain('busy');
        expect(res._body.message).toContain('task-123');
        // newSession IS called (context isolation even for busy workers)
        expect(ctx.sentCommands).toHaveLength(1);
        expect(ctx.sentCommands[0].cmd).toBe('kiroAgent.newSession');
        // Message is still sent (queues in new session)
        expect(ctx.sentMessages).toHaveLength(1);
    });

    test('busy worker response includes task info', async () => {
        const req = mockReq({ id: 'worker-2' }, { message: 'custom ops' });
        const res = mockRes();
        await opsHandler(ctx, req, res);
        expect(res._body).toMatchObject({
            success: true,
            workerId: 'worker-2',
            deferred: true,
        });
        expect(res._body.message).toContain('task-123');
    });

    test('unknown worker treated as idle (no deferred flag)', async () => {
        const req = mockReq({ id: 'worker-unknown' }, { command: 'git-status' });
        const res = mockRes();
        await opsHandler(ctx, req, res);
        expect(res._status).toBe(200);
        expect(res._body.deferred).toBeUndefined();
        // newSession should be called
        expect(ctx.sentCommands).toHaveLength(1);
    });

    test('returns 400 when missing command and message', async () => {
        const req = mockReq({ id: 'worker-1' }, {});
        const res = mockRes();
        await opsHandler(ctx, req, res);
        expect(res._status).toBe(400);
    });

    test('returns 500 when sendToWorker throws', async () => {
        ctx.workerRegistry.sendToWorker = async () => { throw new Error('connection refused'); };
        const req = mockReq({ id: 'worker-1' }, { command: 'git-status' });
        const res = mockRes();
        await opsHandler(ctx, req, res);
        expect(res._status).toBe(500);
        expect(res._body.error).toBe('connection refused');
    });
});
