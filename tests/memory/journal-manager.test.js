/**
 * JournalManager Property Tests
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3**
 */

const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const { JournalManager, VALID_CATEGORIES } = require('../../src/memory/journal-manager');

describe('JournalManager Tests', () => {
  let manager;
  const testDir = 'test-journals';

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    manager = new JournalManager(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  // Helper to reset manager between property test iterations
  const resetManager = () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    manager = new JournalManager(testDir);
  };

  // Arbitraries
  const categoryArb = fc.constantFrom(...VALID_CATEGORIES);
  const safeString = fc.string({ minLength: 1, maxLength: 500 })
    .filter(s => !s.includes('\n') && !s.includes('\r') && s.trim().length > 0);

  /**
   * Property 4: Journal CRUD 操作
   * **Validates: Requirements 2.1, 2.2**
   */
  describe('Property 4: Journal CRUD 操作', () => {
    test('create returns entry with correct fields', () => {
      fc.assert(
        fc.property(categoryArb, safeString, (category, content) => {
          const entry = manager.create(category, content);

          expect(entry.type).toBe('journal');
          expect(entry.category).toBe(category);
          expect(entry.content).toBe(content);
          expect(entry.id).toMatch(/^j_\d+_[a-z0-9]+$/);
          expect(entry.timestamp).toBeDefined();

          if (category === 'todo') {
            expect(entry.status).toBe('pending');
          }
          return true;
        }),
        { numRuns: 20 }
      );
    });

    test('created entry can be read by ID', () => {
      fc.assert(
        fc.property(categoryArb, safeString, (category, content) => {
          const created = manager.create(category, content);
          const read = manager.readById(created.id);

          expect(read).not.toBeNull();
          expect(read.id).toBe(created.id);
          expect(read.content).toBe(created.content);
          return true;
        }),
        { numRuns: 20 }
      );
    });

    test('created entry appears in readByCategory', () => {
      fc.assert(
        fc.property(categoryArb, safeString, (category, content) => {
          const created = manager.create(category, content);
          const entries = manager.readByCategory(category);
          const found = entries.find(e => e.id === created.id);

          expect(found).toBeDefined();
          expect(found.content).toBe(content);
          return true;
        }),
        { numRuns: 20 }
      );
    });

    test('invalid category throws error', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => !VALID_CATEGORIES.includes(s)),
          safeString,
          (invalidCategory, content) => {
            expect(() => manager.create(invalidCategory, content)).toThrow(/Invalid category/);
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 5: Journal 更新操作
   * **Validates: Requirements 2.2**
   */
  describe('Property 5: Journal 更新操作', () => {
    test('update preserves ID and updates fields', () => {
      fc.assert(
        fc.property(categoryArb, safeString, safeString, (category, original, newContent) => {
          const created = manager.create(category, original);
          const updated = manager.update(created.id, { content: newContent });

          expect(updated).not.toBeNull();
          expect(updated.id).toBe(created.id);
          expect(updated.content).toBe(newContent);
          expect(updated.updatedAt).toBeDefined();
          expect(updated.previousTimestamp).toBe(created.timestamp);
          return true;
        }),
        { numRuns: 20 }
      );
    });

    test('getLatestVersions returns only latest version', () => {
      fc.assert(
        fc.property(
          categoryArb,
          fc.array(safeString, { minLength: 2, maxLength: 5 }),
          (category, contents) => {
            resetManager(); // Reset between iterations
            
            const created = manager.create(category, contents[0]);

            for (let i = 1; i < contents.length; i++) {
              manager.update(created.id, { content: contents[i] });
            }

            const latest = manager.getLatestVersions();
            const found = latest.find(e => e.id === created.id);

            expect(found).toBeDefined();
            expect(found.content).toBe(contents[contents.length - 1]);
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 6: Todo 狀態管理
   * **Validates: Requirements 2.3**
   */
  describe('Property 6: Todo 狀態管理', () => {
    test('todos start with pending status', () => {
      fc.assert(
        fc.property(safeString, (content) => {
          const todo = manager.create('todo', content);
          expect(todo.status).toBe('pending');
          return true;
        }),
        { numRuns: 20 }
      );
    });

    test('completeTodo changes status to completed', () => {
      fc.assert(
        fc.property(safeString, (content) => {
          const todo = manager.create('todo', content);
          const completed = manager.completeTodo(todo.id);

          expect(completed).not.toBeNull();
          expect(completed.status).toBe('completed');
          expect(completed.completedAt).toBeDefined();
          return true;
        }),
        { numRuns: 20 }
      );
    });

    test('getPendingTodos excludes completed todos', () => {
      fc.assert(
        fc.property(
          fc.array(safeString, { minLength: 2, maxLength: 5 }),
          (contents) => {
            resetManager(); // Reset between iterations
            
            const todos = contents.map(c => manager.create('todo', c));
            const halfIndex = Math.floor(todos.length / 2);

            for (let i = 0; i < halfIndex; i++) {
              manager.completeTodo(todos[i].id);
            }

            const pending = manager.getPendingTodos();
            expect(pending.length).toBe(todos.length - halfIndex);

            for (const p of pending) {
              expect(p.status).toBe('pending');
            }
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    test('completeTodo returns null for non-todo entries', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('event', 'thought', 'lesson'),
          safeString,
          (category, content) => {
            const entry = manager.create(category, content);
            const result = manager.completeTodo(entry.id);
            expect(result).toBeNull();
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 7: Journal 搜尋和統計
   * **Validates: Requirements 2.2**
   */
  describe('Property 7: Journal 搜尋和統計', () => {
    test('search finds entries containing query', () => {
      fc.assert(
        fc.property(categoryArb, safeString, (category, content) => {
          manager.create(category, content);
          
          // Search for a substring of the content
          const query = content.substring(0, Math.min(5, content.length));
          const results = manager.search(query);

          expect(results.length).toBeGreaterThan(0);
          expect(results.some(r => r.content.toLowerCase().includes(query.toLowerCase()))).toBe(true);
          return true;
        }),
        { numRuns: 20 }
      );
    });

    test('getStats returns correct counts', () => {
      fc.assert(
        fc.property(
          fc.array(fc.tuple(categoryArb, safeString), { minLength: 1, maxLength: 10 }),
          (entries) => {
            resetManager(); // Reset between iterations
            
            for (const [category, content] of entries) {
              manager.create(category, content);
            }

            const stats = manager.getStats();
            expect(stats.total).toBe(entries.length);

            let sum = 0;
            for (const category of VALID_CATEGORIES) {
              sum += stats.byCategory[category];
            }
            expect(sum).toBe(entries.length);
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
