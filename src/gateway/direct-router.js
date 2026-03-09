/**
 * DirectRouter — 在訊息到達 KiroHandler 之前，判斷是否可以直接處理
 * 
 * 路由規則從 direct-routes.json 載入，每個路由包含：
 * - name: 路由名稱
 * - enabled: 是否啟用
 * - handler: handler 名稱（對應 handlers Map 的 key）
 * - patterns: 正則表達式陣列（任一匹配即觸發）
 * - description: 說明文字
 * 
 * 優先順序 = 陣列順序（第一個匹配的路由會被執行）
 */

const fs = require('fs');
const path = require('path');

class DirectRouter {
  /**
   * @param {object} gateway - Gateway 實例（用於 sendDirectReply 等）
   * @param {object} config - Gateway config
   */
  constructor(gateway, config) {
    this.gateway = gateway;
    this.config = config;
    this.routes = this.loadRoutes();
    this.handlers = new Map(); // handler 名稱 → 處理函數
  }

  /**
   * 從 direct-routes.json 載入路由設定
   * 如果檔案不存在或格式錯誤，回傳空陣列（不 crash）
   * @returns {Array} 路由規則陣列
   */
  loadRoutes() {
    const configPath = path.join(__dirname, 'direct-routes.json');
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.routes)) {
        // Pre-compile regex patterns for performance
        const routes = parsed.routes.map(route => {
          const patterns = Array.isArray(route.patterns) ? route.patterns : [];
          const compiledPatterns = [];
          for (const p of patterns) {
            try {
              compiledPatterns.push(new RegExp(p, 'i'));
            } catch (err) {
              console.warn(`[DirectRouter] 無效的正則表達式 "${p}": ${err.message}`);
            }
          }
          return { ...route, _compiledPatterns: compiledPatterns };
        });
        console.log(`[DirectRouter] 載入 ${routes.length} 個路由規則`);
        return routes;
      }
      console.warn('[DirectRouter] direct-routes.json 格式不正確，使用空路由');
      return [];
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn('[DirectRouter] direct-routes.json 不存在，使用空路由');
      } else {
        console.warn(`[DirectRouter] 載入路由設定失敗: ${err.message}，使用空路由`);
      }
      return [];
    }
  }

  /**
   * 註冊 handler
   * @param {string} name - handler 名稱（對應路由設定中的 handler 欄位）
   * @param {Function} fn - async function(message, route) => void
   */
  registerHandler(name, fn) {
    this.handlers.set(name, fn);
  }

  /**
   * 嘗試直接處理訊息
   * 按照路由陣列順序檢查，第一個匹配的路由會被執行
   * 
   * @param {object} message - 訊息物件（需包含 text 或 body）
   * @returns {boolean} true = 已處理，false = 無匹配或處理失敗（應轉發給 AI）
   */
  async tryHandle(message) {
    const text = message.text || message.body || '';

    for (const route of this.routes) {
      if (!route.enabled) continue;

      const handler = this.handlers.get(route.handler);
      if (!handler) continue;

      // 檢查是否有任何 pattern 匹配（使用預編譯的正則）
      const matched = (route._compiledPatterns || []).some(re => re.test(text));

      if (!matched) continue;

      try {
        await handler(message, route);
        this.logRoute(message, route);
        // 記錄到 session log
        try {
          const { getSessionLogger } = require('./session-logger');
          const sessionLogger = getSessionLogger();
          if (sessionLogger) {
            sessionLogger.logDirect(route.handler, text, `[DirectRouter:${route.name}]`);
          }
        } catch (logErr) {
          // 記錄失敗不影響主流程
        }
        return true;
      } catch (err) {
        console.error(`[DirectRouter] ${route.name} failed: ${err.message}`);
        return false; // fallback to AI
      }
    }

    return false; // no match, forward to AI
  }

  /**
   * 記錄路由決策
   * @param {object} message - 訊息物件
   * @param {object} route - 匹配的路由規則
   */
  logRoute(message, route) {
    const text = message.text || message.body || '';
    const preview = text.substring(0, 50);
    console.log(`[DirectRouter] ${route.name} handled: ${preview}`);
  }
}

module.exports = DirectRouter;
