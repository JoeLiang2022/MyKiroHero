/**
 * WeatherHandler unit tests
 */

// Mock fetch globally
global.fetch = jest.fn();

// Suppress console
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const { extractLocation, registerWeatherHandler, WEATHER_KEYWORDS } = require('../src/gateway/weather-handler');

describe('WeatherHandler', () => {
  describe('WEATHER_KEYWORDS', () => {
    it('should contain expected keywords', () => {
      expect(WEATHER_KEYWORDS).toContain('天氣');
      expect(WEATHER_KEYWORDS).toContain('weather');
      expect(WEATHER_KEYWORDS).toContain('氣溫');
      expect(WEATHER_KEYWORDS).toContain('溫度');
    });
  });

  describe('extractLocation', () => {
    it('should extract location after Chinese keyword', () => {
      expect(extractLocation('天氣 台北')).toBe('台北');
      expect(extractLocation('天氣台北')).toBe('台北');
    });

    it('should extract location after English keyword', () => {
      expect(extractLocation('weather Tokyo')).toBe('Tokyo');
    });

    it('should return null when no location given', () => {
      expect(extractLocation('天氣')).toBeNull();
      expect(extractLocation('weather')).toBeNull();
    });

    it('should return null for empty/null input', () => {
      expect(extractLocation('')).toBeNull();
      expect(extractLocation(null)).toBeNull();
      expect(extractLocation(undefined)).toBeNull();
    });

    it('should return null when no keyword matches', () => {
      expect(extractLocation('你好')).toBeNull();
      expect(extractLocation('hello world')).toBeNull();
    });

    it('should handle keyword with extra whitespace', () => {
      expect(extractLocation('  天氣  台北  ')).toBe('台北');
    });

    it('should be case-insensitive for English keywords', () => {
      expect(extractLocation('Weather London')).toBe('London');
      expect(extractLocation('WEATHER London')).toBe('London');
    });

    it('should extract location for 氣溫 keyword', () => {
      expect(extractLocation('氣溫 高雄')).toBe('高雄');
    });

    it('should extract location for 溫度 keyword', () => {
      expect(extractLocation('溫度 台中')).toBe('台中');
    });
  });

  describe('registerWeatherHandler', () => {
    let mockDirectRouter;
    let mockConfig;
    let registeredHandler;

    beforeEach(() => {
      jest.clearAllMocks();
      mockDirectRouter = {
        registerHandler: jest.fn((name, handler) => { registeredHandler = handler; }),
        gateway: { sendDirectReply: jest.fn().mockResolvedValue(undefined) }
      };
      mockConfig = { defaultLocation: 'Taipei' };
      global.fetch.mockReset();
    });

    it('should register handler with name "weather"', () => {
      registerWeatherHandler(mockDirectRouter, mockConfig);
      expect(mockDirectRouter.registerHandler).toHaveBeenCalledWith('weather', expect.any(Function));
    });

    it('should fetch weather and send reply on success', async () => {
      global.fetch.mockResolvedValue({ ok: true, text: async () => 'Taipei: ☀️ +25°C' });
      registerWeatherHandler(mockDirectRouter, mockConfig);

      await registeredHandler({ text: '天氣 台北', chatId: '123@c.us', platform: 'whatsapp' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('wttr.in'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(mockDirectRouter.gateway.sendDirectReply).toHaveBeenCalledWith(
        'whatsapp', '123@c.us', expect.stringContaining('🌤️')
      );
    });

    it('should use default location when none specified', async () => {
      global.fetch.mockResolvedValue({ ok: true, text: async () => 'Taipei: ☀️ +25°C' });
      registerWeatherHandler(mockDirectRouter, mockConfig);

      await registeredHandler({ text: '天氣', chatId: '123@c.us', platform: 'whatsapp' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('Taipei'),
        expect.any(Object)
      );
    });

    it('should use config defaultLocation fallback', async () => {
      mockConfig.defaultLocation = 'Tokyo';
      global.fetch.mockResolvedValue({ ok: true, text: async () => 'Tokyo: 🌧 +15°C' });
      registerWeatherHandler(mockDirectRouter, mockConfig);

      await registeredHandler({ text: '天氣', chatId: '123@c.us', platform: 'whatsapp' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('Tokyo'),
        expect.any(Object)
      );
    });

    it('should send error message on HTTP error', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 500 });
      registerWeatherHandler(mockDirectRouter, mockConfig);

      await registeredHandler({ text: '天氣', chatId: '123@c.us', platform: 'whatsapp' });

      expect(mockDirectRouter.gateway.sendDirectReply).toHaveBeenCalledWith(
        'whatsapp', '123@c.us', expect.stringContaining('⚠️')
      );
    });

    it('should send timeout message on AbortError', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      global.fetch.mockRejectedValue(abortError);
      registerWeatherHandler(mockDirectRouter, mockConfig);

      await registeredHandler({ text: '天氣', chatId: '123@c.us', platform: 'whatsapp' });

      expect(mockDirectRouter.gateway.sendDirectReply).toHaveBeenCalledWith(
        'whatsapp', '123@c.us', expect.stringContaining('超時')
      );
    });

    it('should send generic error on fetch failure', async () => {
      global.fetch.mockRejectedValue(new Error('network error'));
      registerWeatherHandler(mockDirectRouter, mockConfig);

      await registeredHandler({ text: '天氣', chatId: '123@c.us', platform: 'whatsapp' });

      expect(mockDirectRouter.gateway.sendDirectReply).toHaveBeenCalledWith(
        'whatsapp', '123@c.us', expect.stringContaining('失敗')
      );
    });

    it('should use body field when text is missing', async () => {
      global.fetch.mockResolvedValue({ ok: true, text: async () => 'Taipei: ☀️ +25°C' });
      registerWeatherHandler(mockDirectRouter, mockConfig);

      await registeredHandler({ body: 'weather Osaka', chatId: '123@c.us', platform: 'whatsapp' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('Osaka'),
        expect.any(Object)
      );
    });

    it('should default platform to whatsapp', async () => {
      global.fetch.mockResolvedValue({ ok: true, text: async () => 'Taipei: ☀️ +25°C' });
      registerWeatherHandler(mockDirectRouter, mockConfig);

      await registeredHandler({ text: '天氣', chatId: '123@c.us' });

      expect(mockDirectRouter.gateway.sendDirectReply).toHaveBeenCalledWith(
        'whatsapp', '123@c.us', expect.any(String)
      );
    });
  });
});
