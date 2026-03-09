'use strict';

/**
 * Tests for Dashboard WebSocket state management and UI feedback
 * Covers: handleWSMessage direct state updates, updateGatewayBadge,
 * flashSidebarItem, WS retry count tracking, visibility auto-refresh
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ─── Mock DOM ───────────────────────────────────────────

function createMockDOM() {
  const elements = {};
  const eventListeners = {};

  const createElement = (tag) => {
    let _textContent = '';
    let _innerHTML = '';
    const el = {
      tagName: tag,
      get textContent() { return _textContent; },
      set textContent(v) { _textContent = v; },
      get innerHTML() { return _innerHTML; },
      set innerHTML(v) { _innerHTML = v; _textContent = v; },
      className: '',
      style: {},
      dataset: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(...cs) { cs.forEach(c => this._classes.delete(c)); },
        contains(c) { return this._classes.has(c); },
      },
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
      appendChild: () => {},
      removeChild: () => {},
      remove: () => {},
      get offsetWidth() { return 100; },
      get firstElementChild() { return null; },
      get children() { return { length: 0 }; },
      get parentNode() { return null; },
      get scrollHeight() { return 0; },
      set scrollTop(v) {},
    };
    return el;
  };

  return {
    document: {
      getElementById: (id) => {
        if (!elements[id]) {
          elements[id] = createElement('div');
          elements[id].id = id;
        }
        return elements[id];
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement,
      addEventListener: (evt, fn) => {
        if (!eventListeners[evt]) eventListeners[evt] = [];
        eventListeners[evt].push(fn);
      },
      removeEventListener: () => {},
      body: { appendChild: () => {} },
      visibilityState: 'visible',
    },
    elements,
    eventListeners,
  };
}

function loadAppContext() {
  const appSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'gateway', 'dashboard', 'app.js'),
    'utf-8'
  );

  const mock = createMockDOM();
  const fetchCalls = [];
  const toasts = [];

  const ctx = {
    document: mock.document,
    window: { location: { host: 'localhost:3000' } },
    WebSocket: class {
      send() {}
      close() {}
      set onopen(fn) { this._onopen = fn; }
      set onclose(fn) { this._onclose = fn; }
      set onmessage(fn) { this._onmessage = fn; }
      set onerror(fn) { this._onerror = fn; }
    },
    fetch: async (url) => {
      fetchCalls.push(url);
      return {
        status: 200,
        json: async () => {
          // Return appropriate mock data based on URL
          if (url.includes('/stats')) return { activePlans: 1, workers: [], todayTasks: 0 };
          if (url.includes('/plans/')) return { id: 'plan-1', title: 'Test', status: 'active', tasks: [] };
          if (url.includes('/plans')) return [];
          if (url.includes('/projects')) return [];
          return {};
        },
      };
    },
    console,
    setTimeout: (fn) => fn(), // execute immediately for tests
    clearTimeout: () => {},
    setInterval: () => {},
    Date,
    JSON,
    URLSearchParams,
    Math,
    requestAnimationFrame: (fn) => fn(),
    event: { target: { classList: { add() {}, remove() {} } } },
  };

  vm.createContext(ctx);
  vm.runInContext(appSrc, ctx, { filename: 'app.js' });

  // Expose internal state and functions
  vm.runInContext(`
    function _getState() { return state; }
    function _setState(key, val) { state[key] = val; }
  `, ctx);

  return {
    ctx,
    mock,
    getState: ctx._getState,
    setState: ctx._setState,
    fetchCalls,
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('Dashboard WS State Management', () => {
  let ctx, mock, getState, setState, fetchCalls;

  beforeEach(() => {
    ({ ctx, mock, getState, setState, fetchCalls } = loadAppContext());
    fetchCalls.length = 0;
  });

  // ─── State Initialization ─────────────────────────

  describe('WS state initialization', () => {
    test('wsRetryCount starts at 0', () => {
      expect(getState().wsRetryCount).toBe(0);
    });

    test('wsConnected starts false', () => {
      expect(getState().wsConnected).toBe(false);
    });

    test('wsRetryDelay starts at 1000', () => {
      expect(getState().wsRetryDelay).toBe(1000);
    });
  });

  // ─── updateGatewayBadge ───────────────────────────

  describe('updateGatewayBadge', () => {
    test('shows online state correctly', () => {
      ctx.updateGatewayBadge('online');
      const el = mock.elements['gw-status'];
      expect(el.textContent).toContain('Gateway Online');
      expect(el.className).toBe('status-badge online');
    });

    test('shows offline state correctly', () => {
      ctx.updateGatewayBadge('offline');
      const el = mock.elements['gw-status'];
      expect(el.textContent).toContain('Offline');
      expect(el.className).toBe('status-badge offline');
    });

    test('shows reconnecting state with retry count', () => {
      setState('wsRetryCount', 3);
      ctx.updateGatewayBadge('reconnecting');
      const el = mock.elements['gw-status'];
      expect(el.innerHTML).toContain('Reconnecting');
      expect(el.innerHTML).toContain('#3');
      expect(el.className).toBe('status-badge reconnecting');
    });

    test('reconnecting hides count on first retry', () => {
      setState('wsRetryCount', 1);
      ctx.updateGatewayBadge('reconnecting');
      const el = mock.elements['gw-status'];
      expect(el.innerHTML).toContain('Reconnecting');
      expect(el.innerHTML).not.toContain('#1');
    });
  });

  // ─── handleWSMessage: mc:plan_created ─────────────

  describe('handleWSMessage — mc:plan_created', () => {
    test('adds plan to state from WS data directly', () => {
      const plan = { id: 'plan-new', title: 'New Plan', status: 'pending', tasks: [] };
      setState('plans', []);
      ctx.handleWSMessage({ type: 'mc:plan_created', data: { plan } });
      expect(getState().plans.length).toBe(1);
      expect(getState().plans[0].id).toBe('plan-new');
    });

    test('updates existing plan if id matches', () => {
      const existing = { id: 'plan-1', title: 'Old', status: 'pending', tasks: [] };
      const updated = { id: 'plan-1', title: 'Updated', status: 'active', tasks: [] };
      setState('plans', [existing]);
      ctx.handleWSMessage({ type: 'mc:plan_created', data: { plan: updated } });
      expect(getState().plans.length).toBe(1);
      expect(getState().plans[0].title).toBe('Updated');
    });

    test('falls back to fetchPlans when no plan data in WS message', () => {
      fetchCalls.length = 0;
      ctx.handleWSMessage({ type: 'mc:plan_created', data: {} });
      // Should have called fetch for /plans (fetchPlans) and /stats (fetchStats)
      const plansFetch = fetchCalls.some(u => u.includes('/plans') && !u.includes('/stats'));
      expect(plansFetch).toBe(true);
    });
  });

  // ─── handleWSMessage: mc:plan_updated ─────────────

  describe('handleWSMessage — mc:plan_updated', () => {
    test('updates plan in state from full WS data', () => {
      const old = { id: 'plan-1', title: 'Test', status: 'pending', tasks: [] };
      const updated = { id: 'plan-1', title: 'Test', status: 'active', tasks: [{ id: 't1', status: 'running' }] };
      setState('plans', [old]);
      ctx.handleWSMessage({ type: 'mc:plan_updated', data: { planId: 'plan-1', plan: updated } });
      expect(getState().plans[0].status).toBe('active');
      expect(getState().plans[0].tasks.length).toBe(1);
    });

    test('partial update — updates status in-place when only status provided', () => {
      const old = { id: 'plan-1', title: 'Test', status: 'pending', tasks: [] };
      setState('plans', [old]);
      ctx.handleWSMessage({ type: 'mc:plan_updated', data: { planId: 'plan-1', status: 'active' } });
      expect(getState().plans[0].status).toBe('active');
      expect(getState().plans[0].title).toBe('Test'); // unchanged
    });

    test('falls back to fetchPlans when no plan or status in WS data', () => {
      setState('plans', [{ id: 'plan-1', title: 'Test', status: 'pending', tasks: [] }]);
      fetchCalls.length = 0;
      ctx.handleWSMessage({ type: 'mc:plan_updated', data: { planId: 'plan-1' } });
      const plansFetch = fetchCalls.some(u => u.includes('/plans') && !u.includes('/stats'));
      expect(plansFetch).toBe(true);
    });
  });

  // ─── handleWSMessage: mc:plan_deleted ─────────────

  describe('handleWSMessage — mc:plan_deleted', () => {
    test('removes plan from state directly', () => {
      setState('plans', [
        { id: 'plan-1', title: 'A', status: 'active', tasks: [] },
        { id: 'plan-2', title: 'B', status: 'pending', tasks: [] },
      ]);
      ctx.handleWSMessage({ type: 'mc:plan_deleted', data: { planId: 'plan-1' } });
      expect(getState().plans.length).toBe(1);
      expect(getState().plans[0].id).toBe('plan-2');
    });

    test('clears currentPlanId when deleted plan is selected', () => {
      setState('plans', [{ id: 'plan-1', title: 'A', status: 'active', tasks: [] }]);
      setState('currentPlanId', 'plan-1');
      ctx.handleWSMessage({ type: 'mc:plan_deleted', data: { planId: 'plan-1' } });
      expect(getState().currentPlanId).toBeNull();
    });

    test('does not clear currentPlanId when different plan deleted', () => {
      setState('plans', [
        { id: 'plan-1', title: 'A', status: 'active', tasks: [] },
        { id: 'plan-2', title: 'B', status: 'active', tasks: [] },
      ]);
      setState('currentPlanId', 'plan-2');
      ctx.handleWSMessage({ type: 'mc:plan_deleted', data: { planId: 'plan-1' } });
      expect(getState().currentPlanId).toBe('plan-2');
    });
  });

  // ─── handleWSMessage: mc:task_status ──────────────

  describe('handleWSMessage — mc:task_status', () => {
    test('updates task status in local plan state', () => {
      setState('plans', [{
        id: 'plan-1', title: 'Test', status: 'active',
        tasks: [{ id: 'task-1', status: 'running', title: 'Do thing' }],
      }]);
      ctx.handleWSMessage({
        type: 'mc:task_status',
        data: { planId: 'plan-1', taskId: 'task-1', status: 'done' },
      });
      expect(getState().plans[0].tasks[0].status).toBe('done');
    });

    test('updates task output when provided', () => {
      setState('plans', [{
        id: 'plan-1', title: 'Test', status: 'active',
        tasks: [{ id: 'task-1', status: 'running', title: 'Do thing' }],
      }]);
      ctx.handleWSMessage({
        type: 'mc:task_status',
        data: { planId: 'plan-1', taskId: 'task-1', status: 'done', output: 'All good' },
      });
      expect(getState().plans[0].tasks[0].output).toBe('All good');
    });

    test('handles missing plan gracefully', () => {
      setState('plans', []);
      // Should not throw
      expect(() => {
        ctx.handleWSMessage({
          type: 'mc:task_status',
          data: { planId: 'plan-missing', taskId: 'task-1', status: 'done' },
        });
      }).not.toThrow();
    });

    test('handles missing task in plan gracefully', () => {
      setState('plans', [{
        id: 'plan-1', title: 'Test', status: 'active',
        tasks: [{ id: 'task-1', status: 'running', title: 'Do thing' }],
      }]);
      expect(() => {
        ctx.handleWSMessage({
          type: 'mc:task_status',
          data: { planId: 'plan-1', taskId: 'task-nonexistent', status: 'done' },
        });
      }).not.toThrow();
    });
  });

  // ─── handleWSMessage: mc:worker_status ────────────

  describe('handleWSMessage — mc:worker_status', () => {
    test('updates existing worker status in-place', () => {
      setState('workers', [
        { workerId: 'worker-1', status: 'idle', currentTaskId: null, lastSeen: null },
      ]);
      ctx.handleWSMessage({
        type: 'mc:worker_status',
        data: { workerId: 'worker-1', status: 'busy', currentTaskId: 'task-abc' },
      });
      expect(getState().workers[0].status).toBe('busy');
      expect(getState().workers[0].currentTaskId).toBe('task-abc');
    });

    test('updates topbar worker count on status change', () => {
      setState('workers', [
        { workerId: 'worker-1', status: 'idle', currentTaskId: null },
        { workerId: 'worker-2', status: 'idle', currentTaskId: null },
      ]);
      ctx.handleWSMessage({
        type: 'mc:worker_status',
        data: { workerId: 'worker-1', status: 'offline' },
      });
      const statEl = mock.elements['stat-workers'];
      expect(statEl.textContent).toBe(1);
    });

    test('falls back to fetchStats for unknown worker', () => {
      setState('workers', []);
      fetchCalls.length = 0;
      ctx.handleWSMessage({
        type: 'mc:worker_status',
        data: { workerId: 'worker-new', status: 'idle' },
      });
      const statsFetch = fetchCalls.some(u => u.includes('/stats'));
      expect(statsFetch).toBe(true);
    });

    test('falls back to fetchStats when no workerId', () => {
      fetchCalls.length = 0;
      ctx.handleWSMessage({
        type: 'mc:worker_status',
        data: {},
      });
      const statsFetch = fetchCalls.some(u => u.includes('/stats'));
      expect(statsFetch).toBe(true);
    });
  });

  // ─── handleWSMessage: ignores non-mc messages ─────

  describe('handleWSMessage — filtering', () => {
    test('ignores messages without mc: prefix', () => {
      setState('plans', []);
      fetchCalls.length = 0;
      ctx.handleWSMessage({ type: 'heartbeat', data: {} });
      ctx.handleWSMessage({ type: 'chat:message', data: {} });
      // No fetch calls should have been made
      expect(fetchCalls.length).toBe(0);
    });

    test('ignores messages without type', () => {
      fetchCalls.length = 0;
      ctx.handleWSMessage({ data: {} });
      expect(fetchCalls.length).toBe(0);
    });
  });

  // ─── flashSidebarItem ─────────────────────────────

  describe('flashSidebarItem', () => {
    test('does nothing when status unchanged', () => {
      // Should not throw even with no matching DOM element
      expect(() => ctx.flashSidebarItem('plan-1', 'active', 'active')).not.toThrow();
    });

    test('does nothing when plan element not found', () => {
      expect(() => ctx.flashSidebarItem('nonexistent', 'done', 'active')).not.toThrow();
    });
  });
});
