/**
 * WorkerRegistry unit tests
 */
const WorkerRegistry = require('../src/gateway/worker-registry');

// Suppress console output during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

describe('WorkerRegistry', () => {
  let registry;

  beforeEach(() => {
    jest.useFakeTimers();
    registry = new WorkerRegistry();
  });

  afterEach(() => {
    registry.destroy();
    jest.useRealTimers();
  });

  // ─── register ───
  describe('register', () => {
    it('should register a new worker as idle', () => {
      registry.register('worker-1', 3001);
      const list = registry.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ workerId: 'worker-1', port: 3001, status: 'idle' });
    });

    it('should update port for existing worker', () => {
      registry.register('worker-1', 3001);
      registry.register('worker-1', 3002);
      const list = registry.list();
      expect(list).toHaveLength(1);
      expect(list[0].port).toBe(3002);
    });

    it('should recover offline worker on re-register', () => {
      registry.register('worker-1', 3001);
      // Manually set offline
      registry.workers.get('worker-1').status = 'offline';
      registry.register('worker-1', 3001);
      expect(registry.workers.get('worker-1').status).toBe('idle');
    });

    it('should fire onRegister callback for new workers', () => {
      const cb = jest.fn();
      registry.onRegister(cb);
      registry.register('worker-1', 3001);
      expect(cb).toHaveBeenCalledWith('worker-1', 3001, true);
    });

    it('should NOT fire onRegister for existing non-offline worker', () => {
      registry.register('worker-1', 3001);
      const cb = jest.fn();
      registry.onRegister(cb);
      registry.register('worker-1', 3002); // update port
      expect(cb).not.toHaveBeenCalled();
    });

    it('should fire onChange on new registration', () => {
      const cb = jest.fn();
      registry.onChange(cb);
      registry.register('worker-1', 3001);
      expect(cb).toHaveBeenCalledWith('worker-1', 'idle', null);
    });

    it('should auto-start health check on first registration', () => {
      expect(registry._healthTimer).toBeNull();
      registry.register('worker-1', 3001);
      expect(registry._healthTimer).not.toBeNull();
    });
  });

  // ─── findIdle ───
  describe('findIdle', () => {
    it('should return null when no workers', () => {
      expect(registry.findIdle()).toBeNull();
    });

    it('should return idle worker', () => {
      registry.register('worker-1', 3001);
      const result = registry.findIdle();
      expect(result).toMatchObject({ workerId: 'worker-1', port: 3001 });
    });

    it('should skip busy workers', () => {
      registry.register('worker-1', 3001);
      registry.markBusy('worker-1', 'task-1');
      expect(registry.findIdle()).toBeNull();
    });

    it('should round-robin between idle workers', () => {
      registry.register('worker-1', 3001);
      registry.register('worker-2', 3002);
      const first = registry.findIdle();
      const second = registry.findIdle();
      expect(first.workerId).not.toBe(second.workerId);
    });
  });

  // ─── findIdleExcluding ───
  describe('findIdleExcluding', () => {
    it('should exclude specified worker', () => {
      registry.register('worker-1', 3001);
      registry.register('worker-2', 3002);
      const result = registry.findIdleExcluding('worker-1');
      expect(result.workerId).toBe('worker-2');
    });

    it('should return null if only excluded worker is idle', () => {
      registry.register('worker-1', 3001);
      expect(registry.findIdleExcluding('worker-1')).toBeNull();
    });
  });

  // ─── markBusy / markIdle ───
  describe('markBusy / markIdle', () => {
    it('should set status to busy with taskId', () => {
      registry.register('worker-1', 3001);
      registry.markBusy('worker-1', 'task-123');
      const w = registry.workers.get('worker-1');
      expect(w.status).toBe('busy');
      expect(w.currentTaskId).toBe('task-123');
    });

    it('should set status back to idle and clear taskId', () => {
      registry.register('worker-1', 3001);
      registry.markBusy('worker-1', 'task-123');
      registry.markIdle('worker-1');
      const w = registry.workers.get('worker-1');
      expect(w.status).toBe('idle');
      expect(w.currentTaskId).toBeNull();
    });

    it('should fire onChange on status change', () => {
      registry.register('worker-1', 3001);
      const cb = jest.fn();
      registry.onChange(cb);
      registry.markBusy('worker-1', 'task-1');
      expect(cb).toHaveBeenCalledWith('worker-1', 'busy', 'task-1');
    });
  });

  // ─── heartbeat ───
  describe('heartbeat', () => {
    it('should update lastSeen', () => {
      registry.register('worker-1', 3001);
      const before = registry.workers.get('worker-1').lastSeen;
      jest.advanceTimersByTime(1000);
      registry.heartbeat('worker-1');
      expect(registry.workers.get('worker-1').lastSeen).toBeGreaterThan(before);
    });

    it('should handle unknown workerId gracefully', () => {
      expect(() => registry.heartbeat('unknown')).not.toThrow();
    });
  });

  // ─── getTaskId ───
  describe('getTaskId', () => {
    it('should return null for idle worker', () => {
      registry.register('worker-1', 3001);
      expect(registry.getTaskId('worker-1')).toBeNull();
    });

    it('should return taskId for busy worker', () => {
      registry.register('worker-1', 3001);
      registry.markBusy('worker-1', 'task-42');
      expect(registry.getTaskId('worker-1')).toBe('task-42');
    });

    it('should return null for unknown worker', () => {
      expect(registry.getTaskId('unknown')).toBeNull();
    });
  });

  // ─── list ───
  describe('list', () => {
    it('should return all workers', () => {
      registry.register('worker-1', 3001);
      registry.register('worker-2', 3002);
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map(w => w.workerId).sort()).toEqual(['worker-1', 'worker-2']);
    });
  });

  // ─── destroy ───
  describe('destroy', () => {
    it('should stop health check timer', () => {
      registry.register('worker-1', 3001);
      expect(registry._healthTimer).not.toBeNull();
      registry.destroy();
      expect(registry._healthTimer).toBeNull();
    });
  });
});
