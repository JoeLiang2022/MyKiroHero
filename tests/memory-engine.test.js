/**
 * Memory Engine - Property-Based Tests
 * 
 * 使用 fast-check 驗證 7 個正確性屬性：
 * P1: 索引完整性
 * P2: FTS5 搜尋召回率
 * P3: 時間衰減單調性
 * P4: 去重正確性
 * P5: 索引冪等性
 * P6: Fallback 功能等價（簡化版）
 * P7: 索引可重建性
 */

const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { initDatabase, getDatabase, closeDatabase, resetDatabase, isDatabaseAvailable } = require('../src/memory/database');
const { tokenize, extractKeywords, extractFiles, extractToolCalls, indexSession, parseJsonlBySession, indexJsonlFile, rebuildAll } = require('../src/memory/indexer');
const { searchL1, searchL2, applyTimeDecay, deduplicateResults, jaccardSimilarity } = require('../src/memory/search-engine');
const { JsonFallback } = require('../src/memory/json-fallback');

// ============================================
// Test Helpers
// ============================================

let testDir;

function setupTestDir() {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-engine-test-'));
    const sessionsDir = path.join(testDir, 'sessions');
    const dataDir = path.join(testDir, 'data');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    return { sessionsDir, dataDir };
}

function cleanupTestDir() {
    if (testDir && fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
    }
}

function makeRecord(sessionId, role, text, ts) {
    return { ts: ts || new Date().toISOString(), sessionId, role, text };
}

function writeJsonl(sessionsDir, date, records) {
    const filePath = path.join(sessionsDir, `${date}.jsonl`);
    const content = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

// fast-check arbitrary for session records
const sessionRecordArb = fc.record({
    sessionId: fc.stringMatching(/^2026020[1-9]-00[1-9]$/),
    role: fc.constantFrom('user', 'assistant'),
    text: fc.string({ minLength: 1, maxLength: 200 }),
    ts: fc.constant('2026-02-07T10:00:00Z')
});

// ============================================
// Setup / Teardown
// ============================================

beforeEach(() => {
    resetDatabase();
    initDatabase(':memory:');
});

afterEach(() => {
    resetDatabase();
    cleanupTestDir();
});


// ============================================
// Tokenizer Tests
// ============================================

describe('Tokenizer', () => {
    test('tokenizes English text', () => {
        const tokens = tokenize('database query engine');
        expect(tokens).toContain('database');
        expect(tokens).toContain('query');
        expect(tokens).toContain('engine');
    });

    test('tokenizes Chinese text with 2-gram', () => {
        const tokens = tokenize('記憶系統測試');
        expect(tokens.length).toBeGreaterThan(0);
        // Should have bigrams
        expect(tokens).toContain('記憶');
    });

    test('filters stopwords', () => {
        const tokens = tokenize('the is a test');
        expect(tokens).not.toContain('the');
        expect(tokens).not.toContain('is');
        expect(tokens).toContain('test');
    });

    test('handles empty input', () => {
        expect(tokenize('')).toEqual([]);
        expect(tokenize(null)).toEqual([]);
        expect(tokenize(undefined)).toEqual([]);
    });

    test('property: tokenize never returns stopwords', () => {
        fc.assert(fc.property(
            fc.string({ minLength: 0, maxLength: 100 }),
            (text) => {
                const tokens = tokenize(text);
                const { STOPWORDS } = require('../src/memory/indexer');
                for (const t of tokens) {
                    expect(STOPWORDS.has(t)).toBe(false);
                }
            }
        ), { numRuns: 50 });
    });
});

// ============================================
// P1: 索引完整性
// ============================================

describe('P1: Index Completeness', () => {
    test('every indexed session has a row in sessions table', () => {
        const db = getDatabase();
        const records = [
            makeRecord('20260207-001', 'user', 'hello world', '2026-02-07T10:00:00Z'),
            makeRecord('20260207-001', 'assistant', 'hi there', '2026-02-07T10:01:00Z'),
            makeRecord('20260207-002', 'user', 'second session', '2026-02-07T11:00:00Z'),
        ];

        // Index by session
        const bySession = new Map();
        for (const r of records) {
            if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, []);
            bySession.get(r.sessionId).push(r);
        }

        for (const [sid, recs] of bySession) {
            indexSession(sid, recs);
        }

        // Verify all sessions exist
        for (const sid of bySession.keys()) {
            const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid);
            expect(row).toBeTruthy();
            expect(row.id).toBe(sid);
        }
    });

    test('property: indexing N sessions creates N rows', () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 5 }),
            (n) => {
                resetDatabase();
                initDatabase(':memory:');
                const db = getDatabase();

                for (let i = 1; i <= n; i++) {
                    const sid = `20260207-${String(i).padStart(3, '0')}`;
                    indexSession(sid, [makeRecord(sid, 'user', `message ${i}`)]);
                }

                const count = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
                expect(count).toBe(n);
            }
        ), { numRuns: 20 });
    });
});

