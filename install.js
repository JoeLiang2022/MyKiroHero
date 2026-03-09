#!/usr/bin/env node
/**
 * MyKiroHero Cross-platform Install Script — Orchestrator
 * Supports Windows / Mac / Linux
 *
 * 用法：
 *   node install.js             # 正常安裝（互動式）
 *   node install.js --test      # 自動測試模式
 *   node install.js --upgrade   # 升級模式（保留設定，更新程式碼）
 *   node install.js --restore   # 從 GitHub 備份還原記憶
 *   node install.js --manage-ai # AI Provider 管理
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Windows: set console output to UTF-8
if (process.platform === 'win32') {
    try {
        execSync('chcp 65001', { stdio: 'ignore' });
        if (process.stdout.setEncoding) process.stdout.setEncoding('utf8');
        if (process.stderr.setEncoding) process.stderr.setEncoding('utf8');
    } catch { /* ignore */ }
    process.env.PYTHONIOENCODING = 'utf-8';
    process.env.LANG = 'en_US.UTF-8';
}

// Mode flags
const isTestMode = process.argv.includes('--test');
const isUpgradeMode = process.argv.includes('--upgrade');
const isManageAiMode = process.argv.includes('--manage-ai');
const isRestoreMode = process.argv.includes('--restore');

// Git command (default 'git', user may override in env-check)
let gitCmd = 'git';

// Read version
const packageJson = require('./package.json');
const VERSION = packageJson.version;

// Platform detection
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// Shared utilities
const { log, logStep, createPrompt, ask, exec, commandExists } = require('./install/utils');
const i18n = require('./install/i18n');

// Step modules
const envCheck = require('./install/steps/env-check');
const projectSetup = require('./install/steps/project-setup');
const personalize = require('./install/steps/personalize');
const aiSetup = require('./install/steps/ai-setup');
const launch = require('./install/steps/launch');

// ─── upgrade() — reuses step modules where possible ───

