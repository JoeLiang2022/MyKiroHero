'use strict';

/**
 * Tests for Dashboard Output UX features:
 * - Strategy markdown rendering with DOMPurify sanitization
 * - Collapsible task output (collapsed default, auto-expand running)
 * - Progress log / final result separation
 * - Copy-to-clipboard button
 * - WS streaming auto-expand
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

function createMockDOM() {
  const elements = {};

  const createElement = (tag) => {
    let _textContent = '';
    let _innerHTML = '';
    const _children = [];
    const el = {
      tagName: tag,
      get textContent() { return _textContent; },
      set textContent(v) { _textContent = v; },
      get innerHTML() {
        if (!_innerHTML && _textContent) {
          return _textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
        return _innerHTML;
      },
      set innerHTML(v) { _innerHTML = v; _textContent = v; },
      className: '',
      style: {},
      dataset: {},
      id: '',
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      },
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: () => {},
      appendChild: (child) => { _children.push(child); },
      remove: () => {},
      select: () => {},
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
      body: { appendChild: () => {}, removeChild: () => {} },
    },
    elements,
  };
}

function loadAppContext(opts = {}) {
  const appSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'gateway', 'dashboard', 'app.js'),
    'utf-8'
  );

  const mock = createMockDOM();

  // Mock marked and DOMPurify
  const markedCalls = [];
  const purifyCalls = [];

  const ctx = {
    document: mock.document,
    window: { location: { host: 'localhost:3000' } },
    WebSocket: class { send() {} close() {} },
    fetch: async () => ({ status: 200, json: async () => ({}) }),
    console,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    setInterval: () => {},
    Date,
    JSON,
    URLSearchParams,
    Math,
    navigator: {
      clipboard: {
        writeText: async () => {},
      },
    },
    event: { target: { classList: { add() {}, remove() {} } } },
  };

  // Conditionally add marked/DOMPurify
  if (opts.withMarked !== false) {
    ctx.marked = {
      parse: (str) => {
        markedCalls.push(str);
        return `<p>${str}</p>`;
      },
    };
  }
  if (opts.withDOMPurify !== false) {
    ctx.DOMPurify = {
      sanitize: (html) => {
        purifyCalls.push(html);
        return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      },
    };
  }

  vm.createContext(ctx);
  vm.runInContext(appSrc, ctx, { filename: 'app.js' });
  vm.runInContext('function _getState() { return state; }', ctx);

  return { ctx, mock, getState: ctx._getState, markedCalls, purifyCalls };
}

// ─── Tests ──────────────────────────────────────────────

describe('Dashboard Output UX', () => {
  describe('Strategy Markdown Rendering', () => {
    test('renders strategy with marked.parse() and DOMPurify.sanitize()', () => {
      const { ctx, mock, markedCalls, purifyCalls } = loadAppContext();
      const plan = {
        id: 'plan-1', title: 'Test Plan', status: 'active',
        strategy: '## Hello\n- item 1\n- item 2',
        tasks: [],
      };
      ctx.renderPlanDetail(plan);

      expect(markedCalls).toContain('## Hello\n- item 1\n- item 2');
      expect(purifyCalls.length).toBe(1);
      const stratEl = mock.elements['strategy-text'];
      expect(stratEl.innerHTML).toContain('<p>');
    });

    test('falls back to textContent when marked is not available', () => {
      const { ctx, mock } = loadAppContext({ withMarked: false, withDOMPurify: false });
      const plan = {
        id: 'plan-1', title: 'Test', status: 'active',
        strategy: 'plain text strategy',
        tasks: [],
      };
      ctx.renderPlanDetail(plan);

      const stratEl = mock.elements['strategy-text'];
      expect(stratEl.textContent).toBe('plain text strategy');
    });

    test('uses marked without DOMPurify when DOMPurify is unavailable', () => {
      const { ctx, mock, markedCalls } = loadAppContext({ withDOMPurify: false });
      const plan = {
        id: 'plan-1', title: 'Test', status: 'active',
        strategy: '**bold**',
        tasks: [],
      };
      ctx.renderPlanDetail(plan);

      expect(markedCalls).toContain('**bold**');
      // Should still render (raw marked output without sanitization)
      const stratEl = mock.elements['strategy-text'];
      expect(stratEl.innerHTML).toBeTruthy();
    });

    test('hides strategy section when no strategy', () => {
      const { ctx, mock } = loadAppContext();
      const plan = { id: 'plan-1', title: 'Test', status: 'active', strategy: '', tasks: [] };
      ctx.renderPlanDetail(plan);

      const stratSection = mock.elements['strategy-section'];
      expect(stratSection.style.display).toBe('none');
    });
  });

  describe('Collapsible Task Output', () => {
    test('task with output renders details element (collapsed by default)', () => {
      const { ctx, mock } = loadAppContext();
      const plan = {
        id: 'plan-1', title: 'Test', status: 'done',
        tasks: [{
          id: 'task-1', title: 'Task 1', status: 'done',
          output: 'Final result here', progressLog: '[]',
        }],
      };
      ctx.renderPlanDetail(plan);

      const taskList = mock.elements['task-list'];
      const html = taskList.innerHTML;
      // Should have details element
      expect(html).toContain('task-output-details');
      expect(html).toContain('<summary');
      expect(html).toContain('Output');
      // Should NOT have 'open' attribute (collapsed by default for done tasks)
      expect(html).not.toMatch(/task-output-details-task-1"\s+open/);
    });

    test('running task output is auto-expanded (open attribute)', () => {
      const { ctx, mock } = loadAppContext();
      const plan = {
        id: 'plan-1', title: 'Test', status: 'active',
        tasks: [{
          id: 'task-r', title: 'Running Task', status: 'running',
          output: 'In progress...', progressLog: '[]',
        }],
      };
      ctx.renderPlanDetail(plan);

      const taskList = mock.elements['task-list'];
      const html = taskList.innerHTML;
      expect(html).toMatch(/task-output-details-task-r"\s+open/);
    });

    test('task with no output has no details element', () => {
      const { ctx, mock } = loadAppContext();
      const plan = {
        id: 'plan-1', title: 'Test', status: 'pending',
        tasks: [{
          id: 'task-empty', title: 'Empty Task', status: 'pending',
          output: '', progressLog: '[]',
        }],
      };
      ctx.renderPlanDetail(plan);

      const taskList = mock.elements['task-list'];
      const html = taskList.innerHTML;
      expect(html).not.toContain('task-output-details-task-empty');
    });
  });

  describe('Progress Log / Final Result Separation', () => {
    test('renders both progress and result sections when both exist', () => {
      const { ctx, mock } = loadAppContext();
      const progressLog = JSON.stringify([
        { message: 'Step 1 done' },
        { message: 'Step 2 done' },
      ]);
      const plan = {
        id: 'plan-1', title: 'Test', status: 'done',
        tasks: [{
          id: 'task-both', title: 'Task Both', status: 'done',
          output: 'Final output text',
          progressLog,
        }],
      };
      ctx.renderPlanDetail(plan);

      const html = mock.elements['task-list'].innerHTML;
      // Progress section
      expect(html).toContain('Progress Log');
      expect(html).toContain('task-progress-task-both');
      expect(html).toContain('Step 1 done');
      expect(html).toContain('Step 2 done');
      // Result section
      expect(html).toContain('Result');
      expect(html).toContain('task-final-task-both');
      expect(html).toContain('Final output text');
    });

    test('renders only progress section when no final output', () => {
      const { ctx, mock } = loadAppContext();
      const progressLog = JSON.stringify([{ message: 'Progress only' }]);
      const plan = {
        id: 'plan-1', title: 'Test', status: 'active',
        tasks: [{
          id: 'task-prog', title: 'Progress Only', status: 'running',
          output: '',
          progressLog,
        }],
      };
      ctx.renderPlanDetail(plan);

      const html = mock.elements['task-list'].innerHTML;
      expect(html).toContain('Progress Log');
      expect(html).toContain('Progress only');
      expect(html).not.toContain('task-final-task-prog');
    });

    test('renders only result section when no progress log', () => {
      const { ctx, mock } = loadAppContext();
      const plan = {
        id: 'plan-1', title: 'Test', status: 'done',
        tasks: [{
          id: 'task-res', title: 'Result Only', status: 'done',
          output: 'Just the result',
          progressLog: '[]',
        }],
      };
      ctx.renderPlanDetail(plan);

      const html = mock.elements['task-list'].innerHTML;
      expect(html).toContain('Result');
      expect(html).toContain('Just the result');
      expect(html).not.toContain('task-progress-task-res');
    });
  });

  describe('Copy Button', () => {
    test('copy buttons are rendered for each output section', () => {
      const { ctx, mock } = loadAppContext();
      const progressLog = JSON.stringify([{ message: 'log entry' }]);
      const plan = {
        id: 'plan-1', title: 'Test', status: 'done',
        tasks: [{
          id: 'task-cp', title: 'Copy Test', status: 'done',
          output: 'result text',
          progressLog,
        }],
      };
      ctx.renderPlanDetail(plan);

      const html = mock.elements['task-list'].innerHTML;
      // Should have copy buttons for both progress and result
      expect(html).toContain("copyOutputText(this, 'progress-task-cp')");
      expect(html).toContain("copyOutputText(this, 'final-task-cp')");
      expect(html).toContain('copy-btn');
    });

    test('copyOutputText function exists and is callable', () => {
      const { ctx } = loadAppContext();
      expect(typeof ctx.copyOutputText).toBe('function');
    });
  });

  describe('WS Streaming Output', () => {
    test('hidden stream container is rendered for each task', () => {
      const { ctx, mock } = loadAppContext();
      const plan = {
        id: 'plan-1', title: 'Test', status: 'pending',
        tasks: [{
          id: 'task-ws', title: 'WS Task', status: 'pending',
          output: '', progressLog: '[]',
        }],
      };
      ctx.renderPlanDetail(plan);

      const html = mock.elements['task-list'].innerHTML;
      expect(html).toContain('task-output-task-ws');
      expect(html).toContain('display:none');
    });
  });

  describe('Task Output HTML Escaping', () => {
    test('output content is sanitized to prevent XSS', () => {
      const { ctx, mock } = loadAppContext();
      const plan = {
        id: 'plan-1', title: 'Test', status: 'done',
        tasks: [{
          id: 'task-xss', title: 'XSS Test', status: 'done',
          output: '<script>alert("xss")</script>',
          progressLog: '[]',
        }],
      };
      ctx.renderPlanDetail(plan);

      const html = mock.elements['task-list'].innerHTML;
      // DOMPurify should strip script tags from markdown-rendered output
      expect(html).not.toContain('<script>alert');
    });
  });
});
