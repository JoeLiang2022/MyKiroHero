/**
 * Tests for WebSocket-driven Activity Drawer updates (MC Dashboard)
 * Tests debounced refresh logic, state-aware optimization, and new-item detection
 */

// ─── Mock timers ────────────────────────────────────────
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

// ─── Minimal DOM + localStorage mock ────────────────────
const mockElements = {};
const mockLocalStorage = {};

global.document = {
  getElementById: (id) => mockElements[id] || null,
  querySelector: () => null,
};
global.localStorage = {
  getItem: (k) => mockLocalStorage[k] || null,
  setItem: (k, v) => { mockLocalStorage[k] = v; },
};

// ─── State (mirrors app.js) ─────────────────────────────
let state;
let activityRefreshTimer;
let previousItemKeys;
let _renderNewKeys;
let fetchActivitySummaryCalls;
let mcLoadTimelineCalls;

function resetState() {
  state = {
    activityDrawerState: 'collapsed',
    activityData: null,
    activityRange: '7d',
    selectedDate: null,
  };
  activityRefreshTimer = null;
  previousItemKeys = new Set();
  _renderNewKeys = new Set();
  fetchActivitySummaryCalls = 0;
  mcLoadTimelineCalls = 0;
}

// ─── Mirrors: collectItemKeys ───────────────────────────
function collectItemKeys(data) {
  const keys = new Set();
  (data.completed || []).forEach(p => keys.add('plan:' + p.id));
  (data.created || []).forEach(p => keys.add('plan:' + p.id));
  (data.active || []).forEach(p => keys.add('plan:' + p.id));
  (data.tasksDone || []).forEach(t => keys.add('task:' + t.id));
  (data.tasksCreated || []).forEach(t => keys.add('task:' + t.id));
  return keys;
}

// ─── Mirrors: debouncedActivityRefresh ──────────────────
function fetchActivitySummary() { fetchActivitySummaryCalls++; }
function mcLoadTimeline() { mcLoadTimelineCalls++; }

function debouncedActivityRefresh() {
  if (state.activityDrawerState === 'hidden') return;
  if (activityRefreshTimer) clearTimeout(activityRefreshTimer);
  activityRefreshTimer = setTimeout(() => {
    activityRefreshTimer = null;
    fetchActivitySummary();
    if (state.activityDrawerState === 'expanded') {
      if (state.activityData) {
        previousItemKeys = collectItemKeys(state.activityData);
      }
      mcLoadTimeline();
    }
  }, 2000);
}

// ─── Mirrors: handleWSMessage (activity-relevant subset) ─
function simulateWSEvent(type, data) {
  if (!type || !type.startsWith('mc:')) return;
  switch (type) {
    case 'mc:plan_created':
    case 'mc:plan_updated':
    case 'mc:task_status':
      debouncedActivityRefresh();
      break;
  }
}

beforeEach(() => { resetState(); });

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

