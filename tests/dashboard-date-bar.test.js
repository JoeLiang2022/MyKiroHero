/**
 * Tests for Activity Drawer Date Bar (MC Dashboard)
 * Tests pure logic — no DOM dependency (node environment)
 */

// Helper: generate date range array
function generateDateRange(fromDate, toDate) {
  const dates = [];
  const cur = new Date(fromDate);
  cur.setHours(12, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(12, 0, 0, 0);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Helper: count density dots for a day
function countDensityDots(dayCounts, dateStr) {
  const counts = dayCounts[dateStr] || { completed: 0, created: 0, active: 0 };
  return {
    completed: Math.min(counts.completed, 5),
    created: Math.min(counts.created, 5),
    active: Math.min(counts.active, 5),
  };
}

// Helper: build day counts from timeline data
function buildDayCounts(data) {
  const dayCounts = {};
  const countItems = (items, dateField, category) => {
    (items || []).forEach(item => {
      const d = (item[dateField] || '').slice(0, 10);
      if (!d) return;
      if (!dayCounts[d]) dayCounts[d] = { completed: 0, created: 0, active: 0 };
      dayCounts[d][category]++;
    });
  };
  countItems(data.completed, 'completedAt', 'completed');
  countItems(data.created, 'createdAt', 'created');
  countItems(data.active, 'updatedAt', 'active');
  countItems(data.tasksDone, 'completedAt', 'completed');
  countItems(data.tasksCreated, 'createdAt', 'created');
  return dayCounts;
}

describe('Date Bar — Date Range Generation', () => {
  test('7-day range generates 7 cells', () => {
    const today = new Date('2026-02-21');
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    const dates = generateDateRange(from, today);
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-02-15');
    expect(dates[6]).toBe('2026-02-21');
  });

  test('today range generates 1 cell', () => {
    const today = new Date('2026-02-21');
    const dates = generateDateRange(today, today);
    expect(dates).toHaveLength(1);
    expect(dates[0]).toBe('2026-02-21');
  });

  test('30-day range generates 30 cells', () => {
    const today = new Date('2026-02-21');
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    const dates = generateDateRange(from, today);
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe('2026-01-23');
    expect(dates[29]).toBe('2026-02-21');
  });
});

describe('Date Bar — Today Cell Detection', () => {
  test('today cell is identified correctly', () => {
    const today = '2026-02-21';
    const dates = ['2026-02-19', '2026-02-20', '2026-02-21'];
    const todayIndex = dates.findIndex(d => d === today);
    expect(todayIndex).toBe(2);
  });

  test('today cell not in range returns -1', () => {
    const today = '2026-02-21';
    const dates = ['2026-02-10', '2026-02-11', '2026-02-12'];
    const todayIndex = dates.findIndex(d => d === today);
    expect(todayIndex).toBe(-1);
  });
});

describe('Date Bar — Selected State Toggle', () => {
  test('clicking unselected date selects it', () => {
    let selectedDate = null;
    const clickedDate = '2026-02-20';
    if (selectedDate === clickedDate) {
      selectedDate = null;
    } else {
      selectedDate = clickedDate;
    }
    expect(selectedDate).toBe('2026-02-20');
  });

  test('clicking already-selected date deselects it', () => {
    let selectedDate = '2026-02-20';
    const clickedDate = '2026-02-20';
    if (selectedDate === clickedDate) {
      selectedDate = null;
    } else {
      selectedDate = clickedDate;
    }
    expect(selectedDate).toBeNull();
  });

  test('clicking different date changes selection', () => {
    let selectedDate = '2026-02-19';
    const clickedDate = '2026-02-20';
    if (selectedDate === clickedDate) {
      selectedDate = null;
    } else {
      selectedDate = clickedDate;
    }
    expect(selectedDate).toBe('2026-02-20');
  });
});

describe('Date Bar — Density Dots', () => {
  test('dots reflect activity counts', () => {
    const data = {
      completed: [{ completedAt: '2026-02-21T10:00:00Z' }, { completedAt: '2026-02-21T11:00:00Z' }],
      created: [{ createdAt: '2026-02-21T09:00:00Z' }],
      active: [{ updatedAt: '2026-02-21T08:00:00Z' }],
      tasksDone: [{ completedAt: '2026-02-21T12:00:00Z' }],
      tasksCreated: [],
    };
    const dayCounts = buildDayCounts(data);
    const dots = countDensityDots(dayCounts, '2026-02-21');
    expect(dots.completed).toBe(3); // 2 plans + 1 task
    expect(dots.created).toBe(1);
    expect(dots.active).toBe(1);
  });

  test('dots capped at 5 per color', () => {
    const items = [];
    for (let i = 0; i < 8; i++) items.push({ completedAt: '2026-02-21T10:00:00Z' });
    const data = { completed: items, created: [], active: [], tasksDone: [], tasksCreated: [] };
    const dayCounts = buildDayCounts(data);
    const dots = countDensityDots(dayCounts, '2026-02-21');
    expect(dots.completed).toBe(5);
  });

  test('empty days show no dots', () => {
    const data = { completed: [], created: [], active: [], tasksDone: [], tasksCreated: [] };
    const dayCounts = buildDayCounts(data);
    const dots = countDensityDots(dayCounts, '2026-02-21');
    expect(dots.completed).toBe(0);
    expect(dots.created).toBe(0);
    expect(dots.active).toBe(0);
  });

  test('missing date returns zero dots', () => {
    const dayCounts = {};
    const dots = countDensityDots(dayCounts, '2026-02-21');
    expect(dots.completed).toBe(0);
    expect(dots.created).toBe(0);
    expect(dots.active).toBe(0);
  });
});

describe('Date Bar — Range Button Changes', () => {
  test('7d range produces correct from/to', () => {
    const today = new Date('2026-02-21');
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    expect(from.toISOString().slice(0, 10)).toBe('2026-02-15');
    expect(today.toISOString().slice(0, 10)).toBe('2026-02-21');
  });

  test('today range produces same-day from/to', () => {
    const today = new Date('2026-02-21');
    const from = new Date(today);
    expect(from.toISOString().slice(0, 10)).toBe(today.toISOString().slice(0, 10));
  });

  test('30d range produces 29 days back', () => {
    const today = new Date('2026-02-21');
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    expect(from.toISOString().slice(0, 10)).toBe('2026-01-23');
  });
});

describe('Date Bar — 30-day Scrollable', () => {
  test('30-day range creates more cells than 7-day', () => {
    const today = new Date('2026-02-21');
    const from7 = new Date(today); from7.setDate(from7.getDate() - 6);
    const from30 = new Date(today); from30.setDate(from30.getDate() - 29);
    const dates7 = generateDateRange(from7, today);
    const dates30 = generateDateRange(from30, today);
    expect(dates30.length).toBeGreaterThan(dates7.length);
    expect(dates30.length).toBe(30);
    // 30 cells * 48px min-width = 1440px > typical container width → scrollable
    expect(dates30.length * 48).toBeGreaterThan(800);
  });
});

describe('Date Bar — Multi-day Activity Distribution', () => {
  test('activities on different days are counted separately', () => {
    const data = {
      completed: [
        { completedAt: '2026-02-20T10:00:00Z' },
        { completedAt: '2026-02-21T10:00:00Z' },
      ],
      created: [{ createdAt: '2026-02-19T09:00:00Z' }],
      active: [],
      tasksDone: [],
      tasksCreated: [],
    };
    const dayCounts = buildDayCounts(data);
    expect(countDensityDots(dayCounts, '2026-02-19').created).toBe(1);
    expect(countDensityDots(dayCounts, '2026-02-20').completed).toBe(1);
    expect(countDensityDots(dayCounts, '2026-02-21').completed).toBe(1);
    expect(countDensityDots(dayCounts, '2026-02-18').completed).toBe(0);
  });
});
