/**
 * AI Provider Manager
 * 管理外部 AI provider 的啟用/停用/設定
 * 讀取 ai-providers.json，寫入 .env 和 mcp.json
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

class AiProviderManager {
  /**
   * @param {string} projectDir - MyKiroHero 專案目錄
   * @param {string} parentKiroDir - 父資料夾的 .kiro 目錄（Kiro 讀的位置）
   */
  constructor(projectDir, parentKiroDir) {
    this.projectDir = projectDir;
    this.parentKiroDir = parentKiroDir;
    this.registryPath = path.join(projectDir, 'ai-providers.json');
    this.envPath = path.join(projectDir, '.env');
    this.mcpPath = path.join(parentKiroDir, 'settings', 'mcp.json');
    this._registry = null;
  }

  // ─── 讀取 ───

  /** 讀取 ai-providers.json（自動偵測檔案變更，避免長時間 cache 過期） */
  getRegistry() {
    try {
      const stat = fs.statSync(this.registryPath);
      const mtime = stat.mtimeMs;
      if (!this._registry || mtime !== this._registryMtime) {
        const raw = fs.readFileSync(this.registryPath, 'utf-8');
        this._registry = JSON.parse(raw);
        this._registryMtime = mtime;
      }
    } catch (err) {
      // If stat fails, clear cache and re-read file to avoid using stale data
      this._registry = null;
      this._registryMtime = null;
      try {
        const raw = fs.readFileSync(this.registryPath, 'utf-8');
        this._registry = JSON.parse(raw);
      } catch (readErr) {
        // If file doesn't exist or is unreadable, return empty registry
        this._registry = { providers: [] };
      }
    }
    return this._registry;
  }

  /** 取得特定 provider */
  getProvider(providerId) {
    const reg = this.getRegistry();
    return reg.providers.find(p => p.id === providerId) || null;
  }

  /** 從 .env 解析已啟用的 provider 列表 */
  getEnabledProviders() {
    const env = this._readEnv();
    const raw = env.AI_PROVIDERS || '';
    if (!raw.trim()) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  /**
   * 取得特定 provider 的所有 API Key（支援逗號分隔多 Key）
   * @param {string} providerId
   * @returns {string[]} Key 陣列（已去除前後空白），無 Key 時回傳空陣列
   */
  getProviderKeys(providerId) {
    const provider = this.getProvider(providerId);
    if (!provider) return [];

    const env = this._readEnv();
    const raw = env[provider.envKey] || '';
    if (!raw.trim()) return [];

    return raw.split(',').map(k => k.trim()).filter(Boolean);
  }

  /** 取得特定 provider 的完整設定（registry + .env） */
  getProviderConfig(providerId) {
    const provider = this.getProvider(providerId);
    if (!provider) return null;

    const env = this._readEnv();
    const enabled = this.getEnabledProviders().includes(providerId);

    // 多 Key 支援：解析逗號分隔的 Key 為陣列
    const apiKeys = this.getProviderKeys(providerId);
    const apiKey = apiKeys[0] || '';

    // 找出使用者選的 model（按 capability）
    const selectedModels = {};
    for (const cap of provider.capabilities) {
      const envKey = `AI_MODEL_${cap.toUpperCase()}`;
      const val = env[envKey] || '';
      // 格式: provider:modelId
      if (val.startsWith(`${providerId}:`)) {
        selectedModels[cap] = val.split(':')[1];
      }
    }

    return { ...provider, enabled, apiKey, apiKeys, selectedModels };
  }

  // ─── 寫入 ───

  /** 啟用 provider */
  async enableProvider(providerId, apiKey, modelSelections = {}) {
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const env = this._readEnv();

    // 更新 AI_PROVIDERS
    const current = this.getEnabledProviders();
    if (!current.includes(providerId)) {
      current.push(providerId);
    }
    env.AI_PROVIDERS = current.join(',');

    // 寫入 API key
    if (apiKey) {
      env[provider.envKey] = apiKey;
    }

    // 寫入 model 選擇
    for (const cap of provider.capabilities) {
      const envKey = `AI_MODEL_${cap.toUpperCase()}`;
      const modelId = modelSelections[cap];
      if (modelId) {
        env[envKey] = `${providerId}:${modelId}`;
      } else if (!env[envKey]) {
        // 用 default model
        const defaultModel = provider.models.find(m => m.capability === cap && m.default);
        if (defaultModel) {
          env[envKey] = `${providerId}:${defaultModel.id}`;
        }
      }
    }

    this._writeEnv(env);
    await this.syncMcpConfig();
  }

  /** 停用 provider */
  async disableProvider(providerId) {
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const env = this._readEnv();
    const keysToDelete = new Set();

    // 從 AI_PROVIDERS 移除
    const current = this.getEnabledProviders().filter(id => id !== providerId);
    env.AI_PROVIDERS = current.join(',');

    // 清除該 provider 的 model 選擇（如果是該 provider 的）
    for (const cap of provider.capabilities) {
      const envKey = `AI_MODEL_${cap.toUpperCase()}`;
      const val = env[envKey] || '';
      if (val.startsWith(`${providerId}:`)) {
        delete env[envKey];
        keysToDelete.add(envKey);
      }
    }

    // 保留 API key（使用者可能之後再啟用）

    this._writeEnv(env, keysToDelete);
    await this.syncMcpConfig();
  }

  /** 切換 model */
  updateModel(providerId, capability, modelId) {
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const model = provider.models.find(m => m.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    if (model.capability !== capability) {
      throw new Error(`Model ${modelId} is ${model.capability}, not ${capability}`);
    }

    const env = this._readEnv();
    env[`AI_MODEL_${capability.toUpperCase()}`] = `${providerId}:${modelId}`;
    this._writeEnv(env);
  }

  /** 更新 API key */
  updateApiKey(providerId, apiKey) {
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const env = this._readEnv();
    env[provider.envKey] = apiKey;
    this._writeEnv(env);
  }

  // ─── mcp.json 管理 ───

  /** 根據已啟用的 provider 同步 mcp.json */
  async syncMcpConfig() {
    let mcpConfig = {};
    if (fs.existsSync(this.mcpPath)) {
      try {
        mcpConfig = JSON.parse(fs.readFileSync(this.mcpPath, 'utf-8'));
      } catch { /* start fresh */ }
    }

    if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};

    const reg = this.getRegistry();
    const enabled = this.getEnabledProviders();

    // AI provider server 的 key 前綴
    const AI_PREFIX = 'ai-';

    // 移除不再啟用的 AI MCP servers
    // Only clean up when we have an explicit provider list; empty list means
    // AI_PROVIDERS is not set — don't nuke existing ai-* servers in that case.
    if (enabled.length > 0) {
      for (const key of Object.keys(mcpConfig.mcpServers)) {
        if (key.startsWith(AI_PREFIX)) {
          const providerId = key.slice(AI_PREFIX.length);
          if (!enabled.includes(providerId)) {
            delete mcpConfig.mcpServers[key];
          }
        }
      }
    }

    // 新增/更新已啟用的 AI MCP servers
    const env = this._readEnv();
    for (const providerId of enabled) {
      const provider = reg.providers.find(p => p.id === providerId);
      if (!provider || !provider.mcpServer) continue;

      const serverKey = `${AI_PREFIX}${providerId}`;
      const mcp = provider.mcpServer;

      // 解析 command 完整路徑（uvx 等工具可能不在 PATH）
      let command = mcp.command;
      if (command === 'uvx') {
        const uvxFullPath = await this._resolveUvxPath();
        if (uvxFullPath) command = uvxFullPath;
      }

      const serverConfig = {
        command,
        args: [...mcp.args],
        disabled: false,
        autoApprove: ['*']
      };

      // env mapping（MCP 層只使用第一組 Key）
      if (mcp.envMapping) {
        serverConfig.env = {};
        for (const [mcpEnvKey, ourEnvKey] of Object.entries(mcp.envMapping)) {
          const rawVal = env[ourEnvKey] || '';
          // 若為逗號分隔的多 Key，只取第一組
          const firstKey = rawVal.split(',')[0].trim();
          serverConfig.env[mcpEnvKey] = firstKey;
        }
      }

      mcpConfig.mcpServers[serverKey] = serverConfig;
    }

    // 確保目錄存在
    fs.mkdirSync(path.dirname(this.mcpPath), { recursive: true });
    fs.writeFileSync(this.mcpPath, JSON.stringify(mcpConfig, null, 2));
  }

  // ─── 驗證 ───

  /** 格式驗證 API key */
  validateApiKey(providerId, apiKey) {
    // 清理不可見字元（Windows readline 有時會帶入）
    const cleaned = (apiKey || '').replace(/[^\x20-\x7E]/g, '').trim();
    if (!cleaned) {
      return { valid: false, reason: 'empty', cleaned };
    }

    const provider = this.getProvider(providerId);
    if (!provider) {
      return { valid: false, reason: 'unknown_provider', cleaned };
    }

    if (provider.keyPattern) {
      const regex = new RegExp(provider.keyPattern);
      if (!regex.test(cleaned)) {
        return { valid: false, reason: 'format_mismatch', cleaned };
      }
    }

    return { valid: true, cleaned };
  }
  /**
   * Auto-detect provider from API key pattern
   * @param {string} apiKey - The API key to detect
   * @returns {string|string[]|null} - Single provider ID, array of matching IDs, or null
   */
  detectProvider(apiKey) {
    const cleaned = (apiKey || '').replace(/[^\x20-\x7E]/g, '').trim();
    if (!cleaned) return null;

    const matches = [];
    for (const provider of this.getRegistry().providers) {
      if (provider.keyPattern) {
        const regex = new RegExp(provider.keyPattern);
        if (regex.test(cleaned)) {
          matches.push(provider.id);
        }
      }
    }

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return matches;
  }

  // ─── 升級輔助 ───

  /** 比對新舊 registry，找出差異 */
  diffRegistry(oldRegistry) {
    const newReg = this.getRegistry();
    const diff = { newProviders: [], newModels: [], deprecated: [] };

    const oldIds = new Set((oldRegistry.providers || []).map(p => p.id));
    const oldModelMap = new Map();
    for (const p of (oldRegistry.providers || [])) {
      for (const m of (p.models || [])) {
        oldModelMap.set(`${p.id}:${m.id}`, m);
      }
    }

    for (const provider of newReg.providers) {
      if (!oldIds.has(provider.id)) {
        diff.newProviders.push(provider);
        continue;
      }
      for (const model of provider.models) {
        const key = `${provider.id}:${model.id}`;
        if (!oldModelMap.has(key)) {
          diff.newModels.push({ provider: provider.id, model });
        }
        if (model.status === 'deprecated') {
          diff.deprecated.push({ provider: provider.id, model });
        }
      }
    }

    return diff;
  }

  // ─── 內部方法 ───

  /** 讀取 .env 為 key-value object */
  _readEnv() {
    const result = {};
    if (!fs.existsSync(this.envPath)) return result;

    const content = fs.readFileSync(this.envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trimEnd();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1);
      result[key] = val;
    }
    return result;
  }

  /** 寫入 .env（保留註解和格式）
   * @param {Object} envObj - key-value pairs to write
   * @param {Set} [keysToDelete] - keys to remove from .env file
   */
  _writeEnv(envObj, keysToDelete = new Set()) {
    if (!fs.existsSync(this.envPath)) {
      // 沒有 .env，直接寫
      const lines = Object.entries(envObj).map(([k, v]) => `${k}=${v}`);
      fs.writeFileSync(this.envPath, lines.join('\n') + '\n');
      return;
    }

    const content = fs.readFileSync(this.envPath, 'utf-8');
    const lines = content.split('\n');
    const written = new Set();
    const result = [];

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed || trimmed.startsWith('#')) {
        result.push(line);
        continue;
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) {
        result.push(line);
        continue;
      }
      const key = trimmed.slice(0, eqIdx).trim();
      if (keysToDelete.has(key)) {
        // 跳過被刪除的 key（不寫入結果）
        continue;
      }
      if (key in envObj) {
        result.push(`${key}=${envObj[key]}`);
        written.add(key);
      } else {
        result.push(line);
      }
    }

    // 新增尚未寫入的 key
    const unwritten = Object.entries(envObj).filter(([k]) => !written.has(k));
    if (unwritten.length > 0) {
      result.push('');
      result.push('# --- AI Provider Settings ---');
      for (const [k, v] of unwritten) {
        result.push(`${k}=${v}`);
      }
    }

    fs.writeFileSync(this.envPath, result.join('\n'));
  }

  /**
   * 解析 uvx 完整路徑（async, cached）
   * Resolves once on first call, caches the result for subsequent calls.
   * Uses execFile instead of execSync for safety (no shell injection).
   * 優先順序：%LOCALAPPDATA%\uv\uvx.exe → ~/.local/bin/uvx → PATH 裡的 uvx
   * @returns {Promise<string|null>}
   */
  async _resolveUvxPath() {
    // Return cached result if already resolved
    if (this._uvxPathResolved) return this._uvxPathCached;

    const isWin = process.platform === 'win32';
    const candidates = isWin
      ? [
          path.join(process.env.LOCALAPPDATA || '', 'uv', 'uvx.exe'),
          path.join(process.env.USERPROFILE || '', '.local', 'bin', 'uvx.exe'),
        ]
      : [
          path.join(process.env.HOME || '', '.local', 'bin', 'uvx'),
          path.join(process.env.HOME || '', '.cargo', 'bin', 'uvx'),
          '/usr/local/bin/uvx',
        ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        this._uvxPathCached = p;
        this._uvxPathResolved = true;
        return p;
      }
    }

    // fallback: check PATH using async execFile (no shell injection risk)
    try {
      const cmd = isWin ? 'where' : 'which';
      const result = await new Promise((resolve, reject) => {
        execFile(cmd, ['uvx'], { encoding: 'utf-8', timeout: 5000 }, (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout);
        });
      });
      const found = result.trim().split('\n')[0].trim();
      if (found) {
        this._uvxPathCached = found;
        this._uvxPathResolved = true;
        return found;
      }
    } catch { /* not in PATH */ }

    this._uvxPathCached = null;
    this._uvxPathResolved = true;
    return null;
  }
}

module.exports = AiProviderManager;
