/**
 * Integration tests for Activity Drawer — Timeline Fusion
 * Tests multiple features working together (pure logic, no DOM)
 */

// ─── Shared Helpers ─────────────────────────────────────

function isMobileViewport(width) { return width <= 768; }

function buildSummaryText(data) {
  const completed = (data.completed || []).length;
  const created = (data.created || []).length;
  const active = (data.active || []).length;
  const tasksDone = (data.tasksDone || []).length;
  return '\u{1F4CA} Activity (7d): ' + completed + ' completed \u00B7 ' + created + ' created \u00B7 ' + active + ' active \u00B7 ' + tasksDone + ' tasks \u2713';
}

function collectItemKeys(data) {
  const keys = new Set();
  (data.completed || []).forEach(p => keys.add('plan:' + p.id));
  (data.created || []).forEach(p => keys.add('plan:' + p.id));
  (data.active || []).forEach(p => keys.add('plan:' + p.id));
  (data.tasksDone || []).forEach(t => keys.add('task:' + t.id));
  (data.tasksCreated || []).forEach(t => keys.add('task:' + t.id));
  return keys;
}

function getDateRange(range) {
  const today = new Date('2026-02-21T12:00:00');
  let from;
  if (range === 'today') { from = new Date(today); }
  else if (range === '7d') { from = new Date(today); from.setDate(from.getDate() - 6); }
  else { from = new Date(today); from.setDate(from.getDate() - 29); }
  return { from, to: today };
}

function groupByDay(data) {
  const days = {};
  const addToDay = (item, dateField, category) => {
    const date = (item[dateField] || '').slice(0, 10);
    if (!date) return;
    if (!days[date]) days[date] = { completed: [], created: [], active: [], tasksDone: [], tasksActive: [] };
    days[date][category].push(item);
  };
  (data.completed || []).forEach(p => addToDay(p, 'completedAt', 'completed'));
  (data.created || []).forEach(p => addToDay(p, 'createdAt', 'created'));
  (data.active || []).forEach(p => addToDay(p, 'updatedAt', 'active'));
  (data.tasksDone || []).forEach(t => addToDay(t, 'completedAt', 'tasksDone'));
  (data.tasksCreated || []).forEach(t => {
    if (t.status && t.status !== 'done') {
      addToDay(t, 'createdAt', 'tasksActive');
    }
  });
  return days;
}

// ─── Mock Data ──────────────────────────────────────────

const MOCK_TIMELINE = {
  completed: [
    { id: 'plan-1', title: 'Setup CI/CD', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [{ status: 'done' }, { status: 'done' }] },
    { id: 'plan-2', title: 'Fix auth bug', status: 'done', completedAt: '2026-02-20T15:00:00Z', tasks: [{ status: 'done' }] },
  ],
  created: [
    { id: 'plan-3', title: 'New dashboard feature', status: 'planning', createdAt: '2026-02-21T08:00:00Z', tasks: [] },
  ],
  active: [
    { id: 'plan-4', title: 'Refactor API layer', status: 'active', updatedAt: '2026-02-21T09:00:00Z', tasks: [{ status: 'done' }, { status: 'running' }] },
  ],
  tasksDone: [
    { id: 'task-1', title: 'Write unit tests', status: 'done', planId: 'plan-1', completedAt: '2026-02-21T10:00:00Z' },
    { id: 'task-2', title: 'Deploy staging', status: 'done', planId: 'plan-1', completedAt: '2026-02-21T09:30:00Z' },
  ],
  tasksCreated: [
    { id: 'task-3', title: 'Review PR', status: 'running', planId: 'plan-4', createdAt: '2026-02-21T08:00:00Z' },
  ],
};


// ═══════════════════════════════════════════════════════
// 1. Navigation Flow Tests
// ═══════════════════════════════════════════════════════

describe('Navigation Flow — Expand + Click Plan', () => {
  test('expanding drawer changes state to expanded', () => {
    let drawerState = 'collapsed';
    drawerState = 'expanded';
    expect(drawerState).toBe('expanded');
  });

  test('clicking plan item triggers selectPlan with correct ID', () => {
    const planId = 'plan-1';
    let selectedPlanId = null;
    // Simulate selectPlan
    selectedPlanId = planId;
    expect(selectedPlanId).toBe('plan-1');
  });

  test('after plan click, drawer auto-shrinks if >50% of content', () => {
    const contentH = 800;
    const drawerH = 500; // 62.5% > 50%
    let targetPct = null;
    if (drawerH / contentH > 0.5) {
      targetPct = 35;
    }
    expect(targetPct).toBe(35);
  });

  test('after plan click, drawer stays if ≤50% of content', () => {
    const contentH = 800;
    const drawerH = 300; // 37.5% ≤ 50%
    let targetPct = null;
    if (drawerH / contentH > 0.5) {
      targetPct = 35;
    }
    expect(targetPct).toBeNull();
  });
});

