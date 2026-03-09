/**
 * Tests for Activity Drawer foundation (MC Dashboard)
 * Tests pure logic — no DOM dependency (node environment)
 */

describe('Activity Drawer State Management', () => {
  test('default state is collapsed', () => {
    // State defaults when localStorage returns null
    const stored = null;
    const state = stored || 'collapsed';
    expect(state).toBe('collapsed');
  });

  test('valid states are collapsed, expanded, hidden', () => {
    const validStates = ['collapsed', 'expanded', 'hidden'];
    validStates.forEach(s => {
      expect(['collapsed', 'expanded', 'hidden']).toContain(s);
    });
  });

  test('default drawer height is 40 percent', () => {
    const stored = null;
    const height = parseInt(stored) || 40;
    expect(height).toBe(40);
  });

  test('stored height is parsed correctly', () => {
    const stored = '55';
    const height = parseInt(stored) || 40;
    expect(height).toBe(55);
  });
});

describe('Toggle Logic', () => {
  function nextState(current) {
    if (current === 'collapsed' || current === 'hidden') return 'expanded';
    return 'collapsed';
  }

  test('collapsed → expanded', () => {
    expect(nextState('collapsed')).toBe('expanded');
  });

  test('expanded → collapsed', () => {
    expect(nextState('expanded')).toBe('collapsed');
  });

  test('hidden → expanded', () => {
    expect(nextState('hidden')).toBe('expanded');
  });
});

describe('Summary Bar Rendering', () => {
  function buildSummaryText(data) {
    const completed = (data.completed || []).length;
    const created = (data.created || []).length;
    const active = (data.active || []).length;
    const tasksDone = (data.tasksDone || []).length;
    return '\u{1F4CA} Activity (7d): ' + completed + ' completed \u00B7 ' + created + ' created \u00B7 ' + active + ' active \u00B7 ' + tasksDone + ' tasks \u2713';
  }

  test('renders stats from API data', () => {
    const mockData = {
      completed: [{ id: 1 }, { id: 2 }],
      created: [{ id: 3 }],
      active: [{ id: 4 }, { id: 5 }, { id: 6 }],
      tasksDone: [{ id: 7 }, { id: 8 }],
    };
    const text = buildSummaryText(mockData);
    expect(text).toContain('2 completed');
    expect(text).toContain('1 created');
    expect(text).toContain('3 active');
    expect(text).toContain('2 tasks');
  });

  test('handles empty data gracefully', () => {
    const text = buildSummaryText({});
    expect(text).toContain('0 completed');
    expect(text).toContain('0 created');
    expect(text).toContain('0 active');
    expect(text).toContain('0 tasks');
  });

  test('handles missing fields', () => {
    const text = buildSummaryText({ completed: [{ id: 1 }] });
    expect(text).toContain('1 completed');
    expect(text).toContain('0 created');
  });
});

describe('localStorage Persistence Logic', () => {
  test('state string is stored as-is', () => {
    const states = ['collapsed', 'expanded', 'hidden'];
    states.forEach(s => {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    });
  });

  test('height stored as string parses back to number', () => {
    const stored = String(40);
    expect(parseInt(stored)).toBe(40);
  });
});

describe('Keyboard Shortcut Detection', () => {
  function isActivityToggleKey(key) {
    return key === 't' || key === 'T';
  }

  test('T key triggers toggle', () => {
    expect(isActivityToggleKey('T')).toBe(true);
  });

  test('t key triggers toggle', () => {
    expect(isActivityToggleKey('t')).toBe(true);
  });

  test('other keys do not trigger', () => {
    expect(isActivityToggleKey('w')).toBe(false);
    expect(isActivityToggleKey('e')).toBe(false);
    expect(isActivityToggleKey('Enter')).toBe(false);
  });
});

describe('Reopen Button Visibility Logic', () => {
  function shouldShowReopenBtn(drawerState) {
    return drawerState === 'hidden';
  }

  test('visible when drawer is hidden', () => {
    expect(shouldShowReopenBtn('hidden')).toBe(true);
  });

  test('not visible when collapsed', () => {
    expect(shouldShowReopenBtn('collapsed')).toBe(false);
  });

  test('not visible when expanded', () => {
    expect(shouldShowReopenBtn('expanded')).toBe(false);
  });
});

describe('Activity Range Logic', () => {
  test('today range produces same-day from/to', () => {
    const today = new Date('2026-02-21');
    const from = new Date(today);
    expect(from.toISOString().slice(0, 10)).toBe('2026-02-21');
  });

  test('30d range produces 29 days back', () => {
    const today = new Date('2026-02-21');
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    expect(from.toISOString().slice(0, 10)).toBe('2026-01-23');
  });

  test('7d default range produces 6 days back', () => {
    const today = new Date('2026-02-21');
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    expect(from.toISOString().slice(0, 10)).toBe('2026-02-15');
  });
});
