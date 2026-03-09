/**
 * Step 1: Language + Environment Check
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { isWindows, isTestMode, log, logStep, ask, exec, commandExists, getKiroCli } = require('../utils');
const i18n = require('../i18n');

/**
 * Run Step 1: language selection + environment checks
 * @param {object} ctx - shared install context
 * @param {readline.Interface} ctx.rl
 * @param {number} ctx.totalSteps
 * @param {Array} ctx.issues
 * @param {Array} ctx.completed
 * @returns {Promise<void>} mutates ctx with: lang, t, gitCmd, gitAvailable, kiroCli, pm2Installed
 */
async function run(ctx) {
    const { rl, totalSteps, issues, completed } = ctx;

    // Language selection
    let lang = 'en';
    if (isTestMode) {
        log(`  [TEST] Auto selecting: 繁體中文`, 'yellow');
        lang = 'zh';
    } else {
        let defaultLang = 'en';
        if (isWindows) {
            try {
                const culture = execSync('powershell -Command "(Get-Culture).Name"', { encoding: 'utf-8', stdio: 'pipe' }).trim().toLowerCase();
                if (culture.startsWith('zh')) defaultLang = 'zh';
            } catch {
                const systemLang = (process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '').toLowerCase();
                if (systemLang.includes('zh') || systemLang.includes('chinese')) defaultLang = 'zh';
            }
        } else {
            const systemLang = (process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '').toLowerCase();
            if (systemLang.includes('zh') || systemLang.includes('chinese')) defaultLang = 'zh';
        }

        console.log('Choose language / 選擇語言:');
        console.log('  1. 繁體中文');
        console.log('  2. English');
        const defaultChoice = defaultLang === 'zh' ? '1' : '2';
        const langChoice = await ask(rl, `Enter (1/2) [${defaultChoice}]: `, defaultChoice);
        lang = (langChoice === '1' || langChoice.toLowerCase() === 'zh') ? 'zh' : 'en';
    }

    ctx.lang = lang;
    ctx.t = i18n[lang];
    const t = ctx.t;
    console.log('');

    logStep(1, totalSteps, t.step1Title);

    // Git command (may be overridden by user)
    let gitCmd = 'git';
    let gitAvailable = false;

    // Node.js version check (hard requirement)
    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (nodeMajor >= 18) {
        log(`  ✓ Node.js ${nodeVersion}`, 'green');
        completed.push('Node.js ' + nodeVersion);
    } else {
        log(`  ✗ Node.js ${nodeVersion} (${lang === 'zh' ? '需要 v18+' : 'requires v18+'})`, 'red');
        log(`    ${lang === 'zh' ? '請更新 Node.js' : 'Please update Node.js'}: https://nodejs.org/`, 'yellow');
        process.exit(1);
    }

    // Git check (soft dependency)
    if (commandExists('git')) {
        const gitVersion = exec('git --version', { silent: true }).trim();
        log(`  ✓ ${gitVersion}`, 'green');
        gitAvailable = true;
        completed.push(gitVersion);
    } else {
        log(`  ✗ ${t.gitNotFound}`, 'red');

        if (!isTestMode) {
            console.log('');
            log(`  ⚠ ${lang === 'zh' ? '找不到 Git' : 'Git not found'}`, 'yellow');
            console.log('');
            log(`  ${t.gitChatAssist}`, 'cyan');
            log('  ────────────────────────', 'white');
            log(`  ${t.gitChatMsg}`, 'white');
            log('  ────────────────────────', 'white');
            console.log('');
            log(`  ${lang === 'zh'
                ? '或直接下載 Git: https://git-scm.com/downloads'
                : 'Or download Git: https://git-scm.com/downloads'}`, 'cyan');
            console.log('');
            log(`  ${lang === 'zh'
                ? '找到後輸入路徑，或直接按 Enter 跳過'
                : 'Enter path when found, or press Enter to skip'}`, 'yellow');

            const customPath = await ask(rl, `  ${t.gitPathPrompt}`, '');

            if (customPath) {
                const resolvedPath = path.resolve(customPath);
                if (fs.existsSync(resolvedPath)) {
                    try {
                        const ver = execSync(`"${resolvedPath}" --version`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
                        gitCmd = `"${resolvedPath}"`;
                        log(`  ✓ ${ver} (${lang === 'zh' ? '自訂路徑' : 'custom path'})`, 'green');
                        gitAvailable = true;
                        completed.push(ver);
                    } catch {
                        log(`  ✗ ${lang === 'zh' ? '路徑無效' : 'Invalid path'}: ${resolvedPath}`, 'red');
                    }
                } else {
                    log(`  ✗ ${lang === 'zh' ? '檔案不存在' : 'File not found'}: ${resolvedPath}`, 'red');
                }
            }
        }

        if (!gitAvailable) {
            issues.push({
                type: 'warning',
                msg: lang === 'zh' ? 'Git 未安裝' : 'Git not installed',
                fix: lang === 'zh'
                    ? '安裝 Git: https://git-scm.com/ 或在 Kiro 聊天輸入「幫我安裝 Git」'
                    : 'Install Git: https://git-scm.com/ or ask Kiro chat "Help me install Git"'
            });
        }
    }

    // Kiro CLI check (soft dependency)
    const kiroCli = getKiroCli();
    if (kiroCli) {
        log(`  ✓ ${t.kiroFound}`, 'green');
        completed.push('Kiro CLI');
    } else {
        log(`  ! Kiro CLI ${lang === 'zh' ? '未找到' : 'not found'}`, 'yellow');
        issues.push({
            type: 'info',
            msg: lang === 'zh' ? 'Kiro CLI 未找到' : 'Kiro CLI not found',
            fix: lang === 'zh' ? 'Extension 需要手動安裝' : 'Extension needs manual install'
        });
    }

    // PM2 check (soft dependency — try to install)
    let pm2Installed = commandExists('pm2');
    if (pm2Installed) {
        const pm2Version = exec('pm2 --version', { silent: true }).trim();
        log(`  ✓ PM2 v${pm2Version}`, 'green');
        completed.push('PM2 v' + pm2Version);
    } else {
        log(`  ! PM2 ${lang === 'zh' ? '未安裝，嘗試安裝...' : 'not installed, trying to install...'}`, 'yellow');
        if (!isTestMode) {
            try {
                // Try without sudo first, then with sudo on Unix
                try {
                    exec('npm install -g pm2', { silent: true });
                } catch {
                    if (process.platform !== 'win32') {
                        log(`  ${lang === 'zh' ? '權限不足，嘗試 sudo...' : 'Permission denied, trying sudo...'}`, 'yellow');
                        exec('sudo npm install -g pm2', { silent: true });
                    } else {
                        throw new Error('npm install -g pm2 failed');
                    }
                }
                if (commandExists('pm2')) {
                    pm2Installed = true;
                    const pm2Version = exec('pm2 --version', { silent: true }).trim();
                    log(`  ✓ PM2 v${pm2Version} ${lang === 'zh' ? '安裝成功' : 'installed'}`, 'green');
                    completed.push('PM2 v' + pm2Version);
                }
            } catch { /* ignore */ }
        }
        if (!pm2Installed) {
            issues.push({
                type: 'warning',
                msg: lang === 'zh' ? 'PM2 安裝失敗' : 'PM2 install failed',
                fix: lang === 'zh' ? '手動安裝: npm install -g pm2' : 'Manual install: npm install -g pm2'
            });
        }
    }
    console.log('');

    // Store results in context
    ctx.gitCmd = gitCmd;
    ctx.gitAvailable = gitAvailable;
    ctx.kiroCli = kiroCli;
    ctx.pm2Installed = pm2Installed;
}

module.exports = { run };
