/**
 * Unit tests for POST /api/workers/:id/reset endpoint
 * Tests: success, 503 when registry not initialized
 */
const http = require('http');
const express = require('express');

function createTestApp(workerRegistry = null) {
  const app = express();
  app.use(express.json());

  app.post('/api/workers/:id/reset', (req, res) => {
    if (!workerRegistry) {
      return res.status(503).json({ error: 'Worker registry not initialized' });
    }
    const workerId = req.params.id;
    workerRegistry.markIdle(workerId);
    res.json({ success: true, workerId, status: 'idle' });
  });

  return app;
}

function request(server, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
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

async function run() {
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) { passed++; console.log(`  ✅ ${msg}`); }
    else { failed++; console.error(`  ❌ ${msg}`); }
  }

  // --- 503 when workerRegistry is null ---
  console.log('\n[503 — Worker registry not initialized]');
  const app503 = createTestApp(null);
  const server503 = app503.listen(0);
  try {
    const r = await request(server503, 'POST', '/api/workers/worker-1/reset');
    assert(r.status === 503, `POST /api/workers/:id/reset → 503 (got ${r.status})`);
    assert(r.body.error === 'Worker registry not initialized', 'correct error message');
  } finally {
    server503.close();
  }

  // --- Success: markIdle called and correct response ---
  console.log('\n[200 — Reset worker success]');
  let markedWorkerId = null;
  const mockRegistry = {
    markIdle(id) { markedWorkerId = id; },
  };
  const app = createTestApp(mockRegistry);
  const server = app.listen(0);
  try {
    const r = await request(server, 'POST', '/api/workers/worker-1/reset');
    assert(r.status === 200, `POST /api/workers/worker-1/reset → 200 (got ${r.status})`);
    assert(r.body.success === true, 'response.success is true');
    assert(r.body.workerId === 'worker-1', 'response.workerId matches');
    assert(r.body.status === 'idle', 'response.status is idle');
    assert(markedWorkerId === 'worker-1', 'markIdle was called with correct workerId');

    // Test with different worker ID
    const r2 = await request(server, 'POST', '/api/workers/worker-99/reset');
    assert(r2.status === 200, `POST /api/workers/worker-99/reset → 200 (got ${r2.status})`);
    assert(r2.body.workerId === 'worker-99', 'response.workerId matches worker-99');
    assert(markedWorkerId === 'worker-99', 'markIdle called with worker-99');
  } finally {
    server.close();
  }

  // --- Summary ---
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
