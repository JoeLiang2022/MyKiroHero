'use strict';

/**
 * Tests for Dashboard mobile responsive behavior
 * Covers: toggleSidebar, closeSidebar, hamburger button init,
 * backdrop click handler, closeSidebar called in selectPlan
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ─── Mock DOM ───────────────────────────────────────────

function createMockDOM() {
  const elements = {};
  const elListeners = {};
  const docListeners = {};

  const createElement = (tag) => {
    let _textContent = '';
    let _innerHTML = '';
    const _attrs = {};
    const el = {
      tagName: tag,
      get textContent() { return _textContent; },
      set textContent(v) { _textContent = v; },
      get innerHTML() { return _innerHTML; },
      set innerHTML(v) { _innerHTML = v; _textContent = v; },
      className: '',
      style: {},
      dataset: {},
      disabled: false,
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
      setAttribute(name, value) { _attrs[name] = String(value); },
      getAttribute(name) { return _attrs[name] || null; },
      get offsetWidth() { return 100; },
      get firstElementChild() { return null; },
      get children() { return { length: 0 }; },
      get parentNode() { return null; },
      get scrollHeight() { return 0; },
      set scrollTop(_v) {},
      value: '',
    };
    return el;
  };

  // Track addEventListener calls per element ID
  const trackListener = (id, evt, fn) => {
    if (!elListeners[id]) elListeners[id] = {};
    if (!elListeners[id][evt]) elListeners[id][evt] = [];
    elListeners[id][evt].push(fn);
  };

  const makeTrackedElement = (id) => {
    const el = createElement('div');
    el.id = id;
    el.addEventListener = (evt, fn) => trackListener(id, evt, fn);
    return el;
  };

  // Pre-create elements that init() will look up
  const knownIds = [
    'hamburger-btn', 'sidebar-backdrop', 'gw-status',
    'stat-plans', 'stat-workers', 'stat-tasks',
    'worker-panel', 'worker-panel-inner', 'worker-stat-toggle',
    'issue-panel', 'issue-panel-header', 'issue-panel-counts',
    'issue-panel-toggle', 'issue-panel-body', 'issue-loading', 'issue-list',
    'mission-list', 'plan-detail', 'empty-state',
    'plan-title', 'plan-badge', 'plan-source', 'plan-actions',
    'strategy-section', 'strategy-text', 'task-board', 'task-board-title', 'task-list',
    'content-area', 'project-select', 'btn-new-mission', 'btn-send',
    'input-field', 'template-select', 'sidebar-search', 'layer-filter',
    'btn-manage-projects', 'toast-container',
    'mc-timeline-view', 'mcTlFrom', 'mcTlTo', 'mcTlSummary', 'mcTlContent',
  ];
  for (const id of knownIds) {
    elements[id] = makeTrackedElement(id);
  }

  // Sidebar element with querySelector support for '.sidebar'
  const sidebarEl = createElement('div');
  sidebarEl.className = 'sidebar';

  return {
    document: {
      getElementById: (id) => {
        if (!elements[id]) {
          elements[id] = makeTrackedElement(id);
        }
        return elements[id];
      },
      querySelector: (sel) => {
        if (sel === '.sidebar') return sidebarEl;
        if (sel === '.main') { const e = createElement('div'); e.style = {}; return e; }
        if (sel === '.input-bar') { const e = createElement('div'); e.style = {}; return e; }
        if (sel === '#worker-stat-toggle .label') return createElement('div');
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === '.topbar-tab') return [createElement('div'), createElement('div')];
        if (sel === '.mission-item') return [];
        if (sel === '.mc-tl-range-btn') return [];
        return [];
      },
      createElement,
      addEventListener: (evt, fn) => {
        if (!docListeners[evt]) docListeners[evt] = [];
        docListeners[evt].push(fn);
      },
      removeEventListener: () => {},
      body: { appendChild: () => {} },
      visibilityState: 'visible',
    },
    elements,
    elListeners,
    docListeners,
    sidebarEl,
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
    WebSocket: class {
      send() {}
      close() {}
      set onopen(fn) { this._onopen = fn; }
      set onclose(fn) { this._onclose = fn; }
      set onmessage(fn) { this._onmessage = fn; }
      set onerror(fn) { this._onerror = fn; }
    },
    fetch: async (url) => ({
      status: 200,
      json: async () => {
        if (url.includes('/stats')) return { activePlans: 0, workers: [], todayTasks: 0 };
        if (url.includes('/issues/stats')) return { stats: { total: 0, openCount: 0, byStatus: [], byPriority: [] } };
        if (url.includes('/plans/test-plan-1')) return { id: 'test-plan-1', title: 'Test', status: 'active', tasks: [] };
        if (url.includes('/plans')) return [];
        if (url.includes('/projects')) return [];
        return {};
      },
    }),
    console,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    setInterval: () => {},
    Date,
    JSON,
    URLSearchParams,
    Math,
    requestAnimationFrame: (fn) => fn(),
    navigator: { clipboard: { writeText: async () => {} } },
    event: { target: { classList: { add() {}, remove() {} } } },
    DOMPurify: { sanitize: (s) => s },
    marked: { parse: (s) => s },
  };

  vm.createContext(ctx);
  vm.runInContext(appSrc, ctx, { filename: 'app.js' });

  // Fire DOMContentLoaded to trigger init()
  if (mock.docListeners.DOMContentLoaded) {
    mock.docListeners.DOMContentLoaded.forEach(fn => fn());
  }

  return { ctx, mock };
}

// ─── Tests ──────────────────────────────────────────────

describe('Dashboard Mobile Responsive', () => {
  let ctx, mock;

  beforeEach(() => {
    ({ ctx, mock } = loadAppContext());
  });

  // ─── toggleSidebar ────────────────────────────────

  describe('toggleSidebar', () => {
    test('opens sidebar drawer and shows backdrop', () => {
      ctx.toggleSidebar();
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(true);
      expect(mock.elements['sidebar-backdrop'].classList.contains('visible')).toBe(true);
    });

    test('closes sidebar drawer if already open', () => {
      ctx.toggleSidebar();
      ctx.toggleSidebar();
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(false);
      expect(mock.elements['sidebar-backdrop'].classList.contains('visible')).toBe(false);
    });

    test('toggle cycle works correctly', () => {
      ctx.toggleSidebar(); // open
      ctx.toggleSidebar(); // close
      ctx.toggleSidebar(); // open
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(true);
      ctx.toggleSidebar(); // close
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(false);
    });
  });

  // ─── closeSidebar ─────────────────────────────────

  describe('closeSidebar', () => {
    test('removes drawer-open from sidebar', () => {
      mock.sidebarEl.classList.add('drawer-open');
      mock.elements['sidebar-backdrop'].classList.add('visible');
      ctx.closeSidebar();
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(false);
    });

    test('removes visible from backdrop', () => {
      mock.elements['sidebar-backdrop'].classList.add('visible');
      ctx.closeSidebar();
      expect(mock.elements['sidebar-backdrop'].classList.contains('visible')).toBe(false);
    });

    test('is safe to call when already closed', () => {
      ctx.closeSidebar();
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(false);
      expect(mock.elements['sidebar-backdrop'].classList.contains('visible')).toBe(false);
    });
  });

  // ─── selectPlan closes sidebar ────────────────────

  describe('selectPlan closes sidebar', () => {
    test('closes sidebar drawer when a plan is selected', async () => {
      ctx.toggleSidebar();
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(true);
      await ctx.selectPlan('test-plan-1');
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(false);
      expect(mock.elements['sidebar-backdrop'].classList.contains('visible')).toBe(false);
    });
  });

  // ─── init wiring ──────────────────────────────────

  describe('init event wiring', () => {
    test('hamburger-btn has click listener registered', () => {
      const listeners = mock.elListeners['hamburger-btn'];
      expect(listeners).toBeDefined();
      expect(listeners.click).toBeDefined();
      expect(listeners.click.length).toBeGreaterThan(0);
    });

    test('sidebar-backdrop has click listener registered', () => {
      const listeners = mock.elListeners['sidebar-backdrop'];
      expect(listeners).toBeDefined();
      expect(listeners.click).toBeDefined();
      expect(listeners.click.length).toBeGreaterThan(0);
    });

    test('hamburger click listener opens sidebar', () => {
      const handler = mock.elListeners['hamburger-btn'].click[0];
      handler();
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(true);
    });

    test('backdrop click listener closes sidebar', () => {
      ctx.toggleSidebar();
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(true);
      const handler = mock.elListeners['sidebar-backdrop'].click[0];
      handler();
      expect(mock.sidebarEl.classList.contains('drawer-open')).toBe(false);
    });
  });
});
