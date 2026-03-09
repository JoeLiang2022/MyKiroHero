const PushQueueManager = require('../src/gateway/push-queue-manager');

describe('PushQueueManager', () => {
  let pqm;

  beforeEach(() => {
    pqm = new PushQueueManager({ autoTimeoutMs: 200 }); // short timeout for tests
  });

  afterEach(() => {
    pqm.destroy();
  });

  test('single worker gets lock immediately', () => {
    const result = pqm.requestLock('worker-1', '/repo/a');
    expect(result).toEqual({ granted: true, position: 0 });
  });

  test('second worker gets queued', () => {
    pqm.requestLock('worker-1', '/repo/a');
    const result = pqm.requestLock('worker-2', '/repo/a');
    expect(result).toEqual({ granted: false, position: 1 });
  });

  test('same worker requesting again returns granted', () => {
    pqm.requestLock('worker-1', '/repo/a');
    const result = pqm.requestLock('worker-1', '/repo/a');
    expect(result).toEqual({ granted: true, position: 0 });
  });

  test('queued worker requesting again returns same position', () => {
    pqm.requestLock('worker-1', '/repo/a');
    pqm.requestLock('worker-2', '/repo/a');
    const result = pqm.requestLock('worker-2', '/repo/a');
    expect(result).toEqual({ granted: false, position: 1 });
  });

  test('release notifies next worker', async () => {
    const mockSendToWorker = jest.fn().mockResolvedValue();
    pqm.workerRegistry = { sendToWorker: mockSendToWorker };

    pqm.requestLock('worker-1', '/repo/a');
    pqm.requestLock('worker-2', '/repo/a');

    const result = pqm.releaseLock('worker-1', '/repo/a');
    expect(result).toEqual({ released: true, nextHolder: 'worker-2' });

    // Wait for async notification
    await new Promise(r => setTimeout(r, 50));
    expect(mockSendToWorker).toHaveBeenCalledWith(
      'worker-2',
      expect.stringContaining('[Push Queue]')
    );
  });

  test('release with no queue clears repo entry', () => {
    pqm.requestLock('worker-1', '/repo/a');
    pqm.releaseLock('worker-1', '/repo/a');
    const status = pqm.getQueueStatus('/repo/a');
    expect(status).toEqual({ currentHolder: null, queue: [], grantedAt: null });
  });

  test('non-holder release removes from queue instead', () => {
    pqm.requestLock('worker-1', '/repo/a');
    pqm.requestLock('worker-2', '/repo/a');
    pqm.requestLock('worker-3', '/repo/a');

    const result = pqm.releaseLock('worker-2', '/repo/a');
    expect(result).toEqual({ released: false, nextHolder: null });

    // worker-2 should be removed from queue
    const status = pqm.getQueueStatus('/repo/a');
    expect(status.currentHolder).toBe('worker-1');
    expect(status.queue).toEqual(['worker-3']);
  });

  test('auto-timeout releases lock and grants next', async () => {
    const mockSendToWorker = jest.fn().mockResolvedValue();
    pqm.workerRegistry = { sendToWorker: mockSendToWorker };

    pqm.requestLock('worker-1', '/repo/a');
    pqm.requestLock('worker-2', '/repo/a');

    // Wait for auto-timeout (200ms in test config)
    await new Promise(r => setTimeout(r, 350));

    const status = pqm.getQueueStatus('/repo/a');
    expect(status.currentHolder).toBe('worker-2');
    expect(status.queue).toEqual([]);
    expect(mockSendToWorker).toHaveBeenCalledWith(
      'worker-2',
      expect.stringContaining('[Push Queue]')
    );
  });

  test('multiple repos do not interfere', () => {
    const r1 = pqm.requestLock('worker-1', '/repo/a');
    const r2 = pqm.requestLock('worker-2', '/repo/b');

    expect(r1).toEqual({ granted: true, position: 0 });
    expect(r2).toEqual({ granted: true, position: 0 });

    // worker-1 queued on repo/b should not affect repo/a
    const r3 = pqm.requestLock('worker-1', '/repo/b');
    expect(r3).toEqual({ granted: false, position: 1 });

    const statusA = pqm.getQueueStatus('/repo/a');
    expect(statusA.currentHolder).toBe('worker-1');
    expect(statusA.queue).toEqual([]);

    const statusB = pqm.getQueueStatus('/repo/b');
    expect(statusB.currentHolder).toBe('worker-2');
    expect(statusB.queue).toEqual(['worker-1']);
  });

  test('getQueueStatus returns empty for unknown repo', () => {
    const status = pqm.getQueueStatus('/repo/unknown');
    expect(status).toEqual({ currentHolder: null, queue: [], grantedAt: null });
  });

  test('destroy clears all timers and repos', () => {
    pqm.requestLock('worker-1', '/repo/a');
    pqm.requestLock('worker-2', '/repo/b');
    pqm.destroy();
    expect(pqm.repos.size).toBe(0);
  });

  test('third worker gets position 2', () => {
    pqm.requestLock('worker-1', '/repo/a');
    pqm.requestLock('worker-2', '/repo/a');
    const result = pqm.requestLock('worker-3', '/repo/a');
    expect(result).toEqual({ granted: false, position: 2 });
  });

  test('release then re-request works correctly', () => {
    pqm.requestLock('worker-1', '/repo/a');
    pqm.releaseLock('worker-1', '/repo/a');

    const result = pqm.requestLock('worker-2', '/repo/a');
    expect(result).toEqual({ granted: true, position: 0 });
  });
});
