/**
 * uvx auto-install helper for MyKiroHero installer
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { isWindows, isMac, log, commandExists, downloadFile, findFileRecursive } = require('./utils');

/**
 * Find existing uvx installation path
 * @returns {string|null}
 */
function findUvx() {
    const uvxName = isWindows ? 'uvx.exe' : 'uvx';
    const candidates = isWindows
        ? [
            path.join(process.env.LOCALAPPDATA || '', 'uv', uvxName),
            path.join(process.env.USERPROFILE || '', '.local', 'bin', uvxName),
          ]
        : [
            path.join(process.env.HOME || '', '.local', 'bin', uvxName),
            path.join(process.env.HOME || '', '.cargo', 'bin', uvxName),
            path.join('/usr', 'local', 'bin', uvxName),
          ];

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }

    if (commandExists('uvx')) {
        try {
            const cmd = isWindows ? 'where uvx' : 'which uvx';
            const result = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            if (result) return result.split('\n')[0].trim();
        } catch { /* ignore */ }
    }
    return null;
}

/**
 * Get uv latest release download URL
 * @returns {Promise<{url: string, filename: string}>}
 */
function getUvDownloadUrl() {
    return new Promise((resolve, reject) => {
        const arch = process.arch === 'x64' ? 'x86_64'
            : process.arch === 'arm64' ? 'aarch64'
            : process.arch;

        let platform, ext;
        if (isWindows) {
            platform = `${arch}-pc-windows-msvc`;
            ext = 'zip';
        } else if (isMac) {
            platform = `${arch}-apple-darwin`;
            ext = 'tar.gz';
        } else {
            platform = `${arch}-unknown-linux-gnu`;
            ext = 'tar.gz';
        }

        const https = require('https');
        const options = {
            hostname: 'api.github.com',
            path: '/repos/astral-sh/uv/releases/latest',
            headers: { 'User-Agent': 'MyKiroHero-Installer' }
        };

        https.get(options, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                https.get(res.headers.location, { headers: options.headers }, handleResponse);
                return;
            }
            handleResponse(res);

            function handleResponse(response) {
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => {
                    try {
                        const release = JSON.parse(data);
                        const filename = `uv-${platform}.${ext}`;
                        const asset = release.assets?.find(a => a.name === filename);
                        if (asset) {
                            resolve({ url: asset.browser_download_url, filename });
                        } else {
                            resolve({ url: `https://github.com/astral-sh/uv/releases/latest/download/${filename}`, filename });
                        }
                    } catch {
                        const filename = `uv-${platform}.${ext}`;
                        resolve({ url: `https://github.com/astral-sh/uv/releases/latest/download/${filename}`, filename });
                    }
                });
            }
        }).on('error', () => {
            const filename = `uv-${platform}.${ext}`;
            resolve({ url: `https://github.com/astral-sh/uv/releases/latest/download/${filename}`, filename });
        });
    });
}

/**
 * Check and install uvx (uv tool runner)
 * @param {string} lang - 'zh' | 'en'
 * @returns {Promise<string|null>} uvx full path, or null on failure
 */
async function ensureUvx(lang) {
    const existingPath = findUvx();
    if (existingPath) {
        log(`  ✓ uvx ${lang === 'zh' ? '已安裝' : 'found'}: ${existingPath}`, 'green');
        return existingPath;
    }

    log(`  ${lang === 'zh' ? '正在安裝 uvx...' : 'Installing uvx...'}`, 'yellow');

    const installDir = isWindows
        ? path.join(process.env.LOCALAPPDATA || '', 'uv')
        : path.join(process.env.HOME || '', '.local', 'bin');

    try {
        const { url, filename } = await getUvDownloadUrl();
        log(`  ${lang === 'zh' ? '下載中' : 'Downloading'}: ${filename}`, 'yellow');

        const tempDir = path.join(require('os').tmpdir(), 'uv-install-' + Date.now());
        fs.mkdirSync(tempDir, { recursive: true });
        const tempFile = path.join(tempDir, filename);

        await downloadFile(url, tempFile);

        fs.mkdirSync(installDir, { recursive: true });

        if (isWindows) {
            try {
                execSync(
                    `powershell -Command "Expand-Archive -Path '${tempFile}' -DestinationPath '${tempDir}\\extracted' -Force"`,
                    { stdio: 'pipe' }
                );
            } catch {
                execSync(`tar -xf "${tempFile}" -C "${tempDir}\\extracted"`, { stdio: 'pipe' });
            }
            const extractedDir = path.join(tempDir, 'extracted');
            const uvExe = findFileRecursive(extractedDir, 'uv.exe');
            const uvxExe = findFileRecursive(extractedDir, 'uvx.exe');
            if (uvExe) fs.copyFileSync(uvExe, path.join(installDir, 'uv.exe'));
            if (uvxExe) fs.copyFileSync(uvxExe, path.join(installDir, 'uvx.exe'));
        } else {
            execSync(`tar -xzf "${tempFile}" -C "${tempDir}"`, { stdio: 'pipe' });
            const uvBin = findFileRecursive(tempDir, 'uv');
            const uvxBin = findFileRecursive(tempDir, 'uvx');
            if (uvBin) {
                const dest = path.join(installDir, 'uv');
                fs.copyFileSync(uvBin, dest);
                fs.chmodSync(dest, 0o755);
            }
            if (uvxBin) {
                const dest = path.join(installDir, 'uvx');
                fs.copyFileSync(uvxBin, dest);
                fs.chmodSync(dest, 0o755);
            }
        }

        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }

        const uvxPath = findUvx();
        if (uvxPath) {
            log(`  ✓ uvx ${lang === 'zh' ? '安裝成功' : 'installed'}: ${uvxPath}`, 'green');
            return uvxPath;
        } else {
            log(`  ✗ uvx ${lang === 'zh' ? '安裝後找不到執行檔' : 'binary not found after install'}`, 'red');
            return null;
        }
    } catch (e) {
        log(`  ✗ uvx ${lang === 'zh' ? '安裝失敗' : 'install failed'}: ${e.message}`, 'red');
        try { fs.rmSync(path.join(require('os').tmpdir(), 'uv-install-*'), { recursive: true, force: true }); } catch { /* ignore */ }
        return null;
    }
}

module.exports = { ensureUvx, findUvx };
