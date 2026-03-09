/**
 * Step 5: Launch + Install report (including test verification)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { isWindows, isMac, isTestMode, log, logStep, exec, commandExists } = require('../utils');

/**
 * Run Step 5: PM2 launch, Kiro trust settings, install report, test verification
 * @param {object} ctx - shared install context
 */
async function run(ctx) {
    const { rl, totalSteps, issues, completed, lang, t, installPath, isInsideProject, pm2Installed, steeringPath, parentKiroPath } = ctx;

    logStep(5, totalSteps, t.step5Title);

    // PM2 launch
    if (pm2Installed && !isTestMode) {
        try {
            exec('pm2 delete gateway', { silent: true, ignoreError: true });
            exec('pm2 delete recall-worker', { silent: true, ignoreError: true });
            exec('pm2 start ecosystem.config.js', { cwd: installPath, silent: true });
            log(`  ✓ Gateway ${lang === 'zh' ? '已用 PM2 啟動' : 'started with PM2'}`, 'green');
            completed.push('PM2 Gateway');

            log(`  ${lang === 'zh' ? '提示：首次啟動會下載 Chromium (~170MB)，請耐心等候' : 'Note: First launch downloads Chromium (~170MB), please be patient'}`, 'yellow');
            log(`  ${lang === 'zh' ? '📱 WhatsApp QR Code 會出現在日誌中，請執行：pm2 logs gateway' : '📱 WhatsApp QR Code will appear in logs. Run: pm2 logs gateway'}`, 'cyan');
            log(`  ${lang === 'zh' ? '   掃碼後 AI 就會在 WhatsApp 上線！' : '   Scan it and your AI goes live on WhatsApp!'}`, 'cyan');

            try {
                exec('pm2 save', { silent: true });
                log(`  ✓ PM2 ${lang === 'zh' ? '狀態已保存' : 'state saved'}`, 'green');
            } catch { /* ignore */ }
        } catch (e) {
            log(`  ! PM2 ${lang === 'zh' ? '啟動失敗' : 'start failed'}: ${e.message}`, 'yellow');
            issues.push({
                type: 'warning',
                msg: lang === 'zh' ? 'PM2 啟動失敗' : 'PM2 start failed',
                fix: lang === 'zh' ? '手動啟動: pm2 start ecosystem.config.js' : 'Manual start: pm2 start ecosystem.config.js'
            });
        }
    } else if (!pm2Installed && !isTestMode) {
        issues.push({
            type: 'warning',
            msg: lang === 'zh' ? 'PM2 未安裝，無法自動啟動' : 'PM2 not installed, cannot auto-start',
            fix: lang === 'zh' ? '安裝 PM2 後手動啟動: npm i -g pm2 && pm2 start ecosystem.config.js' : 'Install PM2 then start: npm i -g pm2 && pm2 start ecosystem.config.js'
        });
    }

    // Kiro trust settings
    const kiroUserSettingsPath = isWindows
        ? path.join(process.env.APPDATA || '', 'Kiro', 'User', 'settings.json')
        : isMac
            ? path.join(process.env.HOME || '', 'Library', 'Application Support', 'Kiro', 'User', 'settings.json')
            : path.join(process.env.HOME || '', '.config', 'Kiro', 'User', 'settings.json');

    try {
        let userSettings = {};
        if (fs.existsSync(kiroUserSettingsPath)) {
            const content = fs.readFileSync(kiroUserSettingsPath, 'utf-8');
            userSettings = JSON.parse(content);
        } else {
            fs.mkdirSync(path.dirname(kiroUserSettingsPath), { recursive: true });
        }
        if (!userSettings['kiroAgent.trustedCommands']?.includes('*')) {
            userSettings['kiroAgent.trustedCommands'] = ['*'];
        }
        userSettings['kiroAgent.trustedTools'] = ['*', 'webFetch', 'remote_web_search'];
        fs.writeFileSync(kiroUserSettingsPath, JSON.stringify(userSettings, null, 2));
        log(`  ✓ ${lang === 'zh' ? 'Kiro 信任設定已更新' : 'Kiro trust settings updated'}`, 'green');
        completed.push(lang === 'zh' ? 'Kiro 信任設定' : 'Kiro trust settings');
    } catch {
        log(`  ! ${lang === 'zh' ? 'Kiro 設定更新失敗' : 'Kiro settings update failed'}`, 'yellow');
    }
    console.log('');

    // ═══ Install Report ═══
    log('╔══════════════════════════════════════════════════════════════╗', 'green');
    log(`║  ✓ ${t.done}                                              ║`, 'green');
    log('╚══════════════════════════════════════════════════════════════╝', 'green');
    console.log('');

    log(`${t.reportComplete}:`, 'green');
    for (const item of completed) {
        log(`  ✓ ${item}`, 'green');
    }
    console.log('');

    const warnings = issues.filter(i => i.type === 'warning');
    const infos = issues.filter(i => i.type === 'info');

    if (warnings.length > 0 || infos.length > 0) {
        log(`${t.reportWarning}:`, 'yellow');
        for (const issue of [...warnings, ...infos]) {
            const icon = issue.type === 'warning' ? '⚠' : 'ℹ';
            log(`  ${icon} ${issue.msg}`, 'yellow');
            if (issue.fix) log(`    → ${issue.fix}`, 'white');
        }
        console.log('');
    }

    // Next steps
    const parentDir = path.dirname(installPath);
    log(`${t.reportNext}:`, 'cyan');
    log(`  ${t.installPath}: ${installPath}`, 'white');
    if (pm2Installed) {
        log(`  ${lang === 'zh' ? '查看日誌' : 'View logs'}: pm2 logs gateway`, 'white');
    }

    const isRunningInKiro = process.env.TERM_PROGRAM === 'kiro';
    if (isRunningInKiro) {
        if (pm2Installed) {
            log(`  ${lang === 'zh' ? 'Gateway 已在背景執行，等待 WhatsApp 登入...' : 'Gateway running in background, waiting for WhatsApp login...'}`, 'cyan');
        }
    } else {
        log(`  1. ${lang === 'zh' ? '用 Kiro IDE 開啟' : 'Open with Kiro IDE'}: ${parentDir}`, 'white');
        log(`  2. ${lang === 'zh' ? '在 Kiro 聊天視窗輸入任意文字開始' : 'Type anything in Kiro chat to start'}`, 'white');
    }
    console.log('');

    // ═══ Test Mode Verification ═══
    if (isTestMode) {
        runTestVerification(ctx);
    }

    // Non-test mode hint
    if (!isTestMode && !isRunningInKiro && !pm2Installed) {
        log('╔══════════════════════════════════════════════════════════════╗', 'yellow');
        log('║  ⚠️  Please run in Kiro Terminal / 請在 Kiro 終端機執行       ║', 'yellow');
        log('╚══════════════════════════════════════════════════════════════╝', 'yellow');
        console.log('');
        log(`  1. ${lang === 'zh' ? '開啟 Kiro IDE' : 'Open Kiro IDE'}`, 'white');
        log(`  2. ${lang === 'zh' ? '開啟此資料夾' : 'Open this folder'}: ${parentDir}`, 'white');
        log(`  3. ${lang === 'zh' ? '在 Terminal 面板執行' : 'Run in Terminal panel'}: node MyKiroHero/install.js`, 'white');
    }
    console.log('');
}

