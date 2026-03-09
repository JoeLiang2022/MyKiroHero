/**
 * git-helpers.js — Shared git utility functions
 *
 * Used by: memory-backup.js, memory-restore.js
 * Functions:
 *   - buildAuthUrl(repoUrl, token) — inject token into HTTPS URL
 *   - gitExec(cmd, cwd, token) — run git command, redact token on error
 *   - safeGitClone(authUrl, dest, cwd, token) — clone with empty-repo fallback
 */

const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Build authenticated HTTPS URL with token.
 * Normalizes the URL: trims trailing slashes, appends .git, ensures https://, injects token.
 * @param {string} repoUrl - GitHub repo URL
 * @param {string} token - GitHub Personal Access Token
 * @returns {string} Authenticated URL
 */
function buildAuthUrl(repoUrl, token) {
  let url = repoUrl.trim().replace(/\/+$/, '');
  if (!url.endsWith('.git')) url += '.git';
  if (!url.startsWith('https://')) {
    url = 'https://' + url.replace(/^http:\/\//, '');
  }
  return url.replace('https://', `https://${token}@`);
}

/**
 * Execute git command safely — hides token from error messages.
 * @param {string} cmd - Git command to execute
 * @param {string} cwd - Working directory
 * @param {string} token - Token to sanitize from error output
 * @returns {string} Command output (trimmed)
 * @throws {Error} With sanitized message on failure
 */
function gitExec(cmd, cwd, token) {
  try {
    return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch (err) {
    const safeMsg = (err.stderr || err.message || '').replace(new RegExp(token, 'g'), '***');
    throw new Error(`Git failed: ${safeMsg}`);
  }
}

/**
 * Clone a repo with fallback for empty repos (clone fails on empty GitHub repos).
 * If clone fails, initializes a new repo with the remote set.
 * @param {string} authUrl - Authenticated repo URL
 * @param {string} dest - Destination directory
 * @param {string} cwd - Working directory for clone command
 * @param {string} token - Token for error redaction
 */
function safeGitClone(authUrl, dest, cwd, token) {
  try {
    gitExec(`git clone "${authUrl}" "${dest}"`, cwd, token);
  } catch (cloneErr) {
    // Empty repo clone fails — init manually
    fs.mkdirSync(dest, { recursive: true });
    gitExec('git init', dest, token);
    gitExec(`git remote add origin "${authUrl}"`, dest, token);
    gitExec('git checkout -b main', dest, token);
  }
}

module.exports = { buildAuthUrl, gitExec, safeGitClone };
