/**
 * TaskQueueSQLite unit tests
 * Drop-in replacement for TaskQueue — same API, SQLite backend
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const TaskQueueSQLite = require('./task-queue-sqlite');

const testOutputDir = path.join(__dirname, '../../temp/tasks-sqlite-test');
const testDbPath = path.join(__dirname, '../../temp/test-queue.db');
const testJsonPath = path.join(__dirname, '../../temp/test-migrate.json');

function cleanup() {
  for (const p of [testOutputDir]) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  for (const p of [testDbPath, testJsonPath, testJsonPath + '.migrated']) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function run() {
  cleanup();
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) { passed++; console.log(`  ✅ ${msg}`); }
    else { failed++; console.error(`  ❌ ${msg}`); }
  }

  // ── enqueue ────────────────────────────────────────────
  console.log('\n[enqueue]');
  // Use _jsonPath to avoid touching real task-queue.json during tests
  const q = new TaskQueueSQLite({ dbPath: testDbPath, taskOutputDir: testOutputDir, _jsonPath: testJsonPath });
  const res = q.enqueue({ type: 'layer1', action: 'crawl', params: { url: 'https://example.com' } });
  assert(res.taskId && res.taskId.startsWith('task-'), 'taskId starts with task-');
  assert(/^task-\d{8}-\d{6}-[0-9a-f]{3}$/.test(res.taskId), `taskId format correct: ${res.taskId}`);
  assert(res.status === 'queued', 'status is queued');

  // ── getTask ────────────────────────────────────────────
  console.log('\n[getTask]');
  const task = q.getTask(res.taskId);
  assert(task !== null, 'getTask returns task');
  assert(task.action === 'crawl', 'action is crawl');
  assert(task.type === 'layer1', 'type is layer1');
  assert(task.notify === 'wa', 'default notify is wa');
  assert(task.priority === 'normal', 'default priority is normal');
  assert(task.timeout === 300, 'default timeout is 300');
  assert(task.completedAt === null, 'completedAt is null');
  assert(task.result === null, 'result is null');
  assert(task.params.url === 'https://example.com', 'params parsed correctly');
  assert(q.getTask('nonexistent') === null, 'nonexistent returns null');

  // ── listTasks ──────────────────────────────────────────
  console.log('\n[listTasks]');
  q.enqueue({ action: 'pdf-to-md', params: {} });
  q.enqueue({ action: 'tts', params: { text: 'hello' } });
  const list = q.listTasks();
  assert(list.length === 3, `listTasks returns 3 tasks (got ${list.length})`);
  assert(new Date(list[0].createdAt) >= new Date(list[1].createdAt), 'reverse chronological order');
  const limited = q.listTasks(2);
  assert(limited.length === 2, 'limit works');

  // ── updateStatus ───────────────────────────────────────
  console.log('\n[updateStatus]');
  q.updateStatus(res.taskId, 'running');
  assert(q.getTask(res.taskId).status === 'running', 'status updated to running');
  assert(q.getTask(res.taskId).completedAt === null, 'completedAt still null while running');

  const result = { success: true, outputPath: '/tmp/out.md', message: 'done' };
  q.updateStatus(res.taskId, 'done', result);
  const doneTask = q.getTask(res.taskId);
  assert(doneTask.status === 'done', 'status updated to done');
  assert(doneTask.completedAt !== null, 'completedAt set on done');
  assert(doneTask.result.success === true, 'result attached');

  // ── saveResult ─────────────────────────────────────────
  console.log('\n[saveResult]');
  q.saveResult(res.taskId);
  const dirs = fs.readdirSync(testOutputDir);
  assert(dirs.length > 0, 'output directory created');
  const jsonFile = fs.readdirSync(path.join(testOutputDir, dirs[0]))[0];
  assert(jsonFile.endsWith('.json'), 'JSON file created');
  const saved = JSON.parse(fs.readFileSync(path.join(testOutputDir, dirs[0], jsonFile), 'utf-8'));
  assert(saved.taskId === res.taskId, 'saved JSON has correct taskId');
  assert(saved.status === 'done', 'saved JSON has correct status');

  // ── dequeueForWorker ───────────────────────────────────
  console.log('\n[dequeueForWorker]');
  const next = q.dequeueForWorker();
  assert(next !== null, 'dequeueForWorker returns a queued task');
  assert(next.status === 'queued', 'returned task is queued');

  // ── dequeueForWorker priority ──────────────────────────
  console.log('\n[dequeueForWorker priority]');
  const q2 = new TaskQueueSQLite({ dbPath: ':memory:', taskOutputDir: testOutputDir, _jsonPath: testJsonPath });
  q2.enqueue({ action: 'low-task', priority: 'low' });
  q2.enqueue({ action: 'high-task', priority: 'high' });
  q2.enqueue({ action: 'normal-task', priority: 'normal' });
  const first = q2.dequeueForWorker();
  assert(first.action === 'high-task', `high priority dequeued first (got ${first.action})`);
  q2.updateStatus(first.taskId, 'running');
  const second = q2.dequeueForWorker();
  assert(second.action === 'normal-task', `normal priority dequeued second (got ${second.action})`);
  q2.destroy();

  // ── defaults ───────────────────────────────────────────
  console.log('\n[defaults]');
  const q3 = new TaskQueueSQLite({ dbPath: ':memory:', _jsonPath: testJsonPath });
  const res3 = q3.enqueue({ action: 'test' });
  const t3 = q3.getTask(res3.taskId);
  assert(t3.type === 'layer1', 'default type is layer1');
  assert(Array.isArray(t3.tags) && t3.tags.length === 0, 'default tags is empty array');
  assert(t3.workerId === null, 'default workerId is null');
  assert(t3.assignedTo === null, 'default assignedTo is null');
  assert(Array.isArray(t3.progressLog), 'progressLog is array');
  assert(t3.progressLog.length === 0, 'progressLog starts empty');
  assert(t3.retryCount === 0, 'default retryCount is 0');
  assert(t3.maxRetries === 3, 'default maxRetries is 3');
  q3.destroy();

  // ── appendProgress ─────────────────────────────────────
  console.log('\n[appendProgress]');
  const q4 = new TaskQueueSQLite({ dbPath: ':memory:', taskOutputDir: testOutputDir, _jsonPath: testJsonPath });
  const rp = q4.enqueue({ action: 'long-task', params: {} });
  q4.appendProgress(rp.taskId, 'Step 1 done');
  q4.appendProgress(rp.taskId, 'Step 2 done');
  const tp = q4.getTask(rp.taskId);
  assert(tp.progressLog.length === 2, `progressLog has 2 entries (got ${tp.progressLog.length})`);
  assert(tp.progressLog[0].message === 'Step 1 done', 'first progress message correct');
  assert(tp.progressLog[1].message === 'Step 2 done', 'second progress message correct');
  assert(tp.progressLog[0].timestamp, 'progress entry has timestamp');
  assert(tp.status === 'queued', 'status unchanged after progress');
  q4.appendProgress('nonexistent-id', 'should not throw');
  assert(true, 'appendProgress on nonexistent task does not throw');
  q4.destroy();

  // ── _schedulePersist compatibility ─────────────────────
  console.log('\n[_schedulePersist compatibility]');
  const q5 = new TaskQueueSQLite({ dbPath: ':memory:', _jsonPath: testJsonPath });
  q5._schedulePersist(); // should be no-op, not throw
  assert(true, '_schedulePersist is a no-op (no throw)');
  q5.destroy();

  // ── shared DB connection ───────────────────────────────
  console.log('\n[shared DB connection]');
  const sharedDb = new Database(':memory:');
  sharedDb.pragma('journal_mode = WAL');
  const q6 = new TaskQueueSQLite({ db: sharedDb, taskOutputDir: testOutputDir, _jsonPath: testJsonPath });
  const res6 = q6.enqueue({ action: 'shared-test' });
  assert(q6.getTask(res6.taskId).action === 'shared-test', 'works with shared DB');
  // Verify table exists in shared DB
  const tableCheck = sharedDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='exec_tasks'"
  ).get();
  assert(tableCheck !== undefined, 'exec_tasks table created in shared DB');
  q6.destroy();
  // Shared DB should NOT be closed by destroy
  const stillOpen = sharedDb.prepare('SELECT 1').get();
  assert(stillOpen !== undefined, 'shared DB not closed by destroy');
  sharedDb.close();

  // ── reset running tasks on startup ─────────────────────
  console.log('\n[reset running tasks]');
  const db7 = new Database(':memory:');
  db7.pragma('journal_mode = WAL');
  const q7a = new TaskQueueSQLite({ db: db7, _jsonPath: testJsonPath });
  const r7 = q7a.enqueue({ action: 'will-be-running' });
  q7a.updateStatus(r7.taskId, 'running');
  assert(q7a.getTask(r7.taskId).status === 'running', 'task is running before restart');
  // Simulate restart: create new instance on same DB
  const q7b = new TaskQueueSQLite({ db: db7, _jsonPath: testJsonPath });
  assert(q7b.getTask(r7.taskId).status === 'queued', 'running task reset to queued after restart');
  q7b.destroy();
  db7.close();

  // ── JSON migration ─────────────────────────────────────
  console.log('\n[JSON migration]');
  // Create a fake JSON queue file
  const migrateTasks = [
    { taskId: 'task-20260101-120000-abc', type: 'layer1', action: 'crawl',
      params: { url: 'https://test.com' }, notify: 'wa', priority: 'normal',
      timeout: 300, status: 'queued', createdAt: '2026-01-01T12:00:00.000Z',
      progressLog: [{ message: 'started', timestamp: '2026-01-01T12:00:01.000Z' }],
      retryCount: 0, maxRetries: 3, tags: ['test'] },
    { taskId: 'task-20260101-120001-def', type: 'layer2', action: 'tts',
      params: { text: 'hello' }, notify: 'silent', priority: 'high',
      timeout: 60, status: 'done', createdAt: '2026-01-01T12:00:01.000Z',
      completedAt: '2026-01-01T12:00:05.000Z',
      result: { success: true, message: 'ok' },
      progressLog: [], retryCount: 0, maxRetries: 3, tags: [] },
  ];
  const tempDir = path.dirname(testJsonPath);
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(testJsonPath, JSON.stringify(migrateTasks), 'utf-8');

  const migrateDbPath = path.join(tempDir, 'test-migrate.db');
  if (fs.existsSync(migrateDbPath)) fs.unlinkSync(migrateDbPath);
  const q8 = new TaskQueueSQLite({ dbPath: migrateDbPath, _jsonPath: testJsonPath });
  const migrated1 = q8.getTask('task-20260101-120000-abc');
  assert(migrated1 !== null, 'migrated task 1 exists');
  assert(migrated1.action === 'crawl', 'migrated task 1 action correct');
  assert(migrated1.params.url === 'https://test.com', 'migrated task 1 params parsed');
  assert(migrated1.progressLog.length === 1, 'migrated task 1 progressLog preserved');
  assert(migrated1.tags.length === 1 && migrated1.tags[0] === 'test', 'migrated task 1 tags preserved');
  const migrated2 = q8.getTask('task-20260101-120001-def');
  assert(migrated2 !== null, 'migrated task 2 exists');
  assert(migrated2.status === 'done', 'migrated task 2 status preserved');
  assert(migrated2.result.success === true, 'migrated task 2 result preserved');
  assert(!fs.existsSync(testJsonPath), 'original JSON file renamed');
  assert(fs.existsSync(testJsonPath + '.migrated'), 'backup .migrated file created');
  q8.destroy();
  if (fs.existsSync(migrateDbPath)) fs.unlinkSync(migrateDbPath);

  // ── cancelled status ───────────────────────────────────
  console.log('\n[cancelled status]');
  const q9 = new TaskQueueSQLite({ dbPath: ':memory:', _jsonPath: testJsonPath });
  const r9 = q9.enqueue({ action: 'cancel-me' });
  q9.updateStatus(r9.taskId, 'cancelled');
  const cancelled = q9.getTask(r9.taskId);
  assert(cancelled.status === 'cancelled', 'status is cancelled');
  assert(cancelled.completedAt !== null, 'completedAt set on cancelled');
  q9.destroy();

  // ── empty dequeue ──────────────────────────────────────
  console.log('\n[empty dequeue]');
  const q10 = new TaskQueueSQLite({ dbPath: ':memory:', _jsonPath: testJsonPath });
  assert(q10.dequeueForWorker() === null, 'dequeueForWorker returns null when empty');
  q10.destroy();

  // ── summary ────────────────────────────────────────────
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  q.destroy(); // close DB before cleanup
  try { cleanup(); } catch (e) { /* ignore EBUSY on Windows */ }
  process.exit(failed > 0 ? 1 : 0);
}

run();
