#!/usr/bin/env node
/**
 * MyKiroHero 跨平台安裝腳本
 * 支援 Windows / Mac / Linux
 * 
 * 用法：
 *   node install.js          # 正常安裝（互動式）
 *   node install.js --test   # 自動測試模式
 *   或
 *   npx mykiro-hero (未來發布到 npm 後)
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

// 測試模式
const isTestMode = process.argv.includes('--test');

// 平台偵測
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// 顏色輸出
const colors = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    white: '\x1b[37m',
};

function log(msg, color = 'white') {
    console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logStep(step, total, msg) {
    log(`[${step}/${total}] ${msg}`, 'cyan');
}

// 互動式問答
function createPrompt() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

async function ask(rl, question, defaultValue = '') {
    // 測試模式：自動使用預設值
    if (isTestMode) {
        log(`  [TEST] Auto answer: "${defaultValue}"`, 'yellow');
        return defaultValue;
    }
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim()));
    });
}

// 執行指令
function exec(cmd, options = {}) {
    try {
        return execSync(cmd, { 
            encoding: 'utf-8', 
            stdio: options.silent ? 'pipe' : 'inherit',
            ...options 
        });
    } catch (e) {
        if (!options.ignoreError) throw e;
        return null;
    }
}

// 檢查指令是否存在
function commandExists(cmd) {
    try {
        if (isWindows) {
            execSync(`where ${cmd}`, { stdio: 'pipe' });
        } else {
            execSync(`which ${cmd}`, { stdio: 'pipe' });
        }
        return true;
    } catch {
        return false;
    }
}

// 取得 Kiro CLI 路徑
function getKiroCli() {
    // 嘗試各種可能的路徑
    const possiblePaths = isWindows ? [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Kiro', 'resources', 'app', 'bin', 'kiro.cmd'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Kiro', 'bin', 'kiro.cmd'),
        'kiro'
    ] : [
        '/Applications/Kiro.app/Contents/Resources/app/bin/kiro',
        path.join(process.env.HOME || '', '.local', 'bin', 'kiro'),
        'kiro'
    ];

    for (const p of possiblePaths) {
        if (commandExists(p) || (p !== 'kiro' && fs.existsSync(p))) {
            return p;
        }
    }
    return null;
}

// 多語系文字
const i18n = {
    zh: {
        title: '🤖 MyKiroHero 安裝程式',
        subtitle: '讓 Kiro AI 成為你的 WhatsApp 助手',
        platform: '偵測到平台',
        step1: '設定安裝路徑...',
        defaultPath: '預設安裝路徑',
        pathPrompt: '按 Enter 使用預設路徑，或輸入自訂路徑: ',
        step2: '檢查必要工具...',
        gitNotFound: 'Git 未安裝',
        gitInstall: '請先安裝 Git: https://git-scm.com/',
        kiroFound: 'Kiro CLI 找到',
        kiroNotFound: 'Kiro CLI 未找到（extension 需要手動安裝）',
        step3: '下載 MyKiroHero...',
        dirExists: '目錄已存在，更新中...',
        downloadDone: '下載完成',
        step4: '安裝 Node.js 依賴...',
        depsDone: '依賴安裝完成',
        step5: '安裝 vscode-rest-control extension...',
        downloadExt: '下載 extension...',
        extDone: 'Extension 安裝完成',
        extFailed: 'Extension 安裝失敗，請手動安裝',
        extSkip: '跳過（找不到 Kiro CLI）',
        extManual: '請手動安裝: kiro --install-extension vscode-rest-control-0.0.18.vsix',
        step6: '設定 AI 人格檔案...',
        langPrompt: '選擇語言 / Choose language:\n  1. 繁體中文\n  2. English\n請輸入 (1/2): ',
        hasConfig: '已有設定檔，跳過',
        copiedFiles: '複製了 {count} 個檔案',
        step7: '寫入環境設定...',
        envDone: '已寫入 .env',
        done: '安裝完成！',
        installPath: '安裝路徑',
        nextSteps: '下一步:',
        next1: '用 Kiro 開啟資料夾',
        next2: '在終端機執行: node src/gateway/index.js',
        next3: '用手機掃描 QR Code 登入 WhatsApp',
        next4: '開始和你的 AI 助手對話！',
        startPrompt: '是否立即啟動 Gateway? (y/N): ',
        starting: '啟動 Gateway...',
        startNote: '（首次啟動會顯示 QR Code，請用手機掃描）',
        startFailed: '啟動失敗',
        installFailed: '安裝失敗',
    },
    en: {
        title: '🤖 MyKiroHero Installer',
        subtitle: 'Turn Kiro AI into your WhatsApp assistant',
        platform: 'Detected platform',
        step1: 'Setting install path...',
        defaultPath: 'Default install path',
        pathPrompt: 'Press Enter for default, or enter custom path: ',
        step2: 'Checking required tools...',
        gitNotFound: 'Git not installed',
        gitInstall: 'Please install Git first: https://git-scm.com/',
        kiroFound: 'Kiro CLI found',
        kiroNotFound: 'Kiro CLI not found (extension needs manual install)',
        step3: 'Downloading MyKiroHero...',
        dirExists: 'Directory exists, updating...',
        downloadDone: 'Download complete',
        step4: 'Installing Node.js dependencies...',
        depsDone: 'Dependencies installed',
        step5: 'Installing vscode-rest-control extension...',
        downloadExt: 'Downloading extension...',
        extDone: 'Extension installed',
        extFailed: 'Extension install failed, please install manually',
        extSkip: 'Skipped (Kiro CLI not found)',
        extManual: 'Manual install: kiro --install-extension vscode-rest-control-0.0.18.vsix',
        step6: 'Setting up AI personality files...',
        langPrompt: 'Choose language / 選擇語言:\n  1. 繁體中文\n  2. English\nEnter (1/2): ',
        hasConfig: 'Config exists, skipping',
        copiedFiles: 'Copied {count} files',
        step7: 'Writing environment config...',
        envDone: 'Wrote .env',
        done: 'Installation complete!',
        installPath: 'Install path',
        nextSteps: 'Next steps:',
        next1: 'Open folder in Kiro',
        next2: 'Run in terminal: node src/gateway/index.js',
        next3: 'Scan QR Code with phone to login WhatsApp',
        next4: 'Start chatting with your AI assistant!',
        startPrompt: 'Start Gateway now? (y/N): ',
        starting: 'Starting Gateway...',
        startNote: '(First run will show QR Code, scan with phone)',
        startFailed: 'Start failed',
        installFailed: 'Installation failed',
    }
};

// 主安裝流程
async function main() {
    console.log('');
    log('╔══════════════════════════════════════════════════════════════╗', 'cyan');
    log('║                                                              ║', 'cyan');
    log('║   🤖 MyKiroHero Installer / 安裝程式                         ║', 'cyan');
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
    
    // 選擇語言（測試模式預設繁中）
    const langChoice = await ask(rl, 'Choose language / 選擇語言:\n  1. 繁體中文\n  2. English\nEnter / 請輸入 (1/2): ', '1');
    const lang = langChoice === '2' ? 'en' : 'zh';
    const t = i18n[lang];
    console.log('');
    
    const totalSteps = 7;

    try {
        // Step 1: 設定安裝路徑
        logStep(1, totalSteps, t.step1);
        
        // 測試模式使用臨時目錄
        const testPath = isWindows 
            ? path.join(process.env.TEMP || 'C:\\Temp', 'mykiro-test-' + Date.now())
            : path.join('/tmp', 'mykiro-test-' + Date.now());
        
        const defaultPath = isTestMode ? testPath : (isWindows 
            ? path.join(process.env.LOCALAPPDATA || '', 'MyKiroHero')
            : path.join(process.env.HOME || '', '.mykiro-hero'));
        
        log(`${t.defaultPath}: ${defaultPath}`, 'yellow');
        const customPath = await ask(rl, t.pathPrompt, '');
        const installPath = customPath || defaultPath;
        console.log('');

        // Step 2: 檢查必要工具
        logStep(2, totalSteps, t.step2);
        
        // 檢查 Node.js（既然能執行這個腳本，一定有）
        const nodeVersion = process.version;
        log(`  ✓ Node.js ${nodeVersion}`, 'green');

        // 檢查 Git
        if (commandExists('git')) {
            const gitVersion = exec('git --version', { silent: true }).trim();
            log(`  ✓ ${gitVersion}`, 'green');
        } else {
            log(`  ✗ ${t.gitNotFound}`, 'red');
            log(`  ${t.gitInstall}`, 'yellow');
            process.exit(1);
        }

        // 檢查 Kiro
        const kiroCli = getKiroCli();
        if (kiroCli) {
            log(`  ✓ ${t.kiroFound}`, 'green');
        } else {
            log(`  ! ${t.kiroNotFound}`, 'yellow');
        }
        console.log('');

        // Step 3: 下載專案
        logStep(3, totalSteps, t.step3);
        
        if (fs.existsSync(installPath)) {
            log(`  ${t.dirExists}`, 'yellow');
            exec('git pull origin main', { cwd: installPath, ignoreError: true });
        } else {
            exec(`git clone https://github.com/NorlWu-TW/MyKiroHero.git "${installPath}"`);
        }
        log(`  ✓ ${t.downloadDone}`, 'green');
        console.log('');

        // Step 4: 安裝依賴
        logStep(4, totalSteps, t.step4);
        exec('npm install', { cwd: installPath });
        log(`  ✓ ${t.depsDone}`, 'green');
        console.log('');

        // Step 5: 安裝 Extension（測試模式跳過下載）
        logStep(5, totalSteps, t.step5);
        
        if (isTestMode) {
            log(`  [TEST] Skipping extension download`, 'yellow');
        } else if (kiroCli) {
            const vsixUrl = 'https://github.com/dpar39/vscode-rest-control/releases/download/v0.0.18/vscode-rest-control-0.0.18.vsix';
            const vsixPath = path.join(installPath, 'vscode-rest-control-0.0.18.vsix');
            
            // 下載 vsix（如果不存在）
            if (!fs.existsSync(vsixPath)) {
                log(`  ${t.downloadExt}`, 'yellow');
                if (isWindows) {
                    exec(`powershell -Command "Invoke-WebRequest -Uri '${vsixUrl}' -OutFile '${vsixPath}'"`, { silent: true });
                } else {
                    exec(`curl -L -o "${vsixPath}" "${vsixUrl}"`, { silent: true });
                }
            }
            
            // 安裝
            try {
                exec(`"${kiroCli}" --install-extension "${vsixPath}"`, { silent: true });
                log(`  ✓ ${t.extDone}`, 'green');
            } catch {
                log(`  ! ${t.extFailed}`, 'yellow');
            }
        } else {
            log(`  ! ${t.extSkip}`, 'yellow');
            log(`  ${t.extManual}`, 'yellow');
        }
        console.log('');

        // Step 6: 設定 Steering 檔案
        logStep(6, totalSteps, t.step6);
        
        const steeringPath = path.join(installPath, '.kiro', 'steering');
        // 根據語言選擇範本資料夾
        const templateFolder = lang === 'en' ? 'steering-en' : 'steering-zh';
        const templatePath = path.join(installPath, 'templates', templateFolder);
        
        // 建立目錄
        fs.mkdirSync(steeringPath, { recursive: true });
        fs.mkdirSync(path.join(steeringPath, 'memory'), { recursive: true });
        
        // 複製範本（只複製不存在的檔案）
        const templateFiles = fs.readdirSync(templatePath);
        let copiedCount = 0;
        
        for (const file of templateFiles) {
            const srcFile = path.join(templatePath, file);
            const destFile = path.join(steeringPath, file);
            
            if (fs.statSync(srcFile).isFile() && !fs.existsSync(destFile)) {
                fs.copyFileSync(srcFile, destFile);
                log(`    + ${file}`, 'green');
                copiedCount++;
            }
        }
        
        if (copiedCount === 0) {
            log(`  ${t.hasConfig}`, 'yellow');
        } else {
            log(`  ✓ ${t.copiedFiles.replace('{count}', copiedCount)}`, 'green');
        }
        console.log('');

        // Step 7: 寫入環境設定
        logStep(7, totalSteps, t.step7);
        
        const envPath = path.join(installPath, '.env');
        const heartbeatPath = path.join(steeringPath, 'HEARTBEAT.md').replace(/\\/g, '/');
        const steeringPathUnix = steeringPath.replace(/\\/g, '/');
        
        const envContent = `# MyKiroHero Environment Config
# Generated: ${new Date().toISOString()}
# Platform: ${platform}
# Language: ${lang}

# AI reply prefix
AI_PREFIX=*[AI Assistant]* 🤖

# Gateway port
GATEWAY_PORT=3000

# Message settings
MESSAGE_MAX_LENGTH=1500
MESSAGE_SPLIT_DELAY=500

# Error notification
ERROR_NOTIFICATION=true

# Heartbeat config path
HEARTBEAT_PATH=${heartbeatPath}

# Steering files path
STEERING_PATH=${steeringPathUnix}

# IDE settings
IDE_TYPE=kiro
IDE_REST_PORT=55139
`;
        
        fs.writeFileSync(envPath, envContent);
        log(`  ✓ ${t.envDone}`, 'green');
        console.log('');

        // 設定 MCP
        const mcpSettingsPath = path.join(installPath, '.kiro', 'settings');
        fs.mkdirSync(mcpSettingsPath, { recursive: true });
        
        const mcpContent = {
            mcpServers: {
                'mykiro-gateway': {
                    command: 'node',
                    args: ['src/mcp-server.js'],
                    env: { GATEWAY_URL: 'http://localhost:3000' },
                    disabled: false,
                    autoApprove: ['send_whatsapp', 'send_whatsapp_media', 'get_gateway_status']
                }
            }
        };
        
        fs.writeFileSync(
            path.join(mcpSettingsPath, 'mcp.json'),
            JSON.stringify(mcpContent, null, 2)
        );

        // 設定 tasks.json
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
                runOptions: { runOn: 'folderOpen' },
                presentation: { reveal: 'silent', panel: 'dedicated' }
            }]
        };
        
        fs.writeFileSync(
            path.join(vscodePath, 'tasks.json'),
            JSON.stringify(tasksContent, null, 2)
        );

        // 完成
        console.log('');
        log('╔══════════════════════════════════════════════════════════════╗', 'green');
        log(`║  ✓ ${t.done}                                              ║`, 'green');
        log('╚══════════════════════════════════════════════════════════════╝', 'green');
        console.log('');
        log(`${t.installPath}: ${installPath}`, 'cyan');
        console.log('');

        // 測試模式：驗證安裝結果
        if (isTestMode) {
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
            
            // 驗證 .env 內容
            console.log('');
            log('  Checking .env content...', 'cyan');
            const envContent = fs.readFileSync(path.join(installPath, '.env'), 'utf-8');
            const envChecks = ['AI_PREFIX', 'GATEWAY_PORT', 'HEARTBEAT_PATH', 'STEERING_PATH'];
            for (const key of envChecks) {
                if (envContent.includes(key)) {
                    log(`    ✓ ${key} found`, 'green');
                } else {
                    log(`    ✗ ${key} missing`, 'red');
                    testPassed = false;
                }
            }
            
            // 驗證 steering 檔案沒有個人資訊
            console.log('');
            log('  Checking for personal info leaks...', 'cyan');
            const sensitivePatterns = [/886953870991/, /NorlWu(?!-TW)/, /叫小賀/];
            const steeringFiles = fs.readdirSync(steeringPath).filter(f => f.endsWith('.md'));
            
            for (const file of steeringFiles) {
                const content = fs.readFileSync(path.join(steeringPath, file), 'utf-8');
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
            
            // 清理測試目錄
            console.log('');
            log('  Cleaning up test directory...', 'yellow');
            fs.rmSync(installPath, { recursive: true, force: true });
            log(`  ✓ Removed ${installPath}`, 'green');
            
            rl.close();
            return;
        }

        log(t.nextSteps, 'yellow');
        log(`  1. ${t.next1}: ${installPath}`, 'white');
        log(`  2. ${t.next2}`, 'white');
        log(`  3. ${t.next3}`, 'white');
        log(`  4. ${t.next4}`, 'white');
        console.log('');

        // 詢問是否立即啟動（測試模式跳過）
        const startNow = await ask(rl, t.startPrompt, 'n');
        
        if (startNow.toLowerCase() === 'y' && !isTestMode) {
            console.log('');
            log(t.starting, 'cyan');
            log(t.startNote, 'yellow');
            console.log('');
            
            rl.close();
            
            // 啟動 Gateway（不等待結束）
            const gateway = spawn('node', ['src/gateway/index.js'], {
                cwd: installPath,
                stdio: 'inherit'
            });
            
            gateway.on('error', (err) => {
                log(`${t.startFailed}: ${err.message}`, 'red');
            });
        } else {
            rl.close();
        }

    } catch (error) {
        log(`${t.installFailed}: ${error.message}`, 'red');
        rl.close();
        process.exit(1);
    }
}

main();
