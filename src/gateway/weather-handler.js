/**
 * WeatherHandler — DirectRouter 內建 handler，直接呼叫 wttr.in API 回覆天氣
 * 
 * 支援的關鍵字：天氣、weather、氣溫、溫度
 * 格式：「天氣 台北」→ 查台北天氣，「天氣」→ 查預設地點
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

// 天氣關鍵字列表（與 direct-routes.json 的 patterns 對應）
const WEATHER_KEYWORDS = ['天氣', 'weather', '氣溫', '溫度'];

/**
 * 從訊息文字中提取地點
 * 規則：找到第一個匹配的關鍵字，取關鍵字後面的文字作為地點
 * 
 * @param {string} text - 訊息文字
 * @returns {string|null} 地點名稱，或 null（表示使用預設地點）
 */
function extractLocation(text) {
  const trimmed = (text || '').trim();
  for (const kw of WEATHER_KEYWORDS) {
    if (trimmed.toLowerCase().startsWith(kw)) {
      const rest = trimmed.slice(kw.length).trim();
      return rest.length > 0 ? rest : null;
    }
  }
  return null;
}

/**
 * 註冊天氣 handler 到 DirectRouter
 * 
 * @param {DirectRouter} directRouter - DirectRouter 實例
 * @param {object} config - Gateway config（需包含 defaultLocation）
 */
function registerWeatherHandler(directRouter, config) {
  directRouter.registerHandler('weather', async (message) => {
    const text = message.text || message.body || '';
    const location = extractLocation(text) || config.defaultLocation || 'Taipei';
    const platform = message.platform || 'whatsapp';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(
        `https://wttr.in/${encodeURIComponent(location)}?format=3&lang=zh`,
        { signal: controller.signal }
      );
      if (!response.ok) throw new Error(`wttr.in returned ${response.status}`);
      const weather = await response.text();
      await directRouter.gateway.sendDirectReply(platform, message.chatId, `🌤️ ${weather.trim()}`);
    } catch (err) {
      // Send error to user instead of silently failing
      const errorMsg = err.name === 'AbortError' ? '天氣查詢超時' : `天氣查詢失敗: ${err.message}`;
      await directRouter.gateway.sendDirectReply(platform, message.chatId, `⚠️ ${errorMsg}`);
    } finally {
      clearTimeout(timeout);
    }
  });
}

module.exports = { extractLocation, registerWeatherHandler, WEATHER_KEYWORDS };
