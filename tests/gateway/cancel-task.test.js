/**
 * Tests for cancel-task ops command:
 * - Cancels running task in queue + syncs MC
 * - Sends [CANCEL] message to worker's current session
 * - Marks worker idle + resets session
 * - Drains queue for other workers
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
    const sentMessages = [];
    const sentCommands = [];
    const taskUpdates = [];
    const savedResults = [];
    const mcSyncs = [];
    const idleMarks = [];
    let drainCount = 0;

    const workers = new Map();
    workers.set('worker-1', { port: 3001, status: 'busy', currentTaskId: 'task-abc-123' });
    workers.set('worker-2', { port: 3002, status: 'idle', currentTaskId: null });

    return {
        sentMessages,
        sentCommands,
        taskUpdates,
        savedResults,
        mcSyncs,
        idleMarks,
        getDrainCount: () => drainCount,
        workerRegistry: {
            workers,
            getTaskId(wid) {
                const w = workers.get(wid);
                return w ? w.currentTaskId : null;
            },
            async sendToWorker(wid, msg) { sentMessages.push({ wid, msg }); },
            async sendCommandToWorker(wid, cmd) { sentCommands.push({ wid, cmd }); },
            markIdle(wid) { idleMarks.push(wid); },
        },
        taskExecutor: {
            taskQueue: {
                getTask(taskId) {
                    if (taskId === 'task-abc-123') return { status: 'running', action: 'fix-bug' };
                    if (taskId === 'task-done-456') return { status: 'done', action: 'fix-bug' };
                    return null;
                },
                updateStatus(taskId, status, result) { taskUpdates.push({ taskId, status, result }); },
                saveResult(taskId) { savedResults.push(taskId); },
            },
            _syncToMC(taskId, status, data) { mcSyncs.push({ taskId, status, data }); },
            drainQueue() { drainCount++; },
        },
        _resetWorkerSession(wid) { sentCommands.push({ wid, cmd: 'kiroAgent.newSession' }); },
    };
}

// ── Route handler extracted from server.js (cancel-task) ────────────

async function cancelTaskHandler(ctx, req, res) {
    const workerId = req.params.id;
    const { message } = req.body;
    try {
        // ① Cancel task in queue + sync MC
        let cancelledTask = null;
        const currentTaskId = ctx.workerRegistry.getTaskId(workerId);
        if (currentTaskId && ctx.taskExecutor?.taskQueue) {
            const task = ctx.taskExecutor.taskQueue.getTask(currentTaskId);
            if (task && task.status === 'running') {
                ctx.taskExecutor.taskQueue.updateStatus(currentTaskId, 'cancelled', {
                    success: false,
                    message: `Task cancelled via ops cancel-task (${workerId})`,
                });
                ctx.taskExecutor.taskQueue.saveResult(currentTaskId);
                if (ctx.taskExecutor._syncToMC) {
                    ctx.taskExecutor._syncToMC(currentTaskId, 'cancelled', {
                        message: `Task cancelled via ops cancel-task (${workerId})`,
                        workerId,
                    });
                }
                cancelledTask = currentTaskId;
            }
        }

        // ② Send cancel message
        const cancelMsg = message || 'STOP. Your task has been cancelled by Commander. Do NOT make any more code changes, do NOT commit, do NOT push. Follow the [CANCEL] procedure in your AGENTS.md.';
        await ctx.workerRegistry.sendToWorker(workerId, `[CANCEL] ${cancelMsg}`);

        // ③ Mark worker idle + reset session
        ctx.workerRegistry.markIdle(workerId);
        ctx._resetWorkerSession(workerId);

        // ④ Drain queue
        if (ctx.taskExecutor) ctx.taskExecutor.drainQueue();

        res.json({ success: true, workerId, command: 'cancel-task', cancelledTask, message: cancelMsg });
    } catch (err) {
        res.status(500).json({ error: err.message, workerId });
    }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('cancel-task ops command', () => {
    let ctx;
    beforeEach(() => { ctx = createContext(); });

    test('cancels running task, sends [CANCEL], marks idle, drains queue', async () => {
        const req = mockReq({ id: 'worker-1' }, { command: 'cancel-task' });
        const res = mockRes();
        await cancelTaskHandler(ctx, req, res);

        expect(res._status).toBe(200);
        expect(res._body.success).toBe(true);
        expect(res._body.cancelledTask).toBe('task-abc-123');

        // Task queue updated
        expect(ctx.taskUpdates).toHaveLength(1);
        expect(ctx.taskUpdates[0]).toMatchObject({ taskId: 'task-abc-123', status: 'cancelled' });

        // Result saved
        expect(ctx.savedResults).toContain('task-abc-123');

        // MC synced
        expect(ctx.mcSyncs).toHaveLength(1);
        expect(ctx.mcSyncs[0]).toMatchObject({ taskId: 'task-abc-123', status: 'cancelled' });
        expect(ctx.mcSyncs[0].data.workerId).toBe('worker-1');

        // [CANCEL] message sent
        expect(ctx.sentMessages).toHaveLength(1);
        expect(ctx.sentMessages[0].msg).toMatch(/^\[CANCEL\]/);

        // Worker marked idle
        expect(ctx.idleMarks).toContain('worker-1');

        // Session reset
        expect(ctx.sentCommands.some(c => c.cmd === 'kiroAgent.newSession')).toBe(true);

        // Queue drained
        expect(ctx.getDrainCount()).toBe(1);
    });

    test('idle worker with no task — sends cancel but no task update', async () => {
        const req = mockReq({ id: 'worker-2' }, { command: 'cancel-task' });
        const res = mockRes();
        await cancelTaskHandler(ctx, req, res);

        expect(res._status).toBe(200);
        expect(res._body.cancelledTask).toBeNull();
        expect(ctx.taskUpdates).toHaveLength(0);
        expect(ctx.mcSyncs).toHaveLength(0);

        // Still sends cancel message + marks idle
        expect(ctx.sentMessages).toHaveLength(1);
        expect(ctx.idleMarks).toContain('worker-2');
    });

    test('uses custom cancel message when provided', async () => {
        const req = mockReq({ id: 'worker-1' }, { command: 'cancel-task', message: 'Stop now, priority change' });
        const res = mockRes();
        await cancelTaskHandler(ctx, req, res);

        expect(res._body.message).toBe('Stop now, priority change');
        expect(ctx.sentMessages[0].msg).toBe('[CANCEL] Stop now, priority change');
    });

    test('uses default cancel message when none provided', async () => {
        const req = mockReq({ id: 'worker-1' }, { command: 'cancel-task' });
        const res = mockRes();
        await cancelTaskHandler(ctx, req, res);

        expect(res._body.message).toContain('STOP');
        expect(res._body.message).toContain('AGENTS.md');
    });

    test('skips task update when task is not running (already done)', async () => {
        // Override worker-1 to have a done task
        ctx.workerRegistry.workers.set('worker-1', { port: 3001, status: 'busy', currentTaskId: 'task-done-456' });
        ctx.workerRegistry.getTaskId = (wid) => {
            const w = ctx.workerRegistry.workers.get(wid);
            return w ? w.currentTaskId : null;
        };

        const req = mockReq({ id: 'worker-1' }, { command: 'cancel-task' });
        const res = mockRes();
        await cancelTaskHandler(ctx, req, res);

        expect(res._body.cancelledTask).toBeNull();
        expect(ctx.taskUpdates).toHaveLength(0);
        // Still sends cancel + marks idle
        expect(ctx.sentMessages).toHaveLength(1);
        expect(ctx.idleMarks).toContain('worker-1');
    });

    test('handles sendToWorker failure gracefully', async () => {
        ctx.workerRegistry.sendToWorker = async () => { throw new Error('connection refused'); };
        const req = mockReq({ id: 'worker-1' }, { command: 'cancel-task' });
        const res = mockRes();
        await cancelTaskHandler(ctx, req, res);

        expect(res._status).toBe(500);
        expect(res._body.error).toBe('connection refused');
        // Task was still cancelled in queue (happens before sendToWorker)
        expect(ctx.taskUpdates).toHaveLength(1);
    });

    test('works when taskExecutor is null', async () => {
        ctx.taskExecutor = null;
        const req = mockReq({ id: 'worker-2' }, { command: 'cancel-task' });
        const res = mockRes();
        await cancelTaskHandler(ctx, req, res);

        expect(res._status).toBe(200);
        expect(res._body.cancelledTask).toBeNull();
        expect(ctx.sentMessages).toHaveLength(1);
    });

    test('works when _syncToMC is not available', async () => {
        delete ctx.taskExecutor._syncToMC;
        const req = mockReq({ id: 'worker-1' }, { command: 'cancel-task' });
        const res = mockRes();
        await cancelTaskHandler(ctx, req, res);

        expect(res._status).toBe(200);
        expect(res._body.cancelledTask).toBe('task-abc-123');
        expect(ctx.taskUpdates).toHaveLength(1);
        expect(ctx.mcSyncs).toHaveLength(0); // no sync since _syncToMC missing
    });
});