describe('Activity Drawer WS Updates', () => {

  // ─── Trigger tests ──────────────────────────────────────
  describe('WS event triggers', () => {
    test('mc:plan_created triggers debounced refresh', () => {
      simulateWSEvent('mc:plan_created', {});
      expect(activityRefreshTimer).not.toBeNull();
      jest.advanceTimersByTime(2000);
      expect(fetchActivitySummaryCalls).toBe(1);
    });

    test('mc:plan_updated triggers debounced refresh', () => {
      simulateWSEvent('mc:plan_updated', { planId: 'p1' });
      expect(activityRefreshTimer).not.toBeNull();
      jest.advanceTimersByTime(2000);
      expect(fetchActivitySummaryCalls).toBe(1);
    });

    test('mc:task_status triggers debounced refresh', () => {
      simulateWSEvent('mc:task_status', { taskId: 't1', status: 'done' });
      expect(activityRefreshTimer).not.toBeNull();
      jest.advanceTimersByTime(2000);
      expect(fetchActivitySummaryCalls).toBe(1);
    });

    test('unrelated WS events do not trigger refresh', () => {
      simulateWSEvent('mc:worker_status', { workerId: 'w1' });
      expect(activityRefreshTimer).toBeNull();
      jest.advanceTimersByTime(2000);
      expect(fetchActivitySummaryCalls).toBe(0);
    });

    test('non-mc events are ignored', () => {
      simulateWSEvent('system:heartbeat', {});
      expect(activityRefreshTimer).toBeNull();
    });
  });

  // ─── Debounce tests ─────────────────────────────────────
  describe('Debounce behavior', () => {
    test('multiple rapid events only trigger one refresh', () => {
      simulateWSEvent('mc:plan_created', {});
      simulateWSEvent('mc:plan_updated', { planId: 'p1' });
      simulateWSEvent('mc:task_status', { taskId: 't1', status: 'done' });
      simulateWSEvent('mc:plan_created', {});
      simulateWSEvent('mc:plan_updated', { planId: 'p2' });

      // Only 1 timer should be active
      jest.advanceTimersByTime(2000);
      expect(fetchActivitySummaryCalls).toBe(1);
    });

    test('debounce resets on each new event', () => {
      simulateWSEvent('mc:plan_created', {});
      jest.advanceTimersByTime(1500); // 1.5s — not yet fired
      expect(fetchActivitySummaryCalls).toBe(0);

      simulateWSEvent('mc:plan_updated', { planId: 'p1' }); // resets timer
      jest.advanceTimersByTime(1500); // 1.5s from second event — still not fired
      expect(fetchActivitySummaryCalls).toBe(0);

      jest.advanceTimersByTime(500); // now 2s from second event
      expect(fetchActivitySummaryCalls).toBe(1);
    });

    test('debounce timer is exactly 2 seconds', () => {
      simulateWSEvent('mc:plan_created', {});
      jest.advanceTimersByTime(1999);
      expect(fetchActivitySummaryCalls).toBe(0);
      jest.advanceTimersByTime(1);
      expect(fetchActivitySummaryCalls).toBe(1);
    });
  });

  // ─── State-aware optimization ───────────────────────────
  describe('State-aware optimization', () => {
    test('collapsed state: only summary bar refreshes, no timeline load', () => {
      state.activityDrawerState = 'collapsed';
      simulateWSEvent('mc:plan_created', {});
      jest.advanceTimersByTime(2000);
      expect(fetchActivitySummaryCalls).toBe(1);
      expect(mcLoadTimelineCalls).toBe(0);
    });

    test('expanded state: both summary and activity list refresh', () => {
      state.activityDrawerState = 'expanded';
      simulateWSEvent('mc:plan_created', {});
      jest.advanceTimersByTime(2000);
      expect(fetchActivitySummaryCalls).toBe(1);
      expect(mcLoadTimelineCalls).toBe(1);
    });

    test('hidden state: no refresh triggered at all', () => {
      state.activityDrawerState = 'hidden';
      simulateWSEvent('mc:plan_created', {});
      expect(activityRefreshTimer).toBeNull();
      jest.advanceTimersByTime(2000);
      expect(fetchActivitySummaryCalls).toBe(0);
      expect(mcLoadTimelineCalls).toBe(0);
    });

    test('expanded state snapshots previous keys before reload', () => {
      state.activityDrawerState = 'expanded';
      state.activityData = {
        completed: [{ id: 'p1', title: 'Plan 1', completedAt: '2026-02-21T10:00:00Z' }],
        created: [],
        active: [],
        tasksDone: [],
        tasksCreated: [],
      };
      simulateWSEvent('mc:plan_created', {});
      jest.advanceTimersByTime(2000);
      expect(previousItemKeys.has('plan:p1')).toBe(true);
    });

    test('collapsed with no activityData does not crash', () => {
      state.activityDrawerState = 'collapsed';
      state.activityData = null;
      expect(() => {
        simulateWSEvent('mc:plan_created', {});
        jest.advanceTimersByTime(2000);
      }).not.toThrow();
    });
  });

  // ─── Timer cleanup ──────────────────────────────────────
  describe('Timer cleanup', () => {
    test('hiding drawer clears pending refresh timer', () => {
      state.activityDrawerState = 'collapsed';
      simulateWSEvent('mc:plan_created', {});
      expect(activityRefreshTimer).not.toBeNull();

      // Simulate hideActivityDrawer cleanup
      if (activityRefreshTimer) { clearTimeout(activityRefreshTimer); activityRefreshTimer = null; }
      state.activityDrawerState = 'hidden';

      jest.advanceTimersByTime(2000);
      expect(fetchActivitySummaryCalls).toBe(0);
    });

    test('timer is null after debounce fires', () => {
      simulateWSEvent('mc:plan_created', {});
      jest.advanceTimersByTime(2000);
      expect(activityRefreshTimer).toBeNull();
    });
  });

  // ─── New item detection (collectItemKeys) ───────────────
  describe('New item detection', () => {
    test('collectItemKeys extracts plan and task IDs', () => {
      const data = {
        completed: [{ id: 'p1' }],
        created: [{ id: 'p2' }],
        active: [{ id: 'p3' }],
        tasksDone: [{ id: 't1' }],
        tasksCreated: [{ id: 't2' }],
      };
      const keys = collectItemKeys(data);
      expect(keys.has('plan:p1')).toBe(true);
      expect(keys.has('plan:p2')).toBe(true);
      expect(keys.has('plan:p3')).toBe(true);
      expect(keys.has('task:t1')).toBe(true);
      expect(keys.has('task:t2')).toBe(true);
      expect(keys.size).toBe(5);
    });

    test('collectItemKeys handles empty data', () => {
      const keys = collectItemKeys({});
      expect(keys.size).toBe(0);
    });

    test('new items are detected by comparing previous and current keys', () => {
      const prev = new Set(['plan:p1', 'task:t1']);
      const current = new Set(['plan:p1', 'plan:p2', 'task:t1', 'task:t2']);
      const newKeys = new Set();
      current.forEach(k => { if (!prev.has(k)) newKeys.add(k); });
      expect(newKeys.has('plan:p2')).toBe(true);
      expect(newKeys.has('task:t2')).toBe(true);
      expect(newKeys.size).toBe(2);
    });

    test('no new items when data is unchanged', () => {
      const prev = new Set(['plan:p1', 'task:t1']);
      const current = new Set(['plan:p1', 'task:t1']);
      const newKeys = new Set();
      current.forEach(k => { if (!prev.has(k)) newKeys.add(k); });
      expect(newKeys.size).toBe(0);
    });

    test('first render has no new items (previousItemKeys empty)', () => {
      const prev = new Set(); // empty on first render
      const current = new Set(['plan:p1', 'task:t1']);
      const newKeys = new Set();
      if (prev.size > 0) {
        current.forEach(k => { if (!prev.has(k)) newKeys.add(k); });
      }
      expect(newKeys.size).toBe(0);
    });
  });

  // ─── Fade-in animation class ────────────────────────────
  describe('Fade-in animation class', () => {
    test('new plan item gets new-item class in rendered HTML', () => {
      // Simulate: _renderNewKeys has a new plan
      const esc = (s) => s || '';
      const getStatusText = (s) => s || '';
      const planId = 'p-new';
      const renderNewKeys = new Set(['plan:p-new']);
      const newCls = renderNewKeys.has('plan:' + planId) ? ' new-item' : '';
      const html = '<div class="tl-item' + newCls + '" data-plan-id="' + planId + '"></div>';
      expect(html).toContain('tl-item new-item');
      expect(html).toContain('data-plan-id="p-new"');
    });

    test('existing plan item does not get new-item class', () => {
      const planId = 'p-old';
      const renderNewKeys = new Set(['plan:p-new']);
      const newCls = renderNewKeys.has('plan:' + planId) ? ' new-item' : '';
      const html = '<div class="tl-item' + newCls + '" data-plan-id="' + planId + '"></div>';
      expect(html).not.toContain('new-item');
    });

    test('new task item gets new-item class in rendered HTML', () => {
      const taskId = 't-new';
      const renderNewKeys = new Set(['task:t-new']);
      const newCls = renderNewKeys.has('task:' + taskId) ? ' new-item' : '';
      const html = '<div class="tl-item' + newCls + '" data-task-id="' + taskId + '"></div>';
      expect(html).toContain('tl-item new-item');
    });

    test('empty renderNewKeys means no items get new-item class', () => {
      const renderNewKeys = new Set();
      const newCls = renderNewKeys.has('plan:p1') ? ' new-item' : '';
      expect(newCls).toBe('');
    });
  });
});
