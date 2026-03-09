/**
 * WorkerSpawner — Unit Tests
 * Tests resource calculation, capacity limits, provisioning, and spawn logic.
 * Works regardless of whether Worker folders exist on disk.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const WorkerSpawner = require('./worker-spawner');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

// ─── Mock WorkerRegistry ──────────────────────────────

function createMockRegistry(workers = []) {
  return {
    list: () => workers,
    findIdle: () => workers.find(w => w.status === 'idle') || null,
  };
}

// ─── Tests ────────────────────────────────────────────

function run() {
  const projectRoot = path.join(__dirname, '../..');
  const parentDir = path.dirname(projectRoot);

  console.log('\n[WorkerSpawner — getSystemResources]');
  {
    const spawner = new WorkerSpawner(createMockRegistry(), projectRoot);
    const res = spawner.getSystemResources();
    assert(typeof res.totalGB === 'number' && res.totalGB > 0, `totalGB: ${res.totalGB}`);
    assert(typeof res.freeGB === 'number' && res.freeGB >= 0, `freeGB: ${res.freeGB}`);
    assert(typeof res.cpuCount === 'number' && res.cpuCount > 0, `cpuCount: ${res.cpuCount}`);
  }

  console.log('\n[WorkerSpawner — getWorkerFolders]');
  {
    const spawner = new WorkerSpawner(createMockRegistry(), projectRoot);
    const folders = spawner.getWorkerFolders();
    assert(Array.isArray(folders), 'returns array');
    // Only ready folders (with mcp.json) are returned
    for (const f of folders) {
      const mcpPath = path.join(f.path, '.kiro', 'settings', 'mcp.json');
      assert(fs.existsSync(mcpPath), `${f.name} has mcp.json`);
      assert(f.ready === true, `${f.name} marked ready`);
    }
    if (folders.length === 0) {
      console.log('  ℹ️  No ready Worker folders found (expected if none provisioned yet)');
    }
  }

  console.log('\n[WorkerSpawner — getProvisionableSlots]');
  {
    const spawner = new WorkerSpawner(createMockRegistry(), projectRoot);
    const readyFolders = spawner.getWorkerFolders();
    const slots = spawner.getProvisionableSlots();
    assert(Array.isArray(slots), 'returns array');
    // Ready + provisionable should cover all MAX_WORKERS slots
    const readyNums = readyFolders.map(f => f.num);
    const slotNums = slots.map(s => s.num);
    assert(readyNums.length + slotNums.length === 3, `total slots = ${readyNums.length + slotNums.length} (expected 3)`);
    // No overlap
    for (const n of slotNums) {
      assert(!readyNums.includes(n), `slot ${n} not in ready folders`);
    }
  }

  console.log('\n[WorkerSpawner — getCapacity: no workers registered]');
  {
    const spawner = new WorkerSpawner(createMockRegistry([]), projectRoot);
    const cap = spawner.getCapacity();
    assert(cap.registeredCount === 0, 'registeredCount is 0');
    // availableFolders = ready + provisionable
    assert(cap.availableFolders.length === 3, `availableFolders: ${cap.availableFolders.length} (all 3 slots)`);
    assert(cap.canSpawn >= 0, `canSpawn: ${cap.canSpawn}`);
    assert(cap.maxByRam >= 0, `maxByRam: ${cap.maxByRam}`);
    assert(cap.maxByHardCap === 3, `maxByHardCap: ${cap.maxByHardCap}`);
  }

  console.log('\n[WorkerSpawner — getCapacity: worker-1 registered]');
  {
    const spawner = new WorkerSpawner(createMockRegistry([
      { workerId: 'worker-1', port: 38114, status: 'idle' },
    ]), projectRoot);
    const cap = spawner.getCapacity();
    assert(cap.registeredCount === 1, 'registeredCount is 1');
    const availNums = cap.availableFolders.map(f => f.num);
    assert(!availNums.includes(1), 'Worker1 not in available (registered)');
    assert(availNums.includes(2), 'Worker2 is available');
    assert(availNums.includes(3), 'Worker3 is available');
    assert(cap.maxByHardCap === 2, 'maxByHardCap is 2');
  }

  console.log('\n[WorkerSpawner — getCapacity: all 3 workers registered]');
  {
    const spawner = new WorkerSpawner(createMockRegistry([
      { workerId: 'worker-1', port: 38114, status: 'idle' },
      { workerId: 'worker-2', port: 38115, status: 'busy' },
      { workerId: 'worker-3', port: 38116, status: 'idle' },
    ]), projectRoot);
    const cap = spawner.getCapacity();
    assert(cap.registeredCount === 3, 'registeredCount is 3');
    assert(cap.availableFolders.length === 0, 'no available slots');
    assert(cap.canSpawn === 0, 'canSpawn is 0');
  }

  console.log('\n[WorkerSpawner — getCapacity: offline workers excluded]');
  {
    const spawner = new WorkerSpawner(createMockRegistry([
      { workerId: 'worker-1', port: 38114, status: 'offline' },
    ]), projectRoot);
    const cap = spawner.getCapacity();
    assert(cap.registeredCount === 0, 'offline worker not counted');
    assert(cap.availableFolders.length === 3, 'all 3 slots available');
  }

  console.log('\n[WorkerSpawner — _getGitRemoteUrl]');
  {
    const spawner = new WorkerSpawner(createMockRegistry(), projectRoot);
    const url = spawner._getGitRemoteUrl();
    assert(url !== null, `git remote URL: ${url}`);
    assert(url.includes('github.com'), 'URL contains github.com');
  }

  console.log('\n[WorkerSpawner — _findKiroCli]');
  {
    const spawner = new WorkerSpawner(createMockRegistry(), projectRoot);
    const cli = spawner._findKiroCli();
    assert(cli !== null, `found kiro CLI: ${cli}`);
    assert(fs.existsSync(cli), 'CLI path exists');
  }

  console.log('\n[WorkerSpawner — ensureIdleWorker: already has idle]');
  {
    const registry = createMockRegistry([
      { workerId: 'worker-1', port: 38114, status: 'idle' },
    ]);
    registry.findIdle = () => ({ workerId: 'worker-1', port: 38114 });
    const spawner = new WorkerSpawner(registry, projectRoot);
    spawner.ensureIdleWorker().then(id => {
      assert(id === 'worker-1', 'returns existing idle worker');
    });
  }

  // ─── Summary ────────────────────────────────────────
  setTimeout(() => {
    console.log(`\n${'='.repeat(40)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }, 200);
}

run();
