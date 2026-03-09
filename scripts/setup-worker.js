#!/usr/bin/env node
/**
 * Worker Kiro Installer
 * 
 * 用法: node scripts/setup-worker.js [worker-id] [target-dir] [--update|--sync-only] [--launch]
 * 
 * 範例:
 *   node scripts/setup-worker.js worker-1 C:\Users\norl\Desktop\MyAIHero\Worker1
 *   node scripts/setup-worker.js worker-2   (預設: PROJECT_ROOT 的同層目錄/WorkerN)
 *   node scripts/setup-worker.js worker-3 --update   (更新現有 Worker)
 *   node scripts/setup-worker.js worker-4 --launch   (安裝完自動啟動 Kiro)
 * 
 * Modes:
 *   (default)          — Full install: clone repo, copy templates, npm install
 *   --update/--sync-only — Update existing workspace: sync steering, MCP config, .env, .gateway-port
 * 
 * Flags:
 *   --launch           — 安裝/更新完後自動啟動 Kiro（用 PATH 裡的 kiro 指令）
 * 
 * 做的事 (full install):
 *   1. 建立 target workspace 資料夾
 *   2. Clone MyKiroHero repo 到 workspace/MyKiroHero
 *   3. 複製 Worker steering 模板到 workspace/.kiro/steering/
 *   4. 產生 Worker MCP config (帶 X_WORKER_ID)
 *   5. 複製 .env + .gateway-port（讓 Worker MCP 能連 Gateway）
 *   6. npm install (在 clone 的 repo 裡)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Config ────────────────────────────────────────────────────
const REPO_URL = 'https://github.com/NorlWu-TW/MyKiroHero.git';
const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.join(SCRIPT_DIR, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates', 'worker-steering');

// Files that should NOT be overwritten in update mode (Worker's personal data)
const PRESERVE_FILES = ['LESSONS.md'];

// ─── Args ──────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
const flags = rawArgs.filter(a => a.startsWith('--'));
const positional = rawArgs.filter(a => !a.startsWith('--'));

const isUpdate = flags.includes('--update') || flags.includes('--sync-only');
const shouldLaunch = flags.includes('--launch');
const workerId = positional[0] || 'worker-1';

// Extract number from workerId for default path
const workerNum = workerId.match(/\d+/)?.[0] || '1';
const defaultTarget = path.join(path.dirname(PROJECT_ROOT), `Worker${workerNum}`);
const targetDir = positional[1] || defaultTarget;

console.log(`\n🔧 Worker Kiro ${isUpdate ? 'Updater' : 'Installer'}`);
console.log(`   Worker ID: ${workerId}`);
console.log(`   Target:    ${targetDir}`);
console.log(`   Mode:      ${isUpdate ? 'update (sync-only)' : 'full install'}\n`);

// ─── Preflight ─────────────────────────────────────────────────
if (!fs.existsSync(TEMPLATES_DIR)) {
  console.error(`❌ Worker steering templates not found: ${TEMPLATES_DIR}`);
  console.error(`   Run this script from the MyKiroHero project root.`);
  process.exit(1);
}

const repoDir = path.join(targetDir, 'MyKiroHero');

if (isUpdate) {
  // Update mode: target must exist
  if (!fs.existsSync(targetDir)) {
    console.error(`❌ Target directory does not exist: ${targetDir}`);
    console.error(`   Use without --update for a fresh install.`);
    process.exit(1);
  }
  runUpdate();
} else {
  // Fresh install: target must NOT exist
  if (fs.existsSync(targetDir)) {
    console.error(`❌ Target directory already exists: ${targetDir}`);
    console.error(`   Use --update to sync config, or delete it for a fresh install.`);
    process.exit(1);
  }
  runFullInstall();
}

// ─── Full Install ──────────────────────────────────────────────
function runFullInstall() {
  // Step 1: Create workspace
  console.log(`[1/6] 建立 workspace...`);
  fs.mkdirSync(targetDir, { recursive: true });

  // Step 2: Clone repo
  console.log(`[2/6] Clone repo...`);
  try {
    execSync(`git clone "${REPO_URL}" "${repoDir}"`, { stdio: 'inherit', timeout: 60000 });
  } catch (err) {
    console.error(`❌ Git clone failed: ${err.message}`);
    process.exit(1);
  }

  // Step 3-6: Shared setup
  syncSteering();
  syncSkills();
  syncMcpConfig();
  syncEnvFiles();

  // Step 7: npm install
  console.log(`[6/6] npm install...`);
  try {
    execSync('npm install --omit=dev', { cwd: repoDir, stdio: 'inherit', timeout: 120000 });
  } catch (err) {
    console.warn(`⚠️ npm install 有問題，但不影響基本功能: ${err.message}`);
  }

  printDone();
  if (shouldLaunch) launchKiro();
}

// ─── Update Mode ───────────────────────────────────────────────
function runUpdate() {
  console.log(`[update] 同步 steering + skills + MCP config + env files...\n`);

  const steps = [
    { name: 'steering', fn: syncSteering },
    { name: 'skills', fn: syncSkills },
    { name: 'mcp-config', fn: syncMcpConfig },
    { name: 'env-files', fn: syncEnvFiles },
  ];

  let failCount = 0;
  for (const step of steps) {
    try {
      step.fn();
    } catch (err) {
      failCount++;
      console.error(`❌ [${step.name}] 同步失敗: ${err.message}`);
    }
  }

  if (failCount > 0) {
    console.log(`\n⚠️ Worker "${workerId}" 更新完成，但有 ${failCount} 個步驟失敗（見上方錯誤）\n`);
  } else {
    console.log(`\n✅ Worker "${workerId}" 更新完成！`);
    console.log(`   已同步: steering templates, skills, MCP config, .env, .gateway-port\n`);
  }
  if (shouldLaunch) launchKiro();
}

// ─── Shared: Sync Steering Templates ───────────────────────────
function syncSteering() {
  console.log(`[steering] 複製 Worker steering 模板...`);
  const steeringDir = path.join(targetDir, '.kiro', 'steering');
  fs.mkdirSync(steeringDir, { recursive: true });

  const templateFiles = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md'));
  for (const file of templateFiles) {
    const src = path.join(TEMPLATES_DIR, file);
    const dst = path.join(steeringDir, file);

    // In update mode, preserve Worker's personal files (e.g. LESSONS.md)
    if (isUpdate && PRESERVE_FILES.includes(file) && fs.existsSync(dst)) {
      console.log(`   ⏭️  ${file} (preserved — personal playbook)`);
      continue;
    }

    let content = fs.readFileSync(src, 'utf-8');
    // Replace worker-id placeholder (case-insensitive, handles Worker-1, worker-1, etc.)
    content = content.replace(/worker-\d+/gi, workerId);
    fs.writeFileSync(dst, content, 'utf-8');
    console.log(`   ✓ ${file}`);
  }
}

// ─── Shared: Sync Skills Templates ─────────────────────────────
function syncSkills() {
  const skillsTemplateDir = path.join(PROJECT_ROOT, 'templates', 'skills');
  if (!fs.existsSync(skillsTemplateDir)) {
    console.log(`[skills] No skills templates found, skipping.`);
    return;
  }

  console.log(`[skills] 複製 skills 模板...`);
  const skillsDir = path.join(targetDir, '.kiro', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const skillDirs = fs.readdirSync(skillsTemplateDir, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);

  for (const skillDir of skillDirs) {
    const src = path.join(skillsTemplateDir, skillDir);
    const dst = path.join(skillsDir, skillDir);
    if (!fs.existsSync(dst)) {
      fs.cpSync(src, dst, { recursive: true });
      console.log(`   ✓ ${skillDir}`);
    } else {
      console.log(`   - ${skillDir} (already exists)`);
    }
  }
}

// ─── Shared: Sync MCP Config ───────────────────────────────────
function syncMcpConfig() {
  console.log(`[mcp] 產生 MCP config...`);
  const mcpDir = path.join(targetDir, '.kiro', 'settings');
  fs.mkdirSync(mcpDir, { recursive: true });

  // Use forward slashes in JSON paths (Windows backslash escaping issue)
  const mcpServerPath = path.join(repoDir, 'src', 'mcp-server.js').replace(/\\/g, '/');
  const mcpCwd = repoDir.replace(/\\/g, '/');

  const mcpConfig = {
    mcpServers: {
      "mykiro-gateway": {
        command: "node",
        args: [mcpServerPath],
        cwd: mcpCwd,
        disabled: false,
        autoApprove: ["*"],
        env: {
          X_WORKER_ID: workerId
        }
      }
    }
  };

  fs.writeFileSync(
    path.join(mcpDir, 'mcp.json'),
    JSON.stringify(mcpConfig, null, 2),
    'utf-8'
  );
  console.log(`   ✓ mcp.json (X_WORKER_ID=${workerId})`);
}

// ─── Shared: Sync .env + .gateway-port ─────────────────────────
function syncEnvFiles() {
  console.log(`[env] 複製設定檔...`);

  // .env
  const commanderEnv = path.join(PROJECT_ROOT, '.env');
  const workerEnv = path.join(repoDir, '.env');
  if (fs.existsSync(commanderEnv)) {
    fs.copyFileSync(commanderEnv, workerEnv);
    console.log(`   ✓ .env copied (API keys, config)`);
  } else {
    const exampleEnv = path.join(PROJECT_ROOT, '.env.example');
    if (fs.existsSync(exampleEnv)) {
      fs.copyFileSync(exampleEnv, workerEnv);
      console.log(`   ⚠️ .env.example copied — 需要手動填入 API keys`);
    } else {
      console.warn(`   ⚠️ 找不到 .env，Worker MCP server 可能無法正常啟動`);
    }
  }

  // .gateway-port — handle EPERM gracefully (file may be locked by Gateway process)
  const commanderGwPort = path.join(PROJECT_ROOT, '.gateway-port');
  const workerGwPort = path.join(repoDir, '.gateway-port');
  if (fs.existsSync(commanderGwPort)) {
    try {
      fs.copyFileSync(commanderGwPort, workerGwPort);
      const port = fs.readFileSync(commanderGwPort, 'utf-8').trim();
      console.log(`   ✓ .gateway-port copied (port ${port})`);
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EBUSY') {
        // Fallback: read content and write manually
        try {
          const port = fs.readFileSync(commanderGwPort, 'utf-8');
          fs.writeFileSync(workerGwPort, port, 'utf-8');
          console.log(`   ✓ .gateway-port written via fallback (port ${port.trim()})`);
        } catch (fallbackErr) {
          console.warn(`   ⚠️ .gateway-port 複製失敗 (${fallbackErr.code}): ${fallbackErr.message}`);
        }
      } else {
        console.warn(`   ⚠️ .gateway-port 複製失敗 (${err.code}): ${err.message}`);
      }
    }
  } else {
    console.warn(`   ⚠️ .gateway-port 不存在，Worker 可能找不到 Gateway`);
  }
}

// ─── Launch Kiro ───────────────────────────────────────────────
function launchKiro() {
  console.log(`\n🚀 啟動 Kiro...`);
  try {
    // Use 'kiro' from PATH (kiro.cmd) — never hardcode absolute path
    // On Windows, kiro.cmd needs shell:true to resolve .cmd extension
    // Use execSync with start to avoid DEP0190 warning
    execSync(`start "" kiro --new-window "${targetDir}"`, {
      stdio: 'ignore',
      shell: true,
      windowsHide: true,
    });
    console.log(`   ✓ Kiro launched with workspace: ${targetDir}`);
    console.log(`   Worker 會自動透過 MCP 向 Gateway 註冊`);
  } catch (err) {
    console.error(`   ❌ 啟動失敗: ${err.message}`);
    console.error(`   請手動執行: kiro --new-window "${targetDir}"`);
  }
}

// ─── Done Message ──────────────────────────────────────────────
function printDone() {
  const mcpDir = path.join(targetDir, '.kiro', 'settings');
  console.log(`\n✅ Worker "${workerId}" 安裝完成！\n`);
  console.log(`📂 Workspace: ${targetDir}`);
  console.log(`📦 Repo:      ${repoDir}`);
  console.log(`⚙️  MCP:       ${path.join(mcpDir, 'mcp.json')}`);
  console.log(`\n👉 下一步：用 Kiro 開啟 "${targetDir}" 資料夾`);
  console.log(`   Worker 會自動透過 MCP header 向 Gateway 註冊\n`);
}
