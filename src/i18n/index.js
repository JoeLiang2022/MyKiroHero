/**
 * i18n — lightweight internationalization
 *
 * Usage:
 *   const { t } = require('../i18n');
 *   t('reviewPassed', { branch: 'feat/foo' })
 *   // → "Worker 任務 review 通過：feat/foo，等待 Commander 決定是否 merge"
 */

const zh = require('./zh');
const en = require('./en');

const packs = { zh, en };

// Resolve once at startup from config (avoids circular require with config.js)
const lang = process.env.LANGUAGE || 'en';
const strings = packs[lang] || packs.en;

/**
 * Translate a key with optional interpolation.
 * @param {string} key - message key from language pack
 * @param {Record<string, string|number>} [vars] - interpolation variables
 * @returns {string} translated string (falls back to English, then raw key)
 */
function t(key, vars) {
  let msg = strings[key] || packs.en[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return msg;
}

module.exports = { t, lang, strings };
