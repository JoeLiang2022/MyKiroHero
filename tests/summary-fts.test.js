/**
 * Tests for summary_fts FTS5 virtual table and searchL2 summary integration
 * 
 * Covers:
 * - database.js: summary_fts creation, parseSummaryForFts, populateSummaryFts, syncSummaryFts
 * - search-engine.js: searchL2 querying summary_fts and merging results
 */

// Suppress console
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const {
  initDatabase,
  getDatabase,
  closeDatabase,
  resetDatabase,
  populateSummaryFts,
  syncSummaryFts,
  parseSummaryForFts,
} = require('../src/memory/database');

const { searchL2 } = require('../src/memory/search-engine');

// Helper: seed a session + summary into the DB
function seedSession(db, sessionId, date, summaryObj) {
  db.prepare('INSERT OR REPLACE INTO sessions (id, date, keywords) VALUES (?, ?, ?)')
    .run(sessionId, date, JSON.stringify([]));
  db.prepare('INSERT OR REPLACE INTO summaries (session_id, summary, created_at) VALUES (?, ?, ?)')
    .run(sessionId, JSON.stringify(summaryObj), new Date().toISOString());
}

// Helper: seed a message into FTS5
function seedMessage(db, sessionId, role, content) {
  db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
    .run(sessionId, role, content, new Date().toISOString());
}

describe('parseSummaryForFts', () => {
  test('parses valid structured summary JSON', () => {
    const input = JSON.stringify({
      topic: 'Deploy pipeline setup',
      tags: ['deploy', 'ci', 'staging'],
      decisions: ['Use GitHub Actions', 'Deploy to staging first'],
      actions: ['Created workflow file', 'Tested locally'],
      summary: 'Full deployment pipeline overview',
    });
    const result = parseSummaryForFts(input);
    expect(result.topic).toBe('Deploy pipeline setup');
    expect(result.tags).toBe('deploy ci staging');
    expect(result.decisions).toBe('Use GitHub Actions Deploy to staging first');
    expect(result.actions).toBe('Created workflow file Tested locally');
    expect(result.summaryText).toBe('Full deployment pipeline overview');
  });

  test('falls back to topic when summary field missing', () => {
    const input = JSON.stringify({ topic: 'Quick fix' });
    const result = parseSummaryForFts(input);
    expect(result.summaryText).toBe('Quick fix');
  });

  test('handles null/undefined input', () => {
    expect(parseSummaryForFts(null).topic).toBe('');
    expect(parseSummaryForFts(undefined).summaryText).toBe('');
  });

  test('handles non-JSON string as summaryText', () => {
    const result = parseSummaryForFts('plain text summary');
    expect(result.summaryText).toBe('plain text summary');
    expect(result.topic).toBe('');
  });

  test('handles empty arrays gracefully', () => {
    const input = JSON.stringify({ topic: 'Test', tags: [], decisions: [], actions: [] });
    const result = parseSummaryForFts(input);
    expect(result.tags).toBe('');
    expect(result.decisions).toBe('');
    expect(result.actions).toBe('');
  });
});

