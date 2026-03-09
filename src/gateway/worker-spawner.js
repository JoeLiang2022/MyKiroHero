/**
 * worker-spawner.js — Auto-spawn Kiro Worker instances
 * 
 * Checks system resources, finds available Worker folders,
 * and launches new Kiro windows when needed.
 * 
 * Resource limits:
 *   - Each Kiro window ≈ 2.7GB RAM
 *   - MIN_FREE_RAM_GB: keep at least this much free after spawning
 *   - MAX_WORKERS: hard cap on total workers
 *   - SPAWN_COOLDOWN_MS: prevent rapid-fire spawning
 */

const { exec, execSync } = require('child_process');
const path = require('path');
const { t } = require('../i18n');
const fs = require('fs');
const os = require('os');

// ─── Config ───────────────────────────────────────────
const KIRO_RAM_PER_INSTANCE_GB = 2.7;
const MIN_FREE_RAM_GB = 6;       // always keep 6GB free for OS + other apps
const MAX_WORKERS = 2;            // hard cap (RAM check in getCapacity() is the real limiter)
const SPAWN_COOLDOWN_MS = 60000;  // 1 min between spawns
const WORKER_READY_TIMEOUT_MS = 90000; // wait up to 90s for worker to register

// ─── State ────────────────────────────────────────────
let _lastSpawnTime = 0;
let _spawning = false; // prevent concurrent spawns

class WorkerSpawner {
  constructor(workerRegistry, projectRoot) {
    this.registry = workerRegistry;
    this.projectRoot = projectRoot; // e.g. C:\Users\norl\Desktop\MyAIHero\MyKiroHero
    this.parentDir = path.dirname(projectRoot); // e.g. C:\Users\norl\Desktop\MyAIHero
  }

