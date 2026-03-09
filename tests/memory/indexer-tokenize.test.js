/**
 * Tests for enhanced tokenize() in indexer.js
 * Covers: CamelCase splitting, number preservation, domain stopwords, English bigrams
 * Task: task-20260220-054359-733
 */

const { tokenize, splitCamelCase, isUsefulToken, STOPWORDS, DOMAIN_STOPWORDS } = require('../../src/memory/indexer');

// Suppress console
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

// ============================================
// splitCamelCase
// ============================================

describe('splitCamelCase', () => {
    test('splits lowerCamelCase', () => {
        expect(splitCamelCase('searchEngine')).toEqual(['search', 'Engine']);
    });

    test('splits PascalCase', () => {
        expect(splitCamelCase('SearchEngine')).toEqual(['Search', 'Engine']);
    });

    test('splits camelCase with numbers', () => {
        expect(splitCamelCase('searchL3')).toEqual(['search', 'L3']);
    });

    test('splits number-letter boundary', () => {
        const parts = splitCamelCase('v2beta');
        expect(parts).toEqual(['v2', 'beta']);
    });

    test('splits consecutive uppercase (acronym)', () => {
        expect(splitCamelCase('getHTTPResponse')).toEqual(['get', 'HTTP', 'Response']);
    });

    test('handles single word (no split needed)', () => {
        expect(splitCamelCase('hello')).toEqual(['hello']);
    });

    test('handles empty/null', () => {
        expect(splitCamelCase('')).toEqual([]);
        expect(splitCamelCase(null)).toEqual([]);
        expect(splitCamelCase(undefined)).toEqual([]);
    });

    test('handles all-uppercase', () => {
        expect(splitCamelCase('HTTP')).toEqual(['HTTP']);
    });

    test('handles numbers only', () => {
        expect(splitCamelCase('123')).toEqual(['123']);
    });

    test('splits multi-number segments', () => {
        expect(splitCamelCase('fts5Index')).toEqual(['fts5', 'Index']);
    });
});

// ============================================
// isUsefulToken
// ============================================

describe('isUsefulToken', () => {
    test('rejects general stopwords', () => {
        expect(isUsefulToken('the')).toBe(false);
        expect(isUsefulToken('is')).toBe(false);
        expect(isUsefulToken('and')).toBe(false);
    });

    test('rejects domain stopwords', () => {
        expect(isUsefulToken('function')).toBe(false);
        expect(isUsefulToken('const')).toBe(false);
        expect(isUsefulToken('async')).toBe(false);
        expect(isUsefulToken('boolean')).toBe(false);
    });

    test('accepts meaningful tokens', () => {
        expect(isUsefulToken('database')).toBe(true);
        expect(isUsefulToken('gateway')).toBe(true);
        expect(isUsefulToken('search')).toBe(true);
        expect(isUsefulToken('mcp')).toBe(true);
    });

    test('rejects single-char tokens', () => {
        expect(isUsefulToken('a')).toBe(false);
        expect(isUsefulToken('x')).toBe(false);
    });

    test('accepts alphanumeric tokens like l3, v2', () => {
        expect(isUsefulToken('l3')).toBe(true);
        expect(isUsefulToken('v2')).toBe(true);
        expect(isUsefulToken('fts5')).toBe(true);
    });
});

// ============================================
// tokenize — CamelCase splitting
// ============================================

describe('tokenize — CamelCase splitting', () => {
    test('splits camelCase into parts', () => {
        const tokens = tokenize('searchEngine');
        expect(tokens).toContain('search');
        expect(tokens).toContain('engine');
    });

    test('splits searchL3 into search + l3', () => {
        const tokens = tokenize('searchL3');
        expect(tokens).toContain('search');
        expect(tokens).toContain('l3');
    });

    test('preserves compound word as well', () => {
        const tokens = tokenize('searchL3');
        // Should have both parts AND the compound
        expect(tokens).toContain('searchl3');
    });

    test('splits PascalCase class names', () => {
        const tokens = tokenize('SessionLogger');
        expect(tokens).toContain('session');
        expect(tokens).toContain('logger');
    });

    test('splits acronym boundaries', () => {
        const tokens = tokenize('getHTTPResponse');
        expect(tokens).toContain('http');
        expect(tokens).toContain('response');
    });

    test('handles multiple camelCase words in sentence', () => {
        const tokens = tokenize('searchEngine and sessionLogger');
        expect(tokens).toContain('search');
        expect(tokens).toContain('engine');
        expect(tokens).toContain('session');
        expect(tokens).toContain('logger');
    });
});

// ============================================
// tokenize — Number preservation
// ============================================

describe('tokenize — Number preservation', () => {
    test('preserves l3 from searchL3', () => {
        const tokens = tokenize('searchL3');
        expect(tokens).toContain('l3');
    });

    test('preserves v2 from v2beta', () => {
        const tokens = tokenize('v2beta');
        expect(tokens).toContain('v2');
        expect(tokens).toContain('beta');
    });

    test('preserves fts5 as token', () => {
        const tokens = tokenize('fts5');
        expect(tokens).toContain('fts5');
    });

    test('preserves standalone numbers in alphanumeric context', () => {
        const tokens = tokenize('node25 pm2');
        expect(tokens).toContain('pm2');
        expect(tokens).toContain('node25');
    });
});

// ============================================
// tokenize — Domain stopwords removal
// ============================================

