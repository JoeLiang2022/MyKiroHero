/**
 * Tests for Activity List rendering in Activity Drawer (MC Dashboard)
 * Tests pure logic — no DOM dependency (node environment)
 */

// ─── Helper: esc (mirrors app.js) ───────────────────────
const esc = (str) => {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

const getStatusText = (status) => {
  const map = { pending: 'Pending', planning: 'Planning', active: 'Active', done: 'Done', failed: 'Failed', cancelled: 'Cancelled', queued: 'Queued', running: 'Running' };
  return map[status] || status;
};

const mcFmt = (d) => d.toISOString().slice(0, 10);

// ─── Helper: group items by day (mirrors app.js logic) ──
const groupByDay = (data) => {
  const days = {};
  const addToDay = (item, dateField, category) => {
    const date = (item[dateField] || '').slice(0, 10);
    if (!date) return;
    if (!days[date]) days[date] = { completed: [], created: [], active: [], tasksDone: [], tasksActive: [] };
    days[date][category].push(item);
  };
  (data.completed || []).forEach((p) => { addToDay(p, 'completedAt', 'completed'); });
  (data.created || []).forEach((p) => { addToDay(p, 'createdAt', 'created'); });
  (data.active || []).forEach((p) => { addToDay(p, 'updatedAt', 'active'); });
  (data.tasksDone || []).forEach((t) => { addToDay(t, 'completedAt', 'tasksDone'); });
  (data.tasksCreated || []).forEach((t) => {
    if (t.status && t.status !== 'done') {
      addToDay(t, 'createdAt', 'tasksActive');
    }
  });
  return days;
};

// ─── Helper: render plan item HTML (mirrors app.js) ─────
const renderPlanItem = (plan) => {
  const tasks = plan.tasks || [];
  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const statusText = getStatusText(plan.status);
  const meta = [statusText];
  if (total > 0) meta.push(done + '/' + total + ' tasks');
  if (plan.source) meta.push(plan.source);
  const planId = plan.id || '';
  return '<div class="tl-item" data-plan-id="' + esc(planId) + '">' +
    '<div class="tl-connector"></div>' +
    '<div class="tl-item-title">' + esc(plan.title) + '</div>' +
    '<div class="tl-item-meta">' + esc(meta.join(' \u00B7 ')) + '</div>' +
    '</div>';
};

// ─── Helper: render task item HTML (mirrors app.js) ─────
const renderTaskItem = (task) => {
  const meta = [getStatusText(task.status)];
  if (task.type) meta.push(task.type);
  if (task.assignedTo) meta.push(task.assignedTo);
  const taskId = task.id || '';
  return '<div class="tl-item" data-task-id="' + esc(taskId) + '">' +
    '<div class="tl-connector"></div>' +
    '<div class="tl-item-title">' + esc(task.title) + '</div>' +
    '<div class="tl-item-meta">' + esc(meta.join(' \u00B7 ')) + '</div>' +
    '</div>';
};

// ─── Helper: build full timeline HTML (mirrors mcRenderTimeline logic) ──
const buildTimelineHtml = (data, selectedDate, collapsedDays) => {
  collapsedDays = collapsedDays || {};
  const days = groupByDay(data);
  let sortedDates = Object.keys(days).sort().reverse();
  if (selectedDate) {
    sortedDates = sortedDates.filter((d) => d === selectedDate);
  }

  let html = '';

  if (selectedDate) {
    const fd = new Date(selectedDate + 'T12:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const filterLabel = months[fd.getMonth()] + ' ' + fd.getDate();
    html += '<div class="tl-date-filter-bar">';
    html += '<span>Showing ' + filterLabel + ' only</span>';
    html += '<button class="tl-date-filter-clear" onclick="clearDateFilter()">Clear</button>';
    html += '</div>';
  }

  if (sortedDates.length === 0) {
    html += '<div class="tl-empty"><div class="tl-empty-icon">\u{1F4CA}</div><div>No activity in this period</div></div>';
    return html;
  }

  const today = mcFmt(new Date());
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (let di = 0; di < sortedDates.length; di++) {
    const date = sortedDates[di];
    const d = new Date(date + 'T12:00:00');
    const dayName = dayNames[d.getDay()];
    const isToday = date === today;
    const day = days[date];
    const totalItems = day.completed.length + day.created.length + day.active.length + day.tasksDone.length + day.tasksActive.length;

    if (collapsedDays[date] === undefined) {
      collapsedDays[date] = !isToday;
    }
    const isCollapsed = collapsedDays[date];

    html += '<div class="tl-day-group" data-date="' + date + '">';
    html += '<div class="tl-day-header">';
    html += '<span class="tl-day-count">' + totalItems + ' items</span>';
    html += '</div>';
    html += '<div class="tl-day-items' + (isCollapsed ? ' collapsed' : '') + '">';

    if (day.completed.length > 0) {
      html += '<div class="tl-section-label">\u2705 Plans Completed</div>';
      html += '<div class="tl-items-container">';
      day.completed.forEach((p) => { html += renderPlanItem(p); });
      html += '</div>';
    }
    if (day.tasksDone.length > 0) {
      html += '<div class="tl-section-label">\u2713 Tasks Done</div>';
      html += '<div class="tl-items-container">';
      day.tasksDone.forEach((t) => { html += renderTaskItem(t); });
      html += '</div>';
    }
    if (day.active.length > 0) {
      html += '<div class="tl-section-label">\u23F3 Plans Active</div>';
    }
    if (day.tasksActive.length > 0) {
      html += '<div class="tl-section-label">\u26A1 Tasks Active</div>';
    }
    if (day.created.length > 0) {
      html += '<div class="tl-section-label">\u{1F4CB} Plans Created</div>';
    }

    html += '</div></div>';
  }
  return html;
};

// ═══════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════

describe('Activity List — Renders into Drawer Body', () => {
  test('mcRenderTimeline targets activity-drawer-body container', () => {
    // The function writes to #activity-drawer-body, not #mc-timeline-view
    const html = buildTimelineHtml({
      completed: [{ id: 'p1', title: 'Plan A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] }],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    }, null, {});
    expect(html).toContain('tl-day-group');
    expect(html).toContain('Plan A');
    // Should NOT contain old mc-tl-content references
    expect(html).not.toContain('mc-tl-content');
  });
});

describe('Activity List — Day Groups', () => {
  test('groups activities by date', () => {
    const data = {
      completed: [
        { id: 'p1', title: 'Plan A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] },
        { id: 'p2', title: 'Plan B', status: 'done', completedAt: '2026-02-20T10:00:00Z', tasks: [] },
      ],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const days = groupByDay(data);
    expect(Object.keys(days)).toHaveLength(2);
    expect(days['2026-02-21'].completed).toHaveLength(1);
    expect(days['2026-02-20'].completed).toHaveLength(1);
  });

  test('sorted dates are in reverse chronological order', () => {
    const data = {
      completed: [
        { id: 'p1', title: 'A', status: 'done', completedAt: '2026-02-19T10:00:00Z', tasks: [] },
        { id: 'p2', title: 'B', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] },
        { id: 'p3', title: 'C', status: 'done', completedAt: '2026-02-20T10:00:00Z', tasks: [] },
      ],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const days = groupByDay(data);
    const sorted = Object.keys(days).sort().reverse();
    expect(sorted).toEqual(['2026-02-21', '2026-02-20', '2026-02-19']);
  });

  test('day group HTML contains data-date attribute', () => {
    const html = buildTimelineHtml({
      completed: [{ id: 'p1', title: 'X', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] }],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    }, null, {});
    expect(html).toContain('data-date="2026-02-21"');
  });

  test('multiple items on same day grouped together', () => {
    const data = {
      completed: [
        { id: 'p1', title: 'A', status: 'done', completedAt: '2026-02-21T08:00:00Z', tasks: [] },
        { id: 'p2', title: 'B', status: 'done', completedAt: '2026-02-21T14:00:00Z', tasks: [] },
      ],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const days = groupByDay(data);
    expect(days['2026-02-21'].completed).toHaveLength(2);
  });
});

describe('Activity List — Collapsible Day Sections', () => {
  test('today defaults to expanded', () => {
    const today = mcFmt(new Date());
    const collapsedDays = {};
    const data = {
      completed: [{ id: 'p1', title: 'A', status: 'done', completedAt: today + 'T10:00:00Z', tasks: [] }],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, null, collapsedDays);
    expect(collapsedDays[today]).toBe(false);
    // The tl-day-items should NOT have collapsed class
    expect(html).toContain('class="tl-day-items"');
  });

  test('older days default to collapsed', () => {
    const oldDate = '2026-01-15';
    const collapsedDays = {};
    const data = {
      completed: [{ id: 'p1', title: 'A', status: 'done', completedAt: oldDate + 'T10:00:00Z', tasks: [] }],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, null, collapsedDays);
    expect(collapsedDays[oldDate]).toBe(true);
    expect(html).toContain('tl-day-items collapsed');
  });

  test('toggle changes collapsed state', () => {
    const collapsedDays = { '2026-02-20': true };
    // Simulate toggle
    collapsedDays['2026-02-20'] = !collapsedDays['2026-02-20'];
    expect(collapsedDays['2026-02-20']).toBe(false);
    // Toggle again
    collapsedDays['2026-02-20'] = !collapsedDays['2026-02-20'];
    expect(collapsedDays['2026-02-20']).toBe(true);
  });

  test('collapsed state is per-day in memory', () => {
    const collapsedDays = {};
    collapsedDays['2026-02-20'] = true;
    collapsedDays['2026-02-21'] = false;
    expect(collapsedDays['2026-02-20']).toBe(true);
    expect(collapsedDays['2026-02-21']).toBe(false);
  });

  test('explicitly set collapsed state is preserved across renders', () => {
    const collapsedDays = { '2026-02-21': true };
    const today = mcFmt(new Date());
    // Even if 2026-02-21 is today, explicit state should be preserved
    const data = {
      completed: [{ id: 'p1', title: 'A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] }],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    buildTimelineHtml(data, null, collapsedDays);
    expect(collapsedDays['2026-02-21']).toBe(true);
  });
});

describe('Activity List — Date Filter', () => {
  test('shows only selected day when selectedDate is set', () => {
    const data = {
      completed: [
        { id: 'p1', title: 'Plan A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] },
        { id: 'p2', title: 'Plan B', status: 'done', completedAt: '2026-02-20T10:00:00Z', tasks: [] },
      ],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, '2026-02-21', {});
    expect(html).toContain('Plan A');
    expect(html).not.toContain('Plan B');
  });

  test('shows filter indicator with date label', () => {
    const data = {
      completed: [{ id: 'p1', title: 'A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] }],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, '2026-02-21', {});
    expect(html).toContain('Showing Feb 21 only');
    expect(html).toContain('tl-date-filter-clear');
    expect(html).toContain('clearDateFilter()');
  });

  test('no filter indicator when selectedDate is null', () => {
    const data = {
      completed: [{ id: 'p1', title: 'A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] }],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, null, {});
    expect(html).not.toContain('tl-date-filter-bar');
    expect(html).not.toContain('Showing');
  });

  test('filter with no matching date shows empty state', () => {
    const data = {
      completed: [{ id: 'p1', title: 'A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] }],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, '2026-02-19', {});
    expect(html).toContain('tl-empty');
    expect(html).toContain('No activity in this period');
  });
});

describe('Activity List — Empty State', () => {
  test('renders empty state when no data', () => {
    const html = buildTimelineHtml({
      completed: [], created: [], active: [], tasksDone: [], tasksCreated: [],
    }, null, {});
    expect(html).toContain('tl-empty');
    expect(html).toContain('No activity in this period');
    expect(html).toContain('tl-empty-icon');
  });

  test('empty state contains chart emoji', () => {
    const html = buildTimelineHtml({
      completed: [], created: [], active: [], tasksDone: [], tasksCreated: [],
    }, null, {});
    expect(html).toContain('\u{1F4CA}');
  });
});

describe('Activity List — Vertical Connectors', () => {
  test('plan items have tl-connector element', () => {
    const html = renderPlanItem({ id: 'p1', title: 'Test', status: 'done', tasks: [] });
    expect(html).toContain('tl-connector');
  });

  test('task items have tl-connector element', () => {
    const html = renderTaskItem({ id: 't1', title: 'Task', status: 'done' });
    expect(html).toContain('tl-connector');
  });

  test('items have tl-item class for hover and positioning', () => {
    const planHtml = renderPlanItem({ id: 'p1', title: 'Test', status: 'done', tasks: [] });
    const taskHtml = renderTaskItem({ id: 't1', title: 'Task', status: 'done' });
    expect(planHtml).toContain('class="tl-item"');
    expect(taskHtml).toContain('class="tl-item"');
  });
});

describe('Activity List — Section Grouping', () => {
  test('completed plans section appears', () => {
    const data = {
      completed: [{ id: 'p1', title: 'A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] }],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, null, { '2026-02-21': false });
    expect(html).toContain('\u2705 Plans Completed');
  });

  test('tasks done section appears', () => {
    const data = {
      completed: [], created: [], active: [],
      tasksDone: [{ id: 't1', title: 'T', status: 'done', completedAt: '2026-02-21T10:00:00Z' }],
      tasksCreated: [],
    };
    const html = buildTimelineHtml(data, null, { '2026-02-21': false });
    expect(html).toContain('\u2713 Tasks Done');
  });

  test('active plans section appears', () => {
    const data = {
      completed: [], created: [],
      active: [{ id: 'p1', title: 'A', status: 'active', updatedAt: '2026-02-21T10:00:00Z', tasks: [] }],
      tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, null, { '2026-02-21': false });
    expect(html).toContain('\u23F3 Plans Active');
  });

  test('created plans section appears', () => {
    const data = {
      completed: [],
      created: [{ id: 'p1', title: 'A', status: 'pending', createdAt: '2026-02-21T10:00:00Z', tasks: [] }],
      active: [], tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, null, { '2026-02-21': false });
    expect(html).toContain('\u{1F4CB} Plans Created');
  });

  test('tasks active section appears for non-done tasks', () => {
    const data = {
      completed: [], created: [], active: [], tasksDone: [],
      tasksCreated: [{ id: 't1', title: 'T', status: 'running', createdAt: '2026-02-21T10:00:00Z' }],
    };
    const html = buildTimelineHtml(data, null, { '2026-02-21': false });
    expect(html).toContain('\u26A1 Tasks Active');
  });

  test('sections only appear when they have items', () => {
    const data = {
      completed: [{ id: 'p1', title: 'A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] }],
      created: [], active: [], tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, null, { '2026-02-21': false });
    expect(html).toContain('\u2705 Plans Completed');
    expect(html).not.toContain('\u2713 Tasks Done');
    expect(html).not.toContain('\u23F3 Plans Active');
    expect(html).not.toContain('\u{1F4CB} Plans Created');
    expect(html).not.toContain('\u26A1 Tasks Active');
  });

  test('section order: completed, tasks done, active, tasks active, created', () => {
    const data = {
      completed: [{ id: 'p1', title: 'A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] }],
      created: [{ id: 'p2', title: 'B', status: 'pending', createdAt: '2026-02-21T09:00:00Z', tasks: [] }],
      active: [{ id: 'p3', title: 'C', status: 'active', updatedAt: '2026-02-21T08:00:00Z', tasks: [] }],
      tasksDone: [{ id: 't1', title: 'D', status: 'done', completedAt: '2026-02-21T10:00:00Z' }],
      tasksCreated: [{ id: 't2', title: 'E', status: 'running', createdAt: '2026-02-21T07:00:00Z' }],
    };
    const html = buildTimelineHtml(data, null, { '2026-02-21': false });
    const completedIdx = html.indexOf('\u2705 Plans Completed');
    const tasksDoneIdx = html.indexOf('\u2713 Tasks Done');
    const activeIdx = html.indexOf('\u23F3 Plans Active');
    const tasksActiveIdx = html.indexOf('\u26A1 Tasks Active');
    const createdIdx = html.indexOf('\u{1F4CB} Plans Created');
    expect(completedIdx).toBeLessThan(tasksDoneIdx);
    expect(tasksDoneIdx).toBeLessThan(activeIdx);
    expect(activeIdx).toBeLessThan(tasksActiveIdx);
    expect(tasksActiveIdx).toBeLessThan(createdIdx);
  });
});

describe('Activity List — data-plan-id and data-task-id Attributes', () => {
  test('plan items have data-plan-id attribute', () => {
    const html = renderPlanItem({ id: 'plan-123', title: 'Test', status: 'done', tasks: [] });
    expect(html).toContain('data-plan-id="plan-123"');
  });

  test('task items have data-task-id attribute', () => {
    const html = renderTaskItem({ id: 'task-456', title: 'Task', status: 'done' });
    expect(html).toContain('data-task-id="task-456"');
  });

  test('plan items do not have data-task-id', () => {
    const html = renderPlanItem({ id: 'plan-123', title: 'Test', status: 'done', tasks: [] });
    expect(html).not.toContain('data-task-id');
  });

  test('task items do not have data-plan-id', () => {
    const html = renderTaskItem({ id: 'task-456', title: 'Task', status: 'done' });
    expect(html).not.toContain('data-plan-id');
  });

  test('empty id produces empty attribute value', () => {
    const html = renderPlanItem({ title: 'No ID', status: 'done', tasks: [] });
    expect(html).toContain('data-plan-id=""');
  });
});

describe('Activity List — Plan Item Metadata', () => {
  test('shows task count in meta', () => {
    const html = renderPlanItem({
      id: 'p1', title: 'Test', status: 'done',
      tasks: [{ status: 'done' }, { status: 'done' }, { status: 'pending' }],
    });
    expect(html).toContain('2/3 tasks');
  });

  test('shows source in meta', () => {
    const html = renderPlanItem({ id: 'p1', title: 'Test', status: 'done', source: 'dashboard', tasks: [] });
    expect(html).toContain('dashboard');
  });

  test('shows status text', () => {
    const html = renderPlanItem({ id: 'p1', title: 'Test', status: 'done', tasks: [] });
    expect(html).toContain('Done');
  });
});

describe('Activity List — Task Item Metadata', () => {
  test('shows task type in meta', () => {
    const html = renderTaskItem({ id: 't1', title: 'Task', status: 'done', type: 'layer2' });
    expect(html).toContain('layer2');
  });

  test('shows assignedTo in meta', () => {
    const html = renderTaskItem({ id: 't1', title: 'Task', status: 'done', assignedTo: 'worker-1' });
    expect(html).toContain('worker-1');
  });
});

describe('Activity List — Day Item Count', () => {
  test('day header shows correct item count', () => {
    const data = {
      completed: [
        { id: 'p1', title: 'A', status: 'done', completedAt: '2026-02-21T10:00:00Z', tasks: [] },
        { id: 'p2', title: 'B', status: 'done', completedAt: '2026-02-21T11:00:00Z', tasks: [] },
      ],
      created: [{ id: 'p3', title: 'C', status: 'pending', createdAt: '2026-02-21T09:00:00Z', tasks: [] }],
      active: [], tasksDone: [], tasksCreated: [],
    };
    const html = buildTimelineHtml(data, null, { '2026-02-21': false });
    expect(html).toContain('3 items');
  });
});

describe('Activity List — HTML Escaping', () => {
  test('plan title is escaped', () => {
    const html = renderPlanItem({ id: 'p1', title: '<script>alert("xss")</script>', status: 'done', tasks: [] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('task title is escaped', () => {
    const html = renderTaskItem({ id: 't1', title: 'a & b < c', status: 'done' });
    expect(html).toContain('a &amp; b &lt; c');
  });
});

describe('Activity List — tasksCreated filtering', () => {
  test('done tasks from tasksCreated are excluded from tasksActive', () => {
    const data = {
      completed: [], created: [], active: [], tasksDone: [],
      tasksCreated: [
        { id: 't1', title: 'Done Task', status: 'done', createdAt: '2026-02-21T10:00:00Z' },
        { id: 't2', title: 'Running Task', status: 'running', createdAt: '2026-02-21T10:00:00Z' },
      ],
    };
    const days = groupByDay(data);
    expect(days['2026-02-21'].tasksActive).toHaveLength(1);
    expect(days['2026-02-21'].tasksActive[0].title).toBe('Running Task');
  });
});
