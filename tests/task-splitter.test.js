/**
 * Tests for task-splitter.js — canSplit and splitTask
 */

const { canSplit, splitTask } = require('../src/gateway/task-splitter');

// ─── canSplit ───────────────────────────────────────────────────

describe('canSplit', () => {
  test('returns false for empty/null input', () => {
    expect(canSplit('')).toBe(false);
    expect(canSplit(null)).toBe(false);
    expect(canSplit(undefined)).toBe(false);
    expect(canSplit(123)).toBe(false);
  });

  test('returns false for simple single-line description', () => {
    expect(canSplit('Fix the login bug')).toBe(false);
    expect(canSplit('Update README')).toBe(false);
  });

  test('returns true for description with split keywords', () => {
    expect(canSplit('修改多個檔案的 import 路徑')).toBe(true);
    expect(canSplit('Handle multiple files independently')).toBe(true);
    expect(canSplit('分別處理 A 和 B')).toBe(true);
    expect(canSplit('Fix each file respectively')).toBe(true);
  });

  test('returns true for numbered steps (2+)', () => {
    const desc = `
1. Fix the login page
2. Update the dashboard
`;
    expect(canSplit(desc)).toBe(true);
  });

  test('returns true for bullet list (3+ items)', () => {
    const desc = `
- Fix auth module
- Update user service
- Refactor database layer
`;
    expect(canSplit(desc)).toBe(true);
  });

  test('returns false for bullet list with only 2 items', () => {
    const desc = `
- Fix auth module
- Update user service
`;
    expect(canSplit(desc)).toBe(false);
  });

  test('returns false when dependency keywords present', () => {
    expect(canSplit('多個步驟，但有依賴關係')).toBe(false);
    expect(canSplit('Step 1 depends on step 2, multiple files')).toBe(false);
  });
});

// ─── splitTask ──────────────────────────────────────────────────

describe('splitTask', () => {
  test('splits by files when multiple files provided as array', () => {
    const task = {
      taskId: 'task-test-001',
      params: {
        description: 'Fix imports in these files',
        files: ['src/a.js', 'src/b.js', 'src/c.js'],
      },
      notify: 'wa',
    };
    const result = splitTask(task);
    expect(result).toHaveLength(3);
    expect(result[0].params._parentTaskId).toBe('task-test-001');
    expect(result[0].params.files).toEqual(['src/a.js']);
    expect(result[1].params.files).toEqual(['src/b.js']);
    expect(result[0].action).toBe('worker-dispatch');
    expect(result[0].type).toBe('layer3');
  });

  test('splits by files when comma-separated string', () => {
    const task = {
      taskId: 'task-test-002',
      params: {
        description: 'Update these files',
        files: 'src/a.js, src/b.js',
      },
      notify: 'silent',
    };
    const result = splitTask(task);
    expect(result).toHaveLength(2);
    expect(result[0].notify).toBe('silent');
    expect(result[0].params.files).toEqual(['src/a.js']);
    expect(result[1].params.files).toEqual(['src/b.js']);
  });

  test('splits by numbered steps when no files', () => {
    const task = {
      taskId: 'task-test-003',
      params: {
        description: '1. Fix the login page\n2. Update the dashboard\n3. Add tests',
      },
    };
    const result = splitTask(task);
    expect(result).toHaveLength(3);
    expect(result[0].params.description).toContain('Fix the login page');
    expect(result[1].params.description).toContain('Update the dashboard');
    expect(result[2].params.description).toContain('Add tests');
    expect(result[0].params._parentTaskId).toBe('task-test-003');
  });

  test('splits by bullet list when 3+ items and no files/steps', () => {
    const task = {
      taskId: 'task-test-004',
      params: {
        description: '- Fix auth\n- Update user service\n- Refactor DB',
      },
    };
    const result = splitTask(task);
    expect(result).toHaveLength(3);
    expect(result[0].params.description).toContain('Fix auth');
  });

  test('returns single subtask when cannot split', () => {
    const task = {
      taskId: 'task-test-005',
      params: {
        description: 'Simple fix for login bug',
      },
      notify: 'wa',
    };
    const result = splitTask(task);
    expect(result).toHaveLength(1);
    expect(result[0].params._parentTaskId).toBe('task-test-005');
    expect(result[0].params.description).toBe('Simple fix for login bug');
  });

  test('inherits notify setting from parent task', () => {
    const task = {
      taskId: 'task-test-006',
      params: {
        description: 'Fix stuff',
        files: ['a.js', 'b.js'],
      },
      notify: 'silent',
    };
    const result = splitTask(task);
    result.forEach(sub => {
      expect(sub.notify).toBe('silent');
    });
  });

  test('inherits template from params', () => {
    const task = {
      taskId: 'task-test-007',
      params: {
        description: 'Fix stuff',
        files: ['a.js', 'b.js'],
        template: 'bug-fix',
      },
    };
    const result = splitTask(task);
    result.forEach(sub => {
      expect(sub.params.template).toBe('bug-fix');
    });
  });

  test('handles missing params gracefully', () => {
    const task = { taskId: 'task-test-008' };
    const result = splitTask(task);
    expect(result).toHaveLength(1);
  });

  test('files priority over steps (files checked first)', () => {
    const task = {
      taskId: 'task-test-009',
      params: {
        description: '1. Fix a.js\n2. Fix b.js',
        files: ['a.js', 'b.js', 'c.js'],
      },
    };
    const result = splitTask(task);
    expect(result).toHaveLength(3);
  });
});
