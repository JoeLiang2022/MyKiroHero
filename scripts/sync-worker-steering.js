#!/usr/bin/env node
/**
 * Sync Worker Steering Templates (DEPRECATED)
 * 
 * This script is now a thin wrapper around setup-worker.js --update.
 * All sync logic (steering, skills, MCP, env, LESSONS.md preservation)
 * lives in setup-worker.js.
 * 
 * Usage: node scripts/sync-worker-steering.js [WorkerN]
 *   Syncs all Workers found in parent directory, or a specific one.
 * 
 * Equivalent to running:
 *   node scripts/setup-worker.js worker-N <target-dir> --update
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const PARENT_DIR = path.dirname(PROJECT_ROOT);
const SETUP_SCRIPT = path.join(__dirname, 'setup-worker.js');

const args = process.argv.slice(2);
let workerDirs;

if (args[0]) {
  workerDirs = [path.join(PARENT_DIR, args[0])];
} else {
  // Auto-detect Worker directories
  workerDirs = fs.readdirSync(PARENT_DIR)
    .filter(d => /^Worker\d+$/i.test(d))
    .map(d => path.join(PARENT_DIR, d));
}

if (workerDirs.length === 0) {
  console.log('No Worker directories found.');
  process.exit(0);
}

console.log('⚠️  This script is deprecated. Use: node scripts/setup-worker.js <worker-id> --update\n');

let failCount = 0;

for (const workerDir of workerDirs) {
  const workerName = path.basename(workerDir);
  const workerNum = workerName.match(/\d+/)?.[0] || '1';
  const workerId = `worker-${workerNum}`;

  console.log(`🔄 Syncing ${workerName} via setup-worker.js --update ...`);
  try {
    execSync(
      `node "${SETUP_SCRIPT}" ${workerId} "${workerDir}" --update`,
      { stdio: 'inherit', timeout: 30000 }
    );
  } catch (err) {
    failCount++;
    console.error(`❌ Failed to sync ${workerName}: ${err.message}`);
  }
}

if (failCount > 0) {
  console.error(`\n❌ Sync finished with ${failCount} failure(s) out of ${workerDirs.length} worker(s)`);
  process.exit(1);
} else {
  console.log(`\n✅ Sync complete — ${workerDirs.length} worker(s) updated (via setup-worker.js --update)`);
}
