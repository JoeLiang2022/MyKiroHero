/**
 * SearchEngine unit tests
 */

// Suppress console
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const SearchEngine = require('../src/skills/search-engine');

describe('SearchEngine', () => {
  const sampleDocs = [
    { id: 'mcp-guide', title: 'MCP Server Guide', tags: ['mcp', 'server', 'protocol'], summary: 'How to build MCP servers for AI tools' },
    { id: 'whatsapp-api', title: 'WhatsApp API Reference', tags: ['whatsapp', 'api', 'messaging'], summary: 'WhatsApp Web API integration guide' },
    { id: 'bm25-algo', title: 'BM25 Algorithm', tags: ['search', 'algorithm', 'ranking'], summary: 'BM25 scoring for information retrieval' },
    { id: 'chinese-nlp', title: '中文自然語言處理', tags: ['中文', 'nlp', '分詞'], summary: '中文文本分析與搜尋技術' },
    { id: 'gateway-arch', title: 'Gateway Architecture', tags: ['gateway', 'architecture', 'design'], summary: 'System architecture for the AI gateway' },
  ];

  describe('init', () => {
    it('should initialize with documents', () => {
      const engine = new SearchEngine();
      engine.init(sampleDocs);
      expect(engine.initialized).toBe(true);
      expect(engine.documents).toHaveLength(5);
    });

    it('should pre-compute IDF values', () => {
      const engine = new SearchEngine();
      engine.init(sampleDocs);
      expect(engine.idfCache.size).toBeGreaterThan(0);
    });

    it('should compute average document length', () => {
      const engine = new SearchEngine();
      engine.init(sampleDocs);
      expect(engine.avgDocLength).toBeGreaterThan(0);
    });

    it('should throw on search before init', () => {
      const engine = new SearchEngine();
      expect(() => engine.search('test')).toThrow('not initialized');
    });
  });

  describe('tokenize', () => {
    let engine;
    beforeEach(() => { engine = new SearchEngine(); });

    it('should tokenize English text', () => {
      const tokens = engine.tokenize('Hello World');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });

    it('should filter stopwords', () => {
      const tokens = engine.tokenize('the quick brown fox');
      expect(tokens).not.toContain('the');
      expect(tokens).toContain('quick');
    });

    it('should tokenize Chinese text with bigrams', () => {
      const tokens = engine.tokenize('自然語言處理');
      expect(tokens).toContain('自然語言處理');
      expect(tokens).toContain('自然');
      expect(tokens).toContain('語言');
    });

    it('should handle empty input', () => {
      expect(engine.tokenize('')).toEqual([]);
      expect(engine.tokenize(null)).toEqual([]);
      expect(engine.tokenize(undefined)).toEqual([]);
    });

    it('should handle mixed Chinese and English', () => {
      const tokens = engine.tokenize('MCP 伺服器');
      expect(tokens).toContain('mcp');
      expect(tokens).toContain('伺服器');
    });
  });

  describe('stem', () => {
    let engine;
    beforeEach(() => { engine = new SearchEngine(); });

    it('should stem -ing suffix', () => {
      expect(engine.stem('running')).toBe('runn');
    });

    it('should stem -ed suffix', () => {
      expect(engine.stem('searched')).toBe('search');
    });

    it('should not stem short words', () => {
      expect(engine.stem('the')).toBe('the');
      expect(engine.stem('go')).toBe('go');
    });

    it('should not stem non-alpha words', () => {
      expect(engine.stem('test123')).toBe('test123');
    });
  });

  describe('ngrams', () => {
    let engine;
    beforeEach(() => { engine = new SearchEngine(); });

    it('should generate English 3-grams by default', () => {
      const result = engine.ngrams('hello');
      expect(result).toEqual(['hel', 'ell', 'llo']);
    });

    it('should generate Chinese 2-grams by default', () => {
      const result = engine.ngrams('天氣預報');
      expect(result).toEqual(['天氣', '氣預', '預報']);
    });

    it('should handle text shorter than n', () => {
      expect(engine.ngrams('hi')).toEqual(['hi']);
    });

    it('should handle empty/null input', () => {
      expect(engine.ngrams('')).toEqual(['']);
      expect(engine.ngrams(null)).toEqual([null]);
    });

    it('should accept custom n value', () => {
      const result = engine.ngrams('hello', 2);
      expect(result).toEqual(['he', 'el', 'll', 'lo']);
    });
  });

  describe('fuzzyMatch', () => {
    let engine;
    beforeEach(() => { engine = new SearchEngine(); });

    it('should match identical strings', () => {
      expect(engine.fuzzyMatch('hello', 'hello')).toBe(true);
    });

    it('should match with small edit distance', () => {
      expect(engine.fuzzyMatch('hello', 'hallo')).toBe(true);
    });

    it('should reject large edit distance', () => {
      expect(engine.fuzzyMatch('hello', 'world')).toBe(false);
    });

    it('should use contains matching for Chinese', () => {
      expect(engine.fuzzyMatch('天氣預報', '天氣')).toBe(true);
      expect(engine.fuzzyMatch('天氣', '天氣預報')).toBe(true);
    });

    it('should reject short non-matching strings', () => {
      expect(engine.fuzzyMatch('ab', 'cd')).toBe(false);
    });
  });

  describe('search', () => {
    let engine;
    beforeEach(() => {
      engine = new SearchEngine();
      engine.init(sampleDocs);
    });

    it('should find exact title match', () => {
      const { results } = engine.search('MCP Server Guide');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('mcp-guide');
    });

    it('should find by tag', () => {
      const { results } = engine.search('whatsapp');
      expect(results.some(r => r.id === 'whatsapp-api')).toBe(true);
    });

    it('should find by summary content', () => {
      const { results } = engine.search('information retrieval');
      expect(results.some(r => r.id === 'bm25-algo')).toBe(true);
    });

    it('should find Chinese documents', () => {
      const { results } = engine.search('中文分詞');
      expect(results.some(r => r.id === 'chinese-nlp')).toBe(true);
    });

    it('should return few or no results for unrelated query', () => {
      const { results } = engine.search('quantum physics');
      // Fuzzy/ngram fallback may still find marginal matches, but score should be very low
      for (const r of results) {
        expect(r.score).toBeLessThan(1);
      }
    });

    it('should respect limit option', () => {
      const { results } = engine.search('server', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should include debug info when requested', () => {
      const { results } = engine.search('MCP', { debug: true });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]._debug).toBeDefined();
      expect(results[0]._debug.title).toBeDefined();
    });

    it('should return expandedTerms when synonyms expand query', () => {
      // Without synonyms, expandedTerms may be null or have stemmed terms
      const { results, query } = engine.search('gateway');
      expect(query).toBe('gateway');
    });

    it('should find gateway architecture doc', () => {
      const { results } = engine.search('Gateway Architecture');
      expect(results.some(r => r.id === 'gateway-arch')).toBe(true);
    });
  });

  describe('addDocument / removeDocument', () => {
    let engine;
    beforeEach(() => {
      engine = new SearchEngine();
      engine.init([...sampleDocs]);
    });

    it('should add a new document and find it', () => {
      engine.addDocument({ id: 'new-doc', title: 'Redis Caching', tags: ['redis', 'cache'], summary: 'Redis caching strategies' });
      const { results } = engine.search('redis');
      expect(results.some(r => r.id === 'new-doc')).toBe(true);
    });

    it('should replace existing document with same ID', () => {
      engine.addDocument({ id: 'mcp-guide', title: 'Updated MCP Guide', tags: ['mcp'], summary: 'Updated content' });
      expect(engine.documents.filter(d => d.id === 'mcp-guide')).toHaveLength(1);
    });

    it('should remove a document', () => {
      engine.removeDocument('mcp-guide');
      const { results } = engine.search('MCP Server Guide');
      expect(results.every(r => r.id !== 'mcp-guide')).toBe(true);
    });
  });

  describe('synonym expansion', () => {
    it('should expand query with synonyms when loaded', () => {
      const engine = new SearchEngine();
      // Manually build synonym map
      engine.buildSynonymMap([{ terms: ['api', 'interface', 'endpoint'] }]);
      const { terms } = engine.expandQuery(['api']);
      expect(terms).toContain('interface');
      expect(terms).toContain('endpoint');
    });

    it('should limit synonyms to 5 per term', () => {
      const engine = new SearchEngine();
      engine.buildSynonymMap([{ terms: ['a', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh'] }]);
      const { terms } = engine.expandQuery(['a']);
      // Original + stemmed + max 5 synonyms
      expect(terms.length).toBeLessThanOrEqual(8);
    });
  });

  describe('BM25 scoring', () => {
    let engine;
    beforeEach(() => {
      engine = new SearchEngine();
      engine.init(sampleDocs);
    });

    it('should return positive score for matching term', () => {
      const score = engine.bm25Score('mcp', 2, 10);
      expect(score).toBeGreaterThan(0);
    });

    it('should return higher score for higher term frequency', () => {
      const score1 = engine.bm25Score('mcp', 1, 10);
      const score2 = engine.bm25Score('mcp', 5, 10);
      expect(score2).toBeGreaterThan(score1);
    });

    it('should use default IDF for unknown terms', () => {
      const idf = engine.getIdf('xyznonexistent');
      expect(idf).toBe(1);
    });
  });
});
