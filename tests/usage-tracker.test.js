/**
 * UsageTracker unit tests
 */
const fs = require('fs');
const path = require('path');

// Mock fs to avoid actual file I/O
jest.mock('fs');

// Mock timezone utils
jest.mock('../src/utils/timezone', () => ({
  getNow: () => new Date('2026-02-16T10:00:00+08:00'),
  getTodayDate: () => '2026-02-16'
}));

const UsageTracker = require('../src/gateway/usage-tracker');

describe('UsageTracker', () => {
  beforeEach(() => {
    fs.existsSync.mockReturnValue(false); // no existing data file
    fs.readFileSync.mockReturnValue('{}');
    fs.writeFileSync.mockImplementation(() => {});
    fs.mkdirSync.mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  describe('record', () => {
    it('should record a call for a provider', () => {
      const tracker = new UsageTracker();
      const result = tracker.record('gemini', 'flash-2.0');
      expect(result.calls).toBe(1);
      expect(result.estimatedCost).toBe(0);
    });

    it('should accumulate calls', () => {
      const tracker = new UsageTracker();
      tracker.record('gemini', 'flash-2.0');
      const result = tracker.record('gemini', 'flash-2.0');
      expect(result.calls).toBe(2);
    });

    it('should track estimated cost', () => {
      const tracker = new UsageTracker();
      tracker.record('openai', 'gpt-4', { estimatedCost: 0.03 });
      const result = tracker.record('openai', 'gpt-4', { estimatedCost: 0.05 });
      expect(result.estimatedCost).toBeCloseTo(0.08);
    });

    it('should save after each record', () => {
      const tracker = new UsageTracker();
      tracker.record('gemini', 'flash');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('getToday', () => {
    it('should return zeros when no data', () => {
      const tracker = new UsageTracker();
      const result = tracker.getToday();
      expect(result.totalCalls).toBe(0);
      expect(result.totalCost).toBe(0);
    });

    it('should return specific provider stats', () => {
      const tracker = new UsageTracker();
      tracker.record('gemini', 'flash');
      const result = tracker.getToday('gemini');
      expect(result.calls).toBe(1);
    });

    it('should return zeros for unknown provider', () => {
      const tracker = new UsageTracker();
      const result = tracker.getToday('unknown');
      expect(result.calls).toBe(0);
    });

    it('should aggregate all providers', () => {
      const tracker = new UsageTracker();
      tracker.record('gemini', 'flash', { estimatedCost: 0.01 });
      tracker.record('openai', 'gpt-4', { estimatedCost: 0.05 });
      const result = tracker.getToday();
      expect(result.totalCalls).toBe(2);
      expect(result.totalCost).toBeCloseTo(0.06);
      expect(result.byProvider).toHaveProperty('gemini');
      expect(result.byProvider).toHaveProperty('openai');
    });
  });

  describe('isWithinLimit', () => {
    it('should allow when under limits', () => {
      const tracker = new UsageTracker();
      tracker.record('gemini', 'flash');
      const result = tracker.isWithinLimit(100, 10);
      expect(result.allowed).toBe(true);
    });

    it('should deny when call limit reached', () => {
      const tracker = new UsageTracker();
      for (let i = 0; i < 5; i++) tracker.record('gemini', 'flash');
      const result = tracker.isWithinLimit(5, 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('call_limit');
    });

    it('should deny when cost limit reached', () => {
      const tracker = new UsageTracker();
      tracker.record('openai', 'gpt-4', { estimatedCost: 10 });
      const result = tracker.isWithinLimit(1000, 5);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('cost_limit');
    });

    it('should skip limit check when limit is 0', () => {
      const tracker = new UsageTracker();
      for (let i = 0; i < 100; i++) tracker.record('gemini', 'flash');
      const result = tracker.isWithinLimit(0, 0);
      expect(result.allowed).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should remove old data beyond retention', () => {
      const tracker = new UsageTracker();
      // Inject old data
      tracker._data['2026-01-01'] = { gemini: { calls: 5, estimatedCost: 0 } };
      tracker._data['2026-02-16'] = { gemini: { calls: 1, estimatedCost: 0 } };
      const removed = tracker.cleanup();
      expect(removed).toBe(1);
      expect(tracker._data).not.toHaveProperty('2026-01-01');
      expect(tracker._data).toHaveProperty('2026-02-16');
    });
  });
});
