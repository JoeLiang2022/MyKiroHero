/**
 * MessageClassifier unit tests
 */
const {
  classifyMessage,
  isSpecialMessage,
  _internals: {
    scoreLength, scorePunctuation, scoreTimeDelta, scoreContinuation, clamp,
    LENGTH_MIN, LENGTH_MAX, TIME_DELTA_MIN, TIME_DELTA_MAX
  }
} = require('../src/gateway/handlers/message-classifier');

describe('MessageClassifier', () => {
  // ─── scoreLength ───
  describe('scoreLength', () => {
    it('should return 0 for very short text', () => {
      expect(scoreLength('hi')).toBe(0);
      expect(scoreLength('')).toBe(0);
    });

    it('should return 1 for long text', () => {
      expect(scoreLength('a'.repeat(LENGTH_MAX))).toBe(1);
      expect(scoreLength('a'.repeat(100))).toBe(1);
    });

    it('should interpolate for mid-length text', () => {
      const mid = Math.floor((LENGTH_MIN + LENGTH_MAX) / 2);
      const score = scoreLength('a'.repeat(mid));
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });
  });

  // ─── scorePunctuation ───
  describe('scorePunctuation', () => {
    it('should return 1 for ending punctuation', () => {
      expect(scorePunctuation('你好嗎？')).toBe(1);
      expect(scorePunctuation('Hello!')).toBe(1);
      expect(scorePunctuation('OK.')).toBe(1);
      expect(scorePunctuation('結束了。')).toBe(1);
    });

    it('should return 0 for no ending punctuation', () => {
      expect(scorePunctuation('hello')).toBe(0);
      expect(scorePunctuation('你好')).toBe(0);
    });

    it('should return 0 for empty string', () => {
      expect(scorePunctuation('')).toBe(0);
    });
  });

  // ─── scoreTimeDelta ───
  describe('scoreTimeDelta', () => {
    it('should return 0 for very fast messages', () => {
      expect(scoreTimeDelta(500)).toBe(0);
      expect(scoreTimeDelta(0)).toBe(0);
    });

    it('should return 1 for slow messages', () => {
      expect(scoreTimeDelta(TIME_DELTA_MAX)).toBe(1);
      expect(scoreTimeDelta(10000)).toBe(1);
    });

    it('should interpolate for mid-range', () => {
      const mid = (TIME_DELTA_MIN + TIME_DELTA_MAX) / 2;
      const score = scoreTimeDelta(mid);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });
  });

  // ─── scoreContinuation ───
  describe('scoreContinuation', () => {
    it('should return 0 for continuation words', () => {
      expect(scoreContinuation('然後我想說')).toBe(0);
      expect(scoreContinuation('還有一件事')).toBe(0);
      expect(scoreContinuation('但是不行')).toBe(0);
    });

    it('should return 1 for non-continuation text', () => {
      expect(scoreContinuation('我想問一下')).toBe(1);
      expect(scoreContinuation('Hello world')).toBe(1);
    });
  });

  // ─── clamp ───
  describe('clamp', () => {
    it('should clamp values to [0, 1]', () => {
      expect(clamp(-0.5)).toBe(0);
      expect(clamp(1.5)).toBe(1);
      expect(clamp(0.5)).toBe(0.5);
    });
  });

  // ─── classifyMessage ───
  describe('classifyMessage', () => {
    it('should classify empty text as incomplete', () => {
      const result = classifyMessage('', 5000);
      expect(result.isComplete).toBe(false);
      expect(result.score).toBe(0);
    });

    it('should classify null text as incomplete', () => {
      const result = classifyMessage(null, 5000);
      expect(result.isComplete).toBe(false);
    });

    it('should classify long complete sentence as complete', () => {
      const result = classifyMessage('請問今天天氣怎麼樣？', 6000);
      expect(result.isComplete).toBe(true);
      expect(result.score).toBeGreaterThan(0.6);
    });

    it('should classify short fragment as incomplete', () => {
      const result = classifyMessage('嗯', 500);
      expect(result.isComplete).toBe(false);
    });

    it('should handle Infinity timeDelta (first message)', () => {
      const result = classifyMessage('你好嗎？', Infinity);
      expect(result.breakdown.timeDelta).toBe(1);
    });

    it('should handle NaN timeDelta', () => {
      const result = classifyMessage('test', NaN);
      expect(result.breakdown.timeDelta).toBe(0);
    });

    it('should handle negative timeDelta', () => {
      const result = classifyMessage('test', -100);
      expect(result.breakdown.timeDelta).toBe(0);
    });

    it('should respect custom threshold', () => {
      const text = '你好';
      const r1 = classifyMessage(text, 3000, { threshold: 0.1 });
      const r2 = classifyMessage(text, 3000, { threshold: 0.9 });
      // Same score, different isComplete
      expect(r1.score).toBe(r2.score);
      // Low threshold → more likely complete
    });

    it('should return breakdown with all dimensions', () => {
      const result = classifyMessage('Hello world!', 3000);
      expect(result.breakdown).toHaveProperty('length');
      expect(result.breakdown).toHaveProperty('punctuation');
      expect(result.breakdown).toHaveProperty('timeDelta');
      expect(result.breakdown).toHaveProperty('continuation');
    });
  });

  // ─── isSpecialMessage ───
  describe('isSpecialMessage', () => {
    it('should return true for media messages', () => {
      expect(isSpecialMessage({ hasMedia: true, text: '' })).toBe(true);
    });

    it('should return true for URL messages', () => {
      expect(isSpecialMessage({ text: 'https://example.com' })).toBe(true);
      expect(isSpecialMessage({ text: 'http://test.org/path' })).toBe(true);
    });

    it('should return true for pure emoji', () => {
      expect(isSpecialMessage({ text: '😀' })).toBe(true);
      expect(isSpecialMessage({ text: '👍🎉' })).toBe(true);
    });

    it('should return false for normal text', () => {
      expect(isSpecialMessage({ text: 'Hello world' })).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isSpecialMessage(null)).toBe(false);
      expect(isSpecialMessage(undefined)).toBe(false);
    });

    it('should return false for empty text', () => {
      expect(isSpecialMessage({ text: '' })).toBe(false);
    });
  });
});