async function upgrade() {
    const projectDir = process.cwd();
    const pkgPath = path.join(projectDir, 'package.json');

    if (!fs.existsSync(pkgPath)) {
        log('✗ Not inside MyKiroHero project directory', 'red');
        log('  Please run from the MyKiroHero folder', 'yellow');
        process.exit(1);
    }
    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name !== 'mykiro-hero') throw new Error('wrong project');
    } catch {
        log('✗ Not a MyKiroHero project', 'red');
        process.exit(1);
    }

    const oldVersion = pkg.version;

    console.log('');
    log('╔══════════════════════════════════════════════════════════════╗', 'cyan');
    log('║                                                              ║', 'cyan');
    log(`║   🔄 MyKiroHero Upgrade                                      ║`, 'cyan');
    log(`║   Current version: ${oldVersion.padEnd(43)}║`, 'cyan');
    log('║                                                              ║', 'cyan');
    log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
    console.log('');

    const totalSteps = 7;

    try {
        // Step 1: Backup memories
        logStep(1, totalSteps, 'Backing up memories...');
        try {
            require('dotenv').config({ path: path.join(projectDir, '.env') });
            if (process.env.MEMORY_REPO && process.env.GITHUB_TOKEN) {
                const { backup } = require('./src/memory-backup');
                const result = await backup();
                if (result.success) {
                    log(`  ✓ Backup complete (${result.reason})`, 'green');
                } else {
                    log(`  ⚠ Backup skipped: ${result.reason}`, 'yellow');
                }
            } else {
                log('  ⚠ MEMORY_REPO not configured, skipping backup', 'yellow');
            }
        } catch (e) {
            log(`  ⚠ Backup failed (non-fatal): ${e.message}`, 'yellow');
        }
        console.log('');

        // Step 2: git pull
        logStep(2, totalSteps, 'Pulling latest code...');
        let codeChanged = true;
        try {
            const pullResult = exec(`${gitCmd} pull origin main`, { silent: true, cwd: projectDir });
            if (pullResult && pullResult.includes('Already up to date')) {
                log('  Already up to date', 'yellow');
                codeChanged = false;
            } else {
                log('  ✓ Code updated', 'green');
            }
        } catch (e) {
            log(`  ✗ git pull failed: ${e.message}`, 'red');
            log('  Please resolve git issues manually and retry', 'yellow');
            process.exit(1);
        }
        console.log('');

        // Step 3: npm install (skip if no code changes)
        logStep(3, totalSteps, 'Updating dependencies...');
        if (codeChanged) {
            exec('npm install --silent', { cwd: projectDir, silent: true });
            try {
                exec(`node -e "require('better-sqlite3')"`, { cwd: projectDir, silent: true });
                log('  ✓ Dependencies updated (SQLite OK)', 'green');
            } catch {
                log('  ✓ Dependencies updated (SQLite fallback mode)', 'yellow');
            }
        } else {
            log('  ✓ Skipped (no code changes)', 'green');
        }
        console.log('');

        // Step 4: .env backfill
        logStep(4, totalSteps, 'Checking .env for new variables...');
        const envPath = path.join(projectDir, '.env');
        const examplePath = path.join(projectDir, '.env.example');

        if (fs.existsSync(envPath) && fs.existsSync(examplePath)) {
            const currentEnv = fs.readFileSync(envPath, 'utf-8');
            const exampleEnv = fs.readFileSync(examplePath, 'utf-8');

            const existingKeys = new Set();
            for (const line of currentEnv.split('\n')) {
                const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
                if (match) existingKeys.add(match[1]);
            }

            const missingLines = [];
            const exampleLines = exampleEnv.split('\n');
            let pendingComment = '';

            for (const line of exampleLines) {
                if (line.startsWith('#') || line.trim() === '') {
                    pendingComment += line + '\n';
                    continue;
                }
                const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
                if (match && !existingKeys.has(match[1])) {
                    if (pendingComment.trim()) {
                        missingLines.push('');
                        missingLines.push(pendingComment.trimEnd());
                    }
                    missingLines.push(line);
                }
                pendingComment = '';
            }

            if (missingLines.length > 0) {
                const appendContent = '\n# --- Added by upgrade ---\n' + missingLines.join('\n') + '\n';
                fs.appendFileSync(envPath, appendContent);
                const addedCount = missingLines.filter(l => l.match(/^[A-Z_]/)).length;
                log(`  ✓ Added ${addedCount} new variable(s) to .env`, 'green');
                for (const line of missingLines) {
                    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
                    if (m) log(`    + ${m[1]}`, 'cyan');
                }
            } else {
                log('  ✓ .env is up to date', 'green');
            }
        } else if (!fs.existsSync(envPath)) {
            log('  ⚠ No .env found — run full install first: node install.js', 'yellow');
        }
        console.log('');

        // Step 5: Check AI Provider updates (reuses ai-setup pattern)
        logStep(5, totalSteps, 'Checking AI Provider updates...');
        try {
            const registryPath = path.join(projectDir, 'ai-providers.json');
            if (fs.existsSync(registryPath)) {
                const AiProviderManager = require('./src/ai-provider-manager');
                const parentKiroDir = path.join(path.dirname(projectDir), '.kiro');
                const aiManager = new AiProviderManager(projectDir, parentKiroDir);
                const enabled = aiManager.getEnabledProviders();

                const env = {};
                const envPath2 = path.join(projectDir, '.env');
                if (fs.existsSync(envPath2)) {
                    for (const line of fs.readFileSync(envPath2, 'utf-8').split('\n')) {
                        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
                        if (m) env[m[1]] = m[2];
                    }
                }

                const reg = aiManager.getRegistry();
                let hasNews = false;

                // Check deprecated models
                for (const cap of ['IMAGE', 'TTS', 'STT']) {
                    const val = env[`AI_MODEL_${cap}`] || '';
                    if (!val.includes(':')) continue;
                    const [pid, mid] = val.split(':');
                    const provider = reg.providers.find(p => p.id === pid);
                    if (!provider) continue;
                    const model = provider.models.find(m => m.id === mid);
                    if (model && model.status === 'deprecated') {
                        log(`  ⚠ ${provider.name} model "${model.name}" is deprecated${model.deprecationDate ? ` (${model.deprecationDate})` : ''}`, 'yellow');
                        const alt = provider.models.find(m => m.capability === model.capability && m.default);
                        if (alt) log(`    Suggested: ${alt.name}`, 'cyan');
                        hasNews = true;
                    }
                }

                // Check for new providers not yet enabled
                const newProviders = reg.providers.filter(p => !enabled.includes(p.id));
                if (newProviders.length > 0 && enabled.length > 0) {
                    log(`  Available providers not yet enabled:`, 'cyan');
                    for (const p of newProviders) {
                        const free = p.freeTier?.available ? ' ★FREE' : '';
                        log(`    • ${p.name}${free} (${p.capabilities.join(', ')})`, 'white');
                    }
                    log(`    Use: node install.js --manage-ai`, 'yellow');
                    hasNews = true;
                }

                if (!hasNews) {
                    log('  ✓ AI Provider config up to date', 'green');
                }
            } else {
                log('  No ai-providers.json found, skipping', 'yellow');
            }
        } catch (e) {
            log(`  ⚠ AI Provider check failed: ${e.message}`, 'yellow');
        }
        console.log('');

        // Step 6: Restart services
        logStep(6, totalSteps, 'Restarting services...');
        if (commandExists('pm2')) {
            exec('pm2 restart gateway', { silent: true, ignoreError: true });
            exec('pm2 restart recall-worker', { silent: true, ignoreError: true });
            log('  ✓ PM2 services restarted', 'green');
        } else {
            log('  ⚠ PM2 not found — please restart Gateway manually', 'yellow');
        }
        console.log('');

        // Step 7: Show changelog
        logStep(7, totalSteps, 'Recent changes:');
        const newPkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8'));
        const newVersion = newPkg.version;

        if (newVersion !== oldVersion) {
            log(`  Version: ${oldVersion} → ${newVersion}`, 'green');
        } else {
            log(`  Version: ${newVersion} (unchanged)`, 'yellow');
        }

        try {
            const changelog = exec(`${gitCmd} log --oneline -10`, { silent: true, cwd: projectDir });
            if (changelog) {
                console.log('');
                log('  Recent commits:', 'cyan');
                for (const line of changelog.trim().split('\n')) {
                    log(`    ${line}`, 'white');
                }
            }
        } catch { /* ignore */ }

        console.log('');
        log('╔══════════════════════════════════════════════════════════════╗', 'green');
        log('║  ✓ Upgrade complete!                                        ║', 'green');
        log('╚══════════════════════════════════════════════════════════════╝', 'green');
        console.log('');

    } catch (error) {
        log(`Upgrade failed: ${error.message}`, 'red');
        process.exit(1);
    }
}

