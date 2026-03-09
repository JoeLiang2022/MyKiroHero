/**
 * i18n module tests
 */

describe('i18n', () => {
  let originalLang;

  beforeAll(() => {
    originalLang = process.env.LANGUAGE;
  });

  afterAll(() => {
    if (originalLang !== undefined) {
      process.env.LANGUAGE = originalLang;
    } else {
      delete process.env.LANGUAGE;
    }
  });

  test('zh pack has all keys', () => {
    const zh = require('../src/i18n/zh');
    const en = require('../src/i18n/en');
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  test('t() interpolates variables', () => {
    // Force-require fresh module with known language
    jest.resetModules();
    process.env.LANGUAGE = 'en';
    const { t } = require('../src/i18n');
    expect(t('reviewPassed', { branch: 'feat/test' })).toContain('feat/test');
    expect(t('reviewPassed', { branch: 'feat/test' })).toContain('review passed');
  });

  test('t() falls back to English for unknown keys', () => {
    jest.resetModules();
    process.env.LANGUAGE = 'en';
    const { t } = require('../src/i18n');
    expect(t('nonExistentKey')).toBe('nonExistentKey');
  });

  test('zh strings contain Chinese characters', () => {
    const zh = require('../src/i18n/zh');
    // At least some strings should have Chinese
    const hasChinese = Object.values(zh).some(v => /[\u4e00-\u9fff]/.test(v));
    expect(hasChinese).toBe(true);
  });

  test('en strings do not contain Chinese characters', () => {
    const en = require('../src/i18n/en');
    for (const [key, val] of Object.entries(en)) {
      expect(val).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });
});
