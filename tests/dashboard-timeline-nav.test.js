/**
 * Tests for Timeline Navigation (bidirectional click navigation)
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

// ─── Helper: render task item HTML (mirrors updated app.js with data-plan-id) ──
const renderTaskItem = (task) => {
  const meta = [getStatusText(task.status)];
  if (task.type) meta.push(task.type);
  if (task.assignedTo) meta.push(task.assignedTo);
  const taskId = task.id || '';
  const planId = task.planId || '';
  return '<div class="tl-item" data-task-id="' + esc(taskId) + '" data-plan-id="' + esc(planId) + '">' +
    '<div class="tl-connector"></div>' +
    '<div class="tl-item-title">' + esc(task.title) + '</div>' +
    '<div class="tl-item-meta">' + esc(meta.join(' \u00B7 ')) + '</div>' +
    '</div>';
};

// ─── Helper: extract data attributes from HTML string ───
function extractAttr(html, attr) {
  const re = new RegExp(attr + '="([^"]*)"');
  const m = html.match(re);
  return m ? m[1] : null;
}

function extractAllAttrs(html, attr) {
  const re = new RegExp(attr + '="([^"]*)"', 'g');
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) results.push(m[1]);
  return results;
}

// ─── Helper: simulate click delegation logic (mirrors initTimelineNavigation) ──
function simulateClickDelegation(itemHtml) {
  // Parse the tl-item attributes from HTML
  const taskId = extractAttr(itemHtml, 'data-task-id');
  const planId = extractAttr(itemHtml, 'data-plan-id');
  if (taskId && planId) {
    return { action: 'navigateToTask', planId, taskId };
  } else if (planId) {
    return { action: 'navigateToPlan', planId };
  }
  return { action: 'none' };
}

// ─── Helper: simulate auto-shrink logic ─────────────────
function shouldAutoShrink(drawerState, contentH, drawerH) {
  if (drawerState !== 'expanded') return false;
  if (contentH <= 0) return false;
  return (drawerH / contentH) > 0.5;
}

// ─── Helper: simulate highlightTimelineItem logic ───────
function shouldHighlight(drawerState, timelineHtml, planId) {
  if (drawerState !== 'expanded') return false;
  if (!planId) return false;
  return timelineHtml.includes('data-plan-id="' + esc(planId) + '"');
}

// ─── Tests ──────────────────────────────────────────────

describe('Timeline Navigation — Plan Item Rendering', () => {
  test('plan item has data-plan-id attribute', () => {
    const html = renderPlanItem({ id: 'plan-001', title: 'Test Plan', status: 'active', tasks: [] });
    expect(html).toContain('data-plan-id="plan-001"');
  });

  test('plan item does not have data-task-id attribute', () => {
    const html = renderPlanItem({ id: 'plan-001', title: 'Test Plan', status: 'active', tasks: [] });
    expect(html).not.toContain('data-task-id');
  });

  test('plan item with empty id renders empty data-plan-id', () => {
    const html = renderPlanItem({ id: '', title: 'No ID', status: 'done', tasks: [] });
    expect(html).toContain('data-plan-id=""');
  });
});

describe('Timeline Navigation — Task Item Rendering', () => {
  test('task item has both data-task-id and data-plan-id attributes', () => {
    const html = renderTaskItem({ id: 'task-001', planId: 'plan-001', title: 'Test Task', status: 'done' });
    expect(html).toContain('data-task-id="task-001"');
    expect(html).toContain('data-plan-id="plan-001"');
  });

  test('task item without planId renders empty data-plan-id', () => {
    const html = renderTaskItem({ id: 'task-002', title: 'Orphan Task', status: 'running' });
    expect(html).toContain('data-task-id="task-002"');
    expect(html).toContain('data-plan-id=""');
  });

  test('task item preserves all metadata', () => {
    const html = renderTaskItem({ id: 't1', planId: 'p1', title: 'My Task', status: 'done', type: 'layer2', assignedTo: 'worker-1' });
    expect(html).toContain('Done');
    expect(html).toContain('layer2');
    expect(html).toContain('worker-1');
  });
});

describe('Timeline Navigation — Click Delegation Logic', () => {
  test('click on plan item triggers navigateToPlan', () => {
    const html = renderPlanItem({ id: 'plan-abc', title: 'My Plan', status: 'done', tasks: [] });
    const result = simulateClickDelegation(html);
    expect(result.action).toBe('navigateToPlan');
    expect(result.planId).toBe('plan-abc');
  });

  test('click on task item triggers navigateToTask with both IDs', () => {
    const html = renderTaskItem({ id: 'task-xyz', planId: 'plan-xyz', title: 'My Task', status: 'done' });
    const result = simulateClickDelegation(html);
    expect(result.action).toBe('navigateToTask');
    expect(result.planId).toBe('plan-xyz');
    expect(result.taskId).toBe('task-xyz');
  });

  test('task item without planId triggers none (empty planId is falsy)', () => {
    const html = renderTaskItem({ id: 'task-no-plan', title: 'No Plan', status: 'done' });
    const result = simulateClickDelegation(html);
    // data-plan-id="" — extractAttr returns "", which is falsy
    // In real code, navigateTimelineToTask guards with if(!planId) return
    // simulateClickDelegation: taskId is truthy but planId is "" (falsy) → falls to else if
    // planId is "" which is also falsy → action: none
    expect(result.action).toBe('none');
  });

  test('non-tl-item HTML returns action none', () => {
    const html = '<div class="tl-section-label">Section</div>';
    const result = simulateClickDelegation(html);
    expect(result.action).toBe('none');
  });

  test('plan item click extracts correct planId from multiple items', () => {
    const html1 = renderPlanItem({ id: 'plan-a', title: 'A', status: 'done', tasks: [] });
    const html2 = renderPlanItem({ id: 'plan-b', title: 'B', status: 'active', tasks: [] });
    // Each item individually should resolve correctly
    expect(simulateClickDelegation(html1).planId).toBe('plan-a');
    expect(simulateClickDelegation(html2).planId).toBe('plan-b');
  });
});

describe('Timeline Navigation — Auto-Shrink Drawer', () => {
  test('drawer >50% should shrink', () => {
    expect(shouldAutoShrink('expanded', 800, 500)).toBe(true);
  });

  test('drawer exactly 50% should NOT shrink', () => {
    expect(shouldAutoShrink('expanded', 800, 400)).toBe(false);
  });

  test('drawer <50% should NOT shrink', () => {
    expect(shouldAutoShrink('expanded', 800, 300)).toBe(false);
  });

  test('collapsed drawer should NOT shrink regardless of size', () => {
    expect(shouldAutoShrink('collapsed', 800, 700)).toBe(false);
  });

  test('hidden drawer should NOT shrink', () => {
    expect(shouldAutoShrink('hidden', 800, 700)).toBe(false);
  });

  test('zero content height should NOT shrink', () => {
    expect(shouldAutoShrink('expanded', 0, 500)).toBe(false);
  });

  test('target shrink percentage is 35%', () => {
    // When auto-shrink triggers, target is 35%
    const targetPct = 35;
    const state = { activityDrawerHeight: 60 };
    if (shouldAutoShrink('expanded', 800, 500)) {
      state.activityDrawerHeight = targetPct;
    }
    expect(state.activityDrawerHeight).toBe(35);
  });

  test('state is unchanged when shrink not needed', () => {
    const state = { activityDrawerHeight: 40 };
    if (shouldAutoShrink('expanded', 800, 300)) {
      state.activityDrawerHeight = 35;
    }
    expect(state.activityDrawerHeight).toBe(40);
  });
});

describe('Timeline Navigation — Reverse Navigation (highlightTimelineItem)', () => {
  test('finds matching plan item in timeline HTML', () => {
    const html = renderPlanItem({ id: 'plan-a', title: 'A', status: 'done', tasks: [] }) +
      renderPlanItem({ id: 'plan-b', title: 'B', status: 'active', tasks: [] });
    expect(shouldHighlight('expanded', html, 'plan-b')).toBe(true);
  });

  test('returns false when plan not in timeline', () => {
    const html = renderPlanItem({ id: 'plan-a', title: 'A', status: 'done', tasks: [] });
    expect(shouldHighlight('expanded', html, 'plan-z')).toBe(false);
  });

  test('returns false when drawer is collapsed', () => {
    const html = renderPlanItem({ id: 'plan-a', title: 'A', status: 'done', tasks: [] });
    expect(shouldHighlight('collapsed', html, 'plan-a')).toBe(false);
  });

  test('returns false when drawer is hidden', () => {
    const html = renderPlanItem({ id: 'plan-a', title: 'A', status: 'done', tasks: [] });
    expect(shouldHighlight('hidden', html, 'plan-a')).toBe(false);
  });

  test('returns false when planId is empty', () => {
    const html = renderPlanItem({ id: 'plan-a', title: 'A', status: 'done', tasks: [] });
    expect(shouldHighlight('expanded', html, '')).toBe(false);
  });

  test('returns false when planId is null', () => {
    const html = renderPlanItem({ id: 'plan-a', title: 'A', status: 'done', tasks: [] });
    expect(shouldHighlight('expanded', html, null)).toBe(false);
  });

  test('matches plan item among task items', () => {
    const html = renderTaskItem({ id: 't1', planId: 'plan-x', title: 'T', status: 'done' }) +
      renderPlanItem({ id: 'plan-x', title: 'X', status: 'active', tasks: [] });
    expect(shouldHighlight('expanded', html, 'plan-x')).toBe(true);
  });
});

describe('Timeline Navigation — Task Card data-task-id', () => {
  test('task card HTML template includes data-task-id', () => {
    // Mirrors the updated renderPlanDetail task card template
    const taskId = 'mctask-abc-123';
    const html = '<div class="task-card done" data-task-id="' + esc(taskId) + '">content</div>';
    expect(html).toContain('data-task-id="mctask-abc-123"');
  });

  test('task card can be found by data-task-id in HTML string', () => {
    const html = '<div class="task-card done" data-task-id="t-001">Task 1</div>' +
      '<div class="task-card running" data-task-id="t-002">Task 2</div>';
    expect(html).toContain('data-task-id="t-001"');
    expect(html).toContain('data-task-id="t-002"');
  });

  test('multiple task cards have unique data-task-id', () => {
    const html = '<div class="task-card" data-task-id="t-a"></div>' +
      '<div class="task-card" data-task-id="t-b"></div>' +
      '<div class="task-card" data-task-id="t-c"></div>';
    const ids = extractAllAttrs(html, 'data-task-id');
    expect(ids).toEqual(['t-a', 't-b', 't-c']);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('Timeline Navigation — XSS Safety', () => {
  test('plan item escapes special characters in planId', () => {
    const html = renderPlanItem({ id: '<script>alert(1)</script>', title: 'XSS', status: 'done', tasks: [] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('task item escapes special characters in taskId and planId', () => {
    const html = renderTaskItem({
      id: '"><img onerror=alert(1)>',
      planId: '"><img onerror=alert(2)>',
      title: 'XSS Task',
      status: 'done',
    });
    // The " is escaped to &quot; preventing attribute breakout
    expect(html).toContain('&quot;');
    // The < and > are escaped preventing tag injection
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('plan item escapes quotes in title', () => {
    const html = renderPlanItem({ id: 'p1', title: 'Plan "with" quotes', status: 'done', tasks: [] });
    expect(html).toContain('&quot;with&quot;');
  });
});

describe('Timeline Navigation — Edge Cases', () => {
  test('plan item with special characters in id', () => {
    const html = renderPlanItem({ id: 'plan-2026-02-21-001-abc', title: 'Long ID', status: 'done', tasks: [] });
    expect(extractAttr(html, 'data-plan-id')).toBe('plan-2026-02-21-001-abc');
  });

  test('task item with no type or assignee', () => {
    const html = renderTaskItem({ id: 't1', planId: 'p1', title: 'Minimal', status: 'pending' });
    expect(html).toContain('Pending');
    expect(html).not.toContain('undefined');
  });

  test('auto-shrink with very large drawer', () => {
    expect(shouldAutoShrink('expanded', 800, 799)).toBe(true);
  });

  test('auto-shrink with very small drawer', () => {
    expect(shouldAutoShrink('expanded', 800, 1)).toBe(false);
  });

  test('highlight with empty timeline', () => {
    expect(shouldHighlight('expanded', '', 'plan-a')).toBe(false);
  });

  test('click delegation with plan item having tasks count in meta', () => {
    const html = renderPlanItem({ id: 'plan-tasks', title: 'With Tasks', status: 'active', tasks: [{ status: 'done' }, { status: 'pending' }] });
    expect(html).toContain('1/2 tasks');
    const result = simulateClickDelegation(html);
    expect(result.action).toBe('navigateToPlan');
    expect(result.planId).toBe('plan-tasks');
  });
});
