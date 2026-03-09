/**
 * Step 2: Get project + Install dependencies
 */
const fs = require('fs');
const path = require('path');
const { isWindows, isTestMode, log, logStep, exec, getKiroCli } = require('../utils');

/**
 * Run Step 2: clone/update project, npm install, extension
 * @param {object} ctx - shared install context
 * @returns {Promise<void>} mutates ctx with: installPath, isInsideProject
 */
async function run(ctx) {
    const { totalSteps, issues, completed, lang, t, gitCmd, gitAvailable, kiroCli } = ctx;

    logStep(2, totalSteps, t.step2Title);

    // Determine install path
    const testPath = isWindows
        ? path.join(process.env.TEMP || 'C:\\Temp', 'mykiro-test-' + Date.now())
        : path.join('/tmp', 'mykiro-test-' + Date.now());

    const defaultPath = isTestMode ? testPath : (isWindows
        ? path.join(process.env.LOCALAPPDATA || '', 'MyKiroHero')
        : path.join(process.env.HOME || '', '.mykiro-hero'));

    let installPath = defaultPath;

    // Detect if already inside project directory
    const currentDir = process.cwd();
    const currentPkgPath = path.join(currentDir, 'package.json');
    let isInsideProject = false;

    if (fs.existsSync(currentPkgPath)) {
        try {
            const currentPkg = JSON.parse(fs.readFileSync(currentPkgPath, 'utf-8'));
            if (currentPkg.name === 'mykiro-hero') {
                isInsideProject = true;
                installPath = currentDir;
                log(`  ${lang === 'zh' ? '已在專案目錄內，跳過下載' : 'Already inside project, skipping download'}`, 'yellow');
            }
        } catch { /* ignore */ }
    }

    if (!isInsideProject) {
        const pkgPath = path.join(installPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
            log(`  ${t.dirExists}`, 'yellow');
            if (gitAvailable) {
                try {
                    exec(`${gitCmd} pull origin main`, { cwd: installPath, silent: true });
                } catch {
                    log(`  ${lang === 'zh' ? '更新失敗，使用現有版本' : 'Update failed, using existing version'}`, 'yellow');
                }
            }
        } else if (gitAvailable) {
            if (fs.existsSync(installPath)) {
                fs.rmSync(installPath, { recursive: true, force: true });
            }
            exec(`${gitCmd} clone https://github.com/NorlWu-TW/MyKiroHero.git "${installPath}"`);
        } else {
            log(`  ⚠ ${lang === 'zh' ? '沒有 Git，無法自動下載' : 'No Git, cannot auto-download'}`, 'yellow');
            log(`  ${lang === 'zh'
                ? '請手動下載: https://github.com/NorlWu-TW/MyKiroHero/archive/refs/heads/main.zip'
                : 'Manual download: https://github.com/NorlWu-TW/MyKiroHero/archive/refs/heads/main.zip'}`, 'white');
            log(`  ${lang === 'zh' ? '解壓到' : 'Extract to'}: ${installPath}`, 'white');
            issues.push({
                type: 'warning',
                msg: lang === 'zh' ? '需要手動下載專案' : 'Manual project download needed',
                fix: 'https://github.com/NorlWu-TW/MyKiroHero/archive/refs/heads/main.zip'
            });

            if (!fs.existsSync(path.join(installPath, 'package.json'))) {
                log(`\n  ${lang === 'zh' ? '請下載後重新執行安裝程式' : 'Please download and re-run installer'}`, 'red');
                ctx.rl.close();
                process.exit(1);
            }
        }
    }
    log(`  ✓ ${t.downloadDone}`, 'green');
    completed.push(lang === 'zh' ? '專案就緒' : 'Project ready');

    // npm install
    log(`  ${lang === 'zh' ? '安裝依賴中（可能需要 1-3 分鐘）...' : 'Installing dependencies (may take 1-3 minutes)...'}`, 'yellow');
    exec('npm install --silent', { cwd: installPath, silent: true });
    log(`  ✓ ${t.depsDone}`, 'green');
    completed.push(lang === 'zh' ? '依賴安裝' : 'Dependencies');

    // better-sqlite3 check
    try {
        exec(`node -e "require('better-sqlite3')"`, { cwd: installPath, silent: true });
        log(`  ✓ SQLite native module`, 'green');
    } catch {
        log(`  ⚠ SQLite native module ${lang === 'zh' ? '編譯失敗' : 'build failed'}`, 'yellow');
        log(`    ${lang === 'zh' ? 'Memory Engine 將使用 JSON fallback 模式' : 'Memory Engine will use JSON fallback mode'}`, 'yellow');
        issues.push({
            type: 'info',
            msg: lang === 'zh' ? 'SQLite 編譯失敗，使用 JSON fallback' : 'SQLite build failed, using JSON fallback',
            fix: lang === 'zh' ? '功能不受影響' : 'No impact on functionality'
        });
    }

    // Runtime directories
    const runtimeDirs = ['sessions', 'memory/journals', 'data', 'media', 'temp'];
    for (const dir of runtimeDirs) {
        fs.mkdirSync(path.join(installPath, dir), { recursive: true });
    }
    log(`  ✓ ${lang === 'zh' ? 'Runtime 資料夾已建立' : 'Runtime directories created'}`, 'green');

    // Extension (install from marketplace)
    if (isTestMode) {
        log(`  [TEST] Skipping extension install`, 'yellow');
    } else if (kiroCli) {
        try {
            exec(`"${kiroCli}" --install-extension dpar39.vscode-rest-control`, { silent: true });
            log(`  ✓ ${t.extDone}`, 'green');
            completed.push('Extension');
        } catch (installErr) {
            log(`  ! ${t.extFailed}`, 'yellow');
            log(`  ${lang === 'zh'
                ? '  請在 Kiro 中手動安裝: 搜尋 "REST Control" 或執行 kiro --install-extension dpar39.vscode-rest-control'
                : '  Manual install in Kiro: search "REST Control" or run kiro --install-extension dpar39.vscode-rest-control'}`, 'yellow');
        }
    } else {
        log(`  ! Extension ${lang === 'zh' ? '跳過（Kiro CLI 未找到）' : 'skipped (Kiro CLI not found)'}`, 'yellow');
    }
    console.log('');

    ctx.installPath = installPath;
    ctx.isInsideProject = isInsideProject;
}

module.exports = { run };
