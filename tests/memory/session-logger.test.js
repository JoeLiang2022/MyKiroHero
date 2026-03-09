/**
 * SessionLogger Integration Tests
 * 
 * Tests for SessionLogger integration with JournalManager.
 * Uses fast-check for property-based testing.
 */

const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { SessionLogger } = require('../../src/gateway/session-logger');
const { JournalManager } = require('../../src/memory/journal-manager');

// Test utilities
const createTempDir = () => {
  const dir = path.join(os.tmpdir(), `session-logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const cleanupTempDir = (dir) => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('SessionLogger', () => {
  let tempDir;
  let sessionLogger;

  beforeEach(() => {
    tempDir = createTempDir();
    sessionLogger = new SessionLogger(tempDir);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Basic Operations', () => {
    test('should create session logger with log directory', () => {
      expect(sessionLogger).toBeDefined();
      expect(sessionLogger.sessionsDir).toBe(tempDir);
      // sessionId is created lazily on first log
      sessionLogger.logUser('test');
      expect(sessionLogger.currentSessionId).toBeDefined();
    });

    test('should log user message', () => {
      sessionLogger.logUser('Hello');
      
      const logs = sessionLogger.read();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const lastLog = logs[logs.length - 1];
      expect(lastLog.role).toBe('user');
      expect(lastLog.text).toBe('Hello');
    });

    test('should log assistant message', () => {
      sessionLogger.logAssistant('Hi there');
      
      const logs = sessionLogger.read();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const lastLog = logs[logs.length - 1];
      expect(lastLog.role).toBe('assistant');
      expect(lastLog.text).toBe('Hi there');
    });

    test('should log journal entry', () => {
      sessionLogger.logJournal('event', 'Something happened', 'test');
      
      const logs = sessionLogger.read();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const lastLog = logs[logs.length - 1];
      expect(lastLog.role).toBe('journal');
      expect(lastLog.category).toBe('event');
      expect(lastLog.content).toBe('Something happened');
    });

    test('should log operation', () => {
      sessionLogger.logOperation('git_commit', { message: 'test commit' });
      
      const logs = sessionLogger.read();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const lastLog = logs[logs.length - 1];
      expect(lastLog.role).toBe('operation');
      expect(lastLog.type).toBe('git_commit');
    });
  });

  describe('Property: All logs are persisted', () => {
    test('should persist all logged entries', () => {
      const categoryArb = fc.constantFrom('event', 'thought', 'lesson', 'todo');
      const safeString = fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('\n') && !s.includes('\r'));

      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.record({ type: fc.constant('user'), text: safeString }),
              fc.record({ type: fc.constant('assistant'), text: safeString }),
              fc.record({ type: fc.constant('journal'), category: categoryArb, content: safeString })
            ),
            { minLength: 1, maxLength: 10 }
          ),
          (logEntries) => {
            const testDir = createTempDir();
            const logger = new SessionLogger(testDir);
            
            try {
              for (const entry of logEntries) {
                if (entry.type === 'user') {
                  logger.logUser(entry.text);
                } else if (entry.type === 'assistant') {
                  logger.logAssistant(entry.text);
                } else {
                  logger.logJournal(entry.category, entry.content, 'test');
                }
              }
              
              const logs = logger.read();
              expect(logs.length).toBe(logEntries.length);
            } finally {
              cleanupTempDir(testDir);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Property: Log order is preserved', () => {
    test('should preserve chronological order of logs', () => {
      const safeString = fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\n') && !s.includes('\r'));

      fc.assert(
        fc.property(
          fc.array(safeString, { minLength: 2, maxLength: 10 }),
          (messages) => {
            const testDir = createTempDir();
            const logger = new SessionLogger(testDir);
            
            try {
              for (const msg of messages) {
                logger.logUser(msg);
              }
              
              const logs = logger.read();
              for (let i = 0; i < messages.length; i++) {
                expect(logs[i].text).toBe(messages[i]);
              }
            } finally {
              cleanupTempDir(testDir);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Session ID Format', () => {
    test('should generate valid session ID format', () => {
      // Trigger session creation
      sessionLogger.logUser('test');
      expect(sessionLogger.currentSessionId).toMatch(/^\d{8}-\d{3}$/);
    });

    test('should use same session ID for all logs in a session', () => {
      sessionLogger.logUser('First');
      sessionLogger.logAssistant('Second');
      sessionLogger.logJournal('event', 'Third', 'test');
      
      const logs = sessionLogger.read();
      const sessionIds = logs.map(l => l.sessionId);
      const uniqueIds = [...new Set(sessionIds)];
      
      expect(uniqueIds.length).toBe(1);
      expect(uniqueIds[0]).toBe(sessionLogger.currentSessionId);
    });
  });
});

describe('SessionLogger with JournalManager Integration', () => {
  let tempDir;
  let journalManager;
  let sessionLogger;

  beforeEach(() => {
    tempDir = createTempDir();
    journalManager = new JournalManager(path.join(tempDir, 'journals'));
    sessionLogger = new SessionLogger(tempDir);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Journal Entry Sync', () => {
    test('should be able to sync journal entries from SessionLogger to JournalManager', () => {
      // Log some journal entries via SessionLogger
      sessionLogger.logJournal('event', 'User logged in', 'auth');
      sessionLogger.logJournal('thought', 'Should add caching', 'perf');
      sessionLogger.logJournal('lesson', 'Always validate input', 'security');
      
      // Read from SessionLogger
      const sessionLogs = sessionLogger.read().filter(l => l.role === 'journal');
      
      // Sync to JournalManager
      for (const log of sessionLogs) {
        journalManager.create(log.category, log.content, { source: log.source });
      }
      
      // Verify in JournalManager
      const journalEntries = journalManager.readAll();
      expect(journalEntries.length).toBe(3);
      
      const events = journalManager.readByCategory('event');
      expect(events.length).toBe(1);
      expect(events[0].content).toBe('User logged in');
    });

    test('property: all journal categories can be synced', () => {
      const categoryArb = fc.constantFrom('event', 'thought', 'lesson', 'todo');
      const safeString = fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('\n') && !s.includes('\r') && s.trim().length > 0);

      fc.assert(
        fc.property(
          fc.array(
            fc.record({ category: categoryArb, content: safeString }),
            { minLength: 1, maxLength: 10 }
          ),
          (entries) => {
            const testDir = createTempDir();
            const testJournalManager = new JournalManager(path.join(testDir, 'journals'));
            const testSessionLogger = new SessionLogger(testDir);
            
            try {
              // Log via SessionLogger
              for (const entry of entries) {
                testSessionLogger.logJournal(entry.category, entry.content, 'test');
              }
              
              // Sync to JournalManager
              const sessionLogs = testSessionLogger.read().filter(l => l.role === 'journal');
              for (const log of sessionLogs) {
                testJournalManager.create(log.category, log.content, { source: log.source });
              }
              
              // Verify count matches
              const journalEntries = testJournalManager.readAll();
              expect(journalEntries.length).toBe(entries.length);
              
              // Verify each category has correct count
              for (const category of ['event', 'thought', 'lesson', 'todo']) {
                const expectedCount = entries.filter(e => e.category === category).length;
                const actualCount = testJournalManager.readByCategory(category).length;
                expect(actualCount).toBe(expectedCount);
              }
            } finally {
              cleanupTempDir(testDir);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
