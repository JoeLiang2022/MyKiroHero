/**
 * fs-helpers.js — Shared filesystem utilities
 *
 * Used by: memory-backup.js, memory-restore.js
 * Functions:
 *   - copyDir(src, dest, options) — recursive copy with exclude support
 *   - copyFile(src, dest) — copy single file, auto-create parent dirs
 *   - ensureDirs(...dirs) — create multiple directories if they don't exist
 *
 * Uses fs.cpSync (Node 16.7+) when no excludes are needed for performance.
 * Falls back to manual recursive copy when excludeFiles is specified.
 */

const path = require('path');
const fs = require('fs');

/**
 * Copy directory recursively with optional file exclusion.
 *
 * When excludeFiles is empty, uses fs.cpSync for performance.
 * When excludeFiles has entries, uses manual recursive walk to skip them.
 *
 * @param {string} src - Source directory path
 * @param {string} dest - Destination directory path
 * @param {Object} [options] - Copy options
 * @param {string[]} [options.excludeFiles=[]] - Filenames to skip (exact match, not glob)
 * @returns {boolean} true if source existed and copy was attempted, false if source missing
 */
function copyDir(src, dest, options = {}) {
  const { excludeFiles = [] } = options;

  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });

  if (excludeFiles.length === 0) {
    // Fast path — no exclusions needed
    fs.cpSync(src, dest, { recursive: true });
  } else {
    // Manual walk with exclusion filter
    _copyDirRecursive(src, dest, excludeFiles);
  }
  return true;
}

/**
 * Internal recursive copy with exclude support.
 * @private
 */
function _copyDirRecursive(src, dest, excludeFiles) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludeFiles.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      _copyDirRecursive(srcPath, destPath, excludeFiles);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copy a single file, creating parent directories as needed.
 * @param {string} src - Source file path
 * @param {string} dest - Destination file path
 * @returns {boolean} true if source existed and was copied, false if source missing
 */
function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

/**
 * Ensure multiple directories exist (creates recursively).
 * @param {...string} dirs - Directory paths to create
 */
function ensureDirs(...dirs) {
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { copyDir, copyFile, ensureDirs };