  /**
   * Get system resource info
   */
  getSystemResources() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpuCount = os.cpus().length;
    return {
      totalGB: +(totalMem / (1024 ** 3)).toFixed(1),
      freeGB: +(freeMem / (1024 ** 3)).toFixed(1),
      cpuCount,
    };
  }

  /**
   * Find all Worker folders (Worker1, Worker2, Worker3...)
   * Returns both ready folders (have mcp.json) and provisionable slots.
   */
  getWorkerFolders() {
    const folders = [];
    try {
      const entries = fs.readdirSync(this.parentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /^Worker\d+$/.test(entry.name)) {
          const num = parseInt(entry.name.replace('Worker', ''));
          const fullPath = path.join(this.parentDir, entry.name);
          const mcpConfig = path.join(fullPath, '.kiro', 'settings', 'mcp.json');
          if (fs.existsSync(mcpConfig)) {
            const valid = this._validateMcpConfig(mcpConfig, `worker-${num}`);
            if (!valid) {
              console.warn(`[WorkerSpawner] ${entry.name} mcp.json is stale/invalid — will re-provision`);
            }
            folders.push({ name: entry.name, num, path: fullPath, ready: valid });
          }
        }
      }
    } catch (e) {
      console.error(`[WorkerSpawner] Error scanning worker folders: ${e.message}`);
    }
    return folders.sort((a, b) => a.num - b.num);
  }

  /**
   * Get available Worker slots (1..MAX_WORKERS) that can be provisioned.
   * Returns slots that don't have a ready folder, or have a stale/invalid config.
   */
  getProvisionableSlots() {
    const readyNums = this.getWorkerFolders().filter(f => f.ready).map(f => f.num);
    const slots = [];
    for (let i = 1; i <= MAX_WORKERS; i++) {
      if (!readyNums.includes(i)) {
        slots.push({ name: `Worker${i}`, num: i, path: path.join(this.parentDir, `Worker${i}`) });
      }
    }
    return slots;
  }

  /**
   * Get git remote URL from Commander's repo
   */
  _getGitRemoteUrl() {
    try {
      return execSync('git remote get-url origin', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch (e) {
      console.error(`[WorkerSpawner] Failed to get git remote URL: ${e.message}`);
      return null;
    }
  }

  /**
   * Provision a new Worker folder: mkdir + git clone + setup configs
   * @param {number} workerNum - Worker number (1, 2, 3...)
   * @returns {string|null} - Worker folder path if successful, null if failed
   */
  provisionWorkerFolder(workerNum) {
    const workerName = `Worker${workerNum}`;
    const workerParent = path.join(this.parentDir, workerName);
    const workerRepo = path.join(workerParent, 'MyKiroHero');
    const workerId = `worker-${workerNum}`;

    console.log(`[WorkerSpawner] Provisioning ${workerName}...`);

    try {
      // 1. Create parent folder
      if (!fs.existsSync(workerParent)) {
        fs.mkdirSync(workerParent, { recursive: true });
        console.log(`[WorkerSpawner]   Created ${workerParent}`);
      }

      // 2. Git clone or recover existing repo
      const gitDir = path.join(workerRepo, '.git');
      let hasGitDir = false;
      try { hasGitDir = fs.existsSync(gitDir); } catch { hasGitDir = false; }
      const hasPkg = fs.existsSync(path.join(workerRepo, 'package.json'));

      if (hasGitDir && !hasPkg) {
        // Partial clone — try cleanup, fallback to fetch+reset
        console.log(`[WorkerSpawner]   Partial clone detected, cleaning up...`);
        try {
          fs.rmSync(workerRepo, { recursive: true, force: true });
          hasGitDir = false;
        } catch (cleanErr) {
          console.warn(`[WorkerSpawner]   rmSync failed: ${cleanErr.message}, trying git fetch+reset...`);
          try {
            execSync('git fetch origin main', { cwd: workerRepo, encoding: 'utf-8', timeout: 60000, stdio: 'pipe' });
            execSync('git reset --hard origin/main', { cwd: workerRepo, encoding: 'utf-8', timeout: 30000, stdio: 'pipe' });
            execSync('git clean -fd', { cwd: workerRepo, encoding: 'utf-8', timeout: 30000, stdio: 'pipe' });
            hasGitDir = true;
            console.log(`[WorkerSpawner]   Recovered via git fetch+reset`);
          } catch (gitErr) {
            console.error(`[WorkerSpawner]   Cannot recover: ${gitErr.message}`);
            throw new Error(`Cannot clean partial clone at ${workerRepo}`);
          }
        }
      }

      // Folder exists but .git inaccessible — try fetch+reset before re-clone
      if (!hasGitDir && fs.existsSync(workerRepo)) {
        try {
          execSync('git fetch origin main', { cwd: workerRepo, encoding: 'utf-8', timeout: 60000, stdio: 'pipe' });
          execSync('git reset --hard origin/main', { cwd: workerRepo, encoding: 'utf-8', timeout: 30000, stdio: 'pipe' });
          execSync('git clean -fd', { cwd: workerRepo, encoding: 'utf-8', timeout: 30000, stdio: 'pipe' });
          hasGitDir = true;
          console.log(`[WorkerSpawner]   Recovered existing repo via git fetch+reset`);
        } catch {
          console.log(`[WorkerSpawner]   Existing folder unusable, removing...`);
          try { fs.rmSync(workerRepo, { recursive: true, force: true }); } catch {
            try { execSync(`cmd /c "rmdir /s /q "${workerRepo}""`, { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' }); } catch {
              throw new Error(`Cannot remove locked folder at ${workerRepo}`);
            }
          }
        }
      }

      if (!hasGitDir) {
        const remoteUrl = this._getGitRemoteUrl();
        if (!remoteUrl) throw new Error('Cannot determine git remote URL');
        console.log(`[WorkerSpawner]   Cloning ${remoteUrl}...`);
        execSync(`git clone "${remoteUrl}" MyKiroHero`, {
          cwd: workerParent,
          encoding: 'utf-8',
          timeout: 120000,
          stdio: 'pipe',
        });
        console.log(`[WorkerSpawner]   Clone complete`);
      }

      // 3. npm install
      if (!fs.existsSync(path.join(workerRepo, 'node_modules'))) {
        console.log(`[WorkerSpawner]   Running npm install...`);
        execSync('npm install --production', {
          cwd: workerRepo,
          encoding: 'utf-8',
          timeout: 120000,
          stdio: 'pipe',
        });
        console.log(`[WorkerSpawner]   npm install complete`);
      }

      // 4. Setup .kiro/settings/mcp.json from template
      const mcpDir = path.join(workerParent, '.kiro', 'settings');
      if (!fs.existsSync(mcpDir)) {
        fs.mkdirSync(mcpDir, { recursive: true });
      }
      const mcpTemplate = path.join(this.projectRoot, 'templates', 'worker-mcp-config.json');
      if (fs.existsSync(mcpTemplate)) {
        let mcpContent = fs.readFileSync(mcpTemplate, 'utf-8');
        mcpContent = mcpContent.replace(/\$\{REPO_PATH\}/g, workerRepo.replace(/\\/g, '/'));
        mcpContent = mcpContent.replace(/\$\{WORKER_ID\}/g, workerId);
        mcpContent = mcpContent.replace(/\$\{WORKER_PORT\}/g, '0'); // auto-detect
        fs.writeFileSync(path.join(mcpDir, 'mcp.json'), mcpContent, 'utf-8');
        console.log(`[WorkerSpawner]   MCP config written`);
      }

      // 5. Setup .kiro/steering/ from worker-steering templates
      // Files that should NOT be overwritten (Worker's personal data)
      const PRESERVE_FILES = ['LESSONS.md'];
      const steeringDir = path.join(workerParent, '.kiro', 'steering');
      if (!fs.existsSync(steeringDir)) {
        fs.mkdirSync(steeringDir, { recursive: true });
      }
      const steeringTemplateDir = path.join(this.projectRoot, 'templates', 'worker-steering');
      if (fs.existsSync(steeringTemplateDir)) {
        const files = fs.readdirSync(steeringTemplateDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          // Skip preserved files if they already exist in the target
          if (PRESERVE_FILES.includes(file) && fs.existsSync(path.join(steeringDir, file))) {
            console.log(`[WorkerSpawner]   ⏭️  ${file} (preserved)`);
            continue;
          }
          let content = fs.readFileSync(path.join(steeringTemplateDir, file), 'utf-8');
          content = content.replace(/worker-\d+/gi, workerId);
          fs.writeFileSync(path.join(steeringDir, file), content, 'utf-8');
        }
        console.log(`[WorkerSpawner]   Steering files written (${files.length} files)`);
      }

      // 6. Copy .kiro/skills/ from templates
      const skillsTemplateDir = path.join(this.projectRoot, 'templates', 'skills');
      const skillsDir = path.join(workerParent, '.kiro', 'skills');
      if (fs.existsSync(skillsTemplateDir)) {
        this._copyDirRecursive(skillsTemplateDir, skillsDir);
        console.log(`[WorkerSpawner]   Skills copied`);
      }

      // 7. Copy .env and .gateway-port to Worker repo
      const commanderEnv = path.join(this.projectRoot, '.env');
      const workerEnv = path.join(workerRepo, '.env');
      if (fs.existsSync(commanderEnv)) {
        fs.copyFileSync(commanderEnv, workerEnv);
        console.log(`[WorkerSpawner]   .env copied`);
      } else {
        const exampleEnv = path.join(this.projectRoot, '.env.example');
        if (fs.existsSync(exampleEnv)) {
          fs.copyFileSync(exampleEnv, workerEnv);
          console.log(`[WorkerSpawner]   .env.example copied (needs API keys)`);
        }
      }

      const commanderGwPort = path.join(this.projectRoot, '.gateway-port');
      const workerGwPort = path.join(workerRepo, '.gateway-port');
      if (fs.existsSync(commanderGwPort)) {
        try {
          fs.copyFileSync(commanderGwPort, workerGwPort);
          console.log(`[WorkerSpawner]   .gateway-port copied`);
        } catch (err) {
          if (err.code === 'EPERM' || err.code === 'EBUSY') {
            try {
              const port = fs.readFileSync(commanderGwPort, 'utf-8');
              fs.writeFileSync(workerGwPort, port, 'utf-8');
              console.log(`[WorkerSpawner]   .gateway-port written via fallback`);
            } catch (fallbackErr) {
              console.warn(`[WorkerSpawner]   .gateway-port copy failed: ${fallbackErr.message}`);
            }
          } else {
            console.warn(`[WorkerSpawner]   .gateway-port copy failed: ${err.message}`);
          }
        }
      }

      console.log(`[WorkerSpawner] ✓ ${workerName} provisioned at ${workerParent}`);
      return workerParent;
    } catch (err) {
      console.error(`[WorkerSpawner] Provision failed for ${workerName}: ${err.message}`);
      return null;
    }
  }

  /**
   * Validate mcp.json content — check X_WORKER_ID env matches expected workerId
   */
  _validateMcpConfig(mcpPath, expectedWorkerId) {
    try {
      const raw = fs.readFileSync(mcpPath, 'utf-8');
      const config = JSON.parse(raw);
      const server = config?.mcpServers?.['mykiro-gateway'];
      if (!server) return false;
      const envWorkerId = server?.env?.X_WORKER_ID;
      if (!envWorkerId || envWorkerId !== expectedWorkerId) return false;
      return true;
    } catch (e) {
      console.error(`[WorkerSpawner] Failed to validate ${mcpPath}: ${e.message}`);
      return false;
    }
  }

  /**
   * Recursively copy a directory
   */
  _copyDirRecursive(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this._copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Get currently registered worker IDs from registry
   */
  getRegisteredWorkerIds() {
    const workers = this.registry.list();
    return workers
      .filter(w => w.status !== 'offline')
      .map(w => w.workerId);
  }

  /**
   * Calculate how many workers we can spawn
   */
  /**
     * Calculate how many workers we can spawn
     */
    getCapacity() {
      const resources = this.getSystemResources();
      const registeredIds = this.getRegisteredWorkerIds();
      const readyFolders = this.getWorkerFolders();
      const provisionableSlots = this.getProvisionableSlots();

      // Ready folders that aren't registered (can spawn immediately)
      const readyToSpawn = readyFolders.filter(f => {
        const workerId = `worker-${f.num}`;
        return f.ready && !registeredIds.includes(workerId);
      });

      // Provisionable slots that aren't registered
      const availableProvisionable = provisionableSlots.filter(s => {
        const workerId = `worker-${s.num}`;
        return !registeredIds.includes(workerId);
      });

      // Combined = ready + provisionable (both filtered)
      const allAvailable = [...readyToSpawn, ...availableProvisionable];

      // RAM check: how many more can we fit?
      const ramForNewWorkers = resources.freeGB - MIN_FREE_RAM_GB;
      const maxByRam = Math.max(0, Math.floor(ramForNewWorkers / KIRO_RAM_PER_INSTANCE_GB));

      // Hard cap check
      const maxByHardCap = Math.max(0, MAX_WORKERS - registeredIds.length);

      const canSpawn = Math.min(maxByRam, maxByHardCap, allAvailable.length);

      return {
        resources,
        registeredCount: registeredIds.length,
        registeredIds,
        availableFolders: allAvailable,
        readyFolders: readyToSpawn,
        provisionableSlots: availableProvisionable,
        maxByRam,
        maxByHardCap,
        canSpawn,
      };
    }


  /**
   * Spawn a single Worker Kiro instance
   * Returns the workerId if successful, null if failed
   */
  async spawnOne() {
    // Cooldown check
    const now = Date.now();
    if (now - _lastSpawnTime < SPAWN_COOLDOWN_MS) {
      const waitSec = Math.ceil((SPAWN_COOLDOWN_MS - (now - _lastSpawnTime)) / 1000);
      console.log(`[WorkerSpawner] Cooldown: wait ${waitSec}s before next spawn`);
      return null;
    }

    // Prevent concurrent spawns
    if (_spawning) {
      console.log('[WorkerSpawner] Already spawning, skip');
      return null;
    }

    const capacity = this.getCapacity();
    if (capacity.canSpawn <= 0) {
      const reason = capacity.maxByRam <= 0 ? 'insufficient RAM'
        : capacity.maxByHardCap <= 0 ? `max workers reached (${MAX_WORKERS})`
        : 'no available or provisionable slots';
      console.log(`[WorkerSpawner] Cannot spawn: ${reason}`);
      return null;
    }

    // Pick the first available slot (prefer ready folders over provisionable)
    const folder = capacity.readyFolders.length > 0
      ? capacity.readyFolders[0]
      : capacity.provisionableSlots[0];
    const workerId = `worker-${folder.num}`;

    console.log(`[WorkerSpawner] Spawning ${workerId} (free RAM: ${capacity.resources.freeGB}GB)`);
    _spawning = true;
    _lastSpawnTime = now;

    try {
      // If folder isn't ready, provision it first
      let workerPath = folder.path;
      if (!folder.ready) {
        console.log(`[WorkerSpawner] Folder not ready, provisioning Worker${folder.num}...`);
        const provisioned = this.provisionWorkerFolder(folder.num);
        if (!provisioned) {
          console.error(`[WorkerSpawner] Provisioning failed for Worker${folder.num}`);
          return null;
        }
        workerPath = provisioned;
      }

      // Provisioning done — notify owner to manually open Kiro window
      // (Auto-launch disabled: Kiro windows opened via CLI often get "No model available" error)
      console.log(`[WorkerSpawner] ✓ ${workerId} folder ready at: ${workerPath}`);
      console.log(`[WorkerSpawner] Waiting for user to manually open Kiro window for ${workerId}`);

      // Notify via WA (gateway is set by index.js after construction)
      if (this.gateway && this.gateway._notifyOwner) {
        this.gateway._notifyOwner(
          t('workerFolderReady', { workerId, workerPath })
        );
      }

      // Wait for worker to register (user opens Kiro manually)
      const registered = await this._waitForRegistration(workerId);
      if (registered) {
        console.log(`[WorkerSpawner] ✓ ${workerId} registered successfully`);
        return workerId;
      } else {
        console.warn(`[WorkerSpawner] ${workerId} folder ready but not registered within timeout (user may not have opened Kiro yet)`);
        return null;
      }
    } catch (err) {
      console.error(`[WorkerSpawner] Spawn failed: ${err.message}`);
      return null;
    } finally {
      _spawning = false;
    }
  }

  /**
   * Ensure at least one idle worker is available.
   * If none, try to spawn one.
   * Returns the workerId of an idle worker, or null.
   */
  async ensureIdleWorker() {
    // First check if there's already an idle worker
    const idle = this.registry.findIdle();
    if (idle) return idle.workerId;

    // No idle worker — try to spawn
    console.log('[WorkerSpawner] No idle worker, attempting to spawn...');
    const spawnedId = await this.spawnOne();
    if (spawnedId) {
      return spawnedId;
    }
    return null;
  }

  /**
   * Find kiro CLI path
   */
  _findKiroCli() {
    // Check common locations
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Kiro', 'bin', 'kiro.cmd'),
      path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Kiro', 'bin', 'kiro.cmd'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    // Try PATH
    try {
      const result = execSync('where kiro', { encoding: 'utf-8', timeout: 3000 }).trim();
      if (result) return result.split('\n')[0].trim();
    } catch (e) { /* not in PATH */ }

    return null;
  }

  /**
   * Wait for a specific worker to register
   */
  _waitForRegistration(workerId) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const workers = this.registry.list();
        const found = workers.find(w => w.workerId === workerId && w.status !== 'offline');
        if (found) {
          clearInterval(interval);
          resolve(true);
        } else if (Date.now() - startTime > WORKER_READY_TIMEOUT_MS) {
          clearInterval(interval);
          resolve(false);
        }
      }, 3000); // check every 3s
    });
  }
}

module.exports = WorkerSpawner;