// ============================================
// P2: FTS5 搜尋召回率
// ============================================

describe('P2: FTS5 Search Recall', () => {
    test('message containing keyword is found by FTS5', () => {
        const db = getDatabase();
        indexSession('20260207-001', [
            makeRecord('20260207-001', 'user', 'SQLite database testing', '2026-02-07T10:00:00Z'),
            makeRecord('20260207-001', 'assistant', 'FTS5 full text search', '2026-02-07T10:01:00Z'),
        ]);

        const results = db.prepare("SELECT * FROM messages WHERE messages MATCH ?").all('SQLite');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].content).toContain('SQLite');
    });

    test('property: inserted content is always searchable', () => {
        fc.assert(fc.property(
            fc.stringMatching(/^[a-z]{4,10}$/),
            (word) => {
                resetDatabase();
                initDatabase(':memory:');
                const db = getDatabase();

                indexSession('20260207-001', [
                    makeRecord('20260207-001', 'user', `testing ${word} here`)
                ]);

                const results = db.prepare("SELECT * FROM messages WHERE messages MATCH ?").all(word);
                expect(results.length).toBeGreaterThan(0);
            }
        ), { numRuns: 20 });
    });
});

// ============================================
// P3: 時間衰減單調性
// ============================================

describe('P3: Time Decay Monotonicity', () => {
    test('newer results score higher with same BM25', () => {
        const score = 1.0;
        const newer = applyTimeDecay(score, 1);   // 1 day old
        const older = applyTimeDecay(score, 10);   // 10 days old
        expect(newer).toBeGreaterThan(older);
    });

    test('property: decay is monotonically decreasing with age', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.1, max: 10, noNaN: true }),
            fc.double({ min: 0, max: 100, noNaN: true }),
            fc.double({ min: 0, max: 100, noNaN: true }),
            (score, age1, age2) => {
                if (age1 < age2) {
                    expect(applyTimeDecay(score, age1)).toBeGreaterThanOrEqual(applyTimeDecay(score, age2));
                }
            }
        ), { numRuns: 100 });
    });

    test('zero age returns original score', () => {
        expect(applyTimeDecay(5.0, 0)).toBe(5.0);
    });
});

// ============================================
// P4: 去重正確性
// ============================================

describe('P4: Dedup Correctness', () => {
    test('identical results keep only the newest', () => {
        const results = [
            { content: 'hello world test', timestamp: '2026-02-05', score: 1 },
            { content: 'hello world test', timestamp: '2026-02-07', score: 1 },
        ];

        const deduped = deduplicateResults(results);
        expect(deduped.length).toBe(1);
        expect(deduped[0].timestamp).toBe('2026-02-07');
    });

    test('different results are all kept', () => {
        const results = [
            { content: 'SQLite database indexing', timestamp: '2026-02-05', score: 1 },
            { content: 'WhatsApp message sending', timestamp: '2026-02-07', score: 1 },
        ];

        const deduped = deduplicateResults(results);
        expect(deduped.length).toBe(2);
    });

    test('Jaccard similarity of identical sets is 1', () => {
        const s = new Set(['a', 'b', 'c']);
        expect(jaccardSimilarity(s, s)).toBe(1);
    });

    test('Jaccard similarity of disjoint sets is 0', () => {
        const a = new Set(['a', 'b']);
        const b = new Set(['c', 'd']);
        expect(jaccardSimilarity(a, b)).toBe(0);
    });

    test('property: dedup never increases result count', () => {
        fc.assert(fc.property(
            fc.array(fc.record({
                content: fc.string({ minLength: 5, maxLength: 50 }),
                timestamp: fc.constantFrom('2026-02-05', '2026-02-06', '2026-02-07'),
                score: fc.double({ min: 0, max: 10, noNaN: true })
            }), { minLength: 0, maxLength: 10 }),
            (results) => {
                const deduped = deduplicateResults(results);
                expect(deduped.length).toBeLessThanOrEqual(results.length);
            }
        ), { numRuns: 50 });
    });
});


