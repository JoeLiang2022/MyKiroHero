/**
 * TaskExecutor unit tests — Task Dispatch functionality
 * Tests: constructor, loadPluginHandlers, submitTask, executeTask, notifyCompletion, error handling
 */
const path = require('path');
const fs = require('fs');
const TaskQueue = require('./task-queue');
const TaskExecutor = require('./task-executor');

const testOutputDir = path.join(__dirname, '../../temp/tasks-test-executor');
const testPersistPath = path.join(__dirname, '../../temp/tasks-test-executor/test-queue.json');

function cleanup() {
  if (fs.existsSync(testOutputDir)) {
    fs.rmSync(testOutputDir, { recursive: true, force: true });
  }
}

// Mock gateway
function mockGateway() {
  const calls = [];
  return {
    calls,
    sendDirectReply: async (channel, chatId, msg) => {
      calls.push({ method: 'sendDirectReply', channel, chatId, msg });
    },
    sendMedia: async (channel, chatId, filePath, caption) => {
      calls.push({ method: 'sendMedia', channel, chatId, filePath, caption });
    },
    triggerHeartbeat: async (msg) => {
      calls.push({ method: 'triggerHeartbeat', msg });
    },
    _notifyCommander: (msg) => {
      calls.push({ method: '_notifyCommander', msg });
    }
  };
}

const baseConfig = { ownerChatId: '886912345678@c.us', taskOutputDir: testOutputDir };

