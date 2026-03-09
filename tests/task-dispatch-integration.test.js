/**
 * Task Dispatch Integration Tests
 * 
 * Tests the full flow: TaskQueue → TaskExecutor → Plugin Handlers → Result
 * Does NOT require running Gateway or external services.
 * 
 * Covers:
 * - dispatch_task flow (Layer 1 crawl, Layer 2 tts)
 * - WA notification (wa, wa+file, silent)
 * - check_task returns correct status
 * - task result JSON saved to disk
 * - heartbeat tasks still work alongside dispatch
 */

const path = require('path');
const fs = require('fs');
const TaskQueue = require('../src/gateway/task-queue');
const TaskExecutor = require('../src/gateway/task-executor');

const testOutputDir = path.join(__dirname, '../temp/tasks-integration-test');
const testPersistPath = path.join(__dirname, '../temp/tasks-integration-test/test-queue.json');

// Mock gateway that records all calls
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
    },
  };
}

const baseConfig = {
  ownerChatId: '886912345678@c.us',
  taskOutputDir: testOutputDir,
};

describe('Task Dispatch Integration', () => {
  let taskQueue, taskExecutor, gateway;

  beforeAll(() => {
    gateway = mockGateway();
    taskQueue = new TaskQueue({ taskOutputDir: testOutputDir, _persistPath: testPersistPath });
    taskExecutor = new TaskExecutor(gateway, baseConfig, taskQueue);
  });

  afterAll(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  // ─── Plugin handlers loaded ───────────────────────────────────

  test('plugin handlers are loaded (crawl, pdf-to-md, tts, image-gen)', () => {
    expect(taskExecutor.taskHandlers.size).toBeGreaterThanOrEqual(4);
    expect(taskExecutor.taskHandlers.has('crawl')).toBe(true);
    expect(taskExecutor.taskHandlers.has('pdf-to-md')).toBe(true);
    expect(taskExecutor.taskHandlers.has('tts')).toBe(true);
    expect(taskExecutor.taskHandlers.has('image-gen')).toBe(true);
  });

  // ─── Layer 1 crawl dispatch flow ─────────────────────────────

  describe('Layer 1 crawl dispatch', () => {
    let taskId;

    test('submitTask returns taskId and queued status', async () => {
      // Register a mock crawl handler to avoid real network calls
      taskExecutor.taskHandlers.set('crawl', {
        name: 'crawl',
        execute: async (params) => ({
          success: true,
          outputPath: path.join(testOutputDir, 'crawl-output.md'),
          message: `Crawled ${params.url}`,
        }),
      });

      const result = await taskExecutor.submitTask({
        type: 'layer1',
        action: 'crawl',
        params: { url: 'https://example.com' },
        notify: 'silent',
      });
      expect(result.taskId).toMatch(/^task-/);
      expect(result.status).toBe('queued');
      taskId = result.taskId;
    });

    test('check_task returns correct task object after execution', async () => {
      // Wait for async execution
      await new Promise(r => setTimeout(r, 200));

      const task = taskQueue.getTask(taskId);
      expect(task).not.toBeNull();
      expect(task.taskId).toBe(taskId);
      expect(task.action).toBe('crawl');
      expect(task.type).toBe('layer1');
      expect(task.status).toBe('done');
      expect(task.result.success).toBe(true);
      expect(task.result.message).toContain('example.com');
      expect(typeof task.result.duration).toBe('number');
      expect(task.completedAt).not.toBeNull();
    });
  });

  // ─── Layer 2 tts dispatch flow ────────────────────────────────

  describe('Layer 2 tts dispatch', () => {
    let taskId;

    test('submitTask for tts returns taskId', async () => {
      // Register a mock tts handler to avoid real LLM API calls
      taskExecutor.taskHandlers.set('tts', {
        name: 'tts',
        execute: async (params) => ({
          success: true,
          outputPath: path.join(testOutputDir, 'tts-output.ogg'),
          message: `Generated TTS: ${params.voice || 'Puck'}, 3.2s`,
        }),
      });

      const result = await taskExecutor.submitTask({
        type: 'layer2',
        action: 'tts',
        params: { text: 'Hello world', voice: 'Kore' },
        notify: 'silent',
      });
      expect(result.taskId).toMatch(/^task-/);
      expect(result.status).toBe('queued');
      taskId = result.taskId;
    });

    test('tts task completes with correct result', async () => {
      await new Promise(r => setTimeout(r, 200));

      const task = taskQueue.getTask(taskId);
      expect(task.status).toBe('done');
      expect(task.result.success).toBe(true);
      expect(task.result.message).toContain('Kore');
      expect(task.result.outputPath).toContain('tts-output.ogg');
    });
  });

  // ─── WA notification tests ────────────────────────────────────

  describe('WA notification', () => {
    beforeEach(() => {
      gateway.calls.length = 0; // reset recorded calls
    });

    test('notify: wa sends WhatsApp text message', async () => {
      taskExecutor.taskHandlers.set('test-wa', {
        name: 'test-wa',
        execute: async () => ({
          success: true,
          outputPath: '/tmp/test.md',
          message: 'done',
        }),
      });

      const { taskId } = taskQueue.enqueue({
        action: 'test-wa',
        params: {},
        notify: 'wa',
      });
      const task = taskQueue.getTask(taskId);
      await taskExecutor.executeTask(task);

      expect(gateway.calls.length).toBeGreaterThan(0);
      expect(gateway.calls[0].method).toBe('sendDirectReply');
      expect(gateway.calls[0].msg).toContain('test-wa');
      expect(gateway.calls[0].chatId).toBe('886912345678@c.us');
    });

    test('notify: wa+file sends media with file', async () => {
      // Create a real temp file so fs.existsSync passes
      const tmpFile = path.join(testOutputDir, 'test-media.pdf');
      fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
      fs.writeFileSync(tmpFile, 'fake pdf');

      taskExecutor.taskHandlers.set('test-file', {
        name: 'test-file',
        execute: async () => ({
          success: true,
          outputPath: tmpFile,
          message: 'converted',
        }),
      });

      const { taskId } = taskQueue.enqueue({
        action: 'test-file',
        params: {},
        notify: 'wa+file',
      });
      const task = taskQueue.getTask(taskId);
      await taskExecutor.executeTask(task);

      expect(gateway.calls.length).toBeGreaterThan(0);
      expect(gateway.calls[0].method).toBe('sendMedia');
      expect(gateway.calls[0].filePath).toBe(tmpFile);
    });

    test('notify: silent sends no notification', async () => {
      taskExecutor.taskHandlers.set('test-silent', {
        name: 'test-silent',
        execute: async () => ({
          success: true,
          outputPath: '/tmp/x',
          message: 'done',
        }),
      });

      const { taskId } = taskQueue.enqueue({
        action: 'test-silent',
        params: {},
        notify: 'silent',
      });
      const task = taskQueue.getTask(taskId);
      await taskExecutor.executeTask(task);

      expect(gateway.calls.length).toBe(0);
    });
  });

  // ─── check_task status correctness ────────────────────────────

  describe('check_task returns correct status', () => {
    test('queued task has status queued', () => {
      const { taskId } = taskQueue.enqueue({ action: 'crawl', params: { url: 'https://test.com' } });
      const task = taskQueue.getTask(taskId);
      expect(task.status).toBe('queued');
      expect(task.createdAt).toBeDefined();
      expect(task.completedAt).toBeNull();
      expect(task.result).toBeNull();
    });

    test('running task has status running', () => {
      const { taskId } = taskQueue.enqueue({ action: 'crawl', params: {} });
      taskQueue.updateStatus(taskId, 'running');
      const task = taskQueue.getTask(taskId);
      expect(task.status).toBe('running');
      expect(task.completedAt).toBeNull();
    });

    test('failed task has status failed with error message', async () => {
      const { taskId } = taskQueue.enqueue({ action: 'nonexistent', params: {} });
      const task = taskQueue.getTask(taskId);
      await taskExecutor.executeTask(task);

      const updated = taskQueue.getTask(taskId);
      expect(updated.status).toBe('failed');
      expect(updated.result.success).toBe(false);
      expect(updated.result.message).toContain('Unknown action');
      expect(updated.completedAt).not.toBeNull();
    });

    test('handler error results in failed status', async () => {
      taskExecutor.taskHandlers.set('explode', {
        name: 'explode',
        execute: async () => { throw new Error('Boom!'); },
      });

      const { taskId } = taskQueue.enqueue({ action: 'explode', params: {} });
      const task = taskQueue.getTask(taskId);
      await taskExecutor.executeTask(task);

      const updated = taskQueue.getTask(taskId);
      expect(updated.status).toBe('failed');
      expect(updated.result.message).toBe('Boom!');
    });

    test('listTasks returns all submitted tasks', () => {
      const tasks = taskQueue.listTasks();
      expect(tasks.length).toBeGreaterThanOrEqual(5);
      // Verify reverse chronological order
      for (let i = 1; i < tasks.length; i++) {
        expect(new Date(tasks[i - 1].createdAt) >= new Date(tasks[i].createdAt)).toBe(true);
      }
    });
  });

  // ─── Task result JSON saved to disk ───────────────────────────

  describe('task result JSON saved to disk', () => {
    test('completed task has JSON file in output dir', () => {
      const dateDirs = fs.readdirSync(testOutputDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
      expect(dateDirs.length).toBeGreaterThan(0);

      const dateDir = path.join(testOutputDir, dateDirs[0]);
      const jsonFiles = fs.readdirSync(dateDir).filter(f => f.endsWith('.json'));
      expect(jsonFiles.length).toBeGreaterThan(0);
    });

    test('saved JSON contains correct task fields', () => {
      const dateDirs = fs.readdirSync(testOutputDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
      const dateDir = path.join(testOutputDir, dateDirs[0]);
      const jsonFiles = fs.readdirSync(dateDir).filter(f => f.endsWith('.json'));

      const jsonContent = JSON.parse(
        fs.readFileSync(path.join(dateDir, jsonFiles[0]), 'utf-8')
      );
      expect(jsonContent.taskId).toBeDefined();
      expect(jsonContent.taskId).toMatch(/^task-/);
      expect(jsonContent.status).toBeDefined();
      expect(['done', 'failed']).toContain(jsonContent.status);
      expect(jsonContent.result).toBeDefined();
      expect(jsonContent.createdAt).toBeDefined();
      expect(jsonContent.completedAt).toBeDefined();
    });
  });

  // ─── Heartbeat tasks still work ───────────────────────────────

  describe('heartbeat tasks coexist with dispatch', () => {
    test('heartbeat executors are still registered', () => {
      expect(taskExecutor.executors.has('memory-sync')).toBe(true);
      expect(taskExecutor.executors.has('todo-reminder')).toBe(true);
    });

    test('tryExecute returns false for unknown tasks', async () => {
      const result = await taskExecutor.tryExecute('nonexistent-task');
      expect(result).toBe(false);
    });

    test('heartbeat executors and task handlers are separate maps', () => {
      expect(taskExecutor.executors).not.toBe(taskExecutor.taskHandlers);
      // heartbeat tasks should NOT appear in taskHandlers
      expect(taskExecutor.taskHandlers.has('memory-sync')).toBe(false);
      // plugin handlers should NOT appear in executors
      expect(taskExecutor.executors.has('crawl')).toBe(false);
    });
  });
});