// ─── manageAi() — quick setup (paste key → auto-detect) + optional advanced ───

async function manageAi() {
    const projectDir = process.cwd();
    const pkgPath = path.join(projectDir, 'package.json');

    if (!fs.existsSync(pkgPath)) {
        log('✗ Not inside MyKiroHero project directory', 'red');
        process.exit(1);
    }

    const parentKiroDir = path.join(path.dirname(projectDir), '.kiro');
    const AiProviderManager = require('./src/ai-provider-manager');
    const manager = new AiProviderManager(projectDir, parentKiroDir);

    const rl = createPrompt();

    // Detect language
    const envPath = path.join(projectDir, '.env');
    let lang = 'en';
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const match = envContent.match(/^LANGUAGE=(\w+)/m);
        if (match) lang = match[1];
    }

    const reg = manager.getRegistry();

    console.log('');
    log('╔══════════════════════════════════════════════════════════════╗', 'cyan');
    log('║   🤖 AI Provider Manager                                     ║', 'cyan');
    log('╚══════════════════════════════════════════════════════════════╝', 'cyan');

    // Show current status
    const enabledBefore = manager.getEnabledProviders();
    console.log('');
    log(lang === 'zh' ? '目前設定：' : 'Current config:', 'cyan');
    for (const provider of reg.providers) {
        if (enabledBefore.includes(provider.id)) {
            const config = manager.getProviderConfig(provider.id);
            const hasKey = config.apiKey ? '✓key' : '✗key';
            log(`  ✓ ${provider.name} [${hasKey}]`, 'green');
        } else {
            log(`  ✗ ${provider.name}`, 'white');
        }
    }

    // Quick setup: paste key → auto-detect → enable
    const { quickSetupAi } = require('./install/steps/ai-setup');
    const issues = [];
    await quickSetupAi(rl, lang, manager, issues);

    // Sync MCP config
    const enabledAfter = manager.getEnabledProviders();
    if (enabledAfter.length > 0) {
        await manager.syncMcpConfig();
        log(lang === 'zh' ? '  ✓ MCP 設定已同步' : '  ✓ MCP config synced', 'green');
    }

    // Optional advanced management
    console.log('');
    log(lang === 'zh' ? '進階管理？' : 'Advanced management?', 'white');
    log(`  [1] ${lang === 'zh' ? '移除 Provider' : 'Remove Provider'}`, 'white');
    log(`  [2] ${lang === 'zh' ? '切換 Model' : 'Switch Model'}`, 'white');
    log(`  [3] ${lang === 'zh' ? '更新 API Key' : 'Update API Key'}`, 'white');
    log(`  [4] ${lang === 'zh' ? '管理 STT 設定' : 'Manage STT Settings'}`, 'white');
    log(`  [0] ${lang === 'zh' ? '離開' : 'Exit'} (${lang === 'zh' ? '預設' : 'default'})`, 'white');

    const choice = await ask(rl, '\n> ', '0');

    if (choice === '1') {
        const enabled = manager.getEnabledProviders();
        if (enabled.length === 0) {
            log(lang === 'zh' ? '  沒有已啟用的 provider' : '  No enabled providers', 'yellow');
        } else {
            for (let i = 0; i < enabled.length; i++) {
                const p = reg.providers.find(pr => pr.id === enabled[i]);
                log(`  [${i + 1}] ${p?.name || enabled[i]}`, 'white');
            }
            const rChoice = await ask(rl, `  ${lang === 'zh' ? '選擇要移除的' : 'Select to remove'}: `, '');
            const rIdx = parseInt(rChoice, 10);
            if (rIdx >= 1 && rIdx <= enabled.length) {
                await manager.disableProvider(enabled[rIdx - 1]);
                await manager.syncMcpConfig();
                log(`  ✓ ${lang === 'zh' ? '已移除' : 'Removed'}`, 'green');
            }
        }

    } else if (choice === '2') {
        const enabled = manager.getEnabledProviders();
        if (enabled.length === 0) {
            log(lang === 'zh' ? '  沒有已啟用的 provider' : '  No enabled providers', 'yellow');
        } else {
            for (let i = 0; i < enabled.length; i++) {
                const p = reg.providers.find(pr => pr.id === enabled[i]);
                log(`  [${i + 1}] ${p?.name || enabled[i]}`, 'white');
            }
            const sChoice = await ask(rl, `  ${lang === 'zh' ? '選擇 provider' : 'Select provider'}: `, '');
            const sIdx = parseInt(sChoice, 10);
            if (sIdx >= 1 && sIdx <= enabled.length) {
                const provider = reg.providers.find(pr => pr.id === enabled[sIdx - 1]);
                if (provider) {
                    for (const cap of provider.capabilities) {
                        const models = provider.models.filter(m => m.capability === cap && m.status !== 'deprecated');
                        log(`\n  ${cap.toUpperCase()}:`, 'cyan');
                        for (let j = 0; j < models.length; j++) {
                            log(`    [${j + 1}] ${models[j].name}`, 'white');
                        }
                        const mChoice = await ask(rl, `    ${lang === 'zh' ? '選擇' : 'Select'} (Enter skip): `, '');
                        const mIdx = parseInt(mChoice, 10);
                        if (mIdx >= 1 && mIdx <= models.length) {
                            manager.updateModel(provider.id, cap, models[mIdx - 1].id);
                            log(`    ✓ ${models[mIdx - 1].name}`, 'green');
                        }
                    }
                }
            }
        }

    } else if (choice === '3') {
        const enabled = manager.getEnabledProviders();
        if (enabled.length === 0) {
            log(lang === 'zh' ? '  沒有已啟用的 provider' : '  No enabled providers', 'yellow');
        } else {
            for (let i = 0; i < enabled.length; i++) {
                const p = reg.providers.find(pr => pr.id === enabled[i]);
                log(`  [${i + 1}] ${p?.name || enabled[i]}`, 'white');
            }
            const kChoice = await ask(rl, `  ${lang === 'zh' ? '選擇 provider' : 'Select provider'}: `, '');
            const kIdx = parseInt(kChoice, 10);
            if (kIdx >= 1 && kIdx <= enabled.length) {
                const provider = reg.providers.find(pr => pr.id === enabled[kIdx - 1]);
                if (provider) {
                    const newKey = await ask(rl, `  ${lang === 'zh' ? '新 API Key' : 'New API Key'}: `, '');
                    if (newKey) {
                        manager.updateApiKey(provider.id, newKey);
                        log(`  ✓ ${lang === 'zh' ? 'Key 已更新' : 'Key updated'}`, 'green');
                    }
                }
            }
        }

    } else if (choice === '4') {
        const enabled = manager.getEnabledProviders();
        let currentStt = '';
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf-8');
            const match = envContent.match(/^STT_PROVIDER=(.*)$/m);
            if (match) currentStt = match[1].trim();
        }

        log(`  ${lang === 'zh' ? '目前 STT' : 'Current STT'}: ${currentStt || (lang === 'zh' ? '未啟用' : 'disabled')}`, 'cyan');

        const sttProviders = enabled
            .map(id => reg.providers.find(p => p.id === id))
            .filter(p => p && p.capabilities.includes('stt'));

        if (sttProviders.length === 0) {
            log(lang === 'zh'
                ? '  沒有支援 STT 的已啟用 provider'
                : '  No enabled providers with STT support', 'yellow');
        } else {
            for (let i = 0; i < sttProviders.length; i++) {
                const active = sttProviders[i].id === currentStt ? ' ← current' : '';
                log(`  [${i + 1}] ${sttProviders[i].name}${active}`, 'white');
            }
            log(`  [0] ${lang === 'zh' ? '停用 STT' : 'Disable STT'}`, 'white');

            const sttChoice = await ask(rl, `  ${lang === 'zh' ? '選擇' : 'Select'}: `, '');
            const sttIdx = parseInt(sttChoice, 10);

            if (sttIdx === 0) {
                manager._writeEnv({ STT_PROVIDER: '' });
                log(`  ✓ STT ${lang === 'zh' ? '已停用' : 'disabled'}`, 'green');
            } else if (sttIdx >= 1 && sttIdx <= sttProviders.length) {
                const selected = sttProviders[sttIdx - 1];
                manager._writeEnv({ STT_PROVIDER: selected.id });
                log(`  ✓ STT → ${selected.name}`, 'green');
            }
        }
    }

    console.log('');
    log(lang === 'zh'
        ? '提示：重啟 Kiro 讓 MCP server 設定生效'
        : 'Note: Restart Kiro for MCP server changes to take effect', 'yellow');
    rl.close();
}