async function run() {
  cleanup();
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) { passed++; console.log(`  ✅ ${msg}`); }
    else { failed++; console.error(`  ❌ ${msg}`); }
  }

  // --- Constructor ---
  console.log('\n[constructor]');
  const gw1 = mockGateway();
  const ex1 = new TaskExecutor(gw1, baseConfig);
  assert(ex1.executors instanceof Map, 'executors is a Map');
  assert(ex1.taskHandlers instanceof Map, 'taskHandlers is a Map');
  assert(ex1.taskQueue === null, 'taskQueue is null when not passed');
  assert(ex1.executors.size === 2, 'builtin heartbeat tasks registered');

  console.log('\n[constructor with taskQueue]');
  const q2 = new TaskQueue({ taskOutputDir: testOutputDir, _persistPath: testPersistPath });
  const gw2 = mockGateway();
  const ex2 = new TaskExecutor(gw2, baseConfig, q2);
  assert(ex2.taskQueue === q2, 'taskQueue set when passed');
  // loadPluginHandlers called — taskHandlers may have entries if tasks/ has handlers

  // --- loadPluginHandlers ---
  console.log('\n[loadPluginHandlers]');
  const q3 = new TaskQueue({ taskOutputDir: testOutputDir, _persistPath: testPersistPath });
  const gw3 = mockGateway();
  const ex3 = new TaskExecutor(gw3, baseConfig, q3);
  // taskHandlers should be loaded (even if 0 handlers in tasks/ dir)
  assert(ex3.taskHandlers instanceof Map, 'taskHandlers loaded');

  // --- submitTask ---
  console.log('\n[submitTask]');
  // Manually register a test handler
  ex3.taskHandlers.set('test-action', {
    name: 'test-action',
    execute: async (params) => ({
      success: true,
      outputPath: '/tmp/test-output.md',
      message: `Processed: ${params.input}`
    })
  });

  const submitResult = await ex3.submitTask({
    type: 'layer1',
    action: 'test-action',
    params: { input: 'hello' },
    notify: 'silent'
  });
  assert(submitResult.taskId && submitResult.taskId.startsWith('task-'), 'submitTask returns taskId');
  assert(submitResult.status === 'queued', 'submitTask returns queued status');

  // Wait a tick for async execution
  await new Promise(r => setTimeout(r, 100));
  const task = q3.getTask(submitResult.taskId);
  assert(task.status === 'done', 'task executed and status is done');
  assert(task.result.success === true, 'task result is success');
  assert(task.result.message === 'Processed: hello', 'task result message correct');
  assert(typeof task.result.duration === 'number', 'duration recorded');

  // --- submitTask without taskQueue ---
  console.log('\n[submitTask without taskQueue]');
  const exNoQueue = new TaskExecutor(mockGateway(), baseConfig);
  let threwError = false;
  try {
    await exNoQueue.submitTask({ action: 'test' });
  } catch (e) {
    threwError = true;
    assert(e.message === 'TaskQueue not initialized', 'correct error message');
  }
  assert(threwError, 'throws when taskQueue not initialized');

  // --- executeTask with unknown action ---
  console.log('\n[executeTask unknown action]');
  const q4 = new TaskQueue({ taskOutputDir: testOutputDir, _persistPath: testPersistPath });
  const gw4 = mockGateway();
  const ex4 = new TaskExecutor(gw4, baseConfig, q4);
  const { taskId: unknownId } = q4.enqueue({ action: 'nonexistent', params: {} });
  const unknownTask = q4.getTask(unknownId);
  await ex4.executeTask(unknownTask);
  assert(q4.getTask(unknownId).status === 'failed', 'unknown action → failed');
  assert(q4.getTask(unknownId).result.message.includes('Unknown action'), 'error message mentions unknown action');
  assert(gw4.calls.length > 0, 'notifyError called for unknown action');
  assert(gw4.calls.some(c => c.method === '_notifyCommander'), 'notifyError uses _notifyCommander');

  // --- executeTask with handler error ---
  console.log('\n[executeTask handler error]');
  const q5 = new TaskQueue({ taskOutputDir: testOutputDir, _persistPath: testPersistPath });
  const gw5 = mockGateway();
  const ex5 = new TaskExecutor(gw5, baseConfig, q5);
  ex5.taskHandlers.set('fail-action', {
    name: 'fail-action',
    execute: async () => { throw new Error('Handler exploded'); }
  });
  const { taskId: failId } = q5.enqueue({ action: 'fail-action', params: {} });
  const failTask = q5.getTask(failId);
  await ex5.executeTask(failTask);
  assert(q5.getTask(failId).status === 'failed', 'handler error → failed');
  assert(q5.getTask(failId).result.message === 'Handler exploded', 'error message preserved');
  assert(gw5.calls.some(c => c.method === '_notifyCommander' && c.msg.includes('fail-action')), 'notifyError sent _notifyCommander for handler error');

  // --- notifyCompletion: silent ---
  console.log('\n[notifyCompletion silent]');
  const gw6 = mockGateway();
  const ex6 = new TaskExecutor(gw6, baseConfig);
  await ex6.notifyCompletion({ action: 'test', notify: 'silent' }, { outputPath: '/tmp/x' });
  assert(gw6.calls.length === 0, 'silent → no notification');

  // --- notifyCompletion: wa ---
  console.log('\n[notifyCompletion wa]');
  const gw7 = mockGateway();
  const ex7 = new TaskExecutor(gw7, baseConfig);
  await ex7.notifyCompletion(
    { action: 'crawl', notify: 'wa' },
    { outputPath: '/tmp/out.md', message: 'Done' }
  );
  assert(gw7.calls.length === 1, 'wa → one notification');
  assert(gw7.calls[0].method === 'sendDirectReply', 'wa uses sendDirectReply');
  assert(gw7.calls[0].msg.includes('crawl'), 'message includes action name');

  // --- notifyCompletion: wa+file ---
  console.log('\n[notifyCompletion wa+file]');
  const gw8 = mockGateway();
  const ex8 = new TaskExecutor(gw8, baseConfig);
  await ex8.notifyCompletion(
    { action: 'pdf-to-md', notify: 'wa+file' },
    { outputPath: '/tmp/doc.md', message: 'Converted' }
  );
  assert(gw8.calls.length === 1, 'wa+file → one notification');
  assert(gw8.calls[0].method === 'sendMedia', 'wa+file uses sendMedia');
  assert(gw8.calls[0].filePath === '/tmp/doc.md', 'sendMedia gets outputPath');

  // --- notifyCompletion: wa+file without outputPath falls back to text ---
  console.log('\n[notifyCompletion wa+file no outputPath]');
  const gw9 = mockGateway();
  const ex9 = new TaskExecutor(gw9, baseConfig);
  await ex9.notifyCompletion(
    { action: 'test', notify: 'wa+file' },
    { message: 'No file' }
  );
  assert(gw9.calls[0].method === 'sendDirectReply', 'wa+file without outputPath falls back to text');

  // --- notifyCompletion: no ownerChatId ---
  console.log('\n[notifyCompletion no ownerChatId]');
  const gw10 = mockGateway();
  const ex10 = new TaskExecutor(gw10, {});
  await ex10.notifyCompletion({ action: 'test', notify: 'wa' }, { outputPath: '/tmp/x' });
  assert(gw10.calls.length === 0, 'no ownerChatId → no notification');

  // --- Heartbeat still works ---
  console.log('\n[heartbeat preserved]');
  const gw11 = mockGateway();
  const ex11 = new TaskExecutor(gw11, baseConfig);
  assert(ex11.executors.has('記憶同步'), 'heartbeat: 記憶同步 registered');
  assert(ex11.executors.has('檢查 journal todo 提醒'), 'heartbeat: todo reminder registered');
  assert(typeof ex11.tryExecute === 'function', 'tryExecute still exists');
  const unknownResult = await ex11.tryExecute('不存在的任務');
  assert(unknownResult === false, 'tryExecute returns false for unknown task');

  // --- Result saved to disk ---
  console.log('\n[result saved to disk]');
  // submitResult from earlier test should have been saved
  const dateDir = fs.readdirSync(testOutputDir).find(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  assert(dateDir !== undefined, 'date directory created');
  if (dateDir) {
    const jsonFiles = fs.readdirSync(path.join(testOutputDir, dateDir)).filter(f => f.endsWith('.json'));
    assert(jsonFiles.length > 0, 'JSON result files saved');
  }

  // --- Summary ---
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

run();
