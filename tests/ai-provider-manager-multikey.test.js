/**
 * AI Provider Manager — Multi-Key Support Tests
 * 
 * Tests for getProviderKeys(), getProviderConfig() apiKeys array,
 * and syncMcpConfig() first-key-only behavior.
 * 
 * Requirements: 6.1, 6.2, 6.3
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const AiProviderManager = require('../src/ai-provider-manager');

// ─── Test Helpers ───

/** Create a temp directory structure with .env and ai-providers.json */
function createTestEnv(envContent = '', providersJson = null) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-test-'));
  const projectDir = tmpDir;
  const kiroDir = path.join(tmpDir, '.kiro');
  const settingsDir = path.join(kiroDir, 'settings');
  fs.mkdirSync(settingsDir, { recursive: true });

  // Write .env
  if (envContent) {
    fs.writeFileSync(path.join(projectDir, '.env'), envContent);
  }

  // Write ai-providers.json (minimal registry for testing)
  const registry = providersJson || {
    version: '1.0.0',
    providers: [
      {
        id: 'gemini',
        name: 'Google Gemini',
        envKey: 'GEMINI_API_KEY',
        capabilities: ['tts', 'stt'],
        mcpServer: {
          command: 'uvx',
          args: ['gemini-gen-mcp'],
          envMapping: { 'GEMINI_API_KEY': 'GEMINI_API_KEY' }
        },
        models: [
          { id: 'gemini-tts', capability: 'tts', default: true },
          { id: 'gemini-stt', capability: 'stt', default: true },
        ]
      },
      {
        id: 'openai',
        name: 'OpenAI',
        envKey: 'OPENAI_API_KEY',
        capabilities: ['tts', 'stt'],
        mcpServer: {
          command: 'npx',
          args: ['-y', 'imagegen-mcp'],
          envMapping: { 'OPENAI_API_KEY': 'OPENAI_API_KEY' }
        },
        models: [
          { id: 'tts-1', capability: 'tts', default: true },
          { id: 'whisper-1', capability: 'stt', default: true },
        ]
      }
    ]
  };
  fs.writeFileSync(path.join(projectDir, 'ai-providers.json'), JSON.stringify(registry, null, 2));

  return { projectDir, kiroDir, cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
}

// ─── getProviderKeys ───