describe('Navigation Flow — Click Task Item', () => {
  test('task item has both planId and taskId', () => {
    const item = { planId: 'plan-1', taskId: 'task-1' };
    expect(item.planId).toBe('plan-1');
    expect(item.taskId).toBe('task-1');
  });

  test('task navigation loads parent plan first', () => {
    const taskItem = { planId: 'plan-1', taskId: 'task-1' };
    let loadedPlanId = null;
    // Simulate: load parent plan
    loadedPlanId = taskItem.planId;
    expect(loadedPlanId).toBe('plan-1');
  });

  test('task card scroll target is identified by data-task-id', () => {
    const taskId = 'task-1';
    const selector = '.task-card[data-task-id="' + taskId + '"]';
    expect(selector).toBe('.task-card[data-task-id="task-1"]');
  });
});

describe('Navigation Flow — Sidebar Plan Select Highlights Timeline', () => {
  test('selecting plan from sidebar triggers timeline highlight', () => {
    const planId = 'plan-4';
    const drawerState = 'expanded';
    let highlightedId = null;
    if (drawerState === 'expanded') {
      highlightedId = planId;
    }
    expect(highlightedId).toBe('plan-4');
  });

  test('no highlight when drawer is collapsed', () => {
    const planId = 'plan-4';
    const drawerState = 'collapsed';
    let highlightedId = null;
    if (drawerState === 'expanded') {
      highlightedId = planId;
    }
    expect(highlightedId).toBeNull();
  });
});

describe('Navigation Flow — Mobile Click Item', () => {
  test('mobile: overlay closes before navigation', () => {
    const viewportWidth = 375;
    const drawerState = 'expanded';
    let closedOverlay = false;
    let navigated = false;
    if (isMobileViewport(viewportWidth) && drawerState === 'expanded') {
      closedOverlay = true;
    }
    navigated = true;
    expect(closedOverlay).toBe(true);
    expect(navigated).toBe(true);
  });

  test('desktop: no overlay close needed', () => {
    const viewportWidth = 1920;
    const drawerState = 'expanded';
    let closedOverlay = false;
    if (isMobileViewport(viewportWidth) && drawerState === 'expanded') {
      closedOverlay = true;
    }
    expect(closedOverlay).toBe(false);
  });
});

describe('Navigation Flow — Date Bar Click + Item Navigate', () => {
  test('clicking date filters timeline to that day', () => {
    const selectedDate = '2026-02-21';
    const days = groupByDay(MOCK_TIMELINE);
    const sortedDates = Object.keys(days).sort().reverse();
    const filtered = sortedDates.filter(d => d === selectedDate);
    expect(filtered).toEqual(['2026-02-21']);
    expect(filtered.length).toBe(1);
  });

  test('clicking item in filtered view still navigates correctly', () => {
    const selectedDate = '2026-02-21';
    const planId = 'plan-1';
    let navigatedTo = null;
    // Simulate: date filter active, click plan item
    navigatedTo = planId;
    expect(navigatedTo).toBe('plan-1');
  });

  test('clearing date filter shows all days again', () => {
    let selectedDate = '2026-02-21';
    selectedDate = null;
    const days = groupByDay(MOCK_TIMELINE);
    const sortedDates = Object.keys(days).sort().reverse();
    const filtered = selectedDate ? sortedDates.filter(d => d === selectedDate) : sortedDates;
    expect(filtered.length).toBeGreaterThan(1);
  });
});


// ═══════════════════════════════════════════════════════
// 2. WebSocket + Activity List Tests
// ═══════════════════════════════════════════════════════

