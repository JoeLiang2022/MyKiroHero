/**
 * setup-worker.js --update tests
 *
 * Verifies that --update mode:
 * - Syncs steering templates with worker-id replacement
 * - Syncs MCP config with correct X_WORKER_ID
 * - Copies .env and .gateway-port
 * - Preserves LESSONS.md content (does not overwrite user lessons)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates', 'worker-steering');

describe('setup-worker.js --update', () => {
  let tempDir, targetDir, repoDir;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `worker-test-${Date.now()}`);
    targetDir = path.join(tempDir, 'Worker1');
    repoDir = path.join(targetDir, 'MyKiroHero');

    // Create minimal worker workspace structure
    fs.mkdirSync(path.join(targetDir, '.kiro', 'steering'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, '.kiro', 'settings'), { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  describe('syncSteering', () => {
    /**
     * Replicate the syncSteering logic from setup-worker.js for isolated testing.
     * Includes PRESERVE_FILES logic and .md filter (matching source implementation).
     */
    const PRESERVE_FILES = ['LESSONS.md'];

    function syncSteering(workerId, targetDir, { isUpdate = false } = {}) {
      const steeringDir = path.join(targetDir, '.kiro', 'steering');
      fs.mkdirSync(steeringDir, { recursive: true });

      const templateFiles = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md'));
      for (const file of templateFiles) {
        const src = path.join(TEMPLATES_DIR, file);
        const dst = path.join(steeringDir, file);

        // In update mode, preserve Worker's personal files (e.g. LESSONS.md)
        if (isUpdate && PRESERVE_FILES.includes(file) && fs.existsSync(dst)) {
          continue;
        }

        let content = fs.readFileSync(src, 'utf-8');
        content = content.replace(/worker-\d+/gi, workerId);
        fs.writeFileSync(dst, content, 'utf-8');
      }
    }

    test('copies all .md template files to steering dir', () => {
      syncSteering('worker-1', targetDir);

      const templateFiles = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md'));
      const steeringDir = path.join(targetDir, '.kiro', 'steering');
      const steeringFiles = fs.readdirSync(steeringDir);

      for (const file of templateFiles) {
        expect(steeringFiles).toContain(file);
      }
    });

    test('replaces worker-id placeholder in all files', () => {
      syncSteering('worker-3', targetDir);

      const steeringDir = path.join(targetDir, '.kiro', 'steering');
      const identityPath = path.join(steeringDir, 'IDENTITY.md');

      if (fs.existsSync(identityPath)) {
        const content = fs.readFileSync(identityPath, 'utf-8');
        expect(content).toContain('worker-3');
        // Should not contain the original placeholder pattern (worker-1)
        expect(content).not.toMatch(/worker-1/i);
      }
    });

    test('preserves LESSONS.md in update mode when it already exists', () => {
      // Pre-populate LESSONS.md with user content
      const lessonsPath = path.join(targetDir, '.kiro', 'steering', 'LESSONS.md');
      const userLessons = [
        '# LESSONS.md - Personal Playbook',
        '',
        '- [2026-02-10] Always check callers before changing function signatures',
        '- [2026-02-15] Use busyTimeout for SQLite in concurrent scenarios',
        '',
      ].join('\n');
      fs.writeFileSync(lessonsPath, userLessons, 'utf-8');

      // Run syncSteering in update mode — should preserve LESSONS.md
      syncSteering('worker-1', targetDir, { isUpdate: true });

      const afterContent = fs.readFileSync(lessonsPath, 'utf-8');

      // LESSONS.md should be preserved — not overwritten with template
      expect(afterContent).toBe(userLessons);
      expect(afterContent).toContain('Always check callers');
    });

    test('overwrites LESSONS.md in fresh install mode', () => {
      // Pre-populate LESSONS.md
      const lessonsPath = path.join(targetDir, '.kiro', 'steering', 'LESSONS.md');
      fs.writeFileSync(lessonsPath, '# old content\n', 'utf-8');

      // Run syncSteering without update mode — should overwrite
      syncSteering('worker-1', targetDir, { isUpdate: false });

      const afterContent = fs.readFileSync(lessonsPath, 'utf-8');
      const templateContent = fs.readFileSync(
        path.join(TEMPLATES_DIR, 'LESSONS.md'), 'utf-8'
      );

      expect(afterContent).toBe(templateContent.replace(/worker-\d+/gi, 'worker-1'));
    });
  });

  describe('syncMcpConfig', () => {
    function syncMcpConfig(workerId, targetDir, repoDir) {
      const mcpDir = path.join(targetDir, '.kiro', 'settings');
      fs.mkdirSync(mcpDir, { recursive: true });

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
    }

    test('creates mcp.json with correct worker ID', () => {
      syncMcpConfig('worker-2', targetDir, repoDir);

      const mcpPath = path.join(targetDir, '.kiro', 'settings', 'mcp.json');
      const config = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));

      expect(config.mcpServers['mykiro-gateway'].env.X_WORKER_ID).toBe('worker-2');
    });

    test('uses forward slashes in paths (Windows compat)', () => {
      syncMcpConfig('worker-1', targetDir, repoDir);

      const mcpPath = path.join(targetDir, '.kiro', 'settings', 'mcp.json');
      const config = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));

      const serverPath = config.mcpServers['mykiro-gateway'].args[0];
      const cwd = config.mcpServers['mykiro-gateway'].cwd;

      // Should not contain backslashes
      expect(serverPath).not.toContain('\\');
      expect(cwd).not.toContain('\\');
    });

    test('includes autoApprove wildcard', () => {
      syncMcpConfig('worker-1', targetDir, repoDir);

      const mcpPath = path.join(targetDir, '.kiro', 'settings', 'mcp.json');
      const config = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));

      expect(config.mcpServers['mykiro-gateway'].autoApprove).toContain('*');
    });
  });

  describe('syncEnvFiles', () => {
    function syncEnvFiles(projectRoot, repoDir) {
      const commanderEnv = path.join(projectRoot, '.env');
      const workerEnv = path.join(repoDir, '.env');

      if (fs.existsSync(commanderEnv)) {
        fs.copyFileSync(commanderEnv, workerEnv);
        return 'copied';
      }

      const exampleEnv = path.join(projectRoot, '.env.example');
      if (fs.existsSync(exampleEnv)) {
        fs.copyFileSync(exampleEnv, workerEnv);
        return 'example';
      }

      return 'missing';
    }

    test('copies .env from commander to worker repo', () => {
      // Create commander .env
      const commanderRoot = path.join(tempDir, 'Commander');
      fs.mkdirSync(commanderRoot, { recursive: true });
      fs.writeFileSync(path.join(commanderRoot, '.env'), 'LANGUAGE=zh\nGATEWAY_PORT=3000\n');

      const result = syncEnvFiles(commanderRoot, repoDir);
      expect(result).toBe('copied');

      const workerEnv = fs.readFileSync(path.join(repoDir, '.env'), 'utf-8');
      expect(workerEnv).toContain('LANGUAGE=zh');
      expect(workerEnv).toContain('GATEWAY_PORT=3000');
    });

    test('falls back to .env.example when .env missing', () => {
      const commanderRoot = path.join(tempDir, 'Commander');
      fs.mkdirSync(commanderRoot, { recursive: true });
      fs.writeFileSync(path.join(commanderRoot, '.env.example'), 'LANGUAGE=en\n');

      const result = syncEnvFiles(commanderRoot, repoDir);
      expect(result).toBe('example');
    });

    test('returns missing when neither .env nor .env.example exists', () => {
      const commanderRoot = path.join(tempDir, 'Commander');
      fs.mkdirSync(commanderRoot, { recursive: true });

      const result = syncEnvFiles(commanderRoot, repoDir);
      expect(result).toBe('missing');
    });
  });

  describe('syncGatewayPort', () => {
    test('copies .gateway-port file', () => {
      const commanderRoot = path.join(tempDir, 'Commander');
      fs.mkdirSync(commanderRoot, { recursive: true });
      fs.writeFileSync(path.join(commanderRoot, '.gateway-port'), '3456');

      // Simulate the copy
      const src = path.join(commanderRoot, '.gateway-port');
      const dest = path.join(repoDir, '.gateway-port');
      fs.copyFileSync(src, dest);

      const port = fs.readFileSync(dest, 'utf-8').trim();
      expect(port).toBe('3456');
    });
  });

  describe('full --update integration', () => {
    test('update syncs all config files', () => {
      // Create a commander-like project root with required files
      const commanderRoot = path.join(tempDir, 'Commander');
      fs.mkdirSync(commanderRoot, { recursive: true });
      fs.writeFileSync(path.join(commanderRoot, '.env'), 'LANGUAGE=zh\n');
      fs.writeFileSync(path.join(commanderRoot, '.gateway-port'), '9999');

      // Simulate what runUpdate does (without execSync calls)
      // 1. syncSteering (with .md filter, matching source implementation)
      const steeringDir = path.join(targetDir, '.kiro', 'steering');
      const templateFiles = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md'));
      for (const file of templateFiles) {
        let content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
        content = content.replace(/worker-\d+/gi, 'worker-1');
        fs.writeFileSync(path.join(steeringDir, file), content, 'utf-8');
      }

      // 2. syncMcpConfig
      const mcpConfig = {
        mcpServers: {
          "mykiro-gateway": {
            command: "node",
            args: [path.join(repoDir, 'src', 'mcp-server.js').replace(/\\/g, '/')],
            env: { X_WORKER_ID: 'worker-1' },
            autoApprove: ["*"]
          }
        }
      };
      fs.writeFileSync(
        path.join(targetDir, '.kiro', 'settings', 'mcp.json'),
        JSON.stringify(mcpConfig, null, 2)
      );

      // 3. syncEnvFiles
      fs.copyFileSync(path.join(commanderRoot, '.env'), path.join(repoDir, '.env'));
      fs.copyFileSync(path.join(commanderRoot, '.gateway-port'), path.join(repoDir, '.gateway-port'));

      // Verify all files exist
      expect(fs.existsSync(path.join(steeringDir, 'IDENTITY.md'))).toBe(true);
      expect(fs.existsSync(path.join(steeringDir, 'SOUL.md'))).toBe(true);
      expect(fs.existsSync(path.join(steeringDir, 'MEMORY.md'))).toBe(true);
      expect(fs.existsSync(path.join(steeringDir, 'TOOLS.md'))).toBe(true);
      expect(fs.existsSync(path.join(steeringDir, 'LESSONS.md'))).toBe(true);
      expect(fs.existsSync(path.join(steeringDir, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, '.kiro', 'settings', 'mcp.json'))).toBe(true);
      expect(fs.existsSync(path.join(repoDir, '.env'))).toBe(true);
      expect(fs.existsSync(path.join(repoDir, '.gateway-port'))).toBe(true);

      // Verify content
      const identity = fs.readFileSync(path.join(steeringDir, 'IDENTITY.md'), 'utf-8');
      expect(identity).toContain('worker-1');

      const mcp = JSON.parse(fs.readFileSync(path.join(targetDir, '.kiro', 'settings', 'mcp.json'), 'utf-8'));
      expect(mcp.mcpServers['mykiro-gateway'].env.X_WORKER_ID).toBe('worker-1');

      const env = fs.readFileSync(path.join(repoDir, '.env'), 'utf-8');
      expect(env).toContain('LANGUAGE=zh');

      const port = fs.readFileSync(path.join(repoDir, '.gateway-port'), 'utf-8');
      expect(port).toBe('9999');
    });
  });
});
