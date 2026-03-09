/**
 * memory-restore.js — Restore soul & memory from GitHub backup
 *
 * DATA FLOW:
 *   1. Clone backup repo to OS temp dir (soul-restore-<timestamp>/)
 *   2. Verify .backup-meta.json exists (validates it's a real backup)
 *   3. Copy data from backup to target locations (sources defined in backup-config.js):
 *      - steering/       → parentDir/.kiro/steering/  (IDE workspace steering)
 *      - knowledge/      → installPath/skills/memory/
 *      - journals/       → installPath/memory/journals/
 *      - sessions/       → installPath/sessions/
 *   4. Rebuild SQLite index from restored JSONL session files:
 *      a. initDatabase(installPath/data/memory.db) — creates schema
 *      b. rebuildAll(sessionsDir) — parses all JSONL, builds FTS5 index
 *         NOTE: rebuildAll clears the summaries table as part of full rebuild
 *      c. closeDatabase() — releases the connection
 *   5. Import summaries from summaries.json into SQLite (opens new connection)
 *      This MUST happen after rebuildAll since rebuildAll wipes the summaries table
 *   6. Clean up temp dir
 *
 * Path resolution:
 *   installPath = MyKiroHero repo root (passed as parameter)
 *   parentDir   = path.dirname(installPath) → workspace root
 *   Steering restored to parentDir/.kiro/steering/
 *
 * Error handling:
 *   - Missing repoUrl or token → returns { success: false, reason: 'not_configured' }
 *   - Git auth failure → caught, returns { success: false, reason: 'error' }
 *   - Empty/invalid repo → checks .backup-meta.json, returns { success: false, reason: 'empty_repo' }
 *   - Index rebuild failure → logs error, files still restored, user can rebuild manually
 *   - Temp dir always cleaned up (in finally-equivalent pattern)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { buildAuthUrl, gitExec } = require('./utils/git-helpers');
const { copyDir } = require('./utils/fs-helpers');
const { getDataSources, getDbPath, validateSourcePaths } = require('./utils/backup-config');

/**
 * Import summaries from JSON into SQLite.
 * Should be called AFTER rebuildAll so the summaries table exists.
 */
function importSummaries(summariesPath, dbPath) {
  try {
    if (!fs.existsSync(summariesPath)) {
      console.log('[SoulRestore] No summaries.json found, skipping import');
      return 0;
    }

    const summaries = JSON.parse(fs.readFileSync(summariesPath, 'utf-8'));
    if (!summaries.length) return 0;

    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    const insert = db.prepare(
      'INSERT OR REPLACE INTO summaries (session_id, summary, created_at) VALUES (?, ?, ?)'
    );

    const importAll = db.transaction((rows) => {
      for (const row of rows) {
        insert.run(row.session_id, row.summary, row.created_at);
      }
    });

    importAll(summaries);
    db.close();

    console.log(`[SoulRestore] Imported ${summaries.length} summaries`);
    return summaries.length;
  } catch (err) {
    console.error(`[SoulRestore] Failed to import summaries: ${err.message}`);
    return 0;
  }
}

/**
 * Main restore function
 * @param {string} repoUrl - GitHub repo URL
 * @param {string} token - GitHub Personal Access Token
 * @param {string} installPath - MyKiroHero install path
 */
async function restore(repoUrl, token, installPath) {
  if (!repoUrl || !token) {
    console.log('[SoulRestore] Skipped: missing repo URL or token');
    return { success: false, reason: 'not_configured' };
  }

  const authUrl = buildAuthUrl(repoUrl, token);
  const tempDir = path.join(os.tmpdir(), `soul-restore-${Date.now()}`);
  const sources = getDataSources(installPath);
  const dbPath = getDbPath(installPath);

  // Validate target paths match current architecture
  const { missing } = validateSourcePaths(installPath);
  if (missing.length > 0) {
    const names = missing.map(s => s.key).join(', ');
    console.log(`[SoulRestore] Note: some target paths don't exist yet (will be created): ${names}`);
  }

  console.log('[SoulRestore] Starting restore...');

  try {
    // 1. Clone repo to temp dir
    gitExec(`git clone "${authUrl}" "${tempDir}"`, os.tmpdir(), token);

    // 2. Check for backup data
    const metaPath = path.join(tempDir, '.backup-meta.json');
    if (!fs.existsSync(metaPath)) {
      console.log('[SoulRestore] ⚠ No backup data in repo');
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { success: false, reason: 'empty_repo' };
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    console.log(`[SoulRestore] Found backup: ${meta.lastBackup} (v${meta.version || '1.0.0'})`);

    // 3. Copy all data sources from backup to target locations
    let restored = 0;
    for (const source of sources) {
      const backupPath = path.join(tempDir, source.key);
      // Restore always overwrites — no excludeFiles needed
      if (copyDir(backupPath, source.localPath)) {
        console.log(`[SoulRestore]   ✓ ${source.key}`);
        restored++;
      }
    }

    // 4. Rebuild SQLite index from JSONL files
    let rebuildResult = null;
    let summariesImported = 0;
    try {
      const { initDatabase, closeDatabase } = require('./memory/database');
      const { rebuildAll } = require('./memory/indexer');

      initDatabase(dbPath);

      const sessionsDir = path.join(installPath, 'sessions');
      rebuildResult = rebuildAll(sessionsDir);
      console.log(`[SoulRestore]   ✓ rebuilt index: ${rebuildResult.totalIndexed} sessions`);

      closeDatabase();

      // 5. Import summaries AFTER rebuild
      const summariesSrc = path.join(tempDir, 'summaries.json');
      summariesImported = importSummaries(summariesSrc, dbPath);

      restored++;
    } catch (rebuildErr) {
      console.error(`[SoulRestore] Index rebuild failed: ${rebuildErr.message}`);
      console.log('[SoulRestore] Files restored, but index needs manual rebuild');
    }

    // 6. Cleanup temp dir
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(`[SoulRestore] ✅ Restore complete (${restored} sources)`);
    return {
      success: true,
      restored,
      lastBackup: meta.lastBackup,
      rebuildResult,
      summariesImported,
    };

  } catch (err) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    console.error(`[SoulRestore] ❌ Restore failed: ${err.message}`);
    return { success: false, reason: 'error', error: err.message };
  }
}

module.exports = { restore, buildAuthUrl, importSummaries };