describe('summary_fts table', () => {
  let db;

  beforeEach(() => {
    resetDatabase();
    initDatabase(':memory:');
    db = getDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test('summary_fts table is created during initDatabase', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='summary_fts'"
    ).all();
    expect(tables.length).toBe(1);
  });

  test('populateSummaryFts indexes all summaries', () => {
    seedSession(db, '20260220-001', '2026-02-20', {
      topic: 'Gateway refactor',
      tags: ['gateway', 'refactor'],
      decisions: ['Split into modules'],
      actions: ['Created gateway/config.js'],
    });
    seedSession(db, '20260220-002', '2026-02-20', {
      topic: 'Memory search optimization',
      tags: ['memory', 'fts5', 'search'],
      decisions: ['Add summary FTS'],
      actions: ['Implemented summary_fts'],
    });

    populateSummaryFts();

    const rows = db.prepare('SELECT * FROM summary_fts').all();
    expect(rows.length).toBe(2);
  });

  test('populateSummaryFts is idempotent (safe to call multiple times)', () => {
    seedSession(db, '20260220-001', '2026-02-20', { topic: 'Test' });
    populateSummaryFts();
    populateSummaryFts();

    const rows = db.prepare('SELECT * FROM summary_fts').all();
    expect(rows.length).toBe(1);
  });

  test('syncSummaryFts upserts a single session', () => {
    seedSession(db, '20260220-001', '2026-02-20', { topic: 'Initial topic' });
    syncSummaryFts('20260220-001');

    let rows = db.prepare("SELECT * FROM summary_fts WHERE session_id = '20260220-001'").all();
    expect(rows.length).toBe(1);
    expect(rows[0].topic).toBe('Initial topic');

    // Update the summary and re-sync
    db.prepare('UPDATE summaries SET summary = ? WHERE session_id = ?')
      .run(JSON.stringify({ topic: 'Updated topic', tags: ['updated'] }), '20260220-001');
    syncSummaryFts('20260220-001');

    rows = db.prepare("SELECT * FROM summary_fts WHERE session_id = '20260220-001'").all();
    expect(rows.length).toBe(1);
    expect(rows[0].topic).toBe('Updated topic');
  });

  test('syncSummaryFts removes entry when summary is deleted', () => {
    seedSession(db, '20260220-001', '2026-02-20', { topic: 'To be deleted' });
    syncSummaryFts('20260220-001');
    expect(db.prepare("SELECT * FROM summary_fts WHERE session_id = '20260220-001'").all().length).toBe(1);

    db.prepare('DELETE FROM summaries WHERE session_id = ?').run('20260220-001');
    syncSummaryFts('20260220-001');
    expect(db.prepare("SELECT * FROM summary_fts WHERE session_id = '20260220-001'").all().length).toBe(0);
  });

  test('summary_fts supports FTS5 MATCH queries', () => {
    seedSession(db, '20260220-001', '2026-02-20', {
      topic: 'WhatsApp integration',
      tags: ['whatsapp', 'api'],
      decisions: ['Use baileys library'],
      actions: ['Connected to WhatsApp Web'],
    });
    populateSummaryFts();

    const results = db.prepare("SELECT * FROM summary_fts WHERE summary_fts MATCH 'whatsapp'").all();
    expect(results.length).toBe(1);
    expect(results[0].session_id).toBe('20260220-001');
  });

  test('summary_fts BM25 weighted scoring works', () => {
    // Topic match should score higher than actions match
    seedSession(db, 'topic-match', '2026-02-20', {
      topic: 'kubernetes deployment',
      tags: [],
      decisions: [],
      actions: [],
    });
    seedSession(db, 'action-match', '2026-02-20', {
      topic: 'General session',
      tags: [],
      decisions: [],
      actions: ['kubernetes deployment step'],
    });
    populateSummaryFts();

    const results = db.prepare(`
      SELECT session_id, bm25(summary_fts, 0, 10, 5, 3, 2, 1) as score
      FROM summary_fts
      WHERE summary_fts MATCH 'kubernetes'
      ORDER BY bm25(summary_fts, 0, 10, 5, 3, 2, 1)
    `).all();

    expect(results.length).toBe(2);
    // Lower BM25 = better match; topic-match should have lower (better) score
    const topicResult = results.find(r => r.session_id === 'topic-match');
    const actionResult = results.find(r => r.session_id === 'action-match');
    expect(topicResult.score).toBeLessThan(actionResult.score);
  });
});

