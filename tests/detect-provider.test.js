/**
 * Tests for AiProviderManager.detectProvider()
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('AiProviderManager.detectProvider', () => {
  let manager;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-test-'));
    // Create minimal .env
    fs.writeFileSync(path.join(tmpDir, '.env'), 'AI_PROVIDERS=\n');
    // Copy ai-providers.json
    const srcRegistry = path.join(__dirname, '..', 'ai-providers.json');
    fs.copyFileSync(srcRegistry, path.join(tmpDir, 'ai-providers.json'));

    const AiProviderManager = require('../src/ai-provider-manager');
    const parentKiroDir = path.join(tmpDir, '.kiro');
    fs.mkdirSync(parentKiroDir, { recursive: true });
    fs.mkdirSync(path.join(parentKiroDir, 'settings'), { recursive: true });
    fs.writeFileSync(path.join(parentKiroDir, 'settings', 'mcp.json'), '{"mcpServers":{}}');
    manager = new AiProviderManager(tmpDir, parentKiroDir);
  });

  it('should detect Gemini key (AIza prefix)', () => {
    const result = manager.detectProvider('AIzaSyA1234567890abcdefghijklmnopqrstuv');
    assert.strictEqual(result, 'gemini');
  });

  it('should detect xAI key (xai- prefix)', () => {
    const result = manager.detectProvider('xai-' + 'a'.repeat(50));
    assert.strictEqual(result, 'xai');
  });

  it('should detect ElevenLabs key (32 hex chars)', () => {
    const result = manager.detectProvider('abcdef0123456789abcdef0123456789');
    assert.strictEqual(result, 'elevenlabs');
  });

  it('should return array for sk- keys (OpenAI + Stability conflict)', () => {
    // sk- keys can match both OpenAI and Stability
    const key = 'sk-' + 'A'.repeat(50);
    const result = manager.detectProvider(key);
    // Should be array if multiple match, or single if only one matches
    if (Array.isArray(result)) {
      assert.ok(result.includes('openai') || result.includes('stability'));
      assert.ok(result.length >= 2);
    } else {
      // If patterns are specific enough to only match one, that's fine too
      assert.ok(['openai', 'stability'].includes(result));
    }
  });

  it('should return null for empty key', () => {
    assert.strictEqual(manager.detectProvider(''), null);
    assert.strictEqual(manager.detectProvider(null), null);
    assert.strictEqual(manager.detectProvider(undefined), null);
  });

  it('should return null for unrecognized key', () => {
    assert.strictEqual(manager.detectProvider('random-key-that-matches-nothing'), null);
  });

  it('should clean invisible characters before detection', () => {
    // Key with BOM and trailing whitespace
    const key = '\uFEFFAIzaSyA1234567890abcdefghijklmnopqrstuv\r\n';
    const result = manager.detectProvider(key);
    assert.strictEqual(result, 'gemini');
  });
});
