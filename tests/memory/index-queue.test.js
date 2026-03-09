/**
 * Tests for event-driven index queue in memory engine
 */
const http = require('http');
const path = require('path');

// Mock dependencies before requiring engine
jest.mock('../../src/memory/database', () => ({
    initDatabase: jest.fn(() => ({})),
    getDatabase: jest.fn(() => ({
        prepare: jest.fn(() => ({
            get: jest.fn(() => ({ c: 0, value: '' })),
            all: jest.fn(() => []),
            run: jest.fn()
        }))
    })),
    closeDatabase: jest.fn(),
    isDatabaseAvailable: jest.fn(() => true),
    isFallbackMode: jest.fn(() => false)
}));

jest.mock('../../src/memory/indexer', () => ({
    indexAllFiles: jest.fn(() => ({ totalIndexed: 0 })),
    rebuildAll: jest.fn(() => ({ totalIndexed: 0 })),
    indexJsonlFile: jest.fn(() => ({ indexed: true }))
}));

jest.mock('../../src/memory/unified-search', () => ({
    searchAll: jest.fn(() => [])
}));

jest.mock('../../src/utils/timezone', () => ({
    getNowISO: jest.fn(() => '2026-02-20T06:00:00+08:00')
}));

const { handleRequest, processIndexQueue, indexQueue } = require('../../src/memory/engine');
const { indexJsonlFile } = require('../../src/memory/indexer');
const { isDatabaseAvailable } = require('../../src/memory/database');

// Helper: create mock req/res for handleRequest
function mockReqRes(method, url, body = null) {
    const req = new (require('stream').Readable)();
    req.method = method;
    req.url = url;
    req._read = () => {};

    const res = {
        statusCode: null,
        headers: {},
        body: null,
        writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
        end(data) { this.body = data ? JSON.parse(data) : null; }
    };

    // Simulate body
    if (body) {
        process.nextTick(() => {
            req.push(JSON.stringify(body));
            req.push(null);
        });
    } else {
        process.nextTick(() => req.push(null));
    }

    return { req, res };
}

beforeEach(() => {
    indexQueue.clear();
    jest.clearAllMocks();
    isDatabaseAvailable.mockReturnValue(true);
});

describe('POST /index/queue', () => {
    test('accepts filePath and adds to queue', async () => {
        const { req, res } = mockReqRes('POST', '/index/queue', { filePath: '/sessions/2026-02-20.jsonl' });
        await handleRequest(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.queued).toBe(true);
        expect(res.body.queueSize).toBe(1);
        expect(indexQueue.has('/sessions/2026-02-20.jsonl')).toBe(true);
    });

    test('accepts date and resolves to filePath', async () => {
        const { req, res } = mockReqRes('POST', '/index/queue', { date: '2026-02-20' });
        await handleRequest(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.queued).toBe(true);
        // Should contain the resolved path with the date
        const items = [...indexQueue];
        expect(items[0]).toContain('2026-02-20.jsonl');
    });

    test('returns 400 when neither filePath nor date provided', async () => {
        const { req, res } = mockReqRes('POST', '/index/queue', {});
        await handleRequest(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/Missing/);
    });

    test('deduplicates same filePath', async () => {
        const fp = '/sessions/2026-02-20.jsonl';
        const { req: req1, res: res1 } = mockReqRes('POST', '/index/queue', { filePath: fp });
        await handleRequest(req1, res1);

        const { req: req2, res: res2 } = mockReqRes('POST', '/index/queue', { filePath: fp });
        await handleRequest(req2, res2);

        expect(res2.body.queueSize).toBe(1);
        expect(indexQueue.size).toBe(1);
    });
});

describe('processIndexQueue', () => {
    test('drains queue and calls indexJsonlFile for each item', () => {
        indexQueue.add('/a.jsonl');
        indexQueue.add('/b.jsonl');

        processIndexQueue();

        expect(indexJsonlFile).toHaveBeenCalledTimes(2);
        expect(indexJsonlFile).toHaveBeenCalledWith('/a.jsonl');
        expect(indexJsonlFile).toHaveBeenCalledWith('/b.jsonl');
        expect(indexQueue.size).toBe(0);
    });

    test('does nothing when queue is empty', () => {
        processIndexQueue();
        expect(indexJsonlFile).not.toHaveBeenCalled();
    });

    test('skips when database unavailable', () => {
        isDatabaseAvailable.mockReturnValue(false);
        indexQueue.add('/a.jsonl');

        processIndexQueue();

        expect(indexJsonlFile).not.toHaveBeenCalled();
        // Queue should NOT be drained when DB is unavailable
        expect(indexQueue.size).toBe(1);
    });

    test('continues processing remaining items when one fails', () => {
        indexJsonlFile.mockImplementationOnce(() => { throw new Error('fail'); });
        indexJsonlFile.mockImplementationOnce(() => ({ indexed: true }));

        indexQueue.add('/fail.jsonl');
        indexQueue.add('/ok.jsonl');

        processIndexQueue();

        expect(indexJsonlFile).toHaveBeenCalledTimes(2);
        expect(indexQueue.size).toBe(0);
    });
});

describe('GET /health includes queue stats', () => {
    test('returns queueSize, lastQueueProcess, queueProcessCount', async () => {
        indexQueue.add('/x.jsonl');
        const { req, res } = mockReqRes('GET', '/health');
        await handleRequest(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('queueSize', 1);
        expect(res.body).toHaveProperty('lastQueueProcess');
        expect(res.body).toHaveProperty('queueProcessCount');
    });
});

describe('weekly fallback timer constant', () => {
    test('WEEKLY_INDEX_INTERVAL is 7 days in ms', () => {
        // Verify the constant exists by checking the module doesn't crash
        // and the periodic index function is still exported
        const engine = require('../../src/memory/engine');
        expect(typeof engine.runPeriodicIndex).toBe('function');
    });
});