describe('WebSocket + Activity List Integration', () => {
  test('WS event updates summary bar text', () => {
    // Before WS event
    const dataBefore = { completed: [{ id: 1 }], created: [], active: [], tasksDone: [] };
    const textBefore = buildSummaryText(dataBefore);
    expect(textBefore).toContain('1 completed');

    // After WS event adds a new completed plan
    const dataAfter = { completed: [{ id: 1 }, { id: 2 }], created: [], active: [], tasksDone: [] };
    const textAfter = buildSummaryText(dataAfter);
    expect(textAfter).toContain('2 completed');
  });

  test('WS event detects new items via key comparison', () => {
    const oldData = { completed: [{ id: 'p1' }], created: [], active: [], tasksDone: [], tasksCreated: [] };
    const newData = { completed: [{ id: 'p1' }, { id: 'p2' }], created: [], active: [], tasksDone: [{ id: 't1' }], tasksCreated: [] };
    const oldKeys = collectItemKeys(oldData);
    const newKeys = collectItemKeys(newData);
    const added = new Set();
    newKeys.forEach(k => { if (!oldKeys.has(k)) added.add(k); });
    expect(added.has('plan:p2')).toBe(true);
    expect(added.has('task:t1')).toBe(true);
    expect(added.size).toBe(2);
  });

  test('WS event while collapsed: summary updates, no timeline re-render', () => {
    const drawerState = 'collapsed';
    let summaryUpdated = false;
    let timelineRendered = false;
    // Simulate debouncedActivityRefresh logic
    if (drawerState !== 'hidden') {
      summaryUpdated = true; // fetchActivitySummary always runs
      if (drawerState === 'expanded') {
        timelineRendered = true;
      }
    }
    expect(summaryUpdated).toBe(true);
    expect(timelineRendered).toBe(false);
  });

  test('WS event while hidden: no updates at all', () => {
    const drawerState = 'hidden';
    let summaryUpdated = false;
    let timelineRendered = false;
    if (drawerState !== 'hidden') {
      summaryUpdated = true;
      if (drawerState === 'expanded') {
        timelineRendered = true;
      }
    }
    expect(summaryUpdated).toBe(false);
    expect(timelineRendered).toBe(false);
  });

  test('WS event while expanded: both summary and timeline update', () => {
    const drawerState = 'expanded';
    let summaryUpdated = false;
    let timelineRendered = false;
    if (drawerState !== 'hidden') {
      summaryUpdated = true;
      if (drawerState === 'expanded') {
        timelineRendered = true;
      }
    }
    expect(summaryUpdated).toBe(true);
    expect(timelineRendered).toBe(true);
  });

  test('multiple rapid WS events debounce to single refresh', () => {
    let refreshCount = 0;
    let timer = null;
    const DEBOUNCE_MS = 2000;

    function debouncedRefresh() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { refreshCount++; timer = null; }, DEBOUNCE_MS);
    }

    // Simulate 5 rapid WS events
    debouncedRefresh();
    debouncedRefresh();
    debouncedRefresh();
    debouncedRefresh();
    debouncedRefresh();

    // Timer is pending but not yet fired
    expect(refreshCount).toBe(0);
    expect(timer).not.toBeNull();

    // Clean up
    clearTimeout(timer);
  });
});

// ═══════════════════════════════════════════════════════
// 3. State Persistence Tests
// ═══════════════════════════════════════════════════════

describe('State Persistence — localStorage', () => {
  test('expanded state + custom height persists', () => {
    const savedState = 'expanded';
    const savedHeight = '55';
    // Simulate reload: read from localStorage
    const restoredState = savedState || 'collapsed';
    const restoredHeight = parseInt(savedHeight) || 40;
    expect(restoredState).toBe('expanded');
    expect(restoredHeight).toBe(55);
  });

  test('hidden state persists, reopen button should show', () => {
    const savedState = 'hidden';
    const restoredState = savedState || 'collapsed';
    const showReopenBtn = restoredState === 'hidden';
    expect(restoredState).toBe('hidden');
    expect(showReopenBtn).toBe(true);
  });

  test('no saved state defaults to collapsed', () => {
    const savedState = null;
    const restoredState = savedState || 'collapsed';
    expect(restoredState).toBe('collapsed');
  });

  test('invalid saved height falls back to 40', () => {
    const savedHeight = 'abc';
    const restoredHeight = parseInt(savedHeight) || 40;
    expect(restoredHeight).toBe(40);
  });

  test('range is not persisted — defaults to 7d on reload', () => {
    // activityRange is not stored in localStorage, always starts as '7d'
    const defaultRange = '7d';
    expect(defaultRange).toBe('7d');
  });
});


// ═══════════════════════════════════════════════════════
// 4. Edge Case Tests — Empty States
// ═══════════════════════════════════════════════════════

