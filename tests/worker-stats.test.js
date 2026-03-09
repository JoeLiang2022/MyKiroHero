'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('WorkerStats', () => {
  let WorkerStats;
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `worker-stats-test-${Date.now()}.json`);
    // Fresh require to avoid module cache issues
    WorkerStats = require('../src/gateway/worker-stats');
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  });

  test('recordTaskResult creates worker entry and increments counts', () => {
    const ws = new WorkerStats(tmpFile);
    ws.recordTaskResult('worker-1', 'task-001', { success: true, duration: 5000 });
    const stats = ws.getWorkerStats('worker-1');
    expect(stats).not.toBeNull();
    expect(stats.totalTasks).toBe(1);
    expect(stats.successCount).toBe(1);
    expect(stats.failCount).toBe(0);
    expect(stats.avgDuration).toBe(5000);
  });

  test('recordTaskResult tracks failures', () => {
    const ws = new WorkerStats(tmpFile);
    ws.recordTaskResult('worker-1', 'task-001', { success: true, duration: 3000 });
    ws.recordTaskResult('worker-1', 'task-002', { success: false, duration: 1000 });
    const stats = ws.getWorkerStats('worker-1');
    expect(stats.totalTasks).toBe(2);
    expect(stats.successCount).toBe(1);
    expect(stats.failCount).toBe(1);
    expect(stats.avgDuration).toBe(2000);
  });

  test('recordTaskResult tracks review pass rate', () => {
    const ws = new WorkerStats(tmpFile);
    ws.recordTaskResult('worker-1', 'task-001', { success: true, duration: 1000, reviewPassed: true });
    ws.recordTaskResult('worker-1', 'task-002', { success: true, duration: 2000, reviewPassed: false });
    ws.recordTaskResult('worker-1', 'task-003', { success: true, duration: 3000, reviewPassed: true });
    const stats = ws.getWorkerStats('worker-1');
    expect(stats.reviewTotalCount).toBe(3);
    expect(stats.reviewPassCount).toBe(2);
    expect(stats.reviewPassRate).toBeCloseTo(0.67, 1);
  });

  test('recentTasks limited to 20 entries', () => {
    const ws = new WorkerStats(tmpFile);
    for (let i = 0; i < 25; i++) {
      ws.recordTaskResult('worker-1', `task-${i}`, { success: true, duration: 100 });
    }
    const stats = ws.getWorkerStats('worker-1');
    expect(stats.recentTasks.length).toBe(20);
    expect(stats.recentTasks[0].taskId).toBe('task-5');
    expect(stats.recentTasks[19].taskId).toBe('task-24');
  });

  test('getAllStats returns all workers', () => {
    const ws = new WorkerStats(tmpFile);
    ws.recordTaskResult('worker-1', 'task-001', { success: true, duration: 1000 });
    ws.recordTaskResult('worker-2', 'task-002', { success: false, duration: 2000 });
    const all = ws.getAllStats();
    expect(Object.keys(all)).toEqual(['worker-1', 'worker-2']);
  });

  test('getBestWorker returns worker with highest success rate', () => {
    const ws = new WorkerStats(tmpFile);
    ws.recordTaskResult('worker-1', 'task-001', { success: true, duration: 1000 });
    ws.recordTaskResult('worker-1', 'task-002', { success: false, duration: 1000 });
    ws.recordTaskResult('worker-2', 'task-003', { success: true, duration: 1000 });
    ws.recordTaskResult('worker-2', 'task-004', { success: true, duration: 1000 });
    expect(ws.getBestWorker()).toBe('worker-2');
  });

  test('getBestWorker returns null when no data', () => {
    const ws = new WorkerStats(tmpFile);
    expect(ws.getBestWorker()).toBeNull();
  });

  test('persists to disk and reloads', () => {
    const ws1 = new WorkerStats(tmpFile);
    ws1.recordTaskResult('worker-1', 'task-001', { success: true, duration: 5000, reviewPassed: true });
    ws1.destroy(); // flush debounced save to disk
    // Create new instance from same file
    const ws2 = new WorkerStats(tmpFile);
    const stats = ws2.getWorkerStats('worker-1');
    expect(stats.totalTasks).toBe(1);
    expect(stats.successCount).toBe(1);
    expect(stats.reviewPassRate).toBe(1);
  });

  test('getWorkerStats returns null for unknown worker', () => {
    const ws = new WorkerStats(tmpFile);
    expect(ws.getWorkerStats('nonexistent')).toBeNull();
  });

  test('recordTaskResult ignores null workerId', () => {
    const ws = new WorkerStats(tmpFile);
    ws.recordTaskResult(null, 'task-001', { success: true });
    expect(Object.keys(ws.getAllStats()).length).toBe(0);
  });

  test('reviewPassed null does not affect review counts', () => {
    const ws = new WorkerStats(tmpFile);
    ws.recordTaskResult('worker-1', 'task-001', { success: true, duration: 1000 });
    const stats = ws.getWorkerStats('worker-1');
    expect(stats.reviewTotalCount).toBe(0);
    expect(stats.reviewPassRate).toBe(0);
  });
});
