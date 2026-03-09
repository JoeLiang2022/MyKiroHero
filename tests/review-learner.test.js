'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Must use "mock" prefix for jest.mock() scope access
let mockEntriesDir;
let mockIndexPath;

describe('ReviewLearner', () => {
  let extractLessons, saveLessons;
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `review-learner-test-${Date.now()}`);
    mockEntriesDir = path.join(tmpDir, 'entries');
    mockIndexPath = path.join(tmpDir, 'index.json');
    fs.mkdirSync(mockEntriesDir, { recursive: true });
    fs.writeFileSync(mockIndexPath, '[]', 'utf-8');

    jest.resetModules();
    jest.mock('path', () => {
      const original = jest.requireActual('path');
      return {
        ...original,
        join: (...args) => {
          const result = original.join(...args);
          if (result.includes('skills/memory/entries') || result.includes('skills\\memory\\entries')) {
            const basename = original.basename(result);
            if (basename === 'entries') return mockEntriesDir;
            return original.join(mockEntriesDir, basename);
          }
          if (result.includes('skills/memory/index.json') || result.includes('skills\\memory\\index.json')) {
            return mockIndexPath;
          }
          return result;
        },
      };
    });

    ({ extractLessons, saveLessons } = require('../src/gateway/review-learner'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  });

  test('extractLessons parses bullet-point issues', () => {
    const msg = `[Gemini Review] Issues found:
• **Missing error handling:** The function does not catch errors
• **Hardcoded path:** Uses absolute path instead of path.join
• **No tests:** Missing unit tests for new function`;
    const lessons = extractLessons(msg, 'feature/test');
    expect(lessons.length).toBe(3);
    expect(lessons[0].title).toContain('Missing error handling');
    expect(lessons[1].title).toContain('Hardcoded path');
  });

  test('extractLessons limits to 3 lessons', () => {
    const msg = `Issues:
• Issue one
• Issue two
• Issue three
• Issue four
• Issue five`;
    const lessons = extractLessons(msg, 'branch');
    expect(lessons.length).toBe(3);
  });

  test('extractLessons returns empty for empty message', () => {
    expect(extractLessons('', 'branch')).toEqual([]);
    expect(extractLessons(null, 'branch')).toEqual([]);
  });

  test('extractLessons handles dash bullets', () => {
    const msg = `- First issue description
- Second issue here`;
    const lessons = extractLessons(msg, 'branch');
    expect(lessons.length).toBe(2);
  });

  test('saveLessons writes markdown files', () => {
    const lessons = [
      { title: 'Test Issue', summary: 'A test issue', content: 'Full description of test issue' },
    ];
    const count = saveLessons('task-001', 'feature/test', lessons);
    expect(count).toBe(1);
    const files = fs.readdirSync(mockEntriesDir).filter(f => f.startsWith('review-lesson-'));
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(mockEntriesDir, files[0]), 'utf-8');
    expect(content).toContain('Review Lesson: Test Issue');
    expect(content).toContain('review-lesson');
    expect(content).toContain('task-001');
  });

  test('saveLessons deduplicates by title', () => {
    fs.writeFileSync(mockIndexPath, JSON.stringify([
      { id: 'existing', title: 'Review Lesson: Test Issue', tags: ['review-lesson'] }
    ]), 'utf-8');

    jest.resetModules();
    jest.mock('path', () => {
      const original = jest.requireActual('path');
      return {
        ...original,
        join: (...args) => {
          const result = original.join(...args);
          if (result.includes('skills/memory/entries') || result.includes('skills\\memory\\entries')) {
            const basename = original.basename(result);
            if (basename === 'entries') return mockEntriesDir;
            return original.join(mockEntriesDir, basename);
          }
          if (result.includes('skills/memory/index.json') || result.includes('skills\\memory\\index.json')) {
            return mockIndexPath;
          }
          return result;
        },
      };
    });
    const { saveLessons: saveLessons2 } = require('../src/gateway/review-learner');

    const lessons = [
      { title: 'Test Issue', summary: 'A test issue', content: 'Duplicate' },
    ];
    const count = saveLessons2('task-002', 'branch', lessons);
    expect(count).toBe(0);
  });

  test('saveLessons returns 0 for empty lessons', () => {
    expect(saveLessons('task-001', 'branch', [])).toBe(0);
    expect(saveLessons('task-001', 'branch', null)).toBe(0);
  });

  test('saveLessons updates index.json', () => {
    const lessons = [
      { title: 'New Lesson', summary: 'Summary', content: 'Content here' },
    ];
    saveLessons('task-003', 'branch', lessons);
    const raw = JSON.parse(fs.readFileSync(mockIndexPath, 'utf-8'));
    // index.json is now { version, entries } format
    const entries = raw.entries || raw;
    const found = (Array.isArray(entries) ? entries : []).find(e => e.title.includes('New Lesson'));
    expect(found).toBeTruthy();
    expect(found.tags).toContain('review-lesson');
  });
});