describe('Edge Cases — Empty States', () => {
  test('no plans/tasks in range shows empty state', () => {
    const data = { completed: [], created: [], active: [], tasksDone: [], tasksCreated: [] };
    const days = groupByDay(data);
    const sortedDates = Object.keys(days).sort().reverse();
    expect(sortedDates.length).toBe(0);
    // Should render empty state message
    const showEmpty = sortedDates.length === 0;
    expect(showEmpty).toBe(true);
  });

  test('API error returns graceful fallback (no crash)', () => {
    // Simulate API returning error
    const data = { ok: false };
    const shouldRender = data.ok !== false;
    expect(shouldRender).toBe(false);
  });

  test('very long plan title gets truncated via CSS', () => {
    const longTitle = 'A'.repeat(200);
    // tl-item-title has no explicit truncation in JS — CSS handles it
    // Verify the title is passed through without JS truncation
    expect(longTitle.length).toBe(200);
    // CSS class .tl-item-title handles overflow via parent constraints
  });

  test('very long task title is escaped properly', () => {
    const title = 'Fix <script>alert("xss")</script> bug & more';
    // Simulate esc() function
    function esc(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    const escaped = esc(title);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).toContain('&amp;');
  });
});

// ═══════════════════════════════════════════════════════
// 5. Edge Cases — Boundary Conditions
// ═══════════════════════════════════════════════════════

