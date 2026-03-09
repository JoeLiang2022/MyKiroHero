/**
 * DispatchController unit tests
 */
const { DispatchController, STATES } = require('../src/gateway/handlers/dispatch-controller');

// Suppress console output
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

describe('DispatchController', () => {
  let controller;
  let dispatched;

  beforeEach(() => {
    jest.useFakeTimers();
    dispatched = [];
    controller = new DispatchController(
      { collectTimeout: 3000, maxMessages: 3, maxWait: 10000, threshold: 0.6 },
      async (chatId, mergedText, messages) => {
        dispatched.push({ chatId, mergedText, messages });
      }
    );
  });

  afterEach(() => {
    controller.cleanupAll();
    jest.useRealTimers();
  });

  // ─── Constructor ───
  describe('constructor', () => {
    it('should throw if onDispatch is not a function', () => {
      expect(() => new DispatchController({}, 'not a function')).toThrow('onDispatch must be a function');
    });

    it('should use default config values', () => {
      const dc = new DispatchController(null, () => {});
      expect(dc._config.collectTimeout).toBe(3000);
      expect(dc._config.maxMessages).toBe(3);
      expect(dc._config.maxWait).toBe(10000);
    });
  });

  // ─── Complete message → immediate dispatch ───
  describe('complete message', () => {
    it('should dispatch immediately for complete messages', async () => {
      const msg = { text: '請問今天天氣如何？' };
      controller.handleMessage('chat-1', msg, { score: 0.8, isComplete: true });
      // Allow microtask (async dispatch)
      await Promise.resolve();
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].chatId).toBe('chat-1');
      expect(dispatched[0].mergedText).toBe('請問今天天氣如何？');
    });

    it('should return to IDLE after dispatch', async () => {
      controller.handleMessage('chat-1', { text: 'hi' }, { score: 0.9, isComplete: true });
      await Promise.resolve();
      expect(controller.getState('chat-1')).toBe(STATES.IDLE);
    });
  });

  // ─── Fragment collection ───
  describe('fragment collection', () => {
    it('should enter COLLECTING state for fragments', () => {
      controller.handleMessage('chat-1', { text: '嗯' }, { score: 0.2, isComplete: false });
      expect(controller.getState('chat-1')).toBe(STATES.COLLECTING);
    });

    it('should buffer multiple fragments', () => {
      controller.handleMessage('chat-1', { text: '嗯' }, { score: 0.2, isComplete: false });
      controller.handleMessage('chat-1', { text: '然後' }, { score: 0.1, isComplete: false });
      const buffer = controller.getBuffer('chat-1');
      expect(buffer).toHaveLength(2);
    });

    it('should dispatch on collectTimeout (3s no new message)', async () => {
      controller.handleMessage('chat-1', { text: '嗯' }, { score: 0.2, isComplete: false });
      controller.handleMessage('chat-1', { text: '對了' }, { score: 0.1, isComplete: false });
      
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
      await Promise.resolve(); // extra tick for async chain
      
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].mergedText).toContain('[合併 2 則訊息]');
      expect(dispatched[0].mergedText).toContain('嗯');
      expect(dispatched[0].mergedText).toContain('對了');
    });

    it('should dispatch when maxMessages reached', async () => {
      controller.handleMessage('chat-1', { text: 'a' }, { score: 0.2, isComplete: false });
      controller.handleMessage('chat-1', { text: 'b' }, { score: 0.2, isComplete: false });
      controller.handleMessage('chat-1', { text: 'c' }, { score: 0.2, isComplete: false }); // maxMessages=3
      
      await Promise.resolve();
      await Promise.resolve();
      
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].messages).toHaveLength(3);
    });

    it('should dispatch when complete message arrives during collection', async () => {
      controller.handleMessage('chat-1', { text: '嗯' }, { score: 0.2, isComplete: false });
      controller.handleMessage('chat-1', { text: '我想問天氣。' }, { score: 0.9, isComplete: true });
      
      await Promise.resolve();
      await Promise.resolve();
      
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].messages).toHaveLength(2);
    });

    it('should dispatch on maxWait timeout', async () => {
      controller.handleMessage('chat-1', { text: 'a' }, { score: 0.2, isComplete: false });
      
      // Keep sending fragments before collectTimeout
      jest.advanceTimersByTime(2500);
      controller.handleMessage('chat-1', { text: 'b' }, { score: 0.2, isComplete: false });
      
      // maxWait = 10s from first message
      jest.advanceTimersByTime(7500);
      await Promise.resolve();
      await Promise.resolve();
      
      expect(dispatched).toHaveLength(1);
    });
  });

  // ─── getState / getBuffer ───
  describe('getState / getBuffer', () => {
    it('should return IDLE for unknown chatId', () => {
      expect(controller.getState('unknown')).toBe(STATES.IDLE);
    });

    it('should return empty buffer for unknown chatId', () => {
      expect(controller.getBuffer('unknown')).toEqual([]);
    });
  });

  // ─── cleanup ───
  describe('cleanup', () => {
    it('should clear state for specific chatId', () => {
      controller.handleMessage('chat-1', { text: 'a' }, { score: 0.2, isComplete: false });
      controller.cleanup('chat-1');
      expect(controller.getState('chat-1')).toBe(STATES.IDLE);
    });

    it('should cleanupAll', () => {
      controller.handleMessage('chat-1', { text: 'a' }, { score: 0.2, isComplete: false });
      controller.handleMessage('chat-2', { text: 'b' }, { score: 0.2, isComplete: false });
      controller.cleanupAll();
      expect(controller.getState('chat-1')).toBe(STATES.IDLE);
      expect(controller.getState('chat-2')).toBe(STATES.IDLE);
    });
  });

  // ─── Multiple chats ───
  describe('multiple chats', () => {
    it('should handle independent chat states', async () => {
      controller.handleMessage('chat-1', { text: 'a' }, { score: 0.2, isComplete: false });
      controller.handleMessage('chat-2', { text: '你好嗎？' }, { score: 0.9, isComplete: true });
      
      await Promise.resolve();
      
      expect(controller.getState('chat-1')).toBe(STATES.COLLECTING);
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].chatId).toBe('chat-2');
    });
  });

  // ─── Error handling ───
  describe('error handling', () => {
    it('should handle onDispatch errors gracefully', async () => {
      const errorController = new DispatchController(
        { collectTimeout: 3000 },
        async () => { throw new Error('dispatch failed'); }
      );
      
      // Should not throw
      errorController.handleMessage('chat-1', { text: 'hello' }, { score: 0.9, isComplete: true });
      await Promise.resolve();
      
      // State should still be cleaned up
      expect(errorController.getState('chat-1')).toBe(STATES.IDLE);
      errorController.cleanupAll();
    });
  });
});