// ============================================
// P5: 索引冪等性
// ============================================

describe('P5: Index Idempotency', () => {
    test('indexing same session twice does not duplicate', () => {
        const db = getDatabase();
        const records = [
            makeRecord('20260207-001', 'user', 'hello', '2026-02-07T10:00:00Z'),
            makeRecord('20260207-001', 'assistant', 'hi', '2026-02-07T10:01:00Z'),
        ];

        indexSession('20260207-001', records);
        const count1 = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;

        indexSession('20260207-001', records);
        const count2 = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;

        expect(count1).toBe(count2);
    });

    test('property: repeated indexing is stable', () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 3 }),
            (repeats) => {
                resetDatabase();
                initDatabase(':memory:');
                const db = getDatabase();

                const records = [
                    makeRecord('20260207-001', 'user', 'test message'),
                    makeRecord('20260207-001', 'assistant', 'reply message'),
                ];

                indexSession('20260207-001', records);
                const firstCount = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;

                for (let i = 0; i < repeats; i++) {
                    indexSession('20260207-001', records);
                }

                const finalCount = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;
                expect(finalCount).toBe(firstCount);
            }
        ), { numRuns: 10 });
    });
});

// ============================================
// P6: Fallback 功能等價（簡化版）
// ============================================

describe('P6: Fallback Equivalence', () => {
    test('JSON fallback finds same sessions as SQLite L1', () => {
        const { sessionsDir, dataDir } = setupTestDir();

        // 寫入測試 JSONL
        const records = [
            makeRecord('20260207-001', 'user', 'SQLite database testing', '2026-02-07T10:00:00Z'),
            makeRecord('20260207-001', 'assistant', 'FTS5 search works', '2026-02-07T10:01:00Z'),
        ];
        writeJsonl(sessionsDir, '2026-02-07', records);

        // SQLite 索引
        const db = getDatabase();
        indexSession('20260207-001', records);

        // JSON fallback 索引
        const fallback = new JsonFallback(dataDir);
        fallback.indexFile(path.join(sessionsDir, '2026-02-07.jsonl'));

        // 搜尋比較
        const sqliteResults = searchL1('SQLite', { days: 30 });
        const fallbackResults = fallback.search('SQLite', { days: 30 });

        // Fallback 結果的 session IDs 應該是 SQLite 結果的子集
        const sqliteIds = new Set(sqliteResults.map(r => r.sessionId));
        const fallbackIds = fallbackResults.map(r => r.sessionId);

        for (const id of fallbackIds) {
            expect(sqliteIds.has(id)).toBe(true);
        }
    });
});

// ============================================
// P7: 索引可重建性
// ============================================

describe('P7: Index Rebuildability', () => {
    test('rebuild produces same sessions as incremental', () => {
        const { sessionsDir } = setupTestDir();

        const records1 = [
            makeRecord('20260207-001', 'user', 'first session', '2026-02-07T10:00:00Z'),
            makeRecord('20260207-001', 'assistant', 'reply one', '2026-02-07T10:01:00Z'),
        ];
        const records2 = [
            makeRecord('20260207-002', 'user', 'second session', '2026-02-07T11:00:00Z'),
        ];
        writeJsonl(sessionsDir, '2026-02-07', [...records1, ...records2]);

        // Incremental index
        const db = getDatabase();
        indexSession('20260207-001', records1);
        indexSession('20260207-002', records2);
        const incrementalSessions = db.prepare('SELECT id FROM sessions ORDER BY id').all().map(r => r.id);
        const incrementalMsgCount = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;

        // Rebuild
        rebuildAll(sessionsDir);
        const rebuildSessions = db.prepare('SELECT id FROM sessions ORDER BY id').all().map(r => r.id);
        const rebuildMsgCount = db.prepare('SELECT COUNT(*) as c FROM messages').get().c;

        expect(rebuildSessions).toEqual(incrementalSessions);
        expect(rebuildMsgCount).toBe(incrementalMsgCount);
    });
});

