/**
 * Shared utilities for MyKiroHero installer
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const isTestMode = process.argv.includes('--test');

const colors = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    white: '\x1b[37m',
};

/** @param {string} msg @param {string} color */
function log(msg, color = 'white') {
    console.log(`${colors[color]}${msg}${colors.reset}`);
}

/** @param {number} step @param {number} total @param {string} msg */
function logStep(step, total, msg) {
    log(`[${step}/${total}] ${msg}`, 'cyan');
}

/** Create readline interface */
function createPrompt() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * Ask user a question (auto-answers in test mode)
 * @param {readline.Interface} rl
 * @param {string} question
 * @param {string} defaultValue
 */
async function ask(rl, question, defaultValue = '') {
    if (isTestMode) {
        log(`  [TEST] Auto answer: "${defaultValue}"`, 'yellow');
        return defaultValue;
    }
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim()));
    });
}

/**
 * Execute a shell command
 * @param {string} cmd
 * @param {object} options
 */
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

/**
 * Check if a command exists on the system
 * @param {string} cmd
 */
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

/**
 * Get Kiro CLI path
 * @returns {string|null}
 */
function getKiroCli() {
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

/**
 * Download a file via https (supports redirects)
 * @param {string} url
 * @param {string} destPath
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const http = require('http');

        function doGet(targetUrl, redirectCount = 0) {
            if (redirectCount > 5) return reject(new Error('Too many redirects'));
            const mod = targetUrl.startsWith('https') ? https : http;
            mod.get(targetUrl, { headers: { 'User-Agent': 'MyKiroHero-Installer' } }, (res) => {
                if (res.statusCode === 302 || res.statusCode === 301) {
                    return doGet(res.headers.location, redirectCount + 1);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                const file = fs.createWriteStream(destPath);
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
                file.on('error', reject);
            }).on('error', reject);
        }
        doGet(url);
    });
}

/**
 * Recursively search for a file by name
 * @param {string} dir
 * @param {string} filename
 * @returns {string|null}
 */
function findFileRecursive(dir, filename) {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === filename) return fullPath;
            if (entry.isDirectory()) {
                const found = findFileRecursive(fullPath, filename);
                if (found) return found;
            }
        }
    } catch { /* ignore */ }
    return null;
}

module.exports = {
    isWindows, isMac, isLinux, isTestMode,
    colors, log, logStep, createPrompt, ask,
    exec, commandExists, getKiroCli,
    downloadFile, findFileRecursive,
};
