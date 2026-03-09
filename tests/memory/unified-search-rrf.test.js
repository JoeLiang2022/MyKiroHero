/**
 * Tests for rrfMerge() — RRF source weights and per-source capping
 * Covers: SOURCE_WEIGHTS (knowledge=1.3, session=1.0, journal=0.8),
 *         SOURCE_CAP (top 5 per source), score accumulation, sorting
 */
const { rrfMerge } = require('../../src/memory/unified-search');

const RRF_K = 60; // must match unified-search.js

describe('rrfMerge', () => {
    it('should return empty array for empty input', () => {
        expect(rrfMerge([])).toEqual([]);
    });

    it('should return empty array for empty result sets', () => {
        expect(rrfMerge([[], []])).toEqual([]);
    });

    it('should apply knowledge weight (1.3x)', () => {
        const results = rrfMerge([
            [{ id: 'k1', source: 'knowledge', title: 'test' }],
            [{ id: 's1', source: 'session', sessionId: 's1' }]
        ]);
        const k = results.find(r => r.id === 'k1');
        const s = results.find(r => r.sessionId === 's1');
        // knowledge rank-0 score: 1.3 * 1/(60+1) = 1.3/61
        // session rank-0 score: 1.0 * 1/(60+1) = 1.0/61
        expect(k.rrfScore).toBeCloseTo(1.3 / (RRF_K + 1), 10);
        expect(s.rrfScore).toBeCloseTo(1.0 / (RRF_K + 1), 10);
        expect(results[0].id).toBe('k1'); // knowledge ranked higher
    });

    it('should apply journal weight (0.8x)', () => {
        const results = rrfMerge([
            [{ id: 'j1', source: 'journal', date: '2026-02-20' }]
        ]);
        expect(results[0].rrfScore).toBeCloseTo(0.8 / (RRF_K + 1), 10);
    });

    it('should default weight to 1.0 for unknown source', () => {
        const results = rrfMerge([
            [{ id: 'x1', source: 'unknown_source' }]
        ]);
        expect(results[0].rrfScore).toBeCloseTo(1.0 / (RRF_K + 1), 10);
    });

    it('should cap each source to top 5 results', () => {
        const items = Array.from({ length: 8 }, (_, i) => ({
            id: `s${i}`, source: 'session', sessionId: `s${i}`
        }));
        const results = rrfMerge([items]);
        // Only 5 should appear (capped)
        expect(results.length).toBe(5);
    });

    it('should sort by rrfScore descending', () => {
        const results = rrfMerge([
            [
                { id: 'a', source: 'session', sessionId: 'a' },
                { id: 'b', source: 'session', sessionId: 'b' },
                { id: 'c', source: 'session', sessionId: 'c' }
            ]
        ]);
        for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].rrfScore).toBeGreaterThanOrEqual(results[i].rrfScore);
        }
    });

    it('should accumulate scores for same item across sources', () => {
        // Same sessionId appearing in two different result sets
        const results = rrfMerge([
            [{ id: 'shared', source: 'session', sessionId: 'shared' }],
            [{ id: 'shared', source: 'knowledge', sessionId: 'shared' }]
        ]);
        // Should merge into one entry with accumulated score
        const shared = results.find(r => r.sessionId === 'shared');
        const expectedScore = (1.0 / (RRF_K + 1)) + (1.3 / (RRF_K + 1));
        expect(shared.rrfScore).toBeCloseTo(expectedScore, 10);
    });

    it('should use rank-based scoring (lower rank = lower score)', () => {
        const results = rrfMerge([
            [
                { id: 'first', source: 'knowledge', sessionId: 'first' },
                { id: 'second', source: 'knowledge', sessionId: 'second' }
            ]
        ]);
        const first = results.find(r => r.id === 'first');
        const second = results.find(r => r.id === 'second');
        // rank 0: 1.3/(60+1), rank 1: 1.3/(60+2)
        expect(first.rrfScore).toBeGreaterThan(second.rrfScore);
        expect(first.rrfScore).toBeCloseTo(1.3 / 61, 10);
        expect(second.rrfScore).toBeCloseTo(1.3 / 62, 10);
    });

    it('should handle single source passthrough correctly', () => {
        const items = [
            { id: 'a', source: 'knowledge' },
            { id: 'b', source: 'knowledge' }
        ];
        const results = rrfMerge([items]);
        expect(results.length).toBe(2);
        expect(results[0].id).toBe('a');
    });

    it('should handle mixed sources with correct relative ordering', () => {
        // knowledge rank-0 (1.3/61 ≈ 0.0213) > session rank-0 (1.0/61 ≈ 0.0164) > journal rank-0 (0.8/61 ≈ 0.0131)
        const results = rrfMerge([
            [{ id: 'k', source: 'knowledge' }],
            [{ id: 's', source: 'session', sessionId: 's' }],
            [{ id: 'j', source: 'journal', date: '2026-02-20' }]
        ]);
        expect(results[0].id).toBe('k');
        expect(results[1].sessionId).toBe('s');
        expect(results[2].id).toBe('j');
    });
});
