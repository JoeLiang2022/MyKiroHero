/**
 * .env backfill tests
 *
 * Verifies the upgrade --upgrade .env backfill logic:
 * - Adds new variables from .env.example that are missing in .env
 * - Does NOT duplicate variables already present
 * - Preserves existing values
 * - Includes comment context for new variables
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Extract the backfill logic from install.js upgrade() into a testable function.
 * This mirrors the exact algorithm used in Step 4 of upgrade().
 */
function backfillEnv(currentEnvContent, exampleEnvContent) {
  // Parse existing keys (ignore comments and empty lines)
  const existingKeys = new Set();
  for (const line of currentEnvContent.split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match) existingKeys.add(match[1]);
  }

  // Find missing keys from example, preserve their comments
  const missingLines = [];
  const exampleLines = exampleEnvContent.split('\n');
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
    return {
      changed: true,
      appendContent,
      addedKeys: missingLines.filter(l => l.match(/^[A-Z_]/)).map(l => l.match(/^([A-Z_][A-Z0-9_]*)/)[1]),
    };
  }

  return { changed: false, appendContent: '', addedKeys: [] };
}

describe('.env backfill', () => {
  test('adds missing variables from .env.example', () => {
    const currentEnv = [
      'LANGUAGE=zh',
      'GATEWAY_PORT=auto',
    ].join('\n');

    const exampleEnv = [
      'LANGUAGE=en',
      'GATEWAY_PORT=auto',
      '# New feature',
      'NEW_FEATURE=true',
    ].join('\n');

    const result = backfillEnv(currentEnv, exampleEnv);
    expect(result.changed).toBe(true);
    expect(result.addedKeys).toContain('NEW_FEATURE');
  });

  test('does NOT duplicate existing variables', () => {
    const currentEnv = [
      'LANGUAGE=zh',
      'GATEWAY_PORT=3000',
      'AI_PREFIX=▸ *🤖 AI*',
    ].join('\n');

    const exampleEnv = [
      'LANGUAGE=en',
      'GATEWAY_PORT=auto',
      'AI_PREFIX=▸ *🤖 AI Assistant :*',
    ].join('\n');

    const result = backfillEnv(currentEnv, exampleEnv);
    expect(result.changed).toBe(false);
    expect(result.addedKeys).toHaveLength(0);
  });

  test('preserves existing values (does not overwrite)', () => {
    const currentEnv = 'GATEWAY_PORT=3000\nLANGUAGE=zh\n';
    const exampleEnv = 'GATEWAY_PORT=auto\nLANGUAGE=en\nNEW_VAR=hello\n';

    const result = backfillEnv(currentEnv, exampleEnv);
    // Only NEW_VAR should be added
    expect(result.addedKeys).toEqual(['NEW_VAR']);
    // Original content is untouched (backfill only appends)
    expect(result.appendContent).not.toContain('GATEWAY_PORT');
    expect(result.appendContent).not.toContain('LANGUAGE');
  });

  test('includes comment context for new variables', () => {
    const currentEnv = 'LANGUAGE=zh\n';
    const exampleEnv = [
      'LANGUAGE=en',
      '',
      '# Weather settings',
      '# Default location for weather queries',
      'DEFAULT_LOCATION=Taipei',
    ].join('\n');

    const result = backfillEnv(currentEnv, exampleEnv);
    expect(result.changed).toBe(true);
    expect(result.appendContent).toContain('# Weather settings');
    expect(result.appendContent).toContain('DEFAULT_LOCATION=Taipei');
  });

  test('handles multiple new variables', () => {
    const currentEnv = 'LANGUAGE=zh\n';
    const exampleEnv = [
      'LANGUAGE=en',
      'VAR_A=1',
      'VAR_B=2',
      'VAR_C=3',
    ].join('\n');

    const result = backfillEnv(currentEnv, exampleEnv);
    expect(result.addedKeys).toEqual(['VAR_A', 'VAR_B', 'VAR_C']);
  });

  test('handles empty .env (all variables are new)', () => {
    const currentEnv = '';
    const exampleEnv = 'FOO=bar\nBAZ=qux\n';

    const result = backfillEnv(currentEnv, exampleEnv);
    expect(result.changed).toBe(true);
    expect(result.addedKeys).toEqual(['FOO', 'BAZ']);
  });

  test('handles empty .env.example (nothing to add)', () => {
    const currentEnv = 'FOO=bar\n';
    const exampleEnv = '';

    const result = backfillEnv(currentEnv, exampleEnv);
    expect(result.changed).toBe(false);
  });

  test('round-trip: appended content produces valid env file', () => {
    const currentEnv = 'LANGUAGE=zh\nGATEWAY_PORT=3000\n';
    const exampleEnv = [
      'LANGUAGE=en',
      'GATEWAY_PORT=auto',
      '# New section',
      'NEW_VAR=hello',
      'ANOTHER_VAR=world',
    ].join('\n');

    const result = backfillEnv(currentEnv, exampleEnv);
    const finalEnv = currentEnv + result.appendContent;

    // Parse the final env — each key should appear exactly once
    const keys = [];
    for (const line of finalEnv.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (m) keys.push(m[1]);
    }

    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size); // no duplicates
    expect(uniqueKeys).toContain('LANGUAGE');
    expect(uniqueKeys).toContain('GATEWAY_PORT');
    expect(uniqueKeys).toContain('NEW_VAR');
    expect(uniqueKeys).toContain('ANOTHER_VAR');
  });

  test('real .env.example produces correct backfill against minimal .env', () => {
    const examplePath = path.join(__dirname, '..', '.env.example');
    if (!fs.existsSync(examplePath)) return; // skip if not available

    const exampleEnv = fs.readFileSync(examplePath, 'utf-8');
    const minimalEnv = 'LANGUAGE=zh\nGATEWAY_PORT=auto\n';

    const result = backfillEnv(minimalEnv, exampleEnv);
    expect(result.changed).toBe(true);
    // Should add many variables but NOT LANGUAGE or GATEWAY_PORT
    expect(result.addedKeys).not.toContain('LANGUAGE');
    expect(result.addedKeys).not.toContain('GATEWAY_PORT');
    // Should include some known variables from .env.example
    expect(result.addedKeys).toContain('AI_PREFIX');
  });
});