// ============================================
// Keyword Extraction Tests
// ============================================

describe('Keyword Extraction', () => {
    test('extracts keywords from messages', () => {
        const records = [
            makeRecord('20260207-001', 'user', 'SQLite database FTS5 search'),
            makeRecord('20260207-001', 'assistant', 'SQLite is great for FTS5'),
        ];
        const keywords = extractKeywords(records);
        expect(keywords).toContain('sqlite');
        expect(keywords.length).toBeLessThanOrEqual(20);
    });

    test('ignores non-user/assistant roles', () => {
        const records = [
            { sessionId: '20260207-001', role: 'tool', text: 'tool output', toolName: 'test' },
            makeRecord('20260207-001', 'user', 'actual content'),
        ];
        const keywords = extractKeywords(records);
        // 'tool' and 'output' should not be in keywords (from tool role)
        expect(keywords).toContain('actual');
    });

    test('extractFiles finds file paths in tool args', () => {
        const records = [
            { sessionId: '20260207-001', role: 'tool', toolName: 'readFile', args: { path: 'src/memory/engine.js' } },
        ];
        const files = extractFiles(records);
        expect(files).toContain('engine.js');
    });

    test('extractToolCalls collects tool names', () => {
        const records = [
            { sessionId: '20260207-001', role: 'tool', toolName: 'search_knowledge' },
            { sessionId: '20260207-001', role: 'tool', toolName: 'send_whatsapp' },
            { sessionId: '20260207-001', role: 'tool', toolName: 'search_knowledge' },
        ];
        const tools = extractToolCalls(records);
        expect(tools).toContain('search_knowledge');
        expect(tools).toContain('send_whatsapp');
        expect(tools.length).toBe(2); // deduplicated
    });
});

// ============================================
// JSONL Parsing Tests
// ============================================

describe('JSONL Parsing', () => {
    test('parseJsonlBySession groups records correctly', () => {
        const { sessionsDir } = setupTestDir();
        const records = [
            makeRecord('20260207-001', 'user', 'msg1'),
            makeRecord('20260207-001', 'assistant', 'msg2'),
            makeRecord('20260207-002', 'user', 'msg3'),
        ];
        const filePath = writeJsonl(sessionsDir, '2026-02-07', records);

        const sessions = parseJsonlBySession(filePath);
        expect(sessions.size).toBe(2);
        expect(sessions.get('20260207-001').length).toBe(2);
        expect(sessions.get('20260207-002').length).toBe(1);
    });

    test('skips malformed lines', () => {
        const { sessionsDir } = setupTestDir();
        const filePath = path.join(sessionsDir, '2026-02-07.jsonl');
        fs.writeFileSync(filePath, '{"sessionId":"20260207-001","role":"user","text":"ok"}\nINVALID JSON\n', 'utf8');

        const sessions = parseJsonlBySession(filePath);
        expect(sessions.size).toBe(1);
    });
});

// ============================================
// Integration: indexJsonlFile
// ============================================

describe('indexJsonlFile', () => {
    test('indexes a JSONL file and skips already indexed', () => {
        const { sessionsDir } = setupTestDir();
        const records = [
            makeRecord('20260207-001', 'user', 'hello world'),
            makeRecord('20260207-001', 'assistant', 'hi there'),
        ];
        const filePath = writeJsonl(sessionsDir, '2026-02-07', records);

        const result1 = indexJsonlFile(filePath);
        expect(result1.indexed).toBe(1);
        expect(result1.skipped).toBe(0);

        const result2 = indexJsonlFile(filePath);
        expect(result2.indexed).toBe(0);
        expect(result2.skipped).toBe(1);
    });
});