describe('tokenize — Domain stopwords removal', () => {
    test('filters domain stopwords', () => {
        const tokens = tokenize('function async await return');
        expect(tokens).not.toContain('function');
        expect(tokens).not.toContain('async');
        expect(tokens).not.toContain('await');
        expect(tokens).not.toContain('return');
    });

    test('keeps meaningful dev terms', () => {
        const tokens = tokenize('database gateway mcp indexer');
        expect(tokens).toContain('database');
        expect(tokens).toContain('gateway');
        expect(tokens).toContain('mcp');
        expect(tokens).toContain('indexer');
    });

    test('filters both general and domain stopwords', () => {
        const tokens = tokenize('the function is async');
        expect(tokens.length).toBe(0);
    });

    test('DOMAIN_STOPWORDS set exists and has entries', () => {
        expect(DOMAIN_STOPWORDS.size).toBeGreaterThan(10);
        expect(DOMAIN_STOPWORDS.has('function')).toBe(true);
        expect(DOMAIN_STOPWORDS.has('const')).toBe(true);
    });
});

// ============================================
// tokenize — English bigrams
// ============================================

describe('tokenize — English bigrams', () => {
    test('generates bigrams from adjacent tokens', () => {
        const tokens = tokenize('search engine optimization');
        expect(tokens).toContain('search_engine');
        expect(tokens).toContain('engine_optimization');
    });

    test('no bigrams for single word', () => {
        const tokens = tokenize('database');
        const bigrams = tokens.filter(t => t.includes('_'));
        expect(bigrams.length).toBe(0);
    });

    test('bigrams use underscore separator', () => {
        const tokens = tokenize('memory search engine');
        const bigrams = tokens.filter(t => t.includes('_'));
        expect(bigrams).toContain('memory_search');
        expect(bigrams).toContain('search_engine');
    });

    test('bigrams skip stopwords in source unigrams', () => {
        // 'the' and 'is' are stopwords, so unigrams list won't include them
        // bigrams are built from unigrams only
        const tokens = tokenize('search the engine');
        // 'the' is filtered, so unigrams = ['search', 'engine']
        expect(tokens).toContain('search_engine');
    });

    test('bigrams from camelCase-split words', () => {
        // 'searchEngine' splits to 'search' + 'engine', both are unigrams
        // Then 'fast' is next word → bigrams include engine_fast
        const tokens = tokenize('searchEngine fast');
        expect(tokens).toContain('search_engine');
        expect(tokens).toContain('engine_fast');
    });
});

// ============================================
// tokenize — Backward compatibility
// ============================================

describe('tokenize — Backward compatibility', () => {
    test('still tokenizes basic English', () => {
        const tokens = tokenize('database query engine');
        expect(tokens).toContain('database');
        expect(tokens).toContain('query');
        expect(tokens).toContain('engine');
    });

    test('still handles Chinese 2-gram', () => {
        const tokens = tokenize('記憶系統測試');
        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens).toContain('記憶');
    });

    test('still filters general stopwords', () => {
        const tokens = tokenize('the is a test');
        expect(tokens).not.toContain('the');
        expect(tokens).not.toContain('is');
        expect(tokens).toContain('test');
    });

    test('still handles empty input', () => {
        expect(tokenize('')).toEqual([]);
        expect(tokenize(null)).toEqual([]);
        expect(tokenize(undefined)).toEqual([]);
    });

    test('still handles mixed Chinese and English', () => {
        const tokens = tokenize('MCP 伺服器');
        expect(tokens).toContain('mcp');
        expect(tokens).toContain('伺服器');
    });

    test('property: no token is a general stopword', () => {
        const inputs = [
            'the quick brown fox',
            'searchEngine L3 results',
            'database query and optimization',
            'MCP 伺服器 gateway',
            'v2beta fts5 node25',
            '',
            'function async await'
        ];
        for (const input of inputs) {
            const tokens = tokenize(input);
            for (const t of tokens) {
                expect(STOPWORDS.has(t)).toBe(false);
            }
        }
    });

    test('property: no token is a domain stopword', () => {
        const inputs = [
            'function const let var return',
            'async await import export',
            'searchEngine database gateway',
        ];
        for (const input of inputs) {
            const tokens = tokenize(input);
            for (const t of tokens) {
                expect(DOMAIN_STOPWORDS.has(t)).toBe(false);
            }
        }
    });
});

// ============================================
// tokenize — Edge cases
// ============================================

describe('tokenize — Edge cases', () => {
    test('handles pure numbers', () => {
        const tokens = tokenize('42 100');
        // '42' and '100' are alphanumeric, len > 1
        expect(tokens).toContain('42');
        expect(tokens).toContain('100');
    });

    test('handles special characters only', () => {
        const tokens = tokenize('!@#$%^&*()');
        expect(tokens).toEqual([]);
    });

    test('handles very long camelCase', () => {
        const tokens = tokenize('thisIsAVeryLongCamelCaseIdentifier');
        // 'this', 'is', 'very' are stopwords; 'a' is single-char; 'case' is domain stopword
        expect(tokens).toContain('long');
        expect(tokens).toContain('camel');
        expect(tokens).toContain('identifier');
    });

    test('handles hyphenated words', () => {
        const tokens = tokenize('memory-engine search-engine');
        expect(tokens).toContain('memory');
        expect(tokens).toContain('engine');
        expect(tokens).toContain('search');
    });

    test('handles underscored identifiers', () => {
        const tokens = tokenize('session_logger memory_engine');
        expect(tokens).toContain('session');
        expect(tokens).toContain('logger');
        expect(tokens).toContain('memory');
    });

    test('handles mixed separators', () => {
        const tokens = tokenize('src/memory/indexer.js');
        expect(tokens).toContain('src');
        expect(tokens).toContain('memory');
        expect(tokens).toContain('indexer');
        expect(tokens).toContain('js');
    });
});
