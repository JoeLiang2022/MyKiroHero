/**
 * Tests for extractEntities() in summary-extractor.js
 * Covers: people, files, tools, projects extraction from messages
 */

const { extractFallback } = require('../../src/memory/summary-extractor');

// Helper: wrap text in a message array
const msgs = (...texts) => texts.map(t => ({ role: 'user', content: t }));

describe('extractEntities via extractFallback', () => {
  describe('people extraction', () => {
    test('extracts @mentions', () => {
      const result = extractFallback(msgs('Hey @alice can you review this? Also cc @bob-smith'));
      expect(result.entities.people).toContain('alice');
      expect(result.entities.people).toContain('bob-smith');
    });

    test('extracts named references (by/from/assigned to)', () => {
      const result = extractFallback(msgs(
        'This was fixed by John. Assigned to Charlie for review. Got feedback from Alice Wang'
      ));
      expect(result.entities.people).toContain('John');
      expect(result.entities.people).toContain('Charlie');
      expect(result.entities.people).toContain('Alice Wang');
    });

    test('filters out false positives like Error, Promise', () => {
      const result = extractFallback(msgs('Thrown by Error handler, from Promise chain'));
      expect(result.entities.people).not.toContain('Error');
      expect(result.entities.people).not.toContain('Promise');
    });

    test('returns empty when no people mentioned', () => {
      const result = extractFallback(msgs('Just some code changes'));
      expect(result.entities.people).toEqual([]);
    });
  });

  describe('files extraction', () => {
    test('extracts file paths with common extensions', () => {
      const result = extractFallback(msgs(
        'Modified src/gateway/config.js and tests/setup.py for the fix'
      ));
      expect(result.entities.files).toContain('src/gateway/config.js');
      expect(result.entities.files).toContain('tests/setup.py');
    });

    test('extracts various file extensions', () => {
      const result = extractFallback(msgs(
        'Check package.json, README.md, styles.css, and index.html'
      ));
      expect(result.entities.files).toContain('package.json');
      expect(result.entities.files).toContain('README.md');
      expect(result.entities.files).toContain('styles.css');
      expect(result.entities.files).toContain('index.html');
    });

    test('limits to 10 files max', () => {
      const manyFiles = Array.from({ length: 15 }, (_, i) => `file${i}.js`).join(' ');
      const result = extractFallback(msgs(manyFiles));
      expect(result.entities.files.length).toBeLessThanOrEqual(10);
    });
  });

  describe('tools extraction', () => {
    test('extracts MCP tool names', () => {
      const result = extractFallback(msgs(
        'Used run_tests to verify, then called report_task_result'
      ));
      expect(result.entities.tools).toContain('run_tests');
      expect(result.entities.tools).toContain('report_task_result');
    });

    test('extracts mcp_ prefixed tools', () => {
      const result = extractFallback(msgs('Called mcp_playwright_browser_click'));
      expect(result.entities.tools).toContain('mcp_playwright_browser_click');
    });

    test('extracts npm packages from install commands', () => {
      const result = extractFallback(msgs('Run npm install express and npm add lodash'));
      expect(result.entities.tools).toContain('express');
      expect(result.entities.tools).toContain('lodash');
    });

    test('extracts packages from require statements', () => {
      const result = extractFallback(msgs("const fs = require('better-sqlite3')"));
      expect(result.entities.tools).toContain('better-sqlite3');
    });

    test('skips relative requires', () => {
      const result = extractFallback(msgs("const x = require('./local-module')"));
      expect(result.entities.tools).not.toContain('./local-module');
    });
  });

  describe('projects extraction', () => {
    test('extracts GitHub-style repo refs', () => {
      const result = extractFallback(msgs('Check out facebook/react for reference'));
      expect(result.entities.projects).toContain('facebook/react');
    });

    test('extracts branch names as project refs', () => {
      const result = extractFallback(msgs('Working on feat/wave3-entity-extraction branch'));
      expect(result.entities.projects).toContain('feat/wave3-entity-extraction');
    });

    test('filters out file-like paths from repo detection', () => {
      const result = extractFallback(msgs('Edit src/gateway/config.js'));
      // src/gateway looks like a repo but starts with src/ — should be filtered
      const hasSourcePath = result.entities.projects.some(p => p.startsWith('src/'));
      expect(hasSourcePath).toBe(false);
    });
  });

  describe('entity structure', () => {
    test('returns all four entity categories', () => {
      const result = extractFallback(msgs('hello world'));
      expect(result.entities).toHaveProperty('people');
      expect(result.entities).toHaveProperty('files');
      expect(result.entities).toHaveProperty('tools');
      expect(result.entities).toHaveProperty('projects');
    });

    test('all categories are arrays', () => {
      const result = extractFallback(msgs('test'));
      expect(Array.isArray(result.entities.people)).toBe(true);
      expect(Array.isArray(result.entities.files)).toBe(true);
      expect(Array.isArray(result.entities.tools)).toBe(true);
      expect(Array.isArray(result.entities.projects)).toBe(true);
    });
  });

  describe('combined extraction', () => {
    test('extracts multiple entity types from realistic conversation', () => {
      const result = extractFallback(msgs(
        '@alice I fixed the bug in src/memory/search-engine.js',
        'Used run_tests to verify. The fix is on feat/fix-search branch.',
        'npm install cheerio was needed. Assigned to Bob for review.',
        'Check awslabs/aws-documentation for reference.'
      ));
      expect(result.entities.people).toContain('alice');
      expect(result.entities.people).toContain('Bob');
      expect(result.entities.files).toContain('src/memory/search-engine.js');
      expect(result.entities.tools).toContain('run_tests');
      expect(result.entities.tools).toContain('cheerio');
      expect(result.entities.projects).toContain('feat/fix-search');
    });
  });
});


describe('validateOutput entity sub-schema enforcement', () => {
  const { validateOutput } = require('../../src/memory/summary-extractor');

  test('normalizes missing entities to empty arrays', () => {
    const result = validateOutput({ topic: 'test', entities: {} });
    expect(result.entities).toEqual({ people: [], files: [], tools: [], projects: [] });
  });

  test('strips legacy keys (branches, concepts) and enforces new schema', () => {
    const result = validateOutput({
      topic: 'test',
      entities: { branches: ['feat/old'], concepts: ['memory'], files: ['a.js'] },
    });
    expect(result.entities.people).toEqual([]);
    expect(result.entities.files).toEqual(['a.js']);
    expect(result.entities.tools).toEqual([]);
    expect(result.entities.projects).toEqual([]);
    expect(result.entities.branches).toBeUndefined();
    expect(result.entities.concepts).toBeUndefined();
  });

  test('filters non-string values from entity arrays', () => {
    const result = validateOutput({
      topic: 'test',
      entities: { people: ['Alice', 42, null], tools: [true, 'npm'] },
    });
    expect(result.entities.people).toEqual(['Alice']);
    expect(result.entities.tools).toEqual(['npm']);
  });

  test('handles entities as non-object gracefully', () => {
    const result = validateOutput({ topic: 'test', entities: 'bad' });
    expect(result.entities).toEqual({ people: [], files: [], tools: [], projects: [] });
  });

  test('handles entities as array gracefully', () => {
    const result = validateOutput({ topic: 'test', entities: ['bad'] });
    expect(result.entities).toEqual({ people: [], files: [], tools: [], projects: [] });
  });
});
