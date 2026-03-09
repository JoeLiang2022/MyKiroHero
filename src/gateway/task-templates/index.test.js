/**
 * Tests for Task Template System
 */

const { getTemplate, listTemplates, renderPrompt } = require('./index');

describe('Task Template System', () => {
  describe('listTemplates', () => {
    it('should return all loaded template names', () => {
      const names = listTemplates();
      expect(names).toContain('bug-fix');
      expect(names).toContain('feature');
      expect(names).toContain('refactor');
      expect(names).toContain('code-review');
      expect(names).toContain('study');
      expect(names.length).toBe(5);
    });
  });

  describe('getTemplate', () => {
    it('should return template object by name', () => {
      const tpl = getTemplate('bug-fix');
      expect(tpl).not.toBeNull();
      expect(tpl.name).toBe('bug-fix');
      expect(tpl.requiredFields).toContain('description');
      expect(tpl.requiredFields).toContain('files');
      expect(tpl.promptTemplate).toBeDefined();
    });

    it('should return null for unknown template', () => {
      expect(getTemplate('nonexistent')).toBeNull();
    });
  });

  describe('renderPrompt', () => {
    it('should render bug-fix template with required fields', () => {
      const result = renderPrompt('bug-fix', {
        taskId: 'task-001',
        branch: 'worker/task-001',
        files: 'src/foo.js',
        description: 'Fix null pointer',
      });
      expect(result).toContain('[TASK] task-001');
      expect(result).toContain('branch: worker/task-001');
      expect(result).toContain('files: src/foo.js');
      expect(result).toContain('Fix null pointer');
      // Optional fields not provided — conditional sections should be removed
      expect(result).not.toContain('Error message:');
      expect(result).not.toContain('Expected behavior:');
    });

    it('should render bug-fix template with optional fields', () => {
      const result = renderPrompt('bug-fix', {
        taskId: 'task-002',
        branch: 'worker/task-002',
        files: 'src/bar.js',
        description: 'Fix crash on startup',
        errorMessage: 'TypeError: cannot read property x of undefined',
        expectedBehavior: 'App should start without errors',
      });
      expect(result).toContain('Error message:');
      expect(result).toContain('TypeError: cannot read property x of undefined');
      expect(result).toContain('Expected behavior:');
      expect(result).toContain('App should start without errors');
    });

    it('should render feature template', () => {
      const result = renderPrompt('feature', {
        taskId: 'task-003',
        branch: 'worker/feat-task-003',
        files: ['src/a.js', 'src/b.js'],
        description: 'Add dark mode',
        acceptanceCriteria: 'Toggle button works',
      });
      expect(result).toContain('[TASK] task-003');
      expect(result).toContain('files: src/a.js, src/b.js');
      expect(result).toContain('Acceptance criteria:');
      expect(result).toContain('Toggle button works');
    });

    it('should render refactor template', () => {
      const result = renderPrompt('refactor', {
        taskId: 'task-004',
        branch: 'worker/refactor-task-004',
        files: 'src/legacy.js',
        description: 'Extract helper functions',
        reason: 'Too many responsibilities',
        constraints: 'Keep backward compat',
      });
      expect(result).toContain('Reason:');
      expect(result).toContain('Too many responsibilities');
      expect(result).toContain('Constraints:');
      expect(result).toContain('Keep backward compat');
    });

    it('should render code-review template', () => {
      const result = renderPrompt('code-review', {
        taskId: 'task-005',
        branch: 'worker/review-task-005',
        files: 'src/api.js',
        description: 'Review error handling',
        focusAreas: 'Error handling, input validation',
      });
      expect(result).toContain('action: code-review');
      expect(result).toContain('Focus areas:');
      expect(result).toContain('Error handling, input validation');
      expect(result).toContain('Do NOT make changes');
    });

    it('should render study template', () => {
      const result = renderPrompt('study', {
        taskId: 'task-006',
        branch: 'worker/study-task-006',
        files: 'src/memory/',
        description: 'Analyze memory module architecture',
        outputFormat: 'Markdown summary',
      });
      expect(result).toContain('action: study');
      expect(result).toContain('Output format:');
      expect(result).toContain('Markdown summary');
      expect(result).toContain('Do NOT make changes');
    });

    it('should throw on unknown template', () => {
      expect(() => renderPrompt('nope', {})).toThrow('Template not found: nope');
    });

    it('should throw on missing required fields', () => {
      expect(() => renderPrompt('bug-fix', { taskId: 'x' })).toThrow(/Missing required fields/);
    });

    it('should handle array files param', () => {
      const result = renderPrompt('bug-fix', {
        taskId: 'task-arr',
        branch: 'worker/task-arr',
        files: ['a.js', 'b.js', 'c.js'],
        description: 'Fix things',
      });
      expect(result).toContain('files: a.js, b.js, c.js');
    });
  });
});
