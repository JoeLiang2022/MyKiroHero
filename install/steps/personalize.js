/**
 * Step 3: Personalization — steering templates, .env, MCP config
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { isWindows, isMac, isTestMode, log, logStep, ask, exec } = require('../utils');

/**
 * Run Step 3: copy steering templates directly to parent .kiro, write .env, configure MCP
 * @param {object} ctx - shared install context
 * @returns {Promise<void>} mutates ctx with: steeringPath, parentKiroPath
 */
async function run(ctx) {
    const { rl, totalSteps, issues, completed, lang, t, gitAvailable, installPath, isInsideProject } = ctx;

    logStep(3, totalSteps, t.step3Title);

    const parentDir = path.dirname(installPath);
    const parentKiroPath = path.join(parentDir, '.kiro');
    const steeringPath = path.join(parentKiroPath, 'steering');
    const skillsPath = path.join(parentKiroPath, 'skills');
    const templatePath = path.join(installPath, 'templates', 'steering');

    // For test mode running inside project, use project .kiro instead of parent
    const effectiveKiroPath = (isTestMode && isInsideProject) ? path.join(installPath, '.kiro') : parentKiroPath;
    const effectiveSteeringPath = path.join(effectiveKiroPath, 'steering');
    const effectiveSkillsPath = path.join(effectiveKiroPath, 'skills');

    fs.mkdirSync(effectiveSteeringPath, { recursive: true });
    fs.mkdirSync(path.join(effectiveSteeringPath, 'memory'), { recursive: true });
    fs.mkdirSync(effectiveSkillsPath, { recursive: true });

    // Ask if user has a backup to restore
    let restored = false;

    if (!gitAvailable) {
        log(`  ${lang === 'zh' ? '（還原功能需要 Git，已跳過）' : '(Restore requires Git, skipped)'}`, 'yellow');
    } else {
        console.log('');
        log(`  ${lang === 'zh' ? '有之前的備份要還原嗎？（換電腦/重裝時可還原記憶）' : 'Have a backup to restore? (Useful when switching machines)'}`, 'cyan');
        log(`  [1] ${lang === 'zh' ? '有，我要還原' : 'Yes, restore from backup'}`, 'white');
        log(`  [2] ${lang === 'zh' ? '沒有，全新安裝' : 'No, fresh install'}`, 'white');
        const restoreChoice = await ask(rl, '  > ', '2');

        if (restoreChoice === '1') {
            const repoUrl = await ask(rl, `  ${lang === 'zh' ? 'GitHub 備份 repo URL: ' : 'GitHub backup repo URL: '}`, '');
            const ghToken = await ask(rl, `  ${lang === 'zh' ? 'GitHub Token: ' : 'GitHub Token: '}`, '');

            if (repoUrl && ghToken) {
                try {
                    process.env.MEMORY_REPO = repoUrl;
                    process.env.GITHUB_TOKEN = ghToken;
                    const { restore } = require(path.join(installPath, 'src', 'memory-restore'));
                    const result = await restore(repoUrl, ghToken, installPath);
                    if (result.success) {
                        log(`  ✓ ${lang === 'zh' ? '記憶還原成功！' : 'Memory restored successfully!'}`, 'green');
                        restored = true;
                    } else {
                        log(`  ✗ ${lang === 'zh' ? '還原失敗' : 'Restore failed'}: ${result.reason}`, 'red');
                    }
                } catch (e) {
                    log(`  ✗ ${lang === 'zh' ? '還原失敗' : 'Restore failed'}: ${e.message}`, 'red');
                }
            } else {
                log(`  ${lang === 'zh' ? '跳過還原（缺少 URL 或 Token）' : 'Skipping restore (missing URL or Token)'}`, 'yellow');
            }
        }
    }
    console.log('');

    // Copy steering templates directly to parent .kiro/steering/
    const templateFiles = fs.readdirSync(templatePath);
    let copiedCount = 0;

    for (const file of templateFiles) {
        const srcFile = path.join(templatePath, file);
        const destFile = path.join(effectiveSteeringPath, file);
        if (fs.statSync(srcFile).isFile() && !fs.existsSync(destFile)) {
            if (restored && file === 'ONBOARDING.md') continue;
            fs.copyFileSync(srcFile, destFile);
            log(`    + ${file}`, 'green');
            copiedCount++;
        }
    }

    // Update DNA.md language field
    const dnaMdPath = path.join(effectiveSteeringPath, 'DNA.md');
    if (fs.existsSync(dnaMdPath)) {
        let dnaContent = fs.readFileSync(dnaMdPath, 'utf-8');
        const langValue = lang === 'zh' ? 'zh-TW' : 'en';
        dnaContent = dnaContent.replace('lang:(to be set)', `lang:${langValue}`);
        fs.writeFileSync(dnaMdPath, dnaContent, 'utf-8');
    }

    // Copy skills templates
    const skillsTemplatePath = path.join(installPath, 'templates', 'skills');
    if (fs.existsSync(skillsTemplatePath)) {
        const skillDirs = fs.readdirSync(skillsTemplatePath, { withFileTypes: true })
            .filter(d => d.isDirectory()).map(d => d.name);
        for (const skillDir of skillDirs) {
            const srcSkillPath = path.join(skillsTemplatePath, skillDir);
            const destSkillPath = path.join(effectiveSkillsPath, skillDir);
            if (!fs.existsSync(destSkillPath)) {
                fs.cpSync(srcSkillPath, destSkillPath, { recursive: true });
                log(`    + skills/${skillDir}`, 'green');
                copiedCount++;
            }
        }
    }

    if (copiedCount === 0) {
        log(`  ${t.hasConfig}`, 'yellow');
    } else {
        log(`  ✓ ${t.copiedFiles.replace('{count}', copiedCount)}`, 'green');
    }
    completed.push(lang === 'zh' ? 'Steering 設定' : 'Steering config');

    // Set permissions on parent .kiro (Windows only)
    if (!(isTestMode && isInsideProject) && isWindows) {
        try {
            execSync(`icacls "${parentKiroPath}" /grant Users:F /T /Q`, { stdio: 'pipe' });
        } catch { /* ignore */ }
    }
    console.log('');

    // Write .env (merge mode: preserve existing keys like API keys from Step 4)
    const envPath = path.join(installPath, '.env');
    const heartbeatPath = path.join(effectiveSteeringPath, 'HEARTBEAT.md').replace(/\\/g, '/');
    const steeringPathUnix = effectiveSteeringPath.replace(/\\/g, '/');
    const platform = isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux';

    // Default values — only written if key doesn't already exist in .env
    const envDefaults = {
        LANGUAGE: lang,
        AI_PREFIX: '▸ *🤖 AI Assistant :*',
        GATEWAY_PORT: 'auto',
        MESSAGE_MAX_LENGTH: '1500',
        MESSAGE_SPLIT_DELAY: '500',
        FRAGMENT_SCORE_THRESHOLD: '0.6',
        FRAGMENT_COLLECT_TIMEOUT: '3000',
        FRAGMENT_MAX_MESSAGES: '3',
        FRAGMENT_MAX_WAIT: '7000',
        ERROR_NOTIFICATION: 'true',
        OWNER_CHAT_ID: '',
        WA_HEADLESS: '',
        IDE_TYPE: 'kiro',
        IDE_REST_PORT: '55139',
        MEMORY_REPO: process.env.MEMORY_REPO || '',
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
        DEFAULT_LOCATION: '',
        HEARTBEAT_PATH: heartbeatPath,
        STEERING_PATH: steeringPathUnix,
    };

    if (fs.existsSync(envPath)) {
        // Merge: read existing, only add missing keys
        const existing = fs.readFileSync(envPath, 'utf-8');
        const existingKeys = new Set();
        for (const line of existing.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) existingKeys.add(trimmed.slice(0, eqIdx).trim());
        }
        const missing = Object.entries(envDefaults).filter(([k]) => !existingKeys.has(k));
        if (missing.length > 0) {
            const append = '\n# --- Added by installer ---\n' +
                missing.map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
            fs.appendFileSync(envPath, append);
        }
    } else {
        // Fresh install: write full template
        const envContent = `# MyKiroHero Environment Config
# Generated: ${new Date().toISOString()}
# Platform: ${platform}

# Language setting (zh or en)
LANGUAGE=${lang}

# AI reply prefix
AI_PREFIX=▸ *🤖 AI Assistant :*

# Gateway port (auto = system assigns available port)
GATEWAY_PORT=auto

# Message settings
MESSAGE_MAX_LENGTH=1500
MESSAGE_SPLIT_DELAY=500

# Fragment message handling
FRAGMENT_SCORE_THRESHOLD=0.6
FRAGMENT_COLLECT_TIMEOUT=3000
FRAGMENT_MAX_MESSAGES=3
FRAGMENT_MAX_WAIT=7000

# Error notification
ERROR_NOTIFICATION=true

# Owner WhatsApp chatId (filled during onboarding)
OWNER_CHAT_ID=

# WhatsApp Chrome headless mode (default: false = show QR window)
WA_HEADLESS=

# IDE type (kiro, cursor, windsurf, generic)
IDE_TYPE=kiro

# IDE REST API port
IDE_REST_PORT=55139

# Memory backup repo (optional, for soul/memory sync to GitHub)
MEMORY_REPO=${process.env.MEMORY_REPO || ''}

# GitHub token for backup push (optional)
GITHUB_TOKEN=${process.env.GITHUB_TOKEN || ''}

# Default weather location (optional)
DEFAULT_LOCATION=

# Heartbeat config path
HEARTBEAT_PATH=${heartbeatPath}

# Steering files path
STEERING_PATH=${steeringPathUnix}
`;
        fs.writeFileSync(envPath, envContent);
    }
    log(`  ✓ ${t.envDone}`, 'green');
    completed.push('.env');

    // MCP config — write to both project and parent
    const projectMcpSettingsPath = path.join(installPath, '.kiro', 'settings');
    fs.mkdirSync(projectMcpSettingsPath, { recursive: true });

    const coreServers = {
        'mykiro-gateway': {
            command: 'node',
            args: [path.join(installPath, 'src/mcp-server.js')],
            cwd: installPath,
            disabled: false,
            autoApprove: ['*']
        },
        'playwright': {
            command: 'npx',
            args: ['@playwright/mcp@latest'],
            disabled: false,
            autoApprove: ['*']
        }
    };

    function mergeMcpConfig(existingConfig) {
        const merged = { ...existingConfig.mcpServers };
        for (const [name, server] of Object.entries(coreServers)) {
            const prev = merged[name];
            merged[name] = { ...server };
            if (prev && prev.env) {
                merged[name].env = prev.env;
            }
        }
        return { mcpServers: merged };
    }

    // Write to project .kiro/settings/mcp.json (needed for MCP server path resolution)
    const projectMcpJsonPath = path.join(projectMcpSettingsPath, 'mcp.json');
    let mcpResult;
    if (fs.existsSync(projectMcpJsonPath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(projectMcpJsonPath, 'utf-8'));
            mcpResult = mergeMcpConfig(existing);
        } catch {
            mcpResult = { mcpServers: coreServers };
        }
    } else {
        mcpResult = { mcpServers: coreServers };
    }
    fs.writeFileSync(projectMcpJsonPath, JSON.stringify(mcpResult, null, 2));

    // Write to parent .kiro/settings/mcp.json
    const parentMcpSettingsPath = path.join(effectiveKiroPath, 'settings');
    fs.mkdirSync(parentMcpSettingsPath, { recursive: true });
    const parentMcpJsonPath = path.join(parentMcpSettingsPath, 'mcp.json');
    let parentMcpResult;
    if (fs.existsSync(parentMcpJsonPath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(parentMcpJsonPath, 'utf-8'));
            parentMcpResult = mergeMcpConfig(existing);
        } catch {
            parentMcpResult = mcpResult;
        }
    } else {
        parentMcpResult = mcpResult;
    }
    fs.writeFileSync(parentMcpJsonPath, JSON.stringify(parentMcpResult, null, 2));
    log(`  ✓ MCP Server configured`, 'green');
    completed.push('MCP config');

    // tasks.json
    const vscodePath = path.join(installPath, '.vscode');
    fs.mkdirSync(vscodePath, { recursive: true });
    const tasksContent = {
        version: '2.0.0',
        tasks: [{
            label: 'Start Gateway',
            type: 'shell',
            command: 'node',
            args: ['src/gateway/index.js'],
            isBackground: true,
            problemMatcher: [],
            presentation: { reveal: 'silent', panel: 'dedicated' }
        }]
    };
    fs.writeFileSync(
        path.join(vscodePath, 'tasks.json'),
        JSON.stringify(tasksContent, null, 2)
    );
    console.log('');

    // Store in context
    ctx.steeringPath = effectiveSteeringPath;
    ctx.parentKiroPath = effectiveKiroPath;
}

module.exports = { run };
