/**
 * AI Router — Unit Tests
 * 
 * Tests for AiRouter core logic: constructor, classifyError, execute,
 * cooldown management, getStatus, resetCooldowns, AiRouterError.
 */

const { AiRouter, AiRouterError, classifyError, DEFAULT_COOLDOWN_DURATIONS } = require('../src/ai-router');

// ─── Helper: create a simple chain ───
function makeChain(...entries) {
  return entries.map((e, i) => ({
    provider: e.provider || `provider${i}`,
    key: e.key || `key-${i}`,
    keyIndex: e.keyIndex ?? i,
    model: e.model || 'model-default',
  }));
}

function makeError(statusCode, message = 'test error') {
  const err = new Error(message);
  if (statusCode) err.statusCode = statusCode;
  return err;
}

// ─── classifyError ───
describe('classifyError', () => {
  test('401 → permanent, auth_error', () => {
    const result = classifyError(makeError(401));
    expect(result.type).toBe('permanent');
    expect(result.reason).toBe('auth_error');
    expect(result.cooldown).toBe(DEFAULT_COOLDOWN_DURATIONS.permanent);
  });

  test('400 → permanent, bad_request, no cooldown', () => {
    const result = classifyError(makeError(400));
    expect(result.type).toBe('permanent');
    expect(result.reason).toBe('bad_request');
    expect(result.cooldown).toBe(0);
  });

  test('429 → transient, rate_limit', () => {
    const result = classifyError(makeError(429));
    expect(result.type).toBe('transient');
    expect(result.reason).toBe('rate_limit');
    expect(result.cooldown).toBe(DEFAULT_COOLDOWN_DURATIONS.transient);
  });

  test('500 → transient, server_error', () => {
    const result = classifyError(makeError(500));
    expect(result.type).toBe('transient');
    expect(result.reason).toBe('server_error');
  });

  test('503 → transient, server_error', () => {
    const result = classifyError(makeError(503));
    expect(result.type).toBe('transient');
    expect(result.reason).toBe('server_error');
  });

  test('no statusCode (timeout/network) → transient, network_error', () => {
    const result = classifyError(new Error('timeout'));
    expect(result.type).toBe('transient');
    expect(result.reason).toBe('network_error');
  });

  test('custom cooldown durations', () => {
    const custom = { transient: 1000, permanent: 2000 };
    const result = classifyError(makeError(429), custom);
    expect(result.cooldown).toBe(1000);
  });
});

// ─── AiRouter constructor ───
describe('AiRouter constructor', () => {
  test('throws if config.chains is missing', () => {
    expect(() => new AiRouter({})).toThrow('config.chains is required');
    expect(() => new AiRouter(null)).toThrow();
  });

  test('accepts valid config', () => {
    const router = new AiRouter({
      chains: { tts: makeChain({ provider: 'gemini' }) },
    });
    expect(router.chains.tts).toHaveLength(1);
  });

  test('uses default cooldown durations', () => {
    const router = new AiRouter({ chains: { tts: [] } });
    expect(router.cooldownDurations.transient).toBe(300000);
    expect(router.cooldownDurations.permanent).toBe(3600000);
  });

  test('allows custom cooldown durations', () => {
    const router = new AiRouter({
      chains: { tts: [] },
      cooldownDurations: { transient: 1000 },
    });
    expect(router.cooldownDurations.transient).toBe(1000);
    expect(router.cooldownDurations.permanent).toBe(3600000); // default preserved
  });
});

