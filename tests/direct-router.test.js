/**
 * DirectRouter unit tests
 */
const path = require('path');
const fs = require('fs');

// Mock fs for route loading
jest.mock('fs');

// Mock session-logger
jest.mock('../src/gateway/session-logger', () => ({
  getSessionLogger: () => ({
    logDirect: jest.fn()
  })
}));

// Suppress console
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const DirectRouter = require('../src/gateway/direct-router');

describe('DirectRouter', () => {
  const mockGateway = { sendDirectReply: jest.fn() };
  const mockConfig = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadRoutes', () => {
    it('should load valid routes from JSON', () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({
        routes: [
          { name: 'weather', enabled: true, handler: 'weather', patterns: ['^天氣'] }
        ]
      }));
      const router = new DirectRouter(mockGateway, mockConfig);
      expect(router.routes).toHaveLength(1);
      expect(router.routes[0].name).toBe('weather');
    });

    it('should return empty array for missing file', () => {
      fs.readFileSync.mockImplementation(() => { const e = new Error(); e.code = 'ENOENT'; throw e; });
      const router = new DirectRouter(mockGateway, mockConfig);
      expect(router.routes).toEqual([]);
    });

    it('should return empty array for invalid JSON', () => {
      fs.readFileSync.mockReturnValue('not json');
      const router = new DirectRouter(mockGateway, mockConfig);
      expect(router.routes).toEqual([]);
    });

    it('should skip invalid regex patterns gracefully', () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({
        routes: [
          { name: 'test', enabled: true, handler: 'test', patterns: ['[invalid'] }
        ]
      }));
      const router = new DirectRouter(mockGateway, mockConfig);
      expect(router.routes).toHaveLength(1);
      expect(router.routes[0]._compiledPatterns).toHaveLength(0);
    });
  });

  describe('registerHandler', () => {
    it('should register a handler function', () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({ routes: [] }));
      const router = new DirectRouter(mockGateway, mockConfig);
      const handler = jest.fn();
      router.registerHandler('weather', handler);
      expect(router.handlers.get('weather')).toBe(handler);
    });
  });

  describe('tryHandle', () => {
    let router;

    beforeEach(() => {
      fs.readFileSync.mockReturnValue(JSON.stringify({
        routes: [
          { name: 'weather', enabled: true, handler: 'weather', patterns: ['^天氣', '^weather'] },
          { name: 'disabled', enabled: false, handler: 'disabled', patterns: ['^test'] }
        ]
      }));
      router = new DirectRouter(mockGateway, mockConfig);
    });

    it('should match and handle matching message', async () => {
      const handler = jest.fn();
      router.registerHandler('weather', handler);
      const result = await router.tryHandle({ text: '天氣如何' });
      expect(result).toBe(true);
      expect(handler).toHaveBeenCalled();
    });

    it('should return false for non-matching message', async () => {
      router.registerHandler('weather', jest.fn());
      const result = await router.tryHandle({ text: '你好' });
      expect(result).toBe(false);
    });

    it('should skip disabled routes', async () => {
      const handler = jest.fn();
      router.registerHandler('disabled', handler);
      const result = await router.tryHandle({ text: 'test message' });
      expect(result).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should skip routes without registered handler', async () => {
      // Don't register weather handler
      const result = await router.tryHandle({ text: '天氣' });
      expect(result).toBe(false);
    });

    it('should return false on handler error (fallback to AI)', async () => {
      router.registerHandler('weather', () => { throw new Error('handler failed'); });
      const result = await router.tryHandle({ text: '天氣' });
      expect(result).toBe(false);
    });

    it('should handle message with body instead of text', async () => {
      router.registerHandler('weather', jest.fn());
      const result = await router.tryHandle({ body: 'weather today' });
      expect(result).toBe(true);
    });

    it('should handle empty message', async () => {
      router.registerHandler('weather', jest.fn());
      const result = await router.tryHandle({});
      expect(result).toBe(false);
    });
  });
});
