'use strict';

/**
 * Tests for MC Dashboard plan bulk actions and clone:
 * - POST /plans/:id/clone endpoint
 * - renderPlanDetail button rendering for retryAllFailed, cancelAllRunning, clonePlan
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ─── Backend: Clone Route Tests ─────────────────────────

function mockReq(params = {}, body = {}) {
  return { params, body, query: {} };
}

function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { res._status = code; return res; },
    json(data) { res._body = data; return res; },
  };
  return res;
}

function createMcDB() {
  const plans = new Map();
  const tasks = new Map();
  let planCounter = 0;
  let taskCounter = 0;

  return {
    getPlan(id) {
      const plan = plans.get(id);
      if (!plan) return null;
      const planTasks = [...tasks.values()].filter(t => t.planId === id);
      return { ...plan, tasks: planTasks };
    },
    createPlan({ title, description, projectId, source }) {
      const id = `plan-${++planCounter}`;
      const plan = { id, title, description, projectId, source, strategy: null, status: 'pending', createdAt: new Date().toISOString() };
      plans.set(id, plan);
      return plan;
    },
    updatePlan(id, fields) {
      const plan = plans.get(id);
      if (!plan) return false;
      Object.assign(plan, fields);
      return true;
    },
    listTasksByPlan(planId) {
      return [...tasks.values()].filter(t => t.planId === planId);
    },
    createTask({ planId, title, description, type, action, params, orderIndex, timeout, status }) {
      const id = `mctask-${++taskCounter}`;
      const task = { id, planId, title, description, type, action, params, orderIndex, timeout, status: status || 'pending' };
      tasks.set(id, task);
      return task;
    },
    _tasks: tasks,
    _plans: plans,
  };
}


// Extract clone handler logic matching the route in mission-control-routes.js
async function cloneHandler(mcDB, gateway, req, res) {
  try {
    const original = mcDB.getPlan(req.params.id);
    if (!original) return res.status(404).json({ error: 'Plan not found' });

    const newPlan = mcDB.createPlan({
      title: `[Clone] ${original.title}`,
      description: original.description || '',
      projectId: original.projectId || 'default',
      source: 'dashboard',
    });

    if (original.strategy) {
      mcDB.updatePlan(newPlan.id, { strategy: original.strategy });
    }

    const tasks = mcDB.listTasksByPlan(req.params.id);
    const realTasks = tasks.filter(t => t.action !== 'plan-analyze');
    realTasks.forEach((t, i) => {
      mcDB.createTask({
        planId: newPlan.id,
        title: t.title,
        description: t.description,
        type: t.type || 'layer3',
        action: t.action,
        params: typeof t.params === 'string' ? JSON.parse(t.params || '{}') : (t.params || {}),
        orderIndex: t.orderIndex !== undefined ? t.orderIndex : i,
        timeout: t.timeout || 300,
        status: 'pending',
      });
    });

    const full = mcDB.getPlan(newPlan.id);
    gateway.broadcast({ type: 'mc:plan_created', data: { plan: full } });
    res.json(full);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

describe('POST /plans/:id/clone', () => {
  let mcDB, broadcasts;

  beforeEach(() => {
    mcDB = createMcDB();
    broadcasts = [];
  });

  const gateway = { broadcast(msg) { broadcasts.push(msg); } };

  test('returns 404 for non-existent plan', async () => {
    const req = mockReq({ id: 'plan-nonexistent' });
    const res = mockRes();
    await cloneHandler(mcDB, gateway, req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('Plan not found');
  });

  test('clones plan with [Clone] prefix title', async () => {
    const orig = mcDB.createPlan({ title: 'My Plan', description: 'desc', projectId: 'default', source: 'dashboard' });
    const req = mockReq({ id: orig.id });
    const res = mockRes();
    await cloneHandler(mcDB, gateway, req, res);

    expect(res._status).toBe(200);
    expect(res._body.title).toBe('[Clone] My Plan');
    expect(res._body.description).toBe('desc');
  });

  test('copies strategy to cloned plan', async () => {
    const orig = mcDB.createPlan({ title: 'Plan', description: '', projectId: 'default', source: 'dashboard' });
    mcDB.updatePlan(orig.id, { strategy: 'Do X then Y' });
    const req = mockReq({ id: orig.id });
    const res = mockRes();
    await cloneHandler(mcDB, gateway, req, res);

    expect(res._body.strategy).toBe('Do X then Y');
  });

  test('cloned tasks always have pending status regardless of original', async () => {
    const orig = mcDB.createPlan({ title: 'Plan', description: '', projectId: 'default', source: 'dashboard' });
    mcDB.createTask({ planId: orig.id, title: 'Task 1', description: 'done task', type: 'layer3', action: 'worker-dispatch', params: {}, orderIndex: 0, timeout: 300, status: 'done' });
    mcDB.createTask({ planId: orig.id, title: 'Task 2', description: 'failed task', type: 'layer3', action: 'worker-dispatch', params: {}, orderIndex: 1, timeout: 300, status: 'failed' });
    mcDB.createTask({ planId: orig.id, title: 'Task 3', description: 'running task', type: 'layer3', action: 'worker-dispatch', params: {}, orderIndex: 2, timeout: 300, status: 'running' });

    const req = mockReq({ id: orig.id });
    const res = mockRes();
    await cloneHandler(mcDB, gateway, req, res);

    const clonedTasks = res._body.tasks;
    expect(clonedTasks).toHaveLength(3);
    clonedTasks.forEach(t => {
      expect(t.status).toBe('pending');
    });
  });

  test('skips plan-analyze tasks during clone', async () => {
    const orig = mcDB.createPlan({ title: 'Plan', description: '', projectId: 'default', source: 'dashboard' });
    mcDB.createTask({ planId: orig.id, title: 'AI Analysis', description: '', type: 'layer3', action: 'plan-analyze', params: {}, orderIndex: -1, timeout: 120 });
    mcDB.createTask({ planId: orig.id, title: 'Real Task', description: '', type: 'layer3', action: 'worker-dispatch', params: {}, orderIndex: 0, timeout: 300 });

    const req = mockReq({ id: orig.id });
    const res = mockRes();
    await cloneHandler(mcDB, gateway, req, res);

    expect(res._body.tasks).toHaveLength(1);
    expect(res._body.tasks[0].title).toBe('Real Task');
  });

  test('broadcasts mc:plan_created WS event', async () => {
    const orig = mcDB.createPlan({ title: 'Plan', description: '', projectId: 'default', source: 'dashboard' });
    const req = mockReq({ id: orig.id });
    const res = mockRes();
    await cloneHandler(mcDB, gateway, req, res);

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].type).toBe('mc:plan_created');
    expect(broadcasts[0].data.plan.title).toBe('[Clone] Plan');
  });

  test('preserves task params during clone', async () => {
    const orig = mcDB.createPlan({ title: 'Plan', description: '', projectId: 'default', source: 'dashboard' });
    mcDB.createTask({ planId: orig.id, title: 'Task', description: '', type: 'layer3', action: 'worker-dispatch', params: { template: 'code-review', description: 'Review code' }, orderIndex: 0, timeout: 300 });

    const req = mockReq({ id: orig.id });
    const res = mockRes();
    await cloneHandler(mcDB, gateway, req, res);

    const clonedParams = res._body.tasks[0].params;
    expect(clonedParams.template).toBe('code-review');
    expect(clonedParams.description).toBe('Review code');
  });
});


// ─── Frontend: Button Rendering Tests ───────────────────

function createMockDOM() {
  const elements = {};
  const createElement = (tag) => {
    let _textContent = '';
    let _innerHTML = '';
    return {
      tagName: tag,
      get textContent() { return _textContent; },
      set textContent(v) { _textContent = v; },
      get innerHTML() { return _innerHTML; },
      set innerHTML(v) { _innerHTML = v; _textContent = v; },
      className: '',
      style: {},
      dataset: {},
      classList: { _classes: new Set(), add(c) { this._classes.add(c); }, remove(...cs) { cs.forEach(c => this._classes.delete(c)); }, contains(c) { return this._classes.has(c); } },
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
  };
  return {
    document: {
      getElementById: (id) => { if (!elements[id]) { elements[id] = createElement('div'); elements[id].id = id; } return elements[id]; },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement,
      addEventListener: () => {},
      removeEventListener: () => {},
      body: { appendChild: () => {} },
      visibilityState: 'visible',
    },
    elements,
  };
}

function loadAppForButtonTests() {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'gateway', 'dashboard', 'app.js'), 'utf-8');
  const mock = createMockDOM();
  const ctx = {
    document: mock.document,
    window: { location: { host: 'localhost:3000' } },
    WebSocket: class { send() {} close() {} set onopen(fn) {} set onclose(fn) {} set onmessage(fn) {} set onerror(fn) {} },
    fetch: async () => ({ status: 200, json: async () => ({}) }),
    console,
    setTimeout: (fn) => fn(),
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
  return { ctx, mock };
}

describe('renderPlanDetail — bulk action buttons', () => {
  let ctx, mock;

  beforeEach(() => {
    ({ ctx, mock } = loadAppForButtonTests());
  });

  test('shows Retry All Failed button when plan has failed tasks', () => {
    const plan = {
      id: 'plan-1', title: 'Test', status: 'active', strategy: null,
      tasks: [
        { id: 't1', status: 'failed', title: 'A', action: 'worker-dispatch', orderIndex: 0 },
        { id: 't2', status: 'done', title: 'B', action: 'worker-dispatch', orderIndex: 1 },
      ],
    };
    ctx.renderPlanDetail(plan);
    const actionsHtml = mock.elements['plan-actions'].innerHTML;
    expect(actionsHtml).toContain('retry-all');
    expect(actionsHtml).toContain('Retry All Failed (1)');
  });

  test('hides Retry All Failed button when no failed tasks', () => {
    const plan = {
      id: 'plan-1', title: 'Test', status: 'active', strategy: null,
      tasks: [
        { id: 't1', status: 'done', title: 'A', action: 'worker-dispatch', orderIndex: 0 },
      ],
    };
    ctx.renderPlanDetail(plan);
    const actionsHtml = mock.elements['plan-actions'].innerHTML;
    expect(actionsHtml).not.toContain('retry-all');
  });

  test('shows Cancel All button when plan has running/queued tasks', () => {
    const plan = {
      id: 'plan-1', title: 'Test', status: 'active', strategy: null,
      tasks: [
        { id: 't1', status: 'running', title: 'A', action: 'worker-dispatch', orderIndex: 0 },
        { id: 't2', status: 'queued', title: 'B', action: 'worker-dispatch', orderIndex: 1 },
      ],
    };
    ctx.renderPlanDetail(plan);
    const actionsHtml = mock.elements['plan-actions'].innerHTML;
    expect(actionsHtml).toContain('cancel-all');
    expect(actionsHtml).toContain('Cancel All (2)');
  });

  test('hides Cancel All button when no running/queued tasks', () => {
    const plan = {
      id: 'plan-1', title: 'Test', status: 'done', strategy: null,
      tasks: [
        { id: 't1', status: 'done', title: 'A', action: 'worker-dispatch', orderIndex: 0 },
      ],
    };
    ctx.renderPlanDetail(plan);
    const actionsHtml = mock.elements['plan-actions'].innerHTML;
    expect(actionsHtml).not.toContain('cancel-all');
  });

  test('Clone button is always visible', () => {
    const plan = {
      id: 'plan-1', title: 'Test', status: 'done', strategy: null,
      tasks: [],
    };
    ctx.renderPlanDetail(plan);
    const actionsHtml = mock.elements['plan-actions'].innerHTML;
    expect(actionsHtml).toContain('clone');
    expect(actionsHtml).toContain('📋 Clone');
  });

  test('excludes plan-analyze tasks from button counts', () => {
    const plan = {
      id: 'plan-1', title: 'Test', status: 'active', strategy: null,
      tasks: [
        { id: 't0', status: 'failed', title: 'AI Analysis', action: 'plan-analyze', orderIndex: -1 },
        { id: 't1', status: 'failed', title: 'Real Task', action: 'worker-dispatch', orderIndex: 0 },
      ],
    };
    ctx.renderPlanDetail(plan);
    const actionsHtml = mock.elements['plan-actions'].innerHTML;
    // Should show count of 1 (only real task), not 2
    expect(actionsHtml).toContain('Retry All Failed (1)');
  });
});
