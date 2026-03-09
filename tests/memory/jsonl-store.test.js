/**
 * JSONL Store Property Tests
 * 
 * Feature: memory-system
 * Tests for SessionLogger JSONL functionality
 */

const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { SessionLogger } = require('../../src/gateway/session-logger');

// Test utilities
const createTempDir = () => {
  const dir = path.join(os.tmpdir(), `jsonl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const cleanupTempDir = (dir) => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// Arbitraries for generating test data
const categoryArb = fc.constantFrom('event', 'thought', 'lesson', 'todo');
const operationTypeArb = fc.constantFrom('git_commit', 'config_change', 'error', 'context_transfer');
const safeString = fc.string({ minLength: 0, maxLength: 500 }).filter(s => !s.includes('\n') && !s.includes('\r'));

describe('JSONL Store - Property Tests', () => {
  let tempDir;
  let logger;

  beforeEach(() => {
    tempDir = createTempDir();
    logger = new SessionLogger(tempDir);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  /**
   * Property 1: JSONL 記錄結構
   * 
   * 對於所有記錄類型（user、assistant、tool、journal、operation），
   * 當記錄到 JSONL_Store 時，記錄應包含有效的 ts（ISO timestamp）、
   * sessionId 和 role 欄位，加上類型特定的必要欄位。
   * 
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   */
  describe('Property 1: JSONL 記錄結構', () => {
    test('user records have required fields', () => {
      fc.assert(
        fc.property(safeString, (text) => {
          logger.logUser(text);
          const records = logger.read();
          const lastRecord = records[records.length - 1];
          
          // Check required base fields
          expect(lastRecord.ts).toBeDefined();
          expect(new Date(lastRecord.ts).toISOString()).toBe(lastRecord.ts);
          expect(lastRecord.sessionId).toMatch(/^\d{8}-\d{3}$/);
          expect(lastRecord.role).toBe('user');
          
          // Check type-specific fields
          expect(lastRecord.text).toBeDefined();
          expect(lastRecord).toHaveProperty('media');
          
          return true;
        }),
        { numRuns: 100 }
      );
    });

    test('assistant records have required fields', () => {
      fc.assert(
        fc.property(safeString, (text) => {
          logger.logAssistant(text);
          const records = logger.read();
          const lastRecord = records[records.length - 1];
          
          expect(lastRecord.ts).toBeDefined();
          expect(new Date(lastRecord.ts).toISOString()).toBe(lastRecord.ts);
          expect(lastRecord.sessionId).toMatch(/^\d{8}-\d{3}$/);
          expect(lastRecord.role).toBe('assistant');
          expect(lastRecord.text).toBeDefined();
          expect(lastRecord).toHaveProperty('toolCalls');
          
          return true;
        }),
        { numRuns: 100 }
      );
    });

    test('journal records have required fields', () => {
      fc.assert(
        fc.property(categoryArb, safeString, safeString, (category, content, source) => {
          logger.logJournal(category, content, source);
          const records = logger.read();
          const lastRecord = records[records.length - 1];
          
          expect(lastRecord.ts).toBeDefined();
          expect(new Date(lastRecord.ts).toISOString()).toBe(lastRecord.ts);
          expect(lastRecord.sessionId).toMatch(/^\d{8}-\d{3}$/);
          expect(lastRecord.role).toBe('journal');
          expect(['event', 'thought', 'lesson', 'todo']).toContain(lastRecord.category);
          expect(lastRecord.content).toBeDefined();
          expect(lastRecord.source).toBeDefined();
          
          return true;
        }),
        { numRuns: 100 }
      );
    });

    test('operation records have required fields', () => {
      fc.assert(
        fc.property(operationTypeArb, fc.object(), (type, details) => {
          logger.logOperation(type, details);
          const records = logger.read();
          const lastRecord = records[records.length - 1];
          
          expect(lastRecord.ts).toBeDefined();
          expect(new Date(lastRecord.ts).toISOString()).toBe(lastRecord.ts);
          expect(lastRecord.sessionId).toMatch(/^\d{8}-\d{3}$/);
          expect(lastRecord.role).toBe('operation');
          expect(lastRecord.type).toBe(type);
          expect(lastRecord.details).toBeDefined();
          
          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 3: JSONL 只增不改不變量
   * 
   * 對於所有對 JSONL_Store 的寫入操作，檔案大小應只增加，
   * 且所有先前寫入的行應保持不變。
   * 
   * **Validates: Requirements 1.5**
   */
  describe('Property 3: JSONL 只增不改不變量', () => {
    test('file size only increases after writes', () => {
      fc.assert(
        fc.property(
          fc.array(safeString, { minLength: 2, maxLength: 10 }),
          (messages) => {
            const filePath = logger.getTodayFile();
            let previousSize = 0;
            let previousContent = '';

            for (const msg of messages) {
              // Write a record
              logger.logUser(msg);

              // Check file exists and get new size
              expect(fs.existsSync(filePath)).toBe(true);
              const newContent = fs.readFileSync(filePath, 'utf8');
              const newSize = newContent.length;

              // Size should only increase (or stay same for empty writes)
              expect(newSize).toBeGreaterThanOrEqual(previousSize);

              // Previous content should be preserved (prefix check)
              if (previousContent) {
                expect(newContent.startsWith(previousContent)).toBe(true);
              }

              previousSize = newSize;
              previousContent = newContent;
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    test('previous records remain unchanged after new writes', () => {
      fc.assert(
        fc.property(
          fc.array(safeString, { minLength: 3, maxLength: 8 }),
          (messages) => {
            const snapshots = [];

            for (const msg of messages) {
              logger.logUser(msg);
              // Take snapshot of all records
              const records = logger.read();
              snapshots.push(JSON.stringify(records));
            }

            // Verify each snapshot is a prefix of the next
            for (let i = 0; i < snapshots.length - 1; i++) {
              const currentRecords = JSON.parse(snapshots[i]);
              const nextRecords = JSON.parse(snapshots[i + 1]);

              // All records from current should exist in next
              expect(nextRecords.length).toBeGreaterThan(currentRecords.length);
              
              for (let j = 0; j < currentRecords.length; j++) {
                expect(nextRecords[j]).toEqual(currentRecords[j]);
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


const { parseJsonlContent, formatJsonlRecord } = require('../../src/memory/jsonl-parser');

describe('JSONL Parser - Property Tests', () => {
  /**
   * Property 4: 格式錯誤行處理
   * 
   * 對於所有包含格式錯誤行的 JSONL 檔案，解析器應跳過無效行
   * 並回傳所有有效記錄，不拋出錯誤。
   * 
   * **Validates: Requirements 1.6, 9.3**
   */
  describe('Property 4: 格式錯誤行處理', () => {
    test('parser skips malformed lines and returns valid records', () => {
      fc.assert(
        fc.property(
          fc.array(fc.record({
            ts: fc.integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-12-31').getTime() }).map(t => new Date(t).toISOString()),
            sessionId: fc.string(),
            role: fc.constantFrom('user', 'assistant', 'journal'),
            text: fc.string()
          }), { minLength: 1, maxLength: 10 }),
          fc.array(fc.string().filter(s => {
            // Generate strings that are NOT valid JSON
            try { JSON.parse(s); return false; } catch { return true; }
          }), { minLength: 0, maxLength: 5 }),
          (validRecords, invalidLines) => {
            // Mix valid and invalid lines
            const validLines = validRecords.map(r => JSON.stringify(r));
            const allLines = [...validLines, ...invalidLines];
            
            // Shuffle
            for (let i = allLines.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [allLines[i], allLines[j]] = [allLines[j], allLines[i]];
            }
            
            const content = allLines.join('\n');
            const parsed = parseJsonlContent(content);
            
            // Should return exactly the valid records (order may differ)
            expect(parsed.length).toBe(validRecords.length);
            
            // Each parsed record should be one of the valid records
            for (const record of parsed) {
              const found = validRecords.some(vr => 
                vr.ts === record.ts && 
                vr.sessionId === record.sessionId &&
                vr.role === record.role
              );
              expect(found).toBe(true);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    test('parser handles empty content gracefully', () => {
      expect(parseJsonlContent('')).toEqual([]);
      expect(parseJsonlContent(null)).toEqual([]);
      expect(parseJsonlContent(undefined)).toEqual([]);
    });

    test('parser handles content with only invalid lines', () => {
      const invalidContent = 'not json\nalso not json\n{broken';
      expect(parseJsonlContent(invalidContent)).toEqual([]);
    });
  });

  /**
   * Property 2: JSONL Round-Trip 一致性
   * 
   * 對於所有有效的 JSONL 記錄，從一行解析記錄，然後序列化回 JSON，
   * 再解析一次，應產生等價的物件。
   * 
   * **Validates: Requirements 1.8**
   */
  describe('Property 2: JSONL Round-Trip 一致性', () => {
    test('parse -> format -> parse produces equivalent object', () => {
      // Use a constrained date range to avoid Invalid Date
      const validDateArb = fc.integer({ 
        min: new Date('2020-01-01').getTime(), 
        max: new Date('2030-12-31').getTime() 
      }).map(t => new Date(t).toISOString());

      fc.assert(
        fc.property(
          fc.record({
            ts: validDateArb,
            sessionId: fc.stringMatching(/^\d{8}-\d{3}$/),
            role: fc.constantFrom('user', 'assistant', 'journal', 'operation', 'tool'),
            text: fc.string(),
            category: fc.constantFrom('event', 'thought', 'lesson', 'todo', undefined),
            details: fc.option(fc.object(), { nil: undefined })
          }),
          (record) => {
            // Remove undefined values for clean comparison
            const cleanRecord = JSON.parse(JSON.stringify(record));
            
            // Format to JSONL line
            const line = formatJsonlRecord(cleanRecord);
            
            // Parse back
            const parsed = JSON.parse(line);
            
            // Should be equivalent
            expect(parsed).toEqual(cleanRecord);
            
            // Double round-trip
            const line2 = formatJsonlRecord(parsed);
            const parsed2 = JSON.parse(line2);
            expect(parsed2).toEqual(cleanRecord);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