// ─── execute: basic success ───
describe('AiRouter.execute', () => {
  test('returns result on first candidate success', async () => {
    const chain = makeChain({ provider: 'gemini', keyIndex: 0 });
    const router = new AiRouter({ chains: { tts: chain } });

    const result = await router.execute('tts', async (candidate) => {
      return { audio: 'buffer', provider: candidate.provider };
    });

    expect(result.audio).toBe('buffer');
    expect(result.provider).toBe('gemini');
  });

  test('records lastSuccess on success', async () => {
    const chain = makeChain({ provider: 'gemini', keyIndex: 0 });
    const router = new AiRouter({ chains: { tts: chain } });

    await router.execute('tts', async () => 'ok');

    const key = 'tts:gemini:0';
    expect(router.lastSuccess.has(key)).toBe(true);
  });

  test('throws AiRouterError for empty chain', async () => {
    const router = new AiRouter({ chains: { tts: [] } });
    await expect(router.execute('tts', async () => 'ok'))
      .rejects.toThrow(AiRouterError);
  });

  test('throws AiRouterError for unknown capability', async () => {
    const router = new AiRouter({ chains: { tts: [] } });
    await expect(router.execute('unknown', async () => 'ok'))
      .rejects.toThrow(AiRouterError);
  });
});

// ─── execute: transient fallback ───
describe('AiRouter.execute — transient fallback', () => {
  test('falls back to next candidate on 429', async () => {
    const chain = makeChain(
      { provider: 'gemini', keyIndex: 0 },
      { provider: 'gemini', keyIndex: 1 },
    );
    const router = new AiRouter({ chains: { tts: chain } });
    let callCount = 0;

    const result = await router.execute('tts', async (candidate) => {
      callCount++;
      if (candidate.keyIndex === 0) throw makeError(429, 'rate limited');
      return 'success-from-key1';
    });

    expect(result).toBe('success-from-key1');
    expect(callCount).toBe(2);
  });

  test('falls back on 5xx', async () => {
    const chain = makeChain(
      { provider: 'gemini', keyIndex: 0 },
      { provider: 'openai', keyIndex: 0 },
    );
    const router = new AiRouter({ chains: { tts: chain } });

    const result = await router.execute('tts', async (candidate) => {
      if (candidate.provider === 'gemini') throw makeError(500, 'server error');
      return 'openai-ok';
    });

    expect(result).toBe('openai-ok');
  });

  test('falls back on network error (no statusCode)', async () => {
    const chain = makeChain(
      { provider: 'gemini', keyIndex: 0 },
      { provider: 'openai', keyIndex: 0 },
    );
    const router = new AiRouter({ chains: { tts: chain } });

    const result = await router.execute('tts', async (candidate) => {
      if (candidate.provider === 'gemini') throw new Error('ECONNREFUSED');
      return 'openai-ok';
    });

    expect(result).toBe('openai-ok');
  });
});

// ─── execute: 401 skips same provider ───
describe('AiRouter.execute — 401 skips same provider', () => {
  test('skips remaining keys of same provider on 401', async () => {
    const chain = makeChain(
      { provider: 'gemini', keyIndex: 0 },
      { provider: 'gemini', keyIndex: 1 },
      { provider: 'gemini', keyIndex: 2 },
      { provider: 'openai', keyIndex: 0 },
    );
    const router = new AiRouter({ chains: { tts: chain } });
    const triedProviders = [];

    const result = await router.execute('tts', async (candidate) => {
      triedProviders.push(`${candidate.provider}:${candidate.keyIndex}`);
      if (candidate.provider === 'gemini' && candidate.keyIndex === 0) {
        throw makeError(401, 'invalid key');
      }
      return 'ok';
    });

    expect(result).toBe('ok');
    // Should skip gemini:1 and gemini:2, go directly to openai:0
    expect(triedProviders).toEqual(['gemini:0', 'openai:0']);
  });

  test('401 on last provider throws AiRouterError', async () => {
    const chain = makeChain(
      { provider: 'gemini', keyIndex: 0 },
    );
    const router = new AiRouter({ chains: { tts: chain } });

    await expect(
      router.execute('tts', async () => { throw makeError(401); })
    ).rejects.toThrow(AiRouterError);
  });
});

