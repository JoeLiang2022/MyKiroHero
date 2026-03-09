'use strict';

/**
 * Tests for Dashboard Worker Panel functions
 * Uses Node's vm module to load app.js with a minimal DOM mock
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// Minimal DOM mock for loading app.js
function createMockDOM() {
  const elements = {};

  const createElement = (tag) => {
    let _textContent = '';
    let _innerHTML = '';
    const _children = [];
    const _clickHandlers = [];
    const el = {
      tagName: tag,
      _clickHandlers,
      get textContent() { return _textContent; },
      set textContent(v) { _textContent = v; },
      get innerHTML() {
        // When used by esc(), return escaped version of textContent
        if (!_innerHTML && _textContent) {
          return _textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
        return _innerHTML;
      },
      set innerHTML(v) {
        _innerHTML = v;
        _textContent = v;
        // Parse button elements from innerHTML for querySelector support
        _children.length = 0;
        const btnRegex = /<button\s+class="([^"]*?)"\s+id="([^"]*?)">([\s\S]*?)<\/button>/g;
        let match;
        while ((match = btnRegex.exec(v)) !== null) {
          const child = createElement('button');
          child.className = match[1];
          child.id = match[2];
          child.textContent = match[3];
          _children.push(child);
        }
      },
      className: '',
      style: {},
      dataset: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      },
      querySelectorAll: (sel) => {
        return _children.filter(c => {
          if (sel.startsWith('#')) return c.id === sel.slice(1);
          return false;
        });
      },
      querySelector: (sel) => {
        return _children.find(c => {
          if (sel.startsWith('#')) return c.id === sel.slice(1);
          return false;
        }) || null;
      },
      addEventListener: (evt, fn) => {
        if (evt === 'click') _clickHandlers.push(fn);
      },
      appendChild: (child) => { _children.push(child); },
      remove: () => {},
      children: _children,
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
      addEventListener: () => {},
      body: { appendChild: () => {} },
    },
    elements,
  };
}

function loadAppContext() {
  const appSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'gateway', 'dashboard', 'app.js'),
    'utf-8'
  );

  const mock = createMockDOM();
  const ctx = {
    document: mock.document,
    window: { location: { host: 'localhost:3000' } },
    WebSocket: class { send() {} close() {} },
    fetch: async () => ({ json: async () => ({}) }),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    Date,
    JSON,
    URLSearchParams,
    Math,
    event: { target: { classList: { add() {}, remove() {} } } },
  };

  vm.createContext(ctx);
  vm.runInContext(appSrc, ctx, { filename: 'app.js' });
  vm.runInContext('function _getState() { return state; }', ctx);

  return { ctx, mock, getState: ctx._getState };
}

describe('Dashboard Worker Panel', () => {
  let ctx, mock, getState;

  beforeEach(() => {
    ({ ctx, mock, getState } = loadAppContext());
  });

  describe('truncateTaskId', () => {
    test('returns empty string for falsy input', () => {
      expect(ctx.truncateTaskId(null)).toBe('');
      expect(ctx.truncateTaskId('')).toBe('');
      expect(ctx.truncateTaskId(undefined)).toBe('');
    });

    test('returns short taskId unchanged', () => {
      expect(ctx.truncateTaskId('task-123')).toBe('task-123');
    });

    test('truncates taskId longer than 24 chars', () => {
      const longId = 'task-20260221-010842-87f-extra-long';
      const result = ctx.truncateTaskId(longId);
      expect(result.length).toBe(25); // 24 + ellipsis char
      expect(result).toBe(longId.slice(0, 24) + '\u2026');
    });

    test('returns exactly 24-char taskId unchanged', () => {
      const exact = 'abcdefghijklmnopqrstuvwx'; // 24 chars
      expect(ctx.truncateTaskId(exact)).toBe(exact);
    });
  });

  describe('toggleWorkerPanel', () => {
    test('toggles workerPanelOpen state', () => {
      expect(getState().workerPanelOpen).toBe(false);
      ctx.toggleWorkerPanel();
      expect(getState().workerPanelOpen).toBe(true);
      ctx.toggleWorkerPanel();
      expect(getState().workerPanelOpen).toBe(false);
    });

    test('adds open class to panel when opening', () => {
      ctx.toggleWorkerPanel();
      const panel = mock.elements['worker-panel'];
      expect(panel.classList.contains('open')).toBe(true);
    });

    test('removes open class when closing', () => {
      ctx.toggleWorkerPanel(); // open
      ctx.toggleWorkerPanel(); // close
      const panel = mock.elements['worker-panel'];
      expect(panel.classList.contains('open')).toBe(false);
    });
  });

  describe('renderWorkerPanel', () => {
    test('shows empty message when no workers', () => {
      ctx.renderWorkerPanel([]);
      const inner = mock.elements['worker-panel-inner'];
      expect(inner.innerHTML).toContain('No workers registered');
    });

    test('renders worker cards with correct status classes', () => {
      const workers = [
        { workerId: 'worker-1', status: 'idle', lastSeen: new Date().toISOString(), currentTaskId: null },
        { workerId: 'worker-2', status: 'busy', lastSeen: new Date().toISOString(), currentTaskId: 'task-abc' },
      ];
      ctx.renderWorkerPanel(workers);
      const inner = mock.elements['worker-panel-inner'];
      expect(inner.innerHTML).toContain('worker-card-dot idle');
      expect(inner.innerHTML).toContain('worker-card-dot busy');
      expect(inner.innerHTML).toContain('worker-1');
      expect(inner.innerHTML).toContain('worker-2');
    });

    test('renders offline worker with correct status class', () => {
      ctx.renderWorkerPanel([{ workerId: 'w-3', status: 'offline', lastSeen: null, currentTaskId: null }]);
      const inner = mock.elements['worker-panel-inner'];
      expect(inner.innerHTML).toContain('worker-card-dot offline');
    });

    test('renders clickable task link for busy worker', () => {
      ctx.renderWorkerPanel([{ workerId: 'w-1', status: 'busy', lastSeen: null, currentTaskId: 'task-xyz' }]);
      const inner = mock.elements['worker-panel-inner'];
      expect(inner.innerHTML).toContain('worker-card-task');
      expect(inner.innerHTML).toContain('task-xyz');
      expect(inner.innerHTML).toContain('navigateToWorkerTask');
    });

    test('renders dash for idle worker with no task', () => {
      ctx.renderWorkerPanel([{ workerId: 'w-1', status: 'idle', lastSeen: null, currentTaskId: null }]);
      const inner = mock.elements['worker-panel-inner'];
      expect(inner.innerHTML).toContain('worker-card-notask');
    });

    test('handles null input gracefully', () => {
      ctx.renderWorkerPanel(null);
      const inner = mock.elements['worker-panel-inner'];
      expect(inner.innerHTML).toContain('No workers registered');
    });
  });

  describe('state initialization', () => {
    test('workers array starts empty', () => {
      expect(getState().workers).toEqual([]);
    });

    test('workerPanelOpen starts false', () => {
      expect(getState().workerPanelOpen).toBe(false);
    });
  });

  describe('setBtnLoading', () => {
    test('sets button to loading state', () => {
      const btn = mock.document.createElement('button');
      btn.textContent = 'Execute';
      btn.disabled = false;
      btn.dataset = {};
      btn.classList = {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      };
      ctx.setBtnLoading(btn, true);
      expect(btn.textContent).toBe('⏳');
      expect(btn.disabled).toBe(true);
      expect(btn.classList.contains('btn-loading')).toBe(true);
      expect(btn.dataset.origText).toBe('Execute');
    });

    test('restores button from loading state', () => {
      const btn = mock.document.createElement('button');
      btn.textContent = 'Execute';
      btn.disabled = false;
      btn.dataset = {};
      btn.classList = {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      };
      ctx.setBtnLoading(btn, true);
      ctx.setBtnLoading(btn, false);
      expect(btn.textContent).toBe('Execute');
      expect(btn.disabled).toBe(false);
      expect(btn.classList.contains('btn-loading')).toBe(false);
    });

    test('handles null button gracefully', () => {
      expect(() => ctx.setBtnLoading(null, true)).not.toThrow();
      expect(() => ctx.setBtnLoading(undefined, false)).not.toThrow();
    });
  });

  describe('showConfirm', () => {
    let appendedElements, docListeners;

    beforeEach(() => {
      appendedElements = [];
      docListeners = {};

      // Enhanced body.appendChild to track appended overlays
      mock.document.body.appendChild = (el) => { appendedElements.push(el); };

      // Enhanced document.addEventListener/removeEventListener for keyboard events
      mock.document.addEventListener = (evt, fn) => {
        if (!docListeners[evt]) docListeners[evt] = [];
        docListeners[evt].push(fn);
      };
      mock.document.removeEventListener = (evt, fn) => {
        if (docListeners[evt]) {
          docListeners[evt] = docListeners[evt].filter(f => f !== fn);
        }
      };

      // Re-load context with enhanced mocks
      const appSrc = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'gateway', 'dashboard', 'app.js'),
        'utf-8'
      );
      const newMock = createMockDOM();
      newMock.document.body.appendChild = (el) => { appendedElements.push(el); };
      newMock.document.addEventListener = (evt, fn) => {
        if (!docListeners[evt]) docListeners[evt] = [];
        docListeners[evt].push(fn);
      };
      newMock.document.removeEventListener = (evt, fn) => {
        if (docListeners[evt]) {
          docListeners[evt] = docListeners[evt].filter(f => f !== fn);
        }
      };

      const newCtx = {
        document: newMock.document,
        window: { location: { host: 'localhost:3000' } },
        WebSocket: class { send() {} close() {} },
        fetch: async () => ({ json: async () => ({}), status: 200 }),
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        Date,
        JSON,
        URLSearchParams,
        Math,
        requestAnimationFrame: (fn) => fn(),
        event: { target: { classList: { add() {}, remove() {} } } },
      };
      vm.createContext(newCtx);
      vm.runInContext(appSrc, newCtx, { filename: 'app.js' });
      ctx = newCtx;
      mock = newMock;
    });

    test('appends modal overlay to document body', () => {
      ctx.showConfirm('Title', 'Message');
      expect(appendedElements.length).toBe(1);
      expect(appendedElements[0].className).toBe('modal-overlay');
    });

    test('modal contains escaped title and message', () => {
      ctx.showConfirm('Test <b>Title</b>', 'Test <script>alert(1)</script>');
      const overlay = appendedElements[0];
      // innerHTML is set with esc() output — should not contain raw HTML tags
      expect(overlay.innerHTML).not.toContain('<b>');
      expect(overlay.innerHTML).not.toContain('<script>');
    });

    test('confirm button resolves true', async () => {
      const promise = ctx.showConfirm('Title', 'Msg');
      const overlay = appendedElements[0];
      // Simulate clicking confirm button
      const confirmBtn = overlay.querySelector('#confirm-ok-btn');
      confirmBtn.onclick();
      const result = await promise;
      expect(result).toBe(true);
    });

    test('cancel button resolves false', async () => {
      const promise = ctx.showConfirm('Title', 'Msg');
      const overlay = appendedElements[0];
      const cancelBtn = overlay.querySelector('#confirm-cancel-btn');
      cancelBtn.onclick();
      const result = await promise;
      expect(result).toBe(false);
    });

    test('clicking overlay background resolves false', async () => {
      const promise = ctx.showConfirm('Title', 'Msg');
      const overlay = appendedElements[0];
      // Simulate click on overlay itself (not inner modal)
      overlay._clickHandlers.forEach(fn => fn({ target: overlay }));
      const result = await promise;
      expect(result).toBe(false);
    });

    test('Escape key resolves false', async () => {
      const promise = ctx.showConfirm('Title', 'Msg');
      // Fire keydown Escape via document listener
      expect(docListeners['keydown'].length).toBeGreaterThan(0);
      docListeners['keydown'][0]({ key: 'Escape' });
      const result = await promise;
      expect(result).toBe(false);
    });

    test('applies danger class when confirmStyle is danger', () => {
      ctx.showConfirm('Delete?', 'Are you sure?', 'Delete', 'danger');
      const overlay = appendedElements[0];
      const confirmBtn = overlay.querySelector('#confirm-ok-btn');
      expect(confirmBtn.className).toContain('danger');
    });

    test('applies primary class by default', () => {
      ctx.showConfirm('Title', 'Msg');
      const overlay = appendedElements[0];
      const confirmBtn = overlay.querySelector('#confirm-ok-btn');
      expect(confirmBtn.className).toContain('primary');
      expect(confirmBtn.className).not.toContain('danger');
    });

    test('uses custom confirm label', () => {
      ctx.showConfirm('Title', 'Msg', 'Yes, do it');
      const overlay = appendedElements[0];
      const confirmBtn = overlay.querySelector('#confirm-ok-btn');
      expect(confirmBtn.textContent || confirmBtn.innerHTML).toContain('Yes, do it');
    });

    test('removes overlay from DOM after confirm', async () => {
      let removed = false;
      const promise = ctx.showConfirm('Title', 'Msg');
      const overlay = appendedElements[0];
      overlay.remove = () => { removed = true; };
      overlay.querySelector('#confirm-ok-btn').onclick();
      await promise;
      expect(removed).toBe(true);
    });

    test('removes overlay from DOM after cancel', async () => {
      let removed = false;
      const promise = ctx.showConfirm('Title', 'Msg');
      const overlay = appendedElements[0];
      overlay.remove = () => { removed = true; };
      overlay.querySelector('#confirm-cancel-btn').onclick();
      await promise;
      expect(removed).toBe(true);
    });
  });

  describe('executeSingleTask', () => {
    let fetchCalls, fetchResponses;

    beforeEach(() => {
      fetchCalls = [];
      fetchResponses = [];

      // Default: first call = execute POST (empty response), second = fetchPlan (plan data)
      fetchResponses = [
        { json: async () => ({}), status: 200 },
        { json: async () => ({ id: 'plan-1', title: 'Test', status: 'active', tasks: [] }), status: 200 },
      ];

      const appSrc = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'gateway', 'dashboard', 'app.js'),
        'utf-8'
      );
      const newMock = createMockDOM();

      let callIdx = 0;
      const newCtx = {
        document: newMock.document,
        window: { location: { host: 'localhost:3000' } },
        WebSocket: class { send() {} close() {} },
        fetch: async (url, opts) => {
          fetchCalls.push({ url, opts });
          return fetchResponses[callIdx++] || { json: async () => ({}), status: 200 };
        },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        Date,
        JSON,
        URLSearchParams,
        Math,
        requestAnimationFrame: (fn) => fn(),
        event: { target: { classList: { add() {}, remove() {} } } },
      };
      vm.createContext(newCtx);
      vm.runInContext(appSrc, newCtx, { filename: 'app.js' });
      vm.runInContext('function _getState() { return state; }', newCtx);

      ctx = newCtx;
      mock = newMock;
      getState = newCtx._getState;
    });

    test('does nothing when currentPlanId is null', async () => {
      expect(getState().currentPlanId).toBeNull();
      await ctx.executeSingleTask('task-1');
      expect(fetchCalls.length).toBe(0);
    });

    test('calls execute API with correct plan and task ID', async () => {
      getState().currentPlanId = 'plan-1';
      await ctx.executeSingleTask('task-abc');
      expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
      expect(fetchCalls[0].url).toContain('/plans/plan-1/execute?taskId=task-abc');
      expect(fetchCalls[0].opts.method).toBe('POST');
    });

    test('fetches fresh plan data after execution', async () => {
      getState().currentPlanId = 'plan-1';
      await ctx.executeSingleTask('task-abc');
      // Second call should be fetchPlan
      expect(fetchCalls.length).toBeGreaterThanOrEqual(2);
      expect(fetchCalls[1].url).toContain('/plans/plan-1');
    });

    test('sets button loading state during execution', async () => {
      getState().currentPlanId = 'plan-1';

      // Create a mock button with data-exec-id
      const btn = mock.document.createElement('button');
      btn.textContent = 'Execute';
      btn.disabled = false;
      btn.dataset = { execId: 'task-abc' };
      btn.classList = {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      };

      // Override querySelector to return our button
      mock.document.querySelector = (sel) => {
        if (sel === '[data-exec-id="task-abc"]') return btn;
        return null;
      };

      await ctx.executeSingleTask('task-abc');

      // After completion, button should be restored (loading=false)
      expect(btn.disabled).toBe(false);
      expect(btn.classList.contains('btn-loading')).toBe(false);
    });

    test('handles missing button gracefully (no data-exec-id match)', async () => {
      getState().currentPlanId = 'plan-1';
      mock.document.querySelector = () => null;
      // Should not throw
      await expect(ctx.executeSingleTask('task-nonexistent')).resolves.not.toThrow();
    });

    test('restores button state even when API throws', async () => {
      getState().currentPlanId = 'plan-1';

      const btn = mock.document.createElement('button');
      btn.textContent = 'Execute';
      btn.disabled = false;
      btn.dataset = { execId: 'task-err' };
      btn.classList = {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      };
      mock.document.querySelector = (sel) => {
        if (sel === '[data-exec-id="task-err"]') return btn;
        return null;
      };

      // Make fetch throw on first call
      fetchResponses = [
        { json: async () => { throw new Error('network'); }, status: 500 },
      ];

      try { await ctx.executeSingleTask('task-err'); } catch (e) { /* expected */ }

      // Button should be restored via finally block
      expect(btn.disabled).toBe(false);
      expect(btn.classList.contains('btn-loading')).toBe(false);
    });
  });
});
