/**
 * AI Router 初始化模組
 * 
 * 從 AiProviderManager 讀取已啟用 Provider 與 Key，
 * 建構 AiRouter 的 fallback chains。
 * 
 * Requirements: 1.1, 4.5, 5.2
 */

const path = require('path');
const { AiRouter } = require('./ai-router');
const AiProviderManager = require('./ai-provider-manager');

/**
 * 為指定 capability 建構 fallback chain
 * 
 * @param {AiProviderManager} manager
 * @param {string} capability - 'tts' | 'stt' | 'image'
 * @returns {Array<{provider: string, key: string, model: string, keyIndex: number}>}
 */
function buildChain(manager, capability) {
  const chain = [];
  const enabledProviders = manager.getEnabledProviders();

  for (const providerId of enabledProviders) {
    const provider = manager.getProvider(providerId);
    if (!provider) continue;

    // 檢查此 provider 是否支援此 capability
    if (!provider.capabilities.includes(capability)) continue;

    // 找出此 capability 的 default model
    const config = manager.getProviderConfig(providerId);
    const selectedModel = config.selectedModels?.[capability];
    const defaultModel = provider.models.find(
      m => m.capability === capability && m.default
    );
    const modelId = selectedModel || defaultModel?.id || '';

    // 取得所有 keys
    const keys = manager.getProviderKeys(providerId);
    if (keys.length === 0) continue;

    // 每個 key 作為獨立候選
    keys.forEach((key, idx) => {
      chain.push({
        provider: providerId,
        key,
        model: modelId,
        keyIndex: idx,
      });
    });
  }

  return chain;
}

/**
 * 建立完整的 AiRouter 實例
 * 
 * @param {Object} [options]
 * @param {string} [options.projectDir] - MyKiroHero 專案目錄
 * @param {string} [options.parentKiroDir] - 父資料夾的 .kiro 目錄
 * @param {string[]} [options.capabilities] - 要建構的 capabilities，預設 ['tts', 'stt']
 * @returns {{ router: AiRouter, manager: AiProviderManager, chains: Object }}
 */
function createRouter(options = {}) {
  const projectDir = options.projectDir || path.join(__dirname, '..');
  const parentKiroDir = options.parentKiroDir || path.join(projectDir, '..', '.kiro');
  const capabilities = options.capabilities || ['tts', 'stt'];

  const manager = new AiProviderManager(projectDir, parentKiroDir);

  const chains = {};
  for (const cap of capabilities) {
    chains[cap] = buildChain(manager, cap);
  }

  const router = new AiRouter({ chains });

  // Log chain info
  for (const [cap, chain] of Object.entries(chains)) {
    if (chain.length > 0) {
      const summary = chain.map(c => `${c.provider}[key${c.keyIndex}]`).join(' → ');
      console.log(`[AiRouter] ${cap} chain: ${summary}`);
    } else {
      console.log(`[AiRouter] ${cap} chain: (empty)`);
    }
  }

  return { router, manager, chains };
}

module.exports = { createRouter, buildChain };
