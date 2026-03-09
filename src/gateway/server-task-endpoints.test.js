/**
 * Unit tests for Task Dispatch Express Endpoints (Task 4)
 * Tests: POST /api/task, GET /api/task/:id, GET /api/tasks
 * Error handling: 400, 404, 503
 */
const http = require('http');
const express = require('express');

// Minimal mock of MessageGateway to test only the task endpoints
function createTestApp(taskExecutor = null) {
  const app = express();
  app.use(express.json());

  // Simulate the task endpoints exactly as in server.js
  app.post('/api/task', async (req, res) => {
    try {
      if (!taskExecutor || !taskExecutor.taskQueue) {
        return res.status(503).json({ error: 'Task system not initialized' });
      }
      const { type, action, params } = req.body;
      if (!action) {
        return res.status(400).json({ error: 'Missing required field: action' });
      }
      const result = await taskExecutor.submitTask(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/task/:id', (req, res) => {
    if (!taskExecutor || !taskExecutor.taskQueue) {
      return res.status(503).json({ error: 'Task system not initialized' });
    }
    const task = taskExecutor.taskQueue.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  app.get('/api/tasks', (req, res) => {
    if (!taskExecutor || !taskExecutor.taskQueue) {
      return res.status(503).json({ error: 'Task system not initialized' });
    }
    const limit = parseInt(req.query.limit) || 20;
    res.json(taskExecutor.taskQueue.listTasks(limit));
  });

  return app;
}

function request(server, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const opts = { hostname: '127.0.0.1', port: addr.port, path, method, headers: { 'Content-Type': 'application/json' } };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Mock taskQueue
function mockTaskQueue() {
  const tasks = new Map();
  let counter = 0;
  return {
    enqueue(def) {
      counter++;
      const taskId = `task-test-${counter}`;
      const task = { taskId, status: 'queued', action: def.action, params: def.params || {}, createdAt: new Date().toISOString() };
      tasks.set(taskId, task);
      return task;
    },
    getTask(id) { return tasks.get(id) || null; },
    listTasks(limit = 20) { return [...tasks.values()].slice(0, limit); }
  };
}

// Mock taskExecutor
function mockTaskExecutor() {
  const tq = mockTaskQueue();
  return {
    taskQueue: tq,
    submitTask(def) {
      const task = tq.enqueue(def);
      return { taskId: task.taskId, status: 'queued' };
    }
  };
}

async function run() {
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) { passed++; console.log(`  ✅ ${msg}`); }
    else { failed++; console.error(`  ❌ ${msg}`); }
  }

  // --- 503 when taskExecutor is null ---
  console.log('\n[503 — Task system not initialized]');
  const app503 = createTestApp(null);
  const server503 = app503.listen(0);
  try {
    let r = await request(server503, 'POST', '/api/task', { action: 'test' });
    assert(r.status === 503, `POST /api/task → 503 (got ${r.status})`);
    assert(r.body.error === 'Task system not initialized', 'correct error message');

    r = await request(server503, 'GET', '/api/task/some-id');
    assert(r.status === 503, `GET /api/task/:id → 503 (got ${r.status})`);

    r = await request(server503, 'GET', '/api/tasks');
    assert(r.status === 503, `GET /api/tasks → 503 (got ${r.status})`);
  } finally {
    server503.close();
  }

  // --- 400 missing action ---
  console.log('\n[400 — Missing action]');
  const exec400 = mockTaskExecutor();
  const app400 = createTestApp(exec400);
  const server400 = app400.listen(0);
  try {
    let r = await request(server400, 'POST', '/api/task', { type: 'layer1', params: {} });
    assert(r.status === 400, `POST without action → 400 (got ${r.status})`);
    assert(r.body.error === 'Missing required field: action', 'correct error message');

    r = await request(server400, 'POST', '/api/task', {});
    assert(r.status === 400, `POST empty body → 400 (got ${r.status})`);
  } finally {
    server400.close();
  }

  // --- POST /api/task success ---
  console.log('\n[POST /api/task — success]');
  const exec = mockTaskExecutor();
  const app = createTestApp(exec);
  const server = app.listen(0);
  try {
    const r = await request(server, 'POST', '/api/task', { type: 'layer1', action: 'crawl', params: { url: 'https://example.com' } });
    assert(r.status === 200, `POST /api/task → 200 (got ${r.status})`);
    assert(r.body.taskId && r.body.taskId.startsWith('task-'), 'returns taskId');
    assert(r.body.status === 'queued', 'status is queued');

    // --- GET /api/task/:id success ---
    console.log('\n[GET /api/task/:id — success]');
    const r2 = await request(server, 'GET', `/api/task/${r.body.taskId}`);
    assert(r2.status === 200, `GET /api/task/:id → 200 (got ${r2.status})`);
    assert(r2.body.taskId === r.body.taskId, 'correct taskId returned');
    assert(r2.body.action === 'crawl', 'correct action');

    // --- GET /api/task/:id 404 ---
    console.log('\n[GET /api/task/:id — 404]');
    const r3 = await request(server, 'GET', '/api/task/nonexistent-id');
    assert(r3.status === 404, `GET unknown id → 404 (got ${r3.status})`);
    assert(r3.body.error === 'Task not found', 'correct error message');

    // --- GET /api/tasks ---
    console.log('\n[GET /api/tasks — list]');
    // Submit another task
    await request(server, 'POST', '/api/task', { action: 'tts', params: { text: 'hi' } });
    const r4 = await request(server, 'GET', '/api/tasks');
    assert(r4.status === 200, `GET /api/tasks → 200 (got ${r4.status})`);
    assert(Array.isArray(r4.body), 'returns array');
    assert(r4.body.length === 2, `2 tasks in list (got ${r4.body.length})`);

    // --- GET /api/tasks with limit ---
    console.log('\n[GET /api/tasks — limit]');
    const r5 = await request(server, 'GET', '/api/tasks?limit=1');
    assert(r5.status === 200, `GET /api/tasks?limit=1 → 200`);
    assert(r5.body.length === 1, `limit=1 returns 1 task (got ${r5.body.length})`);

    // --- 500 when submitTask throws ---
    console.log('\n[500 — submitTask error]');
    exec.submitTask = () => { throw new Error('Boom'); };
    const r6 = await request(server, 'POST', '/api/task', { action: 'fail' });
    assert(r6.status === 500, `POST error → 500 (got ${r6.status})`);
    assert(r6.body.error === 'Boom', 'error message preserved');
  } finally {
    server.close();
  }

  // --- Summary ---
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