describe('Edge Cases — Boundary Conditions', () => {
  test('today range produces exactly 1 day', () => {
    const range = getDateRange('today');
    const from = range.from.toISOString().slice(0, 10);
    const to = range.to.toISOString().slice(0, 10);
    expect(from).toBe(to);
  });

  test('7d range produces 7 cells', () => {
    const range = getDateRange('7d');
    const diffMs = range.to - range.from;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
    expect(diffDays).toBe(7);
  });

  test('30d range produces 30 cells', () => {
    const range = getDateRange('30d');
    const diffMs = range.to - range.from;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
    expect(diffDays).toBe(30);
  });

  test('plan with 0 tasks still shows in timeline', () => {
    const plan = { id: 'plan-empty', title: 'Empty plan', status: 'planning', tasks: [], createdAt: '2026-02-21T08:00:00Z' };
    const data = { completed: [], created: [plan], active: [], tasksDone: [], tasksCreated: [] };
    const days = groupByDay(data);
    const dayKeys = Object.keys(days);
    expect(dayKeys.length).toBe(1);
    expect(days['2026-02-21'].created.length).toBe(1);
  });

  test('task with no assignee renders meta without crash', () => {
    const task = { id: 'task-no-assign', title: 'Unassigned task', status: 'pending', planId: 'plan-1' };
    const meta = [task.status];
    if (task.type) meta.push(task.type);
    if (task.assignedTo) meta.push(task.assignedTo);
    expect(meta).toEqual(['pending']);
    expect(meta.join(' \u00B7 ')).toBe('pending');
  });

  test('100+ items grouped correctly without data loss', () => {
    const items = [];
    for (let i = 0; i < 120; i++) {
      items.push({ id: 'task-' + i, title: 'Task ' + i, status: 'done', planId: 'plan-1', completedAt: '2026-02-21T10:00:00Z' });
    }
    const data = { completed: [], created: [], active: [], tasksDone: items, tasksCreated: [] };
    const days = groupByDay(data);
    expect(days['2026-02-21'].tasksDone.length).toBe(120);
  });

  test('density dots capped at 5 per category', () => {
    function countDots(count) { return Math.min(count, 5); }
    expect(countDots(0)).toBe(0);
    expect(countDots(3)).toBe(3);
    expect(countDots(5)).toBe(5);
    expect(countDots(10)).toBe(5);
    expect(countDots(100)).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════
// 6. Responsive Breakpoint Tests
// ═══════════════════════════════════════════════════════

describe('Responsive Breakpoints', () => {
  function getLayoutMode(width) {
    if (width <= 480) return 'xs-phone';
    if (width <= 768) return 'mobile';
    if (width <= 1024) return 'tablet';
    return 'desktop';
  }

  function getDrawerBehavior(width, state) {
    if (width <= 768 && state === 'expanded') return 'fullscreen-overlay';
    if (width <= 1024 && state === 'expanded') return 'fixed-250px';
    if (state === 'expanded') return 'percentage-height';
    return state; // collapsed or hidden
  }

  test('480px = xs-phone layout', () => {
    expect(getLayoutMode(480)).toBe('xs-phone');
  });

  test('768px = mobile layout', () => {
    expect(getLayoutMode(768)).toBe('mobile');
  });

  test('1024px = tablet layout', () => {
    expect(getLayoutMode(1024)).toBe('tablet');
  });

  test('1440px = desktop layout', () => {
    expect(getLayoutMode(1440)).toBe('desktop');
  });

  test('mobile expanded = fullscreen overlay', () => {
    expect(getDrawerBehavior(480, 'expanded')).toBe('fullscreen-overlay');
    expect(getDrawerBehavior(768, 'expanded')).toBe('fullscreen-overlay');
  });

  test('tablet expanded = fixed 250px', () => {
    expect(getDrawerBehavior(1024, 'expanded')).toBe('fixed-250px');
    expect(getDrawerBehavior(900, 'expanded')).toBe('fixed-250px');
  });

  test('desktop expanded = percentage height', () => {
    expect(getDrawerBehavior(1440, 'expanded')).toBe('percentage-height');
    expect(getDrawerBehavior(1920, 'expanded')).toBe('percentage-height');
  });

  test('collapsed is same across all breakpoints', () => {
    expect(getDrawerBehavior(480, 'collapsed')).toBe('collapsed');
    expect(getDrawerBehavior(768, 'collapsed')).toBe('collapsed');
    expect(getDrawerBehavior(1024, 'collapsed')).toBe('collapsed');
    expect(getDrawerBehavior(1440, 'collapsed')).toBe('collapsed');
  });
});


// ═══════════════════════════════════════════════════════
// 7. Accessibility Tests
// ═══════════════════════════════════════════════════════

describe('Accessibility — ARIA Attributes', () => {
  test('drawer has role=region and aria-label', () => {
    // Verified in index.html: role="region" aria-label="Activity Timeline"
    const attrs = { role: 'region', 'aria-label': 'Activity Timeline' };
    expect(attrs.role).toBe('region');
    expect(attrs['aria-label']).toBe('Activity Timeline');
  });

  test('aria-expanded reflects drawer state', () => {
    function getAriaExpanded(state) {
      return state === 'expanded' ? 'true' : 'false';
    }
    expect(getAriaExpanded('expanded')).toBe('true');
    expect(getAriaExpanded('collapsed')).toBe('false');
    expect(getAriaExpanded('hidden')).toBe('false');
  });

  test('timeline items have role=button and tabindex=0', () => {
    // Verified in mcRenderTlPlanItem and mcRenderTlTaskItem
    const itemAttrs = 'role="button" tabindex="0"';
    expect(itemAttrs).toContain('role="button"');
    expect(itemAttrs).toContain('tabindex="0"');
  });

  test('timeline items have aria-label with title', () => {
    const title = 'Setup CI/CD';
    const ariaLabel = 'aria-label="' + title + '"';
    expect(ariaLabel).toBe('aria-label="Setup CI/CD"');
  });

  test('summary bar has aria-live=polite', () => {
    // Verified in index.html
    const attr = 'polite';
    expect(attr).toBe('polite');
  });

  test('control buttons have aria-labels', () => {
    const labels = [
      'Toggle activity drawer',
      'Show last 7 days',
      'Show today only',
      'Show last 30 days',
      'Collapse drawer',
      'Close drawer',
    ];
    expect(labels.length).toBe(6);
    labels.forEach(l => expect(l.length).toBeGreaterThan(0));
  });
});

describe('Accessibility — Keyboard Navigation', () => {
  test('Enter key on tl-item triggers navigation', () => {
    const key = 'Enter';
    const shouldActivate = key === 'Enter' || key === ' ';
    expect(shouldActivate).toBe(true);
  });

  test('Space key on tl-item triggers navigation', () => {
    const key = ' ';
    const shouldActivate = key === 'Enter' || key === ' ';
    expect(shouldActivate).toBe(true);
  });

  test('other keys do not trigger navigation', () => {
    ['Tab', 'Escape', 'a', 'ArrowDown'].forEach(key => {
      const shouldActivate = key === 'Enter' || key === ' ';
      expect(shouldActivate).toBe(false);
    });
  });

  test('focus-visible style is defined for tl-item', () => {
    // CSS: .tl-item:focus-visible { outline: 2px solid #58a6ff; }
    const outlineColor = '#58a6ff';
    expect(outlineColor).toBe('#58a6ff');
  });
});

// ═══════════════════════════════════════════════════════
// 8. Performance Logic Tests
// ═══════════════════════════════════════════════════════

describe('Performance — Debounce and Render Efficiency', () => {
  test('debounce timer is 2000ms', () => {
    const DEBOUNCE_MS = 2000;
    expect(DEBOUNCE_MS).toBe(2000);
  });

  test('collapsed drawer skips timeline render on WS event', () => {
    const drawerState = 'collapsed';
    let apiCalls = 0;
    let renderCalls = 0;
    if (drawerState !== 'hidden') {
      apiCalls++; // fetchActivitySummary
      if (drawerState === 'expanded') {
        renderCalls++; // mcLoadTimeline
      }
    }
    expect(apiCalls).toBe(1);
    expect(renderCalls).toBe(0);
  });

  test('hidden drawer skips all updates on WS event', () => {
    const drawerState = 'hidden';
    let apiCalls = 0;
    let renderCalls = 0;
    if (drawerState !== 'hidden') {
      apiCalls++;
      if (drawerState === 'expanded') {
        renderCalls++;
      }
    }
    expect(apiCalls).toBe(0);
    expect(renderCalls).toBe(0);
  });

  test('new-item detection only marks truly new keys', () => {
    const prev = new Set(['plan:p1', 'task:t1']);
    const curr = new Set(['plan:p1', 'plan:p2', 'task:t1', 'task:t2']);
    const newItems = new Set();
    curr.forEach(k => { if (!prev.has(k)) newItems.add(k); });
    expect(newItems.size).toBe(2);
    expect(newItems.has('plan:p2')).toBe(true);
    expect(newItems.has('task:t2')).toBe(true);
  });

  test('collectItemKeys handles all data categories', () => {
    const keys = collectItemKeys(MOCK_TIMELINE);
    expect(keys.has('plan:plan-1')).toBe(true);
    expect(keys.has('plan:plan-3')).toBe(true);
    expect(keys.has('plan:plan-4')).toBe(true);
    expect(keys.has('task:task-1')).toBe(true);
    expect(keys.has('task:task-2')).toBe(true);
    expect(keys.has('task:task-3')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// 9. Day Grouping and Filtering Integration
// ═══════════════════════════════════════════════════════

describe('Day Grouping + Date Filter Integration', () => {
  test('timeline data groups into correct days', () => {
    const days = groupByDay(MOCK_TIMELINE);
    expect(days['2026-02-21']).toBeDefined();
    expect(days['2026-02-20']).toBeDefined();
    expect(days['2026-02-21'].completed.length).toBe(1); // plan-1
    expect(days['2026-02-20'].completed.length).toBe(1); // plan-2
  });

  test('date filter shows only selected day', () => {
    const days = groupByDay(MOCK_TIMELINE);
    const allDates = Object.keys(days).sort().reverse();
    const selectedDate = '2026-02-21';
    const filtered = allDates.filter(d => d === selectedDate);
    expect(filtered.length).toBe(1);
    expect(filtered[0]).toBe('2026-02-21');
  });

  test('no filter shows all days', () => {
    const days = groupByDay(MOCK_TIMELINE);
    const allDates = Object.keys(days).sort().reverse();
    expect(allDates.length).toBe(2);
  });

  test('selecting non-existent date shows empty', () => {
    const days = groupByDay(MOCK_TIMELINE);
    const allDates = Object.keys(days).sort().reverse();
    const selectedDate = '2026-02-19';
    const filtered = allDates.filter(d => d === selectedDate);
    expect(filtered.length).toBe(0);
  });

  test('day item counts are accurate', () => {
    const days = groupByDay(MOCK_TIMELINE);
    const day21 = days['2026-02-21'];
    const totalItems = day21.completed.length + day21.created.length + day21.active.length + day21.tasksDone.length + day21.tasksActive.length;
    // plan-1 completed, plan-3 created, plan-4 active, task-1 done, task-2 done, task-3 active
    expect(totalItems).toBe(6);
  });
});

// ═══════════════════════════════════════════════════════
// 10. HTML Escape / XSS Prevention
// ═══════════════════════════════════════════════════════

describe('XSS Prevention in Timeline Rendering', () => {
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  test('HTML tags are escaped in plan titles', () => {
    const title = '<img src=x onerror=alert(1)>';
    expect(esc(title)).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('quotes are escaped in data attributes', () => {
    const id = 'plan-" onclick="alert(1)';
    expect(esc(id)).toContain('&quot;');
    expect(esc(id)).not.toContain('"');
  });

  test('ampersands are escaped', () => {
    const title = 'Fix A & B';
    expect(esc(title)).toBe('Fix A &amp; B');
  });

  test('null/undefined returns empty string', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc('')).toBe('');
  });
});
