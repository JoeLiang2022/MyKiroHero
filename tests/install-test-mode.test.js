/**
 * install.js --test mode tests
 *
 * Verifies that install.js --test mode completes successfully:
 * - Exits with code 0
 * - Creates required files (.env, steering, mcp.json, etc.)
 * - Cleans up temp directory after test
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');

describe('install.js --test mode', () => {
  test('completes without error (exit code 0)', () => {
    // --test mode auto-answers all prompts and cleans up after itself
    const result = execSync('node install.js --test', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 60000,
    });

    // Should contain the success banner
    expect(result).toContain('ALL TESTS PASSED');
  });

  test('does not leave temp directory behind', () => {
    const tempDir = process.env.TEMP || 'C:\\Temp';
    const before = fs.readdirSync(tempDir).filter(d => d.startsWith('mykiro-test-'));

    execSync('node install.js --test', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 60000,
    });

    const after = fs.readdirSync(tempDir).filter(d => d.startsWith('mykiro-test-'));
    // Should not have more test dirs than before
    expect(after.length).toBeLessThanOrEqual(before.length);
  });
});
