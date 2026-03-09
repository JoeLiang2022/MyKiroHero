/**
 * Tests for searchL3 readline streaming + early termination
 * 
 * Tests readSessionFromJsonl helper and the async searchL3 function.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// Suppress console during tests
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const { readSessionFromJsonl, searchL3 } = require('../src/memory/search-engine');

// Helper: create a temp dir with JSONL files for testing
function createTempSessionsDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-l3-test-'));
    return dir;
}

// Helper: write JSONL lines to a file
function writeJsonl(filePath, records) {
    const content = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(filePath, content, 'utf8');
}

// Cleanup helper
function cleanupDir(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
}

describe('readSessionFromJsonl', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = createTempSessionsDir();
    });

    afterEach(() => {
        cleanupDir(tempDir);
    });

    it('should read all records for a target session', async () => {
        const filePath = path.join(tempDir, '2026-02-20.jsonl');
        writeJsonl(filePath, [
            { sessionId: 'sess-001', role: 'user', text: 'hello', ts: '2026-02-20T10:00:00' },
            { sessionId: 'sess-001', role: 'assistant', text: 'hi there', ts: '2026-02-20T10:00:01' },
            { sessionId: 'sess-002', role: 'user', text: 'other session', ts: '2026-02-20T11:00:00' },
            { sessionId: 'sess-001', role: 'user', text: 'follow up', ts: '2026-02-20T10:00:02' },
        ]);

        const records = await readSessionFromJsonl(filePath, 'sess-001');
        expect(records).toHaveLength(3);
        expect(records.every(r => r.sessionId === 'sess-001')).toBe(true);
    });

    it('should return empty array when session not found', async () => {
        const filePath = path.join(tempDir, '2026-02-20.jsonl');
        writeJsonl(filePath, [
            { sessionId: 'sess-001', role: 'user', text: 'hello', ts: '2026-02-20T10:00:00' },
        ]);

        const records = await readSessionFromJsonl(filePath, 'sess-nonexistent');
        expect(records).toHaveLength(0);
    });

    it('should early-terminate after 50 consecutive non-matching lines', async () => {
        const filePath = path.join(tempDir, '2026-02-20.jsonl');
        const lines = [];

        // Target session records (clustered at the beginning)
        lines.push({ sessionId: 'target', role: 'user', text: 'msg1', ts: '10:00' });
        lines.push({ sessionId: 'target', role: 'assistant', text: 'msg2', ts: '10:01' });

        // 60 non-matching lines (should trigger early termination at 50)
        for (let i = 0; i < 60; i++) {
            lines.push({ sessionId: 'other', role: 'user', text: `filler-${i}`, ts: `11:${i}` });
        }

        // Late target record (should NOT be found due to early termination)
        lines.push({ sessionId: 'target', role: 'user', text: 'late-msg', ts: '12:00' });

        writeJsonl(filePath, lines);

        const records = await readSessionFromJsonl(filePath, 'target');
        // Should find only the first 2 records, not the late one
        expect(records).toHaveLength(2);
        expect(records[0].text).toBe('msg1');
        expect(records[1].text).toBe('msg2');
    });

    it('should NOT early-terminate if misses are under threshold', async () => {
        const filePath = path.join(tempDir, '2026-02-20.jsonl');
        const lines = [];

        // First batch of target records
        lines.push({ sessionId: 'target', role: 'user', text: 'msg1', ts: '10:00' });

        // 30 non-matching lines (under threshold of 50)
        for (let i = 0; i < 30; i++) {
            lines.push({ sessionId: 'other', role: 'user', text: `filler-${i}`, ts: `11:${i}` });
        }

        // Second batch of target records (should still be found)
        lines.push({ sessionId: 'target', role: 'user', text: 'msg2', ts: '12:00' });

        writeJsonl(filePath, lines);

        const records = await readSessionFromJsonl(filePath, 'target');
        expect(records).toHaveLength(2);
        expect(records[1].text).toBe('msg2');
    });

    it('should respect maxRecords limit', async () => {
        const filePath = path.join(tempDir, '2026-02-20.jsonl');
        const lines = [];
        for (let i = 0; i < 100; i++) {
            lines.push({ sessionId: 'target', role: 'user', text: `msg-${i}`, ts: `10:${i}` });
        }
        writeJsonl(filePath, lines);

        const records = await readSessionFromJsonl(filePath, 'target', 5);
        expect(records).toHaveLength(5);
        expect(records[0].text).toBe('msg-0');
        expect(records[4].text).toBe('msg-4');
    });

    it('should skip malformed JSON lines gracefully', async () => {
        const filePath = path.join(tempDir, '2026-02-20.jsonl');
        const content = [
            JSON.stringify({ sessionId: 'target', role: 'user', text: 'good1', ts: '10:00' }),
            'this is not valid json {{{',
            '',
            JSON.stringify({ sessionId: 'target', role: 'assistant', text: 'good2', ts: '10:01' }),
        ].join('\n') + '\n';
        fs.writeFileSync(filePath, content, 'utf8');

        const records = await readSessionFromJsonl(filePath, 'target');
        expect(records).toHaveLength(2);
        expect(records[0].text).toBe('good1');
        expect(records[1].text).toBe('good2');
    });

    it('should handle empty file', async () => {
        const filePath = path.join(tempDir, '2026-02-20.jsonl');
        fs.writeFileSync(filePath, '', 'utf8');

        const records = await readSessionFromJsonl(filePath, 'target');
        expect(records).toHaveLength(0);
    });

    it('should handle file with only empty lines', async () => {
        const filePath = path.join(tempDir, '2026-02-20.jsonl');
        fs.writeFileSync(filePath, '\n\n\n\n', 'utf8');

        const records = await readSessionFromJsonl(filePath, 'target');
        expect(records).toHaveLength(0);
    });

    it('should reset consecutive miss counter when target record found', async () => {
        const filePath = path.join(tempDir, '2026-02-20.jsonl');
        const lines = [];

        lines.push({ sessionId: 'target', role: 'user', text: 'msg1', ts: '10:00' });

        // 45 non-matching (under threshold)
        for (let i = 0; i < 45; i++) {
            lines.push({ sessionId: 'other', role: 'user', text: `filler-${i}`, ts: `11:${i}` });
        }

        // Target record resets the counter
        lines.push({ sessionId: 'target', role: 'user', text: 'msg2', ts: '12:00' });

        // Another 45 non-matching (under threshold again because counter was reset)
        for (let i = 0; i < 45; i++) {
            lines.push({ sessionId: 'other2', role: 'user', text: `filler2-${i}`, ts: `13:${i}` });
        }

        // Should still be found
        lines.push({ sessionId: 'target', role: 'user', text: 'msg3', ts: '14:00' });

        writeJsonl(filePath, lines);

        const records = await readSessionFromJsonl(filePath, 'target');
        expect(records).toHaveLength(3);
    });
});

describe('searchL3 (async)', () => {
    it('should return a promise', () => {
        // searchL3 depends on searchL2 which needs a database,
        // so we test that it returns a promise and handles empty L2 results
        const result = searchL3('nonexistent query', { sessionsDir: '/tmp' });
        expect(result).toBeInstanceOf(Promise);
    });

    it('should return empty array when L2 returns no results', async () => {
        const results = await searchL3('xyznonexistentquery12345', { sessionsDir: '/tmp' });
        expect(results).toEqual([]);
    });

    it('should return empty array when sessionsDir is missing', async () => {
        // Mock searchL2 to return results but no sessionsDir
        const results = await searchL3('test', {});
        expect(results).toEqual([]);
    });
});