// ─── execute: 400 throws immediately ───
describe('AiRouter.execute — 400 throws immediately', () => {
  test('400 does not fallback, throws immediately', async () => {
    const chain = makeChain(
      { provider: 'gemini', keyIndex: 0 },
      { provider: 'openai', keyIndex: 0 },
    );
    const router = new AiRouter({ chains: { tts: chain } });
    let callCount = 0;

    await expect(
      router.execute('tts', async () => {
        callCount++;
        throw makeError(400, 'bad params');
      })
    ).rejects.toThrow(AiRouterError);

    expect(callCount).toBe(1); // Only tried first candidate
  });

  test('400 does not set cooldown', async () => {
    const chain = makeChain({ provider: 'gemini', keyIndex: 0 });
    const router = new AiRouter({ chains: { tts: chain } });

    try {
      await router.execute('tts', async () => { throw makeError(400); });
    } catch (e) { /* expected */ }

    expect(router.cooldownMap.size).toBe(0);
  });
});

// ─── execute: all fail → AiRouterError with all errors ───
describe('AiRouter.execute — all fail', () => {
  test('collects all errors when all candidates fail', async () => {
    const chain = makeChain(
      { provider: 'gemini', keyIndex: 0 },
      { provider: 'openai', keyIndex: 0 },
    );
    const router = new AiRouter({ chains: { tts: chain } });

    try {
      await router.execute('tts', async (candidate) => {
        throw makeError(500, `${candidate.provider} down`);
      });
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AiRouterError);
      expect(err.capability).toBe('tts');
      expect(err.errors).toHaveLength(2);
      expect(err.errors[0].provider).toBe('gemini');
      expect(err.errors[1].provider).toBe('openai');
    }
  });
});

// ─── Cooldown management ───
describe('AiRouter cooldown management', () => {
  test('_setCooldown and _isInCooldown work together', () => {
    const router = new AiRouter({ chains: { tts: [] } });
    router._setCooldown('tts', 'gemini', 0, 'rate_limit', 429, 300000);
    expect(router._isInCooldown('tts', 'gemini', 0)).toBe(true);
  });

  test('_isInCooldown returns false after expiry', () => {
    const router = new AiRouter({ chains: { tts: [] } });
    // Set cooldown that already expired
    const key = 'tts:gemini:0';
    router.cooldownMap.set(key, {
      reason: 'rate_limit',
      statusCode: 429,
      expiresAt: Date.now() - 1000, // already expired
      failedAt: Date.now() - 301000,
    });
    expect(router._isInCooldown('tts', 'gemini', 0)).toBe(false);
    // Should also clean up the entry
    expect(router.cooldownMap.has(key)).toBe(false);
  });

  test('_setCooldown with duration 0 does not set cooldown', () => {
    const router = new AiRouter({ chains: { tts: [] } });
    router._setCooldown('tts', 'gemini', 0, 'bad_request', 400, 0);
    expect(router.cooldownMap.size).toBe(0);
  });

  test('_getCooldownEntry returns entry or null', () => {
    const router = new AiRouter({ chains: { tts: [] } });
    expect(router._getCooldownEntry('tts', 'gemini', 0)).toBeNull();
    router._setCooldown('tts', 'gemini', 0, 'rate_limit', 429, 300000);
    const entry = router._getCooldownEntry('tts', 'gemini', 0);
    expect(entry).not.toBeNull();
    expect(entry.reason).toBe('rate_limit');
  });
});

// ─── execute: cooldown skip behavior ───
describe('AiRouter.execute — cooldown skip', () => {
  test('skips candidates in cooldown', async () => {
    const chain = makeChain(
      { provider: 'gemini', keyIndex: 0 },
      { provider: 'gemini', keyIndex: 1 },
      { provider: 'openai', keyIndex: 0 },
    );
    const router = new AiRouter({ chains: { tts: chain } });

    // Put gemini:0 in cooldown
    router._setCooldown('tts', 'gemini', 0, 'rate_limit', 429, 300000);

    const tried = [];
    const result = await router.execute('tts', async (candidate) => {
      tried.push(`${candidate.provider}:${candidate.keyIndex}`);
      return 'ok';
    });

    expect(result).toBe('ok');
    // Should skip gemini:0, start from gemini:1
    expect(tried).toEqual(['gemini:1']);
  });

  test('when all in cooldown, retries from full chain', async () => {
    const chain = makeChain(
      { provider: 'gemini', keyIndex: 0 },
      { provider: 'openai', keyIndex: 0 },
    );
    const router = new AiRouter({ chains: { tts: chain } });

    // Put all in cooldown
    router._setCooldown('tts', 'gemini', 0, 'rate_limit', 429, 300000);
    router._setCooldown('tts', 'openai', 0, 'rate_limit', 429, 300000);

    const tried = [];
    const result = await router.execute('tts', async (candidate) => {
      tried.push(`${candidate.provider}:${candidate.keyIndex}`);
      return 'ok';
    });

    expect(result).toBe('ok');
    // Should use full chain, starting from gemini:0
    expect(tried).toEqual(['gemini:0']);
  });
});

