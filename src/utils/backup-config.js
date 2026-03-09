/**
 * backup-config.js — Shared source path configuration for memory backup/restore
 *
 * Single source of truth for which data sources are backed up and where they live.
 * Both memory-backup.js and memory-restore.js use this to ensure consistency.
 *
 * Architecture:
 *   PROJECT_ROOT = MyKiroHero repo root (e.g. C:\Users\user\MyKiroHero)
 *   parentDir    = path.dirname(PROJECT_ROOT) → workspace root
 *   Steering lives at parentDir/.kiro/steering/ (IDE workspace steering dir)
 *   Knowledge lives at PROJECT_ROOT/skills/memory/
 *   Journals live at PROJECT_ROOT/memory/journals/
 *   Sessions live at PROJECT_ROOT/sessions/
 *   SQLite DB at PROJECT_ROOT/data/memory.db
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

/**
 * Data source descriptor.
 * @typedef {Object} DataSource
 * @property {string} key - Identifier used as backup subdirectory name
 * @property {string} localPath - Absolute path to the source on disk
 * @property {string[]} [excludeFiles] - Files to skip during backup (exact name match)
 * @property {boolean} [isFile] - true if this is a single file, not a directory
 */

/**
 * Get all data source paths for backup/restore.
 * Both backup and restore use this to ensure they handle the same set of sources.
 *
 * @param {string} [projectRoot] - Override project root (used by restore which receives installPath)
 * @returns {DataSource[]} Array of data source descriptors
 */
function getDataSources(projectRoot = PROJECT_ROOT) {
  const parentDir = path.dirname(projectRoot);
  return [
    {
      key: 'steering',
      localPath: path.join(parentDir, '.kiro', 'steering'),
      excludeFiles: ['ONBOARDING.md'],
    },
    {
      key: 'knowledge',
      localPath: path.join(projectRoot, 'skills', 'memory'),
    },
    {
      key: 'journals',
      localPath: path.join(projectRoot, 'memory', 'journals'),
    },
    {
      key: 'sessions',
      localPath: path.join(projectRoot, 'sessions'),
    },
  ];
}

/**
 * Get the SQLite database path.
 * @param {string} [projectRoot] - Override project root
 * @returns {string} Absolute path to memory.db
 */
function getDbPath(projectRoot = PROJECT_ROOT) {
  return path.join(projectRoot, 'data', 'memory.db');
}

/**
 * Validate that backup source paths match the current architecture.
 * Checks each source path exists and logs warnings for missing ones.
 *
 * @param {string} [projectRoot] - Override project root
 * @returns {{ valid: DataSource[], missing: DataSource[] }}
 */
function validateSourcePaths(projectRoot = PROJECT_ROOT) {
  const sources = getDataSources(projectRoot);
  const valid = [];
  const missing = [];

  for (const source of sources) {
    if (fs.existsSync(source.localPath)) {
      valid.push(source);
    } else {
      missing.push(source);
    }
  }

  return { valid, missing };
}

module.exports = {
  PROJECT_ROOT,
  getDataSources,
  getDbPath,
  validateSourcePaths,
};
