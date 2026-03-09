/**
 * SkillLoader unit tests
 */
const path = require('path');

// Mock fs
jest.mock('fs');
const fs = require('fs');

// Suppress console
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const SkillLoader = require('../src/skills/skill-loader');

const SKILL_MD_CONTENT = `---
name: Test Skill
description: A test skill for unit testing. Triggers: test, unit-test.
version: 2.0.0
allowed-tools: [read_file, write_file]
source: custom
---

# Test Skill

This is the body content.
`;

const SKILL_MD_WITH_TRIGGERS = `---
name: Weather Skill
description: Handles weather queries
version: 1.0.0
triggers: weather, 天氣, forecast
---

# Weather

Weather skill body.
`;

const SKILL_MD_MINIMAL = `---
name: Minimal
description: Minimal skill
---

Body only.
`;

describe('SkillLoader', () => {
  let loader;
  const skillsPath = '/fake/skills';

  beforeEach(() => {
    jest.clearAllMocks();
    loader = new SkillLoader(skillsPath);
  });

  describe('parseMetadata', () => {
    it('should parse standard frontmatter fields', () => {
      fs.readFileSync.mockReturnValue(SKILL_MD_CONTENT);
      const meta = loader.parseMetadata('/fake/SKILL.md');
      expect(meta.name).toBe('test-skill');
      expect(meta.displayName).toBe('Test Skill');
      expect(meta.version).toBe('2.0.0');
      expect(meta.allowedTools).toEqual(['read_file', 'write_file']);
    });

    it('should extract triggers from description', () => {
      fs.readFileSync.mockReturnValue(SKILL_MD_CONTENT);
      const meta = loader.parseMetadata('/fake/SKILL.md');
      expect(meta.triggers).toContain('test');
      expect(meta.triggers).toContain('unit-test');
    });

    it('should prefer frontmatter triggers field over description', () => {
      fs.readFileSync.mockReturnValue(SKILL_MD_WITH_TRIGGERS);
      const meta = loader.parseMetadata('/fake/SKILL.md');
      expect(meta.triggers).toContain('weather');
      expect(meta.triggers).toContain('天氣');
      expect(meta.triggers).toContain('forecast');
    });

    it('should return null for missing frontmatter', () => {
      fs.readFileSync.mockReturnValue('# No frontmatter here');
      const meta = loader.parseMetadata('/fake/SKILL.md');
      expect(meta).toBeNull();
    });

    it('should return null for missing name field', () => {
      fs.readFileSync.mockReturnValue('---\ndescription: no name\n---\nbody');
      const meta = loader.parseMetadata('/fake/SKILL.md');
      expect(meta).toBeNull();
    });

    it('should default version to 1.0.0', () => {
      fs.readFileSync.mockReturnValue(SKILL_MD_MINIMAL);
      const meta = loader.parseMetadata('/fake/SKILL.md');
      expect(meta.version).toBe('1.0.0');
    });

    it('should handle CRLF line endings', () => {
      fs.readFileSync.mockReturnValue(SKILL_MD_CONTENT.replace(/\n/g, '\r\n'));
      const meta = loader.parseMetadata('/fake/SKILL.md');
      expect(meta).not.toBeNull();
      expect(meta.name).toBe('test-skill');
    });
  });

  describe('parseYamlField', () => {
    it('should extract simple field value', () => {
      expect(loader.parseYamlField('name: Hello World', 'name')).toBe('Hello World');
    });

    it('should strip quotes', () => {
      expect(loader.parseYamlField("name: 'quoted'", 'name')).toBe('quoted');
      expect(loader.parseYamlField('name: "double"', 'name')).toBe('double');
    });

    it('should return null for missing field', () => {
      expect(loader.parseYamlField('name: test', 'version')).toBeNull();
    });
  });

  describe('scan', () => {
    it('should scan directory and load skills', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockImplementation((p, opts) => {
        if (opts && opts.withFileTypes) {
          return [{ name: 'test-skill', isDirectory: () => true }];
        }
        return ['SKILL.md', 'extra.md'];
      });
      fs.readFileSync.mockReturnValue(SKILL_MD_CONTENT);

      const list = loader.scan();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('test-skill');
    });

    it('should skip directories starting with _', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockImplementation((p, opts) => {
        if (opts && opts.withFileTypes) {
          return [
            { name: '_hidden', isDirectory: () => true },
            { name: 'visible', isDirectory: () => true }
          ];
        }
        return ['SKILL.md'];
      });
      fs.readFileSync.mockReturnValue(SKILL_MD_CONTENT);

      const list = loader.scan();
      expect(list).toHaveLength(1);
    });

    it('should handle non-existent skills path', () => {
      fs.existsSync.mockReturnValue(false);
      const list = loader.scan();
      expect(list).toHaveLength(0);
    });

    it('should skip directories without SKILL.md', () => {
      fs.existsSync.mockImplementation((p) => {
        if (p === skillsPath) return true;
        if (p.endsWith('SKILL.md')) return false;
        return true;
      });
      fs.readdirSync.mockImplementation((p, opts) => {
        if (opts && opts.withFileTypes) {
          return [{ name: 'no-skill', isDirectory: () => true }];
        }
        return [];
      });

      const list = loader.scan();
      expect(list).toHaveLength(0);
    });

    it('should clear old data on rescan', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockImplementation((p, opts) => {
        if (opts && opts.withFileTypes) {
          return [{ name: 'test-skill', isDirectory: () => true }];
        }
        return ['SKILL.md'];
      });
      fs.readFileSync.mockReturnValue(SKILL_MD_CONTENT);

      loader.scan();
      expect(loader.skills.size).toBe(1);

      // Rescan with empty dir
      fs.readdirSync.mockImplementation((p, opts) => {
        if (opts && opts.withFileTypes) return [];
        return [];
      });
      loader.scan();
      expect(loader.skills.size).toBe(0);
    });
  });

  describe('trigger matching', () => {
    beforeEach(() => {
      // Manually set up skills with triggers
      loader.skills.set('weather-skill', {
        name: 'weather-skill', displayName: 'Weather', description: 'Weather queries',
        version: '1.0.0', allowedTools: [], triggers: ['weather', '天氣', 'forecast'],
        source: 'custom'
      });
      loader.buildTriggerIndex('weather-skill', ['weather', '天氣', 'forecast']);
    });

    it('should exact match trigger', () => {
      const matches = loader.exactTriggerMatch('weather');
      expect(matches).toContain('weather-skill');
    });

    it('should match when query contains trigger', () => {
      const matches = loader.exactTriggerMatch('what is the weather today');
      expect(matches).toContain('weather-skill');
    });

    it('should match Chinese triggers', () => {
      const matches = loader.exactTriggerMatch('天氣如何');
      expect(matches).toContain('weather-skill');
    });

    it('should return empty for no match', () => {
      const matches = loader.exactTriggerMatch('hello world');
      expect(matches).toHaveLength(0);
    });

    it('should do token-level matching', () => {
      const scores = loader.tokenTriggerMatch('weather forecast');
      expect(scores.get('weather-skill')).toBeGreaterThan(0);
    });
  });

  describe('loadSkill (Level 2)', () => {
    beforeEach(() => {
      loader.skills.set('test-skill', {
        name: 'test-skill', displayName: 'Test Skill', description: 'Test',
        version: '1.0.0', allowedTools: [], triggers: [],
        path: '/fake/skills/test-skill/SKILL.md',
        fullPath: '/fake/skills/test-skill', source: 'custom'
      });
    });

    it('should load full skill content', () => {
      fs.readFileSync.mockReturnValue(SKILL_MD_CONTENT);
      fs.existsSync.mockReturnValue(false);
      fs.readdirSync.mockReturnValue([]);

      const skill = loader.loadSkill('test-skill');
      expect(skill).not.toBeNull();
      expect(skill.content).toContain('This is the body content');
    });

    it('should cache loaded skills', () => {
      fs.readFileSync.mockReturnValue(SKILL_MD_CONTENT);
      fs.existsSync.mockReturnValue(false);
      fs.readdirSync.mockReturnValue([]);

      loader.loadSkill('test-skill');
      loader.loadSkill('test-skill');
      // readFileSync called once for content (cached second time)
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('should return null for unknown skill', () => {
      expect(loader.loadSkill('nonexistent')).toBeNull();
    });

    it('should normalize skill name', () => {
      fs.readFileSync.mockReturnValue(SKILL_MD_CONTENT);
      fs.existsSync.mockReturnValue(false);
      fs.readdirSync.mockReturnValue([]);

      const skill = loader.loadSkill('Test Skill');
      expect(skill).not.toBeNull();
    });
  });

  describe('loadReference (Level 3)', () => {
    beforeEach(() => {
      loader.skills.set('test-skill', {
        name: 'test-skill', fullPath: '/fake/skills/test-skill'
      });
    });

    it('should load reference file', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('reference content');

      const content = loader.loadReference('test-skill', 'api.md');
      expect(content).toBe('reference content');
    });

    it('should return null for unknown skill', () => {
      expect(loader.loadReference('nonexistent', 'api.md')).toBeNull();
    });

    it('should block path traversal', () => {
      const result = loader.loadReference('test-skill', '../../etc/passwd');
      expect(result).toBeNull();
    });

    it('should return null for missing file', () => {
      fs.existsSync.mockReturnValue(false);
      expect(loader.loadReference('test-skill', 'missing.md')).toBeNull();
    });
  });

  describe('searchSkills', () => {
    beforeEach(() => {
      // Set up multiple skills
      const skills = [
        { name: 'weather', displayName: 'Weather', description: 'Weather queries', version: '1.0.0', allowedTools: [], triggers: ['weather', '天氣'], source: 'custom' },
        { name: 'codebase', displayName: 'Codebase', description: 'Codebase analysis', version: '1.0.0', allowedTools: [], triggers: ['code', 'architecture'], source: 'custom' },
      ];
      for (const s of skills) {
        loader.skills.set(s.name, s);
        loader.buildTriggerIndex(s.name, s.triggers);
      }
      // Init search engine
      loader.searchEngine.init(skills.map(s => ({
        id: s.name, title: s.displayName, tags: s.triggers, summary: s.description
      })));
    });

    it('should find by exact trigger', () => {
      const results = loader.searchSkills('weather');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('weather');
      expect(results[0].matchType).toBe('exact');
    });

    it('should find by semantic search', () => {
      const results = loader.searchSkills('code analysis');
      expect(results.some(r => r.name === 'codebase')).toBe(true);
    });

    it('should return empty for unrelated query', () => {
      const results = loader.searchSkills('xyznonexistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('matchSkills / getBestMatch', () => {
    beforeEach(() => {
      loader.skills.set('weather', {
        name: 'weather', displayName: 'Weather', description: 'Weather queries',
        version: '1.0.0', allowedTools: [], triggers: ['weather', '天氣'], source: 'custom'
      });
      loader.buildTriggerIndex('weather', ['weather', '天氣']);
      loader.searchEngine.init([{
        id: 'weather', title: 'Weather', tags: ['weather', '天氣'], summary: 'Weather queries'
      }]);
    });

    it('should return matching skill names', () => {
      const names = loader.matchSkills('weather today');
      expect(names).toContain('weather');
    });

    it('should respect threshold', () => {
      const names = loader.matchSkills('xyznonexistent', { threshold: 0.9 });
      expect(names).toHaveLength(0);
    });

    it('should respect limit', () => {
      const names = loader.matchSkills('weather', { limit: 1 });
      expect(names.length).toBeLessThanOrEqual(1);
    });

    it('getBestMatch should return skill for high-confidence match', () => {
      const best = loader.getBestMatch('weather', 0.5);
      expect(best).not.toBeNull();
      expect(best.name).toBe('weather');
    });

    it('getBestMatch should return null for low-confidence', () => {
      const best = loader.getBestMatch('xyznonexistent', 0.9);
      expect(best).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      const stats = loader.getStats();
      expect(stats).toHaveProperty('skillCount');
      expect(stats).toHaveProperty('triggerCount');
      expect(stats).toHaveProperty('tokenCount');
      expect(stats).toHaveProperty('loadedCount');
      expect(stats).toHaveProperty('searchEngineReady');
    });
  });

  describe('getSkillSummary', () => {
    it('should return empty string when no skills', () => {
      expect(loader.getSkillSummary()).toBe('');
    });

    it('should return formatted summary with skills', () => {
      loader.skills.set('test', {
        name: 'test', displayName: 'Test', description: 'A test skill',
        version: '1.0.0', allowedTools: ['read_file'], triggers: [], source: 'custom'
      });
      const summary = loader.getSkillSummary();
      expect(summary).toContain('test');
      expect(summary).toContain('read_file');
    });
  });

  describe('tokenizeTrigger', () => {
    it('should tokenize English words', () => {
      const tokens = loader.tokenizeTrigger('hello world');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });

    it('should tokenize Chinese with bigrams', () => {
      const tokens = loader.tokenizeTrigger('天氣預報');
      expect(tokens).toContain('天氣預報');
      expect(tokens).toContain('天氣');
      expect(tokens).toContain('氣預');
    });

    it('should skip single-char English tokens', () => {
      const tokens = loader.tokenizeTrigger('a b cd');
      expect(tokens).not.toContain('a');
      expect(tokens).not.toContain('b');
      expect(tokens).toContain('cd');
    });
  });
});