// ─── getStatus ───
describe('AiRouter.getStatus', () => {
  test('returns status for specific capability', () => {
    const chain = makeChain(
      { provider: 'gemini', keyIndex: 0, model: 'gemini-tts' },
      { provider: 'openai', keyIndex: 0, model: 'tts-1' },
    );
    const router = new AiRouter({ chains: { tts: chain } });

    const status = router.getStatus('tts');
    expect(status.tts).toBeDefined();
    expect(status.tts.chain).toHaveLength(2);
    expect(status.tts.activeCount).toBe(2);
    expect(status.tts.totalCount).toBe(2);
    expect(status.tts.chain[0].status).toBe('normal');
  });

  test('shows cooling status with reason and remaining time', () => {
    const chain = makeChain({ provider: 'gemini', keyIndex: 0 });
    const router = new AiRouter({ chains: { tts: chain } });
    router._setCooldown('tts', 'gemini', 0, 'rate_limit', 429, 300000);

    const status = router.getStatus('tts');
    expect(status.tts.chain[0].status).toBe('cooling');
    expect(status.tts.chain[0].cooldownReason).toBe('rate_limit');
    expect(status.tts.chain[0].cooldownRemaining).toBeGreaterThan(0);
    expect(status.tts.activeCount).toBe(0);
  });

  test('returns all capabilities when none specified', () => {
    const router = new AiRouter({
      chains: {
        tts: makeChain({ provider: 'gemini', keyIndex: 0 }),
        stt: makeChain({ provider: 'openai', keyIndex: 0 }),
      },
    });

    const status = router.getStatus();
    expect(status.tts).toBeDefined();
    expect(status.stt).toBeDefined();
  });

  test('includes lastSuccess when available', async () => {
    const chain = makeChain({ provider: 'gemini', keyIndex: 0 });
    const router = new AiRouter({ chains: { tts: chain } });

    await router.execute('tts', async () => 'ok');

    const status = router.getStatus('tts');
    expect(status.tts.chain[0].lastSuccess).toBeDefined();
    expect(typeof status.tts.chain[0].lastSuccess).toBe('number');
  });
});

// ─── resetCooldowns ───
describe('AiRouter.resetCooldowns', () => {
  test('resets all cooldowns when no capability specified', () => {
    const router = new AiRouter({
      chains: {
        tts: makeChain({ provider: 'gemini', keyIndex: 0 }),
        stt: makeChain({ provider: 'openai', keyIndex: 0 }),
      },
    });
    router._setCooldown('tts', 'gemini', 0, 'rate_limit', 429, 300000);
    router._setCooldown('stt', 'openai', 0, 'rate_limit', 429, 300000);

    router.resetCooldowns();
    expect(router.cooldownMap.size).toBe(0);
  });

  test('resets only specified capability cooldowns', () => {
    const router = new AiRouter({
      chains: {
        tts: makeChain({ provider: 'gemini', keyIndex: 0 }),
        stt: makeChain({ provider: 'openai', keyIndex: 0 }),
      },
    });
    router._setCooldown('tts', 'gemini', 0, 'rate_limit', 429, 300000);
    router._setCooldown('stt', 'openai', 0, 'rate_limit', 429, 300000);

    router.resetCooldowns('tts');
    expect(router.cooldownMap.size).toBe(1);
    expect(router._isInCooldown('tts', 'gemini', 0)).toBe(false);
    expect(router._isInCooldown('stt', 'openai', 0)).toBe(true);
  });

  test('after reset, getStatus shows all normal', () => {
    const chain = makeChain({ provider: 'gemini', keyIndex: 0 });
    const router = new AiRouter({ chains: { tts: chain } });
    router._setCooldown('tts', 'gemini', 0, 'auth_error', 401, 3600000);

    router.resetCooldowns('tts');
    const status = router.getStatus('tts');
    expect(status.tts.chain[0].status).toBe('normal');
    expect(status.tts.activeCount).toBe(1);
  });
});

