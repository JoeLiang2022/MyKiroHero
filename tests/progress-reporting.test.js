/**
 * Progress Reporting Tests
 * 
 * NOTE: This test file uses Jest's `expect` assertions exclusively,
 * consistent with the project's Jest test runner.
 * 
 * Tests:
 * - TaskQueue.appendProgress adds entries to progressLog
 * - progressLog initialized as empty array on new tasks
 * - appendProgress does not change task status
 * - appendProgress on nonexistent task is safe (no-throw)
 * - POST /api/task/:id/result with progress=true appends to progressLog
 * - POST /api/task/:id/result with progress=true does NOT mark task done
 * - POST /api/task/:id/result without progress falls through to report
 * - 404 / 503 error handling on progress endpoint
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const TaskQueue = require('../src/gateway/task-queue');

const testOutputDir = path.join(__dirname, '../temp/tasks-progress-test');
const testPersistPath = path.join(__dirname, '../temp/tasks-progress-test/test-queue.json');

// ─── Helper: HTTP request to test server ────────────────────────
function req(server, method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// ─── Helper: create Express app with progress endpoint ──────────
function createApp(taskQueue) {
  const app = express();
  app.use(express.json());

  app.post('/api/task', (req, res) => {
    if (!taskQueue) return res.status(503).json({ error: 'Task system not initialized' });
    const { action, params } = req.body;
    if (!action) return res.status(400).json({ error: 'Missing action' });
    const result = taskQueue.enqueue({ action, params: params || {} });
    res.json(result);
  });

  app.get('/api/task/:id', (req, res) => {
    if (!taskQueue) return res.status(503).json({ error: 'Task system not initialized' });
    const task = taskQueue.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  app.post('/api/task/:id/result', (req, res) => {
    if (!taskQueue) return res.status(503).json({ error: 'Task system not initialized' });
    const task = taskQueue.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (req.body.progress) {
      taskQueue.appendProgress(req.params.id, req.body.message || '');
      return res.json({ received: true });
    }

    // Non-progress: mark done
    taskQueue.updateStatus(req.params.id, 'done', { success: req.body.success, message: req.body.message });
    res.json({ success: true, taskId: req.params.id, status: 'done' });
  });

  return app;
}

// ─── TaskQueue unit tests ───────────────────────────────────────

describe('TaskQueue progressLog', () => {
  let tq;

  beforeEach(() => {
    tq = new TaskQueue({ taskOutputDir: testOutputDir, _persistPath: testPersistPath });
  });

  afterAll(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  test('new task has empty progressLog array', () => {
    const { taskId } = tq.enqueue({ action: 'test' });
    const task = tq.getTask(taskId);
    expect(task.progressLog).toEqual([]);
  });

  test('appendProgress adds entries with message and timestamp', () => {
    const { taskId } = tq.enqueue({ action: 'long-job' });
    tq.appendProgress(taskId, 'Step 1 done');
    tq.appendProgress(taskId, 'Step 2 done');

    const task = tq.getTask(taskId);
    expect(task.progressLog).toHaveLength(2);
    expect(task.progressLog[0].message).toBe('Step 1 done');
    expect(task.progressLog[1].message).toBe('Step 2 done');
    expect(task.progressLog[0].timestamp).toBeTruthy();
    expect(task.progressLog[1].timestamp).toBeTruthy();
  });

  test('appendProgress does not change task status', () => {
    const { taskId } = tq.enqueue({ action: 'long-job' });
    tq.appendProgress(taskId, 'progress');
    expect(tq.getTask(taskId).status).toBe('queued');
  });

  test('appendProgress on nonexistent task does not throw', () => {
    expect(() => tq.appendProgress('nonexistent', 'msg')).not.toThrow();
  });

  test('appendProgress initializes progressLog if missing (legacy tasks)', () => {
    const { taskId } = tq.enqueue({ action: 'legacy' });
    // Simulate a legacy task without progressLog
    const task = tq.getTask(taskId);
    delete task.progressLog;

    tq.appendProgress(taskId, 'first');
    expect(task.progressLog).toHaveLength(1);
    expect(task.progressLog[0].message).toBe('first');
  });
});

// ─── HTTP endpoint tests ────────────────────────────────────────

describe('POST /api/task/:id/result progress endpoint', () => {
  let tq, app, server;

  beforeAll((done) => {
    tq = new TaskQueue({ taskOutputDir: testOutputDir, _persistPath: testPersistPath });
    app = createApp(tq);
    server = app.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  test('progress=true appends to progressLog and returns received:true', async () => {
    const submit = await req(server, 'POST', '/api/task', { action: 'long-job' });
    const taskId = submit.body.taskId;

    const r = await req(server, 'POST', `/api/task/${taskId}/result`, {
      progress: true,
      message: 'Step 1 complete',
    });

    expect(r.status).toBe(200);
    expect(r.body.received).toBe(true);
  });

  test('task remains queued after progress update', async () => {
    const submit = await req(server, 'POST', '/api/task', { action: 'long-job' });
    const taskId = submit.body.taskId;

    await req(server, 'POST', `/api/task/${taskId}/result`, {
      progress: true,
      message: 'working...',
    });

    const check = await req(server, 'GET', `/api/task/${taskId}`);
    expect(check.body.status).toBe('queued');
  });

  test('progressLog accumulates multiple updates', async () => {
    const submit = await req(server, 'POST', '/api/task', { action: 'multi-step' });
    const taskId = submit.body.taskId;

    await req(server, 'POST', `/api/task/${taskId}/result`, { progress: true, message: 'Step 1' });
    await req(server, 'POST', `/api/task/${taskId}/result`, { progress: true, message: 'Step 2' });
    await req(server, 'POST', `/api/task/${taskId}/result`, { progress: true, message: 'Step 3' });

    const check = await req(server, 'GET', `/api/task/${taskId}`);
    expect(check.body.progressLog).toHaveLength(3);
    expect(check.body.progressLog[0].message).toBe('Step 1');
    expect(check.body.progressLog[2].message).toBe('Step 3');
  });

  test('progress=false (or absent) marks task done', async () => {
    const submit = await req(server, 'POST', '/api/task', { action: 'quick-job' });
    const taskId = submit.body.taskId;

    const r = await req(server, 'POST', `/api/task/${taskId}/result`, {
      success: true,
      message: 'All done',
    });

    expect(r.body.status).toBe('done');
    const check = await req(server, 'GET', `/api/task/${taskId}`);
    expect(check.body.status).toBe('done');
  });

  test('404 for nonexistent task', async () => {
    const r = await req(server, 'POST', '/api/task/nonexistent/result', {
      progress: true,
      message: 'nope',
    });
    expect(r.status).toBe(404);
  });

  test('503 when task system not initialized', async () => {
    const noApp = createApp(null);
    const noServer = noApp.listen(0);
    try {
      const r = await req(noServer, 'POST', '/api/task/any/result', {
        progress: true,
        message: 'x',
      });
      expect(r.status).toBe(503);
    } finally {
      await new Promise((resolve) => noServer.close(resolve));
    }
  });
});