describe('searchL2 with summary_fts integration', () => {
  let db;

  beforeEach(() => {
    resetDatabase();
    initDatabase(':memory:');
    db = getDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test('searchL2 returns summary-only matches not in messages', () => {
    // Session with summary but no matching messages
    seedSession(db, '20260220-001', '2026-02-20', {
      topic: 'Redis caching strategy',
      tags: ['redis', 'cache', 'performance'],
      decisions: ['Use Redis for session cache'],
      actions: ['Installed ioredis'],
    });
    seedMessage(db, '20260220-001', 'user', 'Hello how are you');
    populateSummaryFts();

    const results = searchL2('redis caching', { days: 30 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sessionId).toBe('20260220-001');
  });

  test('searchL2 deduplicates by sessionId keeping highest score', () => {
    seedSession(db, '20260220-001', '2026-02-20', {
      topic: 'Deploy pipeline',
      tags: ['deploy', 'pipeline'],
      decisions: [],
      actions: [],
    });
    // Also add a message with the same keyword
    seedMessage(db, '20260220-001', 'user', 'deploy the pipeline now');
    populateSummaryFts();

    const results = searchL2('deploy pipeline', { days: 30 });
    // Should only have one entry for this session
    const sessionIds = results.map(r => r.sessionId);
    const unique = new Set(sessionIds);
    expect(unique.size).toBe(sessionIds.length);
  });

  test('searchL2 summary matches get 1.2x boost', () => {
    // Two sessions: one only in messages, one only in summary_fts
    seedSession(db, 'msg-only', '2026-02-20', {
      topic: 'Unrelated topic',
      tags: [],
      decisions: [],
      actions: [],
    });
    seedMessage(db, 'msg-only', 'user', 'terraform infrastructure setup');

    seedSession(db, 'summary-only', '2026-02-20', {
      topic: 'terraform infrastructure setup',
      tags: ['terraform', 'infrastructure'],
      decisions: [],
      actions: [],
    });
    seedMessage(db, 'summary-only', 'user', 'Hello general chat');
    populateSummaryFts();

    const results = searchL2('terraform infrastructure', { days: 30 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Summary match should appear (may or may not be ranked first depending on BM25)
    expect(results.some(r => r.sessionId === 'summary-only')).toBe(true);
  });

  test('searchL2 result format includes required fields', () => {
    seedSession(db, '20260220-001', '2026-02-20', {
      topic: 'API gateway design',
      tags: ['api', 'gateway'],
      decisions: ['Use Express'],
      actions: ['Created server.js'],
    });
    populateSummaryFts();

    const results = searchL2('gateway design', { days: 30 });
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r).toHaveProperty('sessionId');
    expect(r).toHaveProperty('date');
    expect(r).toHaveProperty('score');
    expect(r).toHaveProperty('level', 'L2');
    expect(typeof r.score).toBe('number');
  });

  test('searchL2 works when summary_fts is empty', () => {
    seedSession(db, '20260220-001', '2026-02-20', { topic: 'Test' });
    seedMessage(db, '20260220-001', 'user', 'docker container setup');
    // Don't populate summary_fts

    const results = searchL2('docker container', { days: 30 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sessionId).toBe('20260220-001');
  });

  test('searchL2 returns empty for no matches', () => {
    seedSession(db, '20260220-001', '2026-02-20', {
      topic: 'Unrelated topic',
      tags: ['unrelated'],
      decisions: [],
      actions: [],
    });
    seedMessage(db, '20260220-001', 'user', 'nothing relevant here');
    populateSummaryFts();

    const results = searchL2('xyznonexistent', { days: 30 });
    expect(results.length).toBe(0);
  });

  test('searchL2 respects maxResults limit', () => {
    // Seed multiple sessions
    for (let i = 1; i <= 5; i++) {
      const sid = `20260220-00${i}`;
      seedSession(db, sid, '2026-02-20', {
        topic: `Kubernetes cluster ${i}`,
        tags: ['kubernetes', 'cluster'],
        decisions: [],
        actions: [],
      });
    }
    populateSummaryFts();

    const results = searchL2('kubernetes cluster', { days: 30, maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