// ─── AiRouterError ───
describe('AiRouterError', () => {
  test('has correct properties', () => {
    const errors = [
      { provider: 'gemini', keyIndex: 0, reason: 'rate_limit', statusCode: 429, message: 'rate limited' },
    ];
    const err = new AiRouterError('tts', errors);
    expect(err.name).toBe('AiRouterError');
    expect(err.capability).toBe('tts');
    expect(err.errors).toEqual(errors);
    expect(err instanceof Error).toBe(true);
  });

  test('formatErrorMessage includes all error entries', () => {
    const errors = [
      { provider: 'gemini', keyIndex: 0, reason: 'server_error', statusCode: 500, message: 'down' },
      { provider: 'openai', keyIndex: 0, reason: 'rate_limit', statusCode: 429, message: 'limited' },
    ];
    const msg = AiRouterError.formatErrorMessage('tts', errors);
    expect(msg).toContain('gemini');
    expect(msg).toContain('openai');
    expect(msg).toContain('server_error');
    expect(msg).toContain('rate_limit');
  });

  test('formatErrorMessage sorts by severity (401 first)', () => {
    const errors = [
      { provider: 'openai', keyIndex: 0, reason: 'rate_limit', statusCode: 429, message: 'limited' },
      { provider: 'gemini', keyIndex: 0, reason: 'auth_error', statusCode: 401, message: 'invalid key' },
    ];
    const msg = AiRouterError.formatErrorMessage('tts', errors);
    const authIdx = msg.indexOf('auth_error');
    const rateIdx = msg.indexOf('rate_limit');
    expect(authIdx).toBeLessThan(rateIdx);
  });

  test('formatErrorMessage includes "Key 有問題" when 401 present', () => {
    const errors = [
      { provider: 'gemini', keyIndex: 0, reason: 'auth_error', statusCode: 401, message: 'invalid' },
    ];
    const msg = AiRouterError.formatErrorMessage('tts', errors);
    expect(msg).toContain('Key 有問題');
  });

  test('formatErrorMessage does NOT include "Key 有問題" without 401', () => {
    const errors = [
      { provider: 'gemini', keyIndex: 0, reason: 'rate_limit', statusCode: 429, message: 'limited' },
    ];
    const msg = AiRouterError.formatErrorMessage('tts', errors);
    expect(msg).not.toContain('Key 有問題');
  });

  test('formatErrorMessage includes cooldown recovery time', () => {
    const errors = [
      { provider: 'gemini', keyIndex: 0, reason: 'rate_limit', statusCode: 429, message: 'limited' },
    ];
    const cooldownMap = new Map();
    cooldownMap.set('tts:gemini:0', {
      reason: 'rate_limit',
      statusCode: 429,
      expiresAt: Date.now() + 120000, // 2 minutes
      failedAt: Date.now(),
    });
    const msg = AiRouterError.formatErrorMessage('tts', errors, cooldownMap);
    expect(msg).toContain('分鐘後恢復');
  });

  test('formatErrorMessage handles empty errors', () => {
    const msg = AiRouterError.formatErrorMessage('tts', []);
    expect(msg).toContain('所有候選都失敗');
  });

  test('every error entry includes reason (never just "失敗了")', () => {
    const errors = [
      { provider: 'gemini', keyIndex: 0, reason: 'server_error', statusCode: 500, message: 'internal error' },
      { provider: 'openai', keyIndex: 0, reason: 'auth_error', statusCode: 401, message: 'unauthorized' },
    ];
    const msg = AiRouterError.formatErrorMessage('tts', errors);
    expect(msg).not.toBe('失敗了');
    expect(msg).toContain('server_error');
    expect(msg).toContain('auth_error');
  });
});
