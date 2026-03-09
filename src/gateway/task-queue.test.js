/**
 * TaskQueue unit tests
 */
const path = require('path');
const fs = require('fs');
const TaskQueue = require('./task-queue');

// Use a temp dir for test output
const testOutputDir = path.join(__dirname, '../../temp/tasks-test');
const testPersistPath = path.join(__dirname, '../../temp/tasks-test/test-queue.json');

function cleanup() {
  if (fs.existsSync(testOutputDir)) {
    fs.rmSync(testOutputDir, { recursive: true, force: true });
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

  // --- enqueue ---
  console.log('\n[enqueue]');
  const q = new TaskQueue({ taskOutputDir: testOutputDir, _persistPath: testPersistPath });
  const res = q.enqueue({ type: 'layer1', action: 'crawl', params: { url: 'https://example.com' } });
  assert(res.taskId && res.taskId.startsWith('task-'), 'taskId starts with task-');
  assert(/^task-\d{8}-\d{6}-[0-9a-f]{3}$/.test(res.taskId), `taskId format correct: ${res.taskId}`);
  assert(res.status === 'queued', 'status is queued');

  // --- getTask ---
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
  assert(q.getTask('nonexistent') === null, 'nonexistent returns null');

  // --- listTasks ---
  console.log('\n[listTasks]');
  q.enqueue({ action: 'pdf-to-md', params: {} });
  q.enqueue({ action: 'tts', params: { text: 'hello' } });
  const list = q.listTasks();
  assert(list.length === 3, `listTasks returns 3 tasks (got ${list.length})`);
  assert(new Date(list[0].createdAt) >= new Date(list[1].createdAt), 'reverse chronological order');
  const limited = q.listTasks(2);
  assert(limited.length === 2, 'limit works');

  // --- updateStatus ---
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

  // --- saveResult ---
  console.log('\n[saveResult]');
  q.saveResult(res.taskId);
  const files = fs.readdirSync(testOutputDir, { recursive: true });
  assert(files.length > 0, 'output directory created with files');
  const jsonFile = fs.readdirSync(path.join(testOutputDir, fs.readdirSync(testOutputDir)[0]))[0];
  assert(jsonFile.endsWith('.json'), 'JSON file created');
  const saved = JSON.parse(fs.readFileSync(path.join(testOutputDir, fs.readdirSync(testOutputDir)[0], jsonFile), 'utf-8'));
  assert(saved.taskId === res.taskId, 'saved JSON has correct taskId');
  assert(saved.status === 'done', 'saved JSON has correct status');

  // --- dequeueForWorker ---
  console.log('\n[dequeueForWorker]');
  const next = q.dequeueForWorker();
  assert(next !== null, 'dequeueForWorker returns a queued task');
  assert(next.status === 'queued', 'returned task is queued');

  // --- defaults ---
  console.log('\n[defaults]');
  const q2 = new TaskQueue({ _persistPath: testPersistPath });
  assert(q2.outputDir.includes('temp'), 'default outputDir contains temp');
  const res2 = q2.enqueue({ action: 'test' });
  const t2 = q2.getTask(res2.taskId);
  assert(t2.type === 'layer1', 'default type is layer1');
  assert(t2.tags.length === 0, 'default tags is empty array');
  assert(t2.workerId === null, 'default workerId is null');
  assert(t2.assignedTo === null, 'default assignedTo is null');
  assert(Array.isArray(t2.progressLog), 'progressLog is array');
  assert(t2.progressLog.length === 0, 'progressLog starts empty');

  // --- appendProgress ---
  console.log('\n[appendProgress]');
  const qp = new TaskQueue({ taskOutputDir: testOutputDir, _persistPath: testPersistPath });
  const rp = qp.enqueue({ action: 'long-task', params: {} });
  qp.appendProgress(rp.taskId, 'Step 1 done');
  qp.appendProgress(rp.taskId, 'Step 2 done');
  const tp = qp.getTask(rp.taskId);
  assert(tp.progressLog.length === 2, `progressLog has 2 entries (got ${tp.progressLog.length})`);
  assert(tp.progressLog[0].message === 'Step 1 done', 'first progress message correct');
  assert(tp.progressLog[1].message === 'Step 2 done', 'second progress message correct');
  assert(tp.progressLog[0].timestamp, 'progress entry has timestamp');
  assert(tp.status === 'queued', 'status unchanged after progress');
  qp.appendProgress('nonexistent-id', 'should not throw');
  assert(true, 'appendProgress on nonexistent task does not throw');

  // --- summary ---
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

run();