describe('getProviderKeys', () => {
  let env, mgr;

  afterEach(() => {
    if (env) env.cleanup();
  });

  test('single key returns array with one element', () => {
    env = createTestEnv('GEMINI_API_KEY=AIzaXXX1\nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const keys = mgr.getProviderKeys('gemini');
    expect(keys).toEqual(['AIzaXXX1']);
  });

  test('multiple comma-separated keys returns array', () => {
    env = createTestEnv('GEMINI_API_KEY=AIzaXXX1,AIzaXXX2,AIzaXXX3\nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const keys = mgr.getProviderKeys('gemini');
    expect(keys).toEqual(['AIzaXXX1', 'AIzaXXX2', 'AIzaXXX3']);
  });

  test('trims whitespace around keys', () => {
    env = createTestEnv('GEMINI_API_KEY= AIzaXXX1 , AIzaXXX2 , AIzaXXX3 \nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const keys = mgr.getProviderKeys('gemini');
    expect(keys).toEqual(['AIzaXXX1', 'AIzaXXX2', 'AIzaXXX3']);
  });

  test('empty key string returns empty array', () => {
    env = createTestEnv('GEMINI_API_KEY=\nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const keys = mgr.getProviderKeys('gemini');
    expect(keys).toEqual([]);
  });

  test('no .env entry returns empty array', () => {
    env = createTestEnv('AI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const keys = mgr.getProviderKeys('gemini');
    expect(keys).toEqual([]);
  });

  test('unknown provider returns empty array', () => {
    env = createTestEnv('GEMINI_API_KEY=AIzaXXX1');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const keys = mgr.getProviderKeys('nonexistent');
    expect(keys).toEqual([]);
  });

  test('filters out empty segments from trailing comma', () => {
    env = createTestEnv('GEMINI_API_KEY=AIzaXXX1,,AIzaXXX2,\nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const keys = mgr.getProviderKeys('gemini');
    expect(keys).toEqual(['AIzaXXX1', 'AIzaXXX2']);
  });
});

// ─── getProviderConfig — apiKeys array ───

describe('getProviderConfig — multi-key', () => {
  let env, mgr;

  afterEach(() => {
    if (env) env.cleanup();
  });

  test('returns apiKeys array and apiKey as first key', () => {
    env = createTestEnv('GEMINI_API_KEY=key1,key2,key3\nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const config = mgr.getProviderConfig('gemini');
    expect(config.apiKeys).toEqual(['key1', 'key2', 'key3']);
    expect(config.apiKey).toBe('key1');
  });

  test('single key: apiKeys has one element, apiKey matches', () => {
    env = createTestEnv('GEMINI_API_KEY=singlekey\nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const config = mgr.getProviderConfig('gemini');
    expect(config.apiKeys).toEqual(['singlekey']);
    expect(config.apiKey).toBe('singlekey');
  });

  test('no key: apiKeys is empty, apiKey is empty string', () => {
    env = createTestEnv('AI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const config = mgr.getProviderConfig('gemini');
    expect(config.apiKeys).toEqual([]);
    expect(config.apiKey).toBe('');
  });

  test('backward compatibility: other fields still present', () => {
    env = createTestEnv('GEMINI_API_KEY=key1,key2\nAI_PROVIDERS=gemini\nAI_MODEL_TTS=gemini:gemini-tts');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    const config = mgr.getProviderConfig('gemini');
    expect(config.id).toBe('gemini');
    expect(config.enabled).toBe(true);
    expect(config.selectedModels.tts).toBe('gemini-tts');
    expect(config.apiKey).toBe('key1');
    expect(config.apiKeys).toEqual(['key1', 'key2']);
  });
});

// ─── syncMcpConfig — first key only ───

describe('syncMcpConfig — first key only for MCP', () => {
  let env, mgr;

  afterEach(() => {
    if (env) env.cleanup();
  });

  test('MCP config uses only first key from comma-separated list', async () => {
    env = createTestEnv('GEMINI_API_KEY=key1,key2,key3\nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    await mgr.syncMcpConfig();

    const mcpPath = path.join(env.kiroDir, 'settings', 'mcp.json');
    const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));

    expect(mcpConfig.mcpServers['ai-gemini'].env.GEMINI_API_KEY).toBe('key1');
  });

  test('MCP config works with single key (no comma)', async () => {
    env = createTestEnv('GEMINI_API_KEY=singlekey\nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    await mgr.syncMcpConfig();

    const mcpPath = path.join(env.kiroDir, 'settings', 'mcp.json');
    const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));

    expect(mcpConfig.mcpServers['ai-gemini'].env.GEMINI_API_KEY).toBe('singlekey');
  });

  test('MCP config trims whitespace from first key', async () => {
    env = createTestEnv('GEMINI_API_KEY= key1 , key2 \nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    await mgr.syncMcpConfig();

    const mcpPath = path.join(env.kiroDir, 'settings', 'mcp.json');
    const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));

    expect(mcpConfig.mcpServers['ai-gemini'].env.GEMINI_API_KEY).toBe('key1');
  });

  test('MCP config handles empty key gracefully', async () => {
    env = createTestEnv('GEMINI_API_KEY=\nAI_PROVIDERS=gemini');
    mgr = new AiProviderManager(env.projectDir, env.kiroDir);

    await mgr.syncMcpConfig();

    const mcpPath = path.join(env.kiroDir, 'settings', 'mcp.json');
    const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));

    expect(mcpConfig.mcpServers['ai-gemini'].env.GEMINI_API_KEY).toBe('');
  });
});