// ─── restoreMemory() ───

async function restoreMemory() {
    const projectDir = process.cwd();
    const pkgPath = path.join(projectDir, 'package.json');

    if (!fs.existsSync(pkgPath)) {
        log('✗ Not inside MyKiroHero project directory', 'red');
        process.exit(1);
    }

    console.log('');
    log('╔══════════════════════════════════════════════════════════════╗', 'cyan');
    log('║  🔄 MyKiroHero Memory Restore                               ║', 'cyan');
    log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
    console.log('');

    require('dotenv').config({ path: path.join(projectDir, '.env') });

    if (!process.env.MEMORY_REPO || !process.env.GITHUB_TOKEN) {
        log('MEMORY_REPO and GITHUB_TOKEN must be set in .env', 'red');
        process.exit(1);
    }

    try {
        const { restore } = require('./src/memory-restore');
        const result = await restore(process.env.MEMORY_REPO, process.env.GITHUB_TOKEN, projectDir);
        if (result.success) {
            log('✓ Memory restored successfully!', 'green');
        } else {
            log(`✗ Restore failed: ${result.reason}`, 'red');
            process.exit(1);
        }
    } catch (e) {
        log(`✗ Restore failed: ${e.message}`, 'red');
        process.exit(1);
    }
}

// ─── main() — orchestrator ───

