/**
 * Backup/Restore round-trip tests
 *
 * Verifies that:
 * - copyDir preserves all files and directories
 * - copyDir with excludeFiles skips specified files
 * - exportSummaries → importSummaries round-trip preserves data
 * - getDataSources returns consistent paths for backup and restore
 * - buildAuthUrl produces correct authenticated URLs
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { copyDir } = require('../src/utils/fs-helpers');
const { buildAuthUrl } = require('../src/utils/git-helpers');
const { getDataSources, getDbPath, validateSourcePaths } = require('../src/utils/backup-config');

describe('backup/restore round-trip', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `backup-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  describe('copyDir', () => {
    test('copies all files and subdirectories', () => {
      const src = path.join(tempDir, 'src');
      const dest = path.join(tempDir, 'dest');

      // Create source structure
      fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(src, 'a.txt'), 'hello');
      fs.writeFileSync(path.join(src, 'b.md'), '# title');
      fs.writeFileSync(path.join(src, 'sub', 'c.json'), '{}');

      const result = copyDir(src, dest);
      expect(result).toBe(true);
      expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf-8')).toBe('hello');
      expect(fs.readFileSync(path.join(dest, 'b.md'), 'utf-8')).toBe('# title');
      expect(fs.readFileSync(path.join(dest, 'sub', 'c.json'), 'utf-8')).toBe('{}');
    });

    test('returns false for non-existent source', () => {
      const result = copyDir(path.join(tempDir, 'nope'), path.join(tempDir, 'dest'));
      expect(result).toBe(false);
    });

    test('excludeFiles skips specified files', () => {
      const src = path.join(tempDir, 'src');
      const dest = path.join(tempDir, 'dest');

      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(path.join(src, 'keep.txt'), 'keep');
      fs.writeFileSync(path.join(src, 'ONBOARDING.md'), 'skip me');
      fs.writeFileSync(path.join(src, 'other.md'), 'keep too');

      copyDir(src, dest, { excludeFiles: ['ONBOARDING.md'] });

      expect(fs.existsSync(path.join(dest, 'keep.txt'))).toBe(true);
      expect(fs.existsSync(path.join(dest, 'other.md'))).toBe(true);
      expect(fs.existsSync(path.join(dest, 'ONBOARDING.md'))).toBe(false);
    });

    test('round-trip: copy to backup then restore preserves content', () => {
      const original = path.join(tempDir, 'original');
      const backup = path.join(tempDir, 'backup');
      const restored = path.join(tempDir, 'restored');

      // Create original data
      fs.mkdirSync(path.join(original, 'entries'), { recursive: true });
      fs.writeFileSync(path.join(original, 'index.json'), '{"version":1}');
      fs.writeFileSync(path.join(original, 'entries', 'note1.md'), '# Note 1\nContent here');
      fs.writeFileSync(path.join(original, 'entries', 'note2.md'), '# Note 2\nMore content');

      // Backup
      copyDir(original, backup);
      // Restore
      copyDir(backup, restored);

      // Verify all content matches
      expect(fs.readFileSync(path.join(restored, 'index.json'), 'utf-8')).toBe('{"version":1}');
      expect(fs.readFileSync(path.join(restored, 'entries', 'note1.md'), 'utf-8')).toBe('# Note 1\nContent here');
      expect(fs.readFileSync(path.join(restored, 'entries', 'note2.md'), 'utf-8')).toBe('# Note 2\nMore content');
    });
  });

  describe('summaries round-trip', () => {
    test('exportSummaries output can be imported by importSummaries', () => {
      let Database;
      try {
        Database = require('better-sqlite3');
      } catch (e) {
        // better-sqlite3 not available, skip
        return;
      }

      const dbPath = path.join(tempDir, 'test-memory.db');

      // Create DB with summaries table and seed data
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS summaries (
          session_id TEXT PRIMARY KEY,
          summary TEXT,
          created_at TEXT
        )
      `);
      db.prepare('INSERT INTO summaries VALUES (?, ?, ?)').run(
        '20260215-001', 'Test summary one', '2026-02-15T10:00:00Z'
      );
      db.prepare('INSERT INTO summaries VALUES (?, ?, ?)').run(
        '20260215-002', 'Test summary two', '2026-02-15T11:00:00Z'
      );
      db.close();

      // Export (simulate what memory-backup does)
      const dbExport = new Database(dbPath, { readonly: false });
      const rows = dbExport.prepare('SELECT session_id, summary, created_at FROM summaries').all();
      dbExport.close();

      const summariesJson = JSON.stringify(rows, null, 2);
      const summariesPath = path.join(tempDir, 'summaries.json');
      fs.writeFileSync(summariesPath, summariesJson);

      // Create a fresh DB for import (simulate restore)
      const restoreDbPath = path.join(tempDir, 'restored-memory.db');
      const restoreDb = new Database(restoreDbPath);
      restoreDb.exec(`
        CREATE TABLE IF NOT EXISTS summaries (
          session_id TEXT PRIMARY KEY,
          summary TEXT,
          created_at TEXT
        )
      `);
      restoreDb.close();

      // Import using the actual importSummaries function
      const { importSummaries } = require('../src/memory-restore');
      const imported = importSummaries(summariesPath, restoreDbPath);

      expect(imported).toBe(2);

      // Verify data matches
      const verifyDb = new Database(restoreDbPath, { readonly: true });
      const restored = verifyDb.prepare('SELECT * FROM summaries ORDER BY session_id').all();
      verifyDb.close();

      expect(restored).toHaveLength(2);
      expect(restored[0].session_id).toBe('20260215-001');
      expect(restored[0].summary).toBe('Test summary one');
      expect(restored[1].session_id).toBe('20260215-002');
      expect(restored[1].summary).toBe('Test summary two');
    });

    test('importSummaries returns 0 for missing file', () => {
      const { importSummaries } = require('../src/memory-restore');
      const result = importSummaries(
        path.join(tempDir, 'nonexistent.json'),
        path.join(tempDir, 'nonexistent.db')
      );
      expect(result).toBe(0);
    });
  });

  describe('backup-config consistency', () => {
    test('getDataSources returns same keys for default and custom root', () => {
      const defaultSources = getDataSources();
      const customSources = getDataSources(tempDir);

      const defaultKeys = defaultSources.map(s => s.key);
      const customKeys = customSources.map(s => s.key);

      expect(defaultKeys).toEqual(customKeys);
      expect(defaultKeys).toContain('steering');
      expect(defaultKeys).toContain('knowledge');
      expect(defaultKeys).toContain('journals');
      expect(defaultKeys).toContain('sessions');
    });

    test('getDataSources paths are absolute', () => {
      const sources = getDataSources(tempDir);
      for (const source of sources) {
        expect(path.isAbsolute(source.localPath)).toBe(true);
      }
    });

    test('getDbPath returns path ending in memory.db', () => {
      const dbPath = getDbPath(tempDir);
      expect(dbPath).toMatch(/memory\.db$/);
      expect(path.isAbsolute(dbPath)).toBe(true);
    });

    test('steering source has ONBOARDING.md in excludeFiles', () => {
      const sources = getDataSources();
      const steering = sources.find(s => s.key === 'steering');
      expect(steering.excludeFiles).toContain('ONBOARDING.md');
    });
  });

  describe('buildAuthUrl', () => {
    test('injects token into https URL', () => {
      const url = buildAuthUrl('https://github.com/user/repo', 'mytoken');
      expect(url).toBe('https://mytoken@github.com/user/repo.git');
    });

    test('appends .git if missing', () => {
      const url = buildAuthUrl('https://github.com/user/repo', 'tok');
      expect(url).toContain('.git');
    });

    test('does not double .git', () => {
      const url = buildAuthUrl('https://github.com/user/repo.git', 'tok');
      expect(url).not.toContain('.git.git');
    });

    test('trims trailing slashes', () => {
      const url = buildAuthUrl('https://github.com/user/repo///', 'tok');
      expect(url).toBe('https://tok@github.com/user/repo.git');
    });

    test('converts http to https', () => {
      const url = buildAuthUrl('http://github.com/user/repo', 'tok');
      expect(url).toStartWith('https://');
    });
  });
});

// Custom matcher for toStartWith
expect.extend({
  toStartWith(received, prefix) {
    const pass = typeof received === 'string' && received.startsWith(prefix);
    return {
      pass,
      message: () => `expected "${received}" to start with "${prefix}"`,
    };
  },
});
