/**
 * Tests for auto-recall context builder
 */

// Mock dependencies before requiring module
jest.mock('../../src/memory/database', () => ({
    getDatabase: jest.fn(),
    isDatabaseAvailable: jest.fn(() => true)
}));

jest.mock('../../src/memory/search-engine', () => ({
    searchL1: jest.fn(async () => [])
}));

const { getDatabase, isDatabaseAvailable } = require('../../src/memory/database');
const { searchL1 } = require('../../src/memory/search-engine');
const {
    buildAutoRecallContext,
    isEnabled,
    estimateTokens,
    truncateToTokenBudget,
    getLastSummary
} = require('../../src/memory/auto-recall');

// Helper: mock DB with a summary row
function mockDbWithSummary(summaryObj, sessionId = '20260219-001') {
    const row = {
        session_id: sessionId,
        summary: JSON.stringify(summaryObj),
        created_at: '2026-02-19T18:00:00+08:00'
    };
    getDatabase.mockReturnValue({
        prepare: jest.fn(() => ({
            get: jest.fn(() => row)
        }))
    });
}

// Helper: mock DB with no summaries
function mockDbEmpty() {
    getDatabase.mockReturnValue({
        prepare: jest.fn(() => ({
            get: jest.fn(() => null)
        }))
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    isDatabaseAvailable.mockReturnValue(true);
    delete process.env.AUTO_RECALL_ENABLED;
});

describe('isEnabled', () => {
    test('returns true by default', () => {
        expect(isEnabled()).toBe(true);
    });

    test('returns false when AUTO_RECALL_ENABLED=false', () => {
        process.env.AUTO_RECALL_ENABLED = 'false';
        expect(isEnabled()).toBe(false);
    });

    test('returns false when AUTO_RECALL_ENABLED=0', () => {
        process.env.AUTO_RECALL_ENABLED = '0';
        expect(isEnabled()).toBe(false);
    });

    test('returns true when AUTO_RECALL_ENABLED=true', () => {
        process.env.AUTO_RECALL_ENABLED = 'true';
        expect(isEnabled()).toBe(true);
    });
});

describe('estimateTokens', () => {
    test('returns 0 for empty string', () => {
        expect(estimateTokens('')).toBe(0);
    });

    test('estimates tokens as words * 1.3', () => {
        // 10 words * 1.3 = 13
        expect(estimateTokens('one two three four five six seven eight nine ten')).toBe(13);
    });
});

describe('truncateToTokenBudget', () => {
    test('returns text unchanged if within budget', () => {
        const text = 'short text';
        expect(truncateToTokenBudget(text, 250)).toBe(text);
    });

    test('truncates long text with ellipsis', () => {
        const words = Array(200).fill('word').join(' ');
        const result = truncateToTokenBudget(words, 20);
        expect(result).toContain('...');
        expect(estimateTokens(result)).toBeLessThanOrEqual(25); // some slack for ellipsis
    });
});

describe('getLastSummary', () => {
    test('returns parsed summary when available', () => {
        mockDbWithSummary({
            topic: 'Memory optimization',
            decisions: ['Use FTS5', 'Add decay'],
            actions: ['Implement search'],
            tags: ['memory', 'search']
        });

        const result = getLastSummary();
        expect(result).not.toBeNull();
        expect(result.topic).toBe('Memory optimization');
        expect(result.decisions).toEqual(['Use FTS5', 'Add decay']);
        expect(result.sessionId).toBe('20260219-001');
    });

    test('returns null when no summaries exist', () => {
        mockDbEmpty();
        expect(getLastSummary()).toBeNull();
    });

    test('returns null when DB unavailable', () => {
        isDatabaseAvailable.mockReturnValue(false);
        expect(getLastSummary()).toBeNull();
    });

    test('returns null on malformed JSON', () => {
        getDatabase.mockReturnValue({
            prepare: jest.fn(() => ({
                get: jest.fn(() => ({
                    session_id: '20260219-001',
                    summary: 'not-json{{{',
                    created_at: '2026-02-19T18:00:00+08:00'
                }))
            }))
        });
        expect(getLastSummary()).toBeNull();
    });
});

describe('buildAutoRecallContext', () => {
    test('returns context with last summary and related sessions', async () => {
        mockDbWithSummary({
            topic: 'Task dispatch refactor',
            decisions: ['Use queue pattern'],
            actions: ['Implement queue'],
            tags: ['tasks', 'refactor']
        });

        searchL1.mockResolvedValue([
            { sessionId: '20260218-002', date: '2026-02-18', keywords: ['dispatch', 'queue', 'worker'], score: 0.8 },
            { sessionId: '20260217-001', date: '2026-02-17', keywords: ['task', 'system'], score: 0.5 }
        ]);

        const result = await buildAutoRecallContext();

        expect(result.context).toContain('[Auto-recall]');
        expect(result.context).toContain('Task dispatch refactor');
        expect(result.context).toContain('Use queue pattern');
        expect(result.context).toContain('Related');
        expect(result.tokenEstimate).toBeGreaterThan(0);
        expect(result.tokenEstimate).toBeLessThanOrEqual(250);
        expect(result.sources).toContain('20260219-001');
        expect(result.sources).toContain('20260218-002');
    });

    test('returns empty when AUTO_RECALL_ENABLED=false', async () => {
        process.env.AUTO_RECALL_ENABLED = 'false';
        const result = await buildAutoRecallContext();
        expect(result.context).toBe('');
        expect(result.tokenEstimate).toBe(0);
        expect(result.sources).toEqual([]);
    });

    test('returns empty when DB unavailable', async () => {
        isDatabaseAvailable.mockReturnValue(false);
        const result = await buildAutoRecallContext();
        expect(result.context).toBe('');
    });

    test('returns empty when no summaries and no related sessions', async () => {
        mockDbEmpty();
        searchL1.mockResolvedValue([]);
        const result = await buildAutoRecallContext();
        expect(result.context).toBe('');
        expect(result.sources).toEqual([]);
    });

    test('falls back to L1 keyword search when no summary exists', async () => {
        mockDbEmpty();
        searchL1.mockResolvedValue([
            { sessionId: '20260218-001', date: '2026-02-18', keywords: ['gateway', 'config'], score: 0.6 }
        ]);

        const result = await buildAutoRecallContext();
        expect(result.context).toContain('[Auto-recall]');
        expect(result.context).toContain('Recent sessions');
        expect(result.sources).toContain('20260218-001');
    });

    test('excludes last session from related results', async () => {
        mockDbWithSummary({
            topic: 'Test topic',
            decisions: [],
            actions: [],
            tags: ['test']
        });

        // searchL1 returns the same session as the summary
        searchL1.mockResolvedValue([
            { sessionId: '20260219-001', date: '2026-02-19', keywords: ['test'], score: 0.9 }
        ]);

        const result = await buildAutoRecallContext();
        // Should not have "Related" since the only result is self
        expect(result.context).not.toContain('Related');
    });

    test('respects token budget', async () => {
        mockDbWithSummary({
            topic: 'A very long topic that goes on and on with many words to test truncation behavior',
            decisions: ['Decision one about something', 'Decision two about another thing', 'Decision three'],
            actions: [],
            tags: ['tag1', 'tag2', 'tag3']
        });

        searchL1.mockResolvedValue([
            { sessionId: '20260218-001', date: '2026-02-18', keywords: ['keyword1', 'keyword2', 'keyword3', 'keyword4', 'keyword5'], score: 0.8 },
            { sessionId: '20260217-001', date: '2026-02-17', keywords: ['other1', 'other2', 'other3'], score: 0.6 },
            { sessionId: '20260216-001', date: '2026-02-16', keywords: ['more1', 'more2'], score: 0.4 }
        ]);

        const result = await buildAutoRecallContext();
        expect(result.tokenEstimate).toBeLessThanOrEqual(250);
    });
});