async function main() {
    if (isUpgradeMode) return upgrade();
    if (isManageAiMode) return manageAi();
    if (isRestoreMode) return restoreMemory();

    console.log('');
    log('╔══════════════════════════════════════════════════════════════╗', 'cyan');
    log('║                                                              ║', 'cyan');
    log(`║   🤖 MyKiroHero Installer v${VERSION.padEnd(40)}║`, 'cyan');
    log('║   Turn Kiro AI into your WhatsApp assistant                  ║', 'cyan');
    log('║   讓 Kiro AI 成為你的 WhatsApp 助手                          ║', 'cyan');
    log('║                                                              ║', 'cyan');
    log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
    console.log('');

    if (isTestMode) {
        log('🧪 TEST MODE - 自動測試模式', 'yellow');
        console.log('');
    }

    const platform = isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux';
    log(`Platform / 平台: ${platform}`, 'yellow');
    console.log('');

    const rl = createPrompt();

    // Shared context object passed to all steps
    const ctx = {
        rl,
        totalSteps: 5,
        issues: [],
        completed: [],
        // Populated by steps:
        lang: null, t: null,
        gitCmd: 'git', gitAvailable: false,
        kiroCli: null, pm2Installed: false,
        installPath: null, isInsideProject: false,
        steeringPath: null, parentKiroPath: null,
    };

    try {
        await envCheck.run(ctx);
        await projectSetup.run(ctx);
        await personalize.run(ctx);
        await aiSetup.run(ctx);
        await launch.run(ctx);
    } catch (error) {
        log(`${i18n[ctx.lang || 'en'].installFailed || 'Installation failed'}: ${error.message}`, 'red');
        if (rl) rl.close();
        process.exit(1);
    }
}

main();
