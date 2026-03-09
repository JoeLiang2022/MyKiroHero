/**
 * memory-backup.js — Soul & Memory backup to GitHub
 *
 * DATA FLOW:
 *   1. Read config: MEMORY_REPO (GitHub URL) + GITHUB_TOKEN from env
 *   2. Clone or pull the backup repo into PROJECT_ROOT/.soul-backup/
 *   3. Copy source data into the backup repo working tree (sources defined in backup-config.js):
 *      - steering/       ← parentDir/.kiro/steering/ (excludes ONBOARDING.md)
 *      - knowledge/      ← PROJECT_ROOT/skills/memory/
 *      - journals/       ← PROJECT_ROOT/memory/journals/
 *      - sessions/       ← PROJECT_ROOT/sessions/
 *   4. Export summaries from SQLite (data/memory.db) → summaries.json
 *   5. Write .backup-meta.json with timestamp and stats
 *   6. git add + commit + push to origin/main
 *
 * Path resolution:
 *   PROJECT_ROOT = path.join(__dirname, '..') → repo root (e.g. /home/user/MyKiroHero)
 *   parentDir    = path.dirname(PROJECT_ROOT) → workspace root (e.g. /home/user)
 *   Steering lives at parentDir/.kiro/steering/ (the IDE workspace steering dir)
 *
 * NOT backed up (by design — these are code/config, tracked in main repo):
 *   - skills/codebase/, skills/tools/, skills/url-handlers/ (SKILL definitions)
 *   - templates/ (scaffolding templates)
 *   - ai-providers.json (provider config — contains no secrets, tracked in git)
 *
 * Error handling:
 *   - Missing MEMORY_REPO or GITHUB_TOKEN → returns { success: false, reason: 'not_configured' }
 *   - Git auth failure (expired token) → caught, returns { success: false, reason: 'error' }
 *   - Empty repo (first backup) → handles clone failure, inits manually
 *   - No changes → skips commit, returns { success: true, reason: 'no_changes' }
 *   - Disk/IO errors → caught by outer try/catch
 */

const path = require('path');
const fs = require('fs');

const { buildAuthUrl, gitExec, safeGitClone } = require('./utils/git-helpers');
const { copyDir } = require('./utils/fs-helpers');
const { PROJECT_ROOT, getDataSources, getDbPath, validateSourcePaths } = require('./utils/backup-config');

/**
 * Export summaries from SQLite to JSON
 * Performs WAL checkpoint first to ensure all data is flushed
 */
function exportSummaries(dbPath) {
  try {
    const Database = require('better-sqlite3');
    if (!fs.existsSync(dbPath)) return [];

    const db = new Database(dbPath, { readonly: false });

    // Checkpoint WAL — flush all pending writes to main db file
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.log(`[SoulBackup] WAL checkpoint warning: ${e.message}`);
    }

    // Export all summaries
    const rows = db.prepare('SELECT session_id, summary, created_at FROM summaries').all();
    db.close();

    console.log(`[SoulBackup] Exported ${rows.length} summaries`);
    return rows;
  } catch (err) {
    console.error(`[SoulBackup] Failed to export summaries: ${err.message}`);
    return [];
  }
}

/**
 * Main backup function
 */
async function backup() {
  const repoUrl = process.env.MEMORY_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!repoUrl || !token) {
    console.log('[SoulBackup] Skipped: MEMORY_REPO or GITHUB_TOKEN not set');
    return { success: false, reason: 'not_configured' };
  }

  const authUrl = buildAuthUrl(repoUrl, token);
  const backupDir = path.join(PROJECT_ROOT, '.soul-backup');
  const sources = getDataSources();
  const dbPath = getDbPath();

  // Validate source paths match current architecture
  const { missing } = validateSourcePaths();
  if (missing.length > 0) {
    const names = missing.map(s => s.key).join(', ');
    console.log(`[SoulBackup] Warning: missing source paths: ${names}`);
  }

  console.log('[SoulBackup] Starting backup...');

  try {
    // 1. Ensure local repo exists
    if (!fs.existsSync(path.join(backupDir, '.git'))) {
      console.log('[SoulBackup] First backup, initializing repo...');
      safeGitClone(authUrl, backupDir, PROJECT_ROOT, token);
    } else {
      try {
        gitExec('git pull origin main --rebase', backupDir, token);
      } catch (pullErr) {
        console.log('[SoulBackup] Pull failed (maybe first time), continuing...');
      }
    }

    // 2. Set git user
    try {
      gitExec('git config user.email "soul-backup@mykiro.local"', backupDir, token);
      gitExec('git config user.name "SoulBackup"', backupDir, token);
    } catch (e) { /* ignore */ }

    // 3. Copy all data sources to backup repo
    let copied = 0;
    for (const source of sources) {
      const destPath = path.join(backupDir, source.key);
      const result = copyDir(source.localPath, destPath, {
        excludeFiles: source.excludeFiles || [],
      });
      if (result) copied++;
    }

    // 4. Export summaries as JSON (instead of copying .db)
    const summaries = exportSummaries(dbPath);
    const summariesPath = path.join(backupDir, 'summaries.json');
    fs.writeFileSync(summariesPath, JSON.stringify(summaries, null, 2));
    copied++;

    console.log(`[SoulBackup] Copied ${copied} sources`);

    // 5. Write meta
    const meta = {
      lastBackup: new Date().toISOString(),
      source: 'MyKiroHero',
      version: '2.0.0',
      platform: process.platform,
      summaryCount: summaries.length,
    };
    fs.writeFileSync(path.join(backupDir, '.backup-meta.json'), JSON.stringify(meta, null, 2));

    // 6. git add + commit + push
    gitExec('git add -A', backupDir, token);

    const status = gitExec('git status --porcelain', backupDir, token);
    if (!status) {
      console.log('[SoulBackup] No changes, skipping commit');
      return { success: true, reason: 'no_changes' };
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    gitExec(`git commit -m "Soul backup ${now}"`, backupDir, token);
    gitExec('git push -u origin main', backupDir, token);

    console.log('[SoulBackup] ✅ Backup complete');
    return { success: true, reason: 'backed_up', summaryCount: summaries.length };

  } catch (err) {
    console.error(`[SoulBackup] ❌ Backup failed: ${err.message}`);
    return { success: false, reason: 'error', error: err.message };
  }
}

module.exports = { backup, buildAuthUrl };
