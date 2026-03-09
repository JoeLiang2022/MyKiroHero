/**
 * Plugin Handler 自動載入器
 * 
 * 啟動時掃描 tasks/ 目錄，載入所有符合格式的 handler。
 * 
 * Handler 格式：
 *   module.exports = {
 *     name: 'action-name',
 *     description: '描述',
 *     type: 'layer1' | 'layer2',
 *     execute: async (params) => {
 *       return { success: boolean, outputPath: string, message: string }
 *     }
 *   }
 * 
 * **Implements: Requirements 5.1, 5.2, 5.4, 5.5**
 */

const fs = require('fs');
const path = require('path');

const handlers = [];
const dir = __dirname;

for (const file of fs.readdirSync(dir)) {
  if (file === 'index.js') continue;
  if (!file.endsWith('.js')) continue;
  if (file.endsWith('.test.js')) continue;
  try {
    const handler = require(path.join(dir, file));
    if (handler.name && typeof handler.execute === 'function') {
      handlers.push(handler);
      console.log(`[TaskHandlers] Loaded: ${handler.name} (${handler.type || 'unknown'})`);
    }
  } catch (err) {
    console.error(`[TaskHandlers] Failed to load ${file}: ${err.message}`);
  }
}

module.exports = handlers;
