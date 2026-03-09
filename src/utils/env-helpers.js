/**
 * env-helpers.js — Shared .env file utilities
 *
 * Used by: install.js (backfill), ai-provider-manager.js (writeEnv)
 * Functions:
 *   - readEnvKeys(envPath) — parse .env file, return Set of defined keys
 *   - backfillEnv(envPath, examplePath) — add missing vars from .env.example
 *   - writeEnv(envPath, envObj, keysToDelete) — update/add/remove keys in .env
 */

const fs = require('fs');

/**
 * Parse a .env file and return the set of defined variable keys.
 * Ignores comments and blank lines.
 * @param {string} envPath - Path to .env file
 * @returns {Set<string>} Set of variable names
 */
function readEnvKeys(envPath) {
  const keys = new Set();
  if (!fs.existsSync(envPath)) return keys;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

/**
 * Backfill missing variables from .env.example into .env.
 * Preserves comment context above each variable.
 * @param {string} envPath - Path to .env file
 * @param {string} examplePath - Path to .env.example file
 * @returns {{ added: string[], upToDate: boolean }} List of added key names
 */
function backfillEnv(envPath, examplePath) {
  if (!fs.existsSync(envPath) || !fs.existsSync(examplePath)) {
    return { added: [], upToDate: true };
  }

  const existingKeys = readEnvKeys(envPath);
  const exampleLines = fs.readFileSync(examplePath, 'utf-8').split('\n');

  const missingLines = [];
  let pendingComment = '';

  for (const line of exampleLines) {
    if (line.startsWith('#') || line.trim() === '') {
      pendingComment += line + '\n';
      continue;
    }
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match && !existingKeys.has(match[1])) {
      if (pendingComment.trim()) {
        missingLines.push('');
        missingLines.push(pendingComment.trimEnd());
      }
      missingLines.push(line);
    }
    pendingComment = '';
  }

  if (missingLines.length > 0) {
    const appendContent = '\n# --- Added by upgrade ---\n' + missingLines.join('\n') + '\n';
    fs.appendFileSync(envPath, appendContent);
    const added = missingLines
      .map(l => { const m = l.match(/^([A-Z_][A-Z0-9_]*)=/); return m ? m[1] : null; })
      .filter(Boolean);
    return { added, upToDate: false };
  }

  return { added: [], upToDate: true };
}

/**
 * Write/update key-value pairs in a .env file.
 * Updates existing keys in-place, appends new ones at the end.
 * Optionally deletes specified keys.
 * @param {string} envPath - Path to .env file
 * @param {Object<string, string>} envObj - Key-value pairs to write
 * @param {Set<string>} [keysToDelete] - Keys to remove from the file
 */
function writeEnv(envPath, envObj, keysToDelete = new Set()) {
  if (!fs.existsSync(envPath)) {
    const lines = Object.entries(envObj).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(envPath, lines.join('\n') + '\n');
    return;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
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
    if (keysToDelete.has(key)) continue;
    if (key in envObj) {
      result.push(`${key}=${envObj[key]}`);
      written.add(key);
    } else {
      result.push(line);
    }
  }

  const unwritten = Object.entries(envObj).filter(([k]) => !written.has(k));
  if (unwritten.length > 0) {
    result.push('');
    for (const [k, v] of unwritten) {
      result.push(`${k}=${v}`);
    }
  }

  fs.writeFileSync(envPath, result.join('\n'));
}

module.exports = { readEnvKeys, backfillEnv, writeEnv };