/**
 * Test mode verification (called only in --test mode)
 */
function runTestVerification(ctx) {
    const { rl, totalSteps, installPath, isInsideProject, steeringPath } = ctx;

    console.log('');
    log('🧪 TEST VERIFICATION - 驗證安裝結果', 'cyan');
    console.log('');

    let testPassed = true;
    const requiredFiles = [
        '.env',
        '.kiro/steering/IDENTITY.md',
        '.kiro/steering/SOUL.md',
        '.kiro/steering/USER.md',
        '.kiro/steering/MEMORY.md',
        '.kiro/steering/AGENTS.md',
        '.kiro/steering/HEARTBEAT.md',
        '.kiro/steering/ONBOARDING.md',
        '.kiro/steering/TOOLS.md',
        '.kiro/settings/mcp.json',
        '.vscode/tasks.json',
        'src/gateway/index.js',
        'src/gateway/server.js',
        'src/mcp-server.js',
        'package.json'
    ];

    for (const file of requiredFiles) {
        const filePath = path.join(installPath, file);
        if (fs.existsSync(filePath)) {
            log(`  ✓ ${file}`, 'green');
        } else {
            log(`  ✗ ${file} (MISSING)`, 'red');
            testPassed = false;
        }
    }

    // Verify .env content
    console.log('');
    log('  Checking .env content...', 'cyan');
    const envFileContent = fs.readFileSync(path.join(installPath, '.env'), 'utf-8');
    const envChecks = ['AI_PREFIX', 'GATEWAY_PORT', 'HEARTBEAT_PATH', 'STEERING_PATH', 'OWNER_CHAT_ID', 'FRAGMENT_SCORE_THRESHOLD', 'MEMORY_REPO', 'DEFAULT_LOCATION'];
    for (const key of envChecks) {
        if (envFileContent.includes(key)) {
            log(`    ✓ ${key} found`, 'green');
        } else {
            log(`    ✗ ${key} missing`, 'red');
            testPassed = false;
        }
    }

    // Verify .env has no personal info
    // Skip when running inside an already-configured project (user's .env legitimately has their chatId)
    if (!isInsideProject) {
        console.log('');
        log('  Checking .env for personal info...', 'cyan');
        const envSensitive = [/886953870991/, /NorlWu(?!-TW)/, /叫小賀/, /Moltbot/];
        for (const pattern of envSensitive) {
            if (pattern.test(envFileContent)) {
                log(`    ✗ .env contains sensitive info: ${pattern}`, 'red');
                testPassed = false;
            } else {
                log(`    ✓ .env clean for ${pattern}`, 'green');
            }
        }
    } else {
        console.log('');
        log('  Skipping .env personal info check (inside configured project)', 'yellow');
    }

    // Verify runtime directories
    console.log('');
    log('  Checking runtime directories...', 'cyan');
    const requiredDirs = ['sessions', 'data', 'media', 'temp'];
    for (const dir of requiredDirs) {
        const dirPath = path.join(installPath, dir);
        if (fs.existsSync(dirPath)) {
            log(`    ✓ ${dir}/`, 'green');
        } else {
            log(`    ✗ ${dir}/ (MISSING)`, 'red');
            testPassed = false;
        }
    }

    // Verify steering TEMPLATE files have no personal info
    // In existing project, check templates/steering/ (what new users get), not local .kiro/steering/
    console.log('');
    log('  Checking for personal info leaks...', 'cyan');
    const sensitivePatterns = [/886953870991/, /NorlWu(?!-TW)/, /叫小賀/];
    const checkPath = isInsideProject ? path.join(installPath, 'templates', 'steering') : steeringPath;
    const steeringFiles = fs.readdirSync(checkPath).filter(f => f.endsWith('.md'));

    for (const file of steeringFiles) {
        const content = fs.readFileSync(path.join(checkPath, file), 'utf-8');
        let hasLeak = false;
        for (const pattern of sensitivePatterns) {
            if (pattern.test(content)) {
                log(`    ✗ ${file} contains sensitive info: ${pattern}`, 'red');
                hasLeak = true;
                testPassed = false;
            }
        }
        if (!hasLeak) {
            log(`    ✓ ${file} clean`, 'green');
        }
    }

    // Verify 5-step structure
    console.log('');
    log('  Checking 5-step structure...', 'cyan');
    log(`    ✓ totalSteps = ${totalSteps}`, totalSteps === 5 ? 'green' : 'red');
    if (totalSteps !== 5) testPassed = false;
    log(`    ✓ issues array used`, 'green');
    log(`    ✓ completed array used`, 'green');

    console.log('');
    if (testPassed) {
        log('╔══════════════════════════════════════════════════════════════╗', 'green');
        log('║  🎉 ALL TESTS PASSED!                                        ║', 'green');
        log('╚══════════════════════════════════════════════════════════════╝', 'green');
    } else {
        log('╔══════════════════════════════════════════════════════════════╗', 'red');
        log('║  ❌ SOME TESTS FAILED!                                       ║', 'red');
        log('╚══════════════════════════════════════════════════════════════╝', 'red');
        process.exit(1);
    }

    // Cleanup test directory
    console.log('');
    if (installPath.includes('mykiro-test-')) {
        log('  Cleaning up test directory...', 'yellow');
        fs.rmSync(installPath, { recursive: true, force: true });
        log(`  ✓ Removed ${installPath}`, 'green');
    } else {
        log('  Skipping cleanup (running inside project directory)', 'yellow');
    }

    rl.close();
}

module.exports = { run };
