/**
 * lint-test.js — Layer 1 Handler: Run ESLint and/or npm test
 * 
 * Zero-token task — runs locally, no AI provider needed.
 * 
 * Params:
 *   cwd (required) — project directory path
 *   scope (optional) — 'lint' | 'test' | 'both' (default: 'both')
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_OUTPUT = 1000;

function truncate(str) {
  if (!str || str.length <= MAX_OUTPUT) return str || '';
  return str.slice(0, MAX_OUTPUT) + '... (truncated)';
}

function runLint(cwd) {
  try {
    const output = execSync('npx eslint . --max-warnings=0 --quiet', {
      cwd,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: 'pipe',
    });
    return { status: 'passed', output: truncate(output) };
  } catch (err) {
    // Exit code 1 = lint errors, other codes = eslint not found / config issue
    const stderr = truncate(err.stderr || '');
    const stdout = truncate(err.stdout || '');
    // Check if eslint is not installed / not found
    if (stderr.includes('not found') || stderr.includes('Cannot find module') || stderr.includes('ENOENT')) {
      return { status: 'skipped', output: 'ESLint not found or not installed' };
    }
    return { status: 'failed', output: stdout || stderr || err.message };
  }
}

function runTest(cwd) {
  // Check package.json for test script
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { status: 'skipped', output: 'No package.json found' };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return { status: 'skipped', output: 'Failed to parse package.json' };
  }

  const testScript = pkg.scripts && pkg.scripts.test;
  if (!testScript || testScript.includes('no test specified')) {
    return { status: 'skipped', output: 'No test script defined' };
  }

  try {
    const output = execSync('npm test', {
      cwd,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: 'pipe',
    });
    return { status: 'passed', output: truncate(output) };
  } catch (err) {
    const stderr = truncate(err.stderr || '');
    const stdout = truncate(err.stdout || '');
    return { status: 'failed', output: stdout || stderr || err.message };
  }
}

module.exports = {
  name: 'lint-test',
  description: 'Run ESLint and/or npm test (zero token)',
  type: 'layer1',

  /**
   * @param {Object} params
   * @param {string} params.cwd - Project directory path.
   *   SECURITY: cwd must come from trusted internal sources only (Commander/Gateway).
   *   Never pass user-supplied paths directly without validation.
   * @param {string} [params.scope='both'] - 'lint' | 'test' | 'both'
   */
  execute: (params) => {
    const { cwd, scope = 'both' } = params;
    if (!cwd) throw new Error('Missing required param: cwd');

    const results = [];
    let allSuccess = true;

    if (scope === 'lint' || scope === 'both') {
      const lint = runLint(cwd);
      results.push(`Lint: ${lint.status}${lint.output ? ' — ' + lint.output : ''}`);
      if (lint.status === 'failed') allSuccess = false;
    }

    if (scope === 'test' || scope === 'both') {
      const test = runTest(cwd);
      results.push(`Test: ${test.status}${test.output ? ' — ' + test.output : ''}`);
      if (test.status === 'failed') allSuccess = false;
    }

    return {
      success: allSuccess,
      message: results.join('\n'),
      outputPath: null,
    };
  },
};
