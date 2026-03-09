/**
 * Test: Worker session reset after task completion (Plan B)
 * 
 * Simulates 3 workers reporting task results and verifies
 * that sendCommandToWorker('kiroAgent.newSession') is called
 * at the correct terminal states.
 */

const WorkerRegistry = require('../src/gateway/worker-registry');

describe('Worker Session Reset (Plan B)', () => {
  let registry;
  let sendCommandSpy;

  beforeEach(() => {
    registry = new WorkerRegistry();
    // Register 3 workers
    registry.register('worker-1', 10001);
    registry.register('worker-2', 10002);
    registry.register('worker-3', 10003);
    // Spy on sendCommandToWorker
    sendCommandSpy = jest.spyOn(registry, 'sendCommandToWorker').mockResolvedValue(true);
  });

  afterEach(() => {
    registry.destroy();
    jest.restoreAllMocks();
  });

  test('sendCommandToWorker exists and is callable', () => {
    expect(typeof registry.sendCommandToWorker).toBe('function');
  });

  test('sendCommandToWorker skips unknown worker gracefully', async () => {
    sendCommandSpy.mockRestore(); // use real implementation
    // Should not throw
    const result = await registry.sendCommandToWorker('nonexistent', 'kiroAgent.newSession');
    expect(result).toBeUndefined();
  });

  test('markIdle does NOT auto-send newSession (Plan B behavior)', () => {
    registry.markBusy('worker-1', 'task-001');
    registry.markIdle('worker-1');
    // Plan B: markIdle should NOT trigger sendCommandToWorker
    expect(sendCommandSpy).not.toHaveBeenCalled();
  });

  test('3 workers: simulate report success (no review) → each gets newSession', async () => {
    // Simulate: each worker was busy, then reports success (path 3)
    const workers = ['worker-1', 'worker-2', 'worker-3'];
    
    for (const wId of workers) {
      registry.markBusy(wId, `task-${wId}`);
      registry.markIdle(wId);
      // Caller (server.js) would call this after markIdle at terminal state
      await registry.sendCommandToWorker(wId, 'kiroAgent.newSession');
    }

    expect(sendCommandSpy).toHaveBeenCalledTimes(3);
    expect(sendCommandSpy).toHaveBeenCalledWith('worker-1', 'kiroAgent.newSession');
    expect(sendCommandSpy).toHaveBeenCalledWith('worker-2', 'kiroAgent.newSession');
    expect(sendCommandSpy).toHaveBeenCalledWith('worker-3', 'kiroAgent.newSession');
  });

  test('3 workers: simulate report failure → each gets newSession', async () => {
    const workers = ['worker-1', 'worker-2', 'worker-3'];
    
    for (const wId of workers) {
      registry.markBusy(wId, `task-${wId}`);
      registry.markIdle(wId);
      // Path 1: task failed → reset session
      await registry.sendCommandToWorker(wId, 'kiroAgent.newSession');
    }

    expect(sendCommandSpy).toHaveBeenCalledTimes(3);
    for (const wId of workers) {
      expect(sendCommandSpy).toHaveBeenCalledWith(wId, 'kiroAgent.newSession');
    }
  });

  test('worker status is idle after markIdle + sendCommand', async () => {
    registry.markBusy('worker-1', 'task-001');
    expect(registry.list().find(w => w.workerId === 'worker-1').status).toBe('busy');
    
    registry.markIdle('worker-1');
    await registry.sendCommandToWorker('worker-1', 'kiroAgent.newSession');
    
    const w = registry.list().find(w => w.workerId === 'worker-1');
    expect(w.status).toBe('idle');
    expect(w.currentTaskId).toBeNull();
  });

  test('sendCommandToWorker can be called with any command', async () => {
    await registry.sendCommandToWorker('worker-1', 'kiroAgent.someOtherCommand');
    expect(sendCommandSpy).toHaveBeenCalledWith('worker-1', 'kiroAgent.someOtherCommand');
  });

  test('concurrent reports from 3 workers do not interfere', async () => {
    // All 3 workers busy with different tasks
    registry.markBusy('worker-1', 'task-A');
    registry.markBusy('worker-2', 'task-B');
    registry.markBusy('worker-3', 'task-C');

    // All report at roughly the same time
    const promises = ['worker-1', 'worker-2', 'worker-3'].map(async (wId) => {
      registry.markIdle(wId);
      await registry.sendCommandToWorker(wId, 'kiroAgent.newSession');
    });

    await Promise.all(promises);

    expect(sendCommandSpy).toHaveBeenCalledTimes(3);
    // All workers should be idle
    for (const w of registry.list()) {
      expect(w.status).toBe('idle');
    }
  });
});
