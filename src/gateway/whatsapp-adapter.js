/**
 * WhatsApp Adapter for Gateway
 * 
 * Auto-recovery features:
 * - Retry on initialize failure (5 attempts, exponential backoff)
 * - Auto-reconnect on disconnect (10 attempts, exponential backoff)
 * - Auto-clear .wwebjs_cache on repeated failures (stale cache fix)
 * - Health check every 2 minutes (detect silent disconnects)
 * - Watchdog for stuck authenticated→ready transition
 * - Zombie Chrome cleanup between retries
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { setTimeOffset, isTimeSynced } = require('../utils/timezone');
const config = require('./config');

class WhatsAppAdapter {
    constructor(gateway) {
        this.gateway = gateway;
        this.client = this._createClient();

        // Message dedup (prevent duplicate triggers)
        this.processedMessages = new Set();

        // Whether to send welcome message (only after QR scan)
        this.needsWelcome = false;

        // Auto-recovery state
        this._reconnecting = false;
        this._reconnectAttempts = 0;
        this._maxReconnectAttempts = 10;
        this._healthCheckInterval = null;
        this._destroyed = false; // graceful shutdown flag

        // Send Queue: serialize all wwebjs operations (pupPage.evaluate)
        // Prevents concurrent CDP calls causing "Promise was collected" errors
        this._sendQueue = Promise.resolve();
        this._queueLength = 0;

        this.setupEvents();
    }

    // ==================== Send Queue ====================

    /**
     * Enqueue an operation for serialized execution
     * @param {Function} fn - async function to execute
     * @param {Object} [options]
     * @param {number} [options.timeout] - timeout in ms (default 0 = no limit)
     * @param {boolean} [options.skipIfBusy] - skip if queue is busy (for low-priority ops like typing)
     * @returns {Promise}
     */
    _enqueue(fn, options = {}) {
        const { timeout = 0, skipIfBusy = false } = options;

        // Low-priority: skip if queue is busy
        if (skipIfBusy && this._queueLength > 0) {
            return Promise.resolve(null);
        }

        this._queueLength++;

        const task = this._sendQueue.then(async () => {
            try {
                if (timeout > 0) {
                    return await Promise.race([
                        fn(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Queue task timeout')), timeout)
                        ),
                    ]);
                }
                return await fn();
            } finally {
                this._queueLength--;
            }
        });

        // Update queue tail (don't let errors break the chain)
        this._sendQueue = task.catch(() => {});

        return task;
    }

    /**
     * Create wwebjs Client instance (unified config)
     */
    _createClient() {
            return new Client({
                authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
                puppeteer: {
                    headless: process.env.WA_HEADLESS === 'true', // Default: false (shows QR in Chrome window)
                    protocolTimeout: 180000,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                }
            });
        }


    setupEvents() {
        this.client.on('qr', (qr) => {
            console.log('\n[WhatsApp] QR event fired - please scan');
            qrcode.generate(qr, { small: true });
            this.needsWelcome = true;
        });

        this.client.on('loading_screen', (percent, message) => {
            console.log(`[WhatsApp] loading_screen: ${percent}% - ${message}`);
        });

        this.client.on('authenticated', () => {
            console.log('[WhatsApp] authenticated event fired');
            this._reconnectAttempts = 0; // Auth success, reset counter
            // Clear any existing watchdog before starting a new one
            if (this._readyWatchdog) clearInterval(this._readyWatchdog);
            // Watchdog: poll state in case ready event doesn't fire (wwebjs timing bug)
            let watchdogChecks = 0;
            this._readyWatchdog = setInterval(async () => {
                watchdogChecks++;
                try {
                    if (this.client.info) {
                        clearInterval(this._readyWatchdog);
                        return;
                    }
                    const state = await this.client.getState();
                    console.log(`[WhatsApp] watchdog #${watchdogChecks}: state=${state}`);
                    if (state === 'CONNECTED') {
                        console.log('[WhatsApp] watchdog: CONNECTED but ready never fired, restarting...');
                        clearInterval(this._readyWatchdog);
                        await this._reconnect('watchdog: ready event stuck');
                    }
                    if (watchdogChecks >= 12) { // 3 min max
                        console.log('[WhatsApp] watchdog: giving up after 3 min, attempting reconnect...');
                        clearInterval(this._readyWatchdog);
                        await this._reconnect('watchdog: timeout after 3 min');
                    }
                } catch (err) {
                    // getState() may fail if page not ready, ignore
                }
            }, 15000);
        });

        this.client.on('auth_failure', async (msg) => {
            console.error('[WhatsApp] auth_failure event:', msg);
            // Auth failure usually means corrupted session, clear cache and retry
            await this._reconnect('auth_failure: ' + msg, true);
        });

        this.client.on('change_state', (state) => {
            console.log('[WhatsApp] change_state:', state);
            // CONFLICT = another WhatsApp Web session opened (from phone)
            if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
                console.log(`[WhatsApp] state=${state}, will attempt reconnect...`);
                // Delay before reconnect to avoid conflicting with wwebjs internal reconnect
                setTimeout(() => this._reconnect(`change_state: ${state}`), 5000);
            }
        });

        this.client.on('disconnected', async (reason) => {
            console.log('[WhatsApp] disconnected event:', reason);
            if (!this._destroyed) {
                // Auto-reconnect
                const clearCache = reason === 'NAVIGATION' || reason === 'LOGOUT';
                await this._reconnect('disconnected: ' + reason, clearCache);
            }
        });

        this.client.on('ready', async () => {
            console.log('[WhatsApp] ready event fired - connected!');
            if (this._readyWatchdog) clearInterval(this._readyWatchdog);
            this._reconnecting = false;
            this._reconnectAttempts = 0;
            this.gateway.registerClient('whatsapp', this);

            // Start health check
            this._startHealthCheck();

            if (this.needsWelcome) {
                console.log('[WhatsApp] QR login detected, sending welcome');
                await this.sendWelcomeMessage();
                this.needsWelcome = false;
            } else {
                console.log('[WhatsApp] auto-reconnect, skip welcome');
            }
        });

        // message_create captures all messages, including self-sent
        this.client.on('message_create', async (msg) => {
            // Time Sync: 用第一則訊息的 timestamp 校正時間
            if (!isTimeSynced() && msg.timestamp) {
                setTimeOffset(msg.timestamp);
            }

            // Dedup: check if already processed
            const msgId = msg.id._serialized;
            if (this.processedMessages.has(msgId)) {
                return; // Already processed, skip
            }
            this.processedMessages.add(msgId);

            // Clean up old message IDs (keep last 50)
            // Atomic operation: create new Set instead of clear+re-add to avoid race condition
            if (this.processedMessages.size > 100) {
                const arr = Array.from(this.processedMessages);
                const recent = arr.slice(-50);

                this.processedMessages = new Set(recent);
            }

            // Typing indicator: show "typing" immediately on message receive (low priority, skip if queue busy)
            if (msg.from && !msg.from.endsWith('@lid')) {
                this._enqueue(async () => {
                    try {
                        const chat = await msg.getChat();
                        await chat.sendStateTyping();
                    } catch (err) {
                    // typing failure doesn't affect main flow
                    }
                }, { skipIfBusy: true, timeout: 5000 });
            }

            // Use msg.from as default, no extra API calls needed
            let contactName = msg.from;
            let chatName = msg.from;

            // Try to get more info from msg._data (no extra API call needed)
            try {
                if (msg._data && msg._data.notifyName) {
                    contactName = msg._data.notifyName;
                }
            } catch (e) {
                // ignore
            }

            // Download media files (regardless of sender)
            let mediaPath = null;
            let mediaMimeType = null;
            if (msg.hasMedia) {
                try {
                    console.log(`[WhatsApp] Media detected, downloading... (fromMe: ${msg.fromMe})`);
                    const media = await msg.downloadMedia();
                    if (media) {
                        mediaMimeType = media.mimetype;
                        mediaPath = this.saveMedia(media, msg.id._serialized);
                        console.log(`[WhatsApp] Media saved: ${mediaPath}`);
                    } else {
                        console.log(`[WhatsApp] Media download returned null`);
                    }
                } catch (err) {
                    console.error('[WhatsApp] Media download failed:', err.message);
                }
            }

            try {
                this.gateway.receiveMessage('whatsapp', {
                    chatId: msg.from,
                    chatName: chatName,
                    isGroup: msg.from.endsWith('@g.us'),
                    sender: contactName,
                    senderId: msg.author || msg.from,
                    text: msg.body,
                    hasMedia: msg.hasMedia,
                    mediaPath: mediaPath,
                    mediaMimeType: mediaMimeType,
                    messageId: msg.id._serialized,
                    fromMe: msg.fromMe,
                    timestamp: msg.timestamp,
                    raw: msg
                });
            } catch (err) {
                console.error('[WhatsApp] Message processing error:', err.message);
            }
        });
    }

    // ==================== Auto-Recovery ====================

    /**
     * Auto-reconnect (core recovery logic)
     * @param {string} reason - reconnect reason (for logging)
     * @param {boolean} clearCache - whether to clear .wwebjs_cache (stale cache fix)
     */
    async _reconnect(reason, clearCache = false) {
        if (this._destroyed) {
            console.log('[WhatsApp] _reconnect skipped: adapter destroyed');
            return;
        }
        if (this._reconnecting) {
            console.log('[WhatsApp] _reconnect skipped: already reconnecting');
            return;
        }

        this._reconnecting = true;
        this._reconnectAttempts++;

        console.log(`[WhatsApp] Reconnecting (reason: ${reason}, attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})`);

        if (this._reconnectAttempts > this._maxReconnectAttempts) {
            console.error('[WhatsApp] Max reconnect attempts reached, giving up. Manual pm2 restart gateway required');
            this._reconnecting = false;
            return;
        }

        // Stop health check
        this._stopHealthCheck();

        // Clean up old client
        try {
            if (this._readyWatchdog) clearInterval(this._readyWatchdog);
            await this.client.destroy();
        } catch (e) {
            // ignore cleanup errors
        }

        await this._killZombieChrome();

        // Auto-clear cache after 3rd failure (stale cache is the most common issue)
        if (clearCache || this._reconnectAttempts >= 3) {
            this._clearWwebjsCache();
        }

        // Exponential backoff: 5s, 10s, 15s, 20s, 25s... (max 60s)
        const delay = Math.min(5000 * this._reconnectAttempts, 60000);
        console.log(`[WhatsApp] Reconnecting in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));

        if (this._destroyed) {
            this._reconnecting = false;
            return;
        }

        // Rebuild client
        this.client = this._createClient();
        this.setupEvents();

        try {
            await this.client.initialize();
            console.log('[WhatsApp] Reconnect initialization succeeded');
            // ready event will set _reconnecting = false
        } catch (err) {
            console.error(`[WhatsApp] Reconnect initialization failed: ${err.message}`);
            this._reconnecting = false;
            // Recursive retry (delay will increase)
            await this._reconnect('init failed after reconnect: ' + err.message);
        }
    }

    /**
     * Clear .wwebjs_cache (fix stale WhatsApp Web JS issues)
     * Note: does NOT clear .wwebjs_auth (that's the QR session, clearing requires re-scan)
     */
    _clearWwebjsCache() {
        const cachePath = path.join(process.cwd(), '.wwebjs_cache');
        try {
            if (fs.existsSync(cachePath)) {
                fs.rmSync(cachePath, { recursive: true, force: true });
                console.log('[WhatsApp] Cleared .wwebjs_cache (stale cache fix)');
            }
        } catch (err) {
            console.error('[WhatsApp] Failed to clear .wwebjs_cache:', err.message);
        }
    }

    /**
     * Health check: verify WhatsApp connection every 2 minutes
     * Detects "silent disconnects" — disconnected event didn't fire but actually disconnected
     */
    _startHealthCheck() {
        this._stopHealthCheck(); // Clear old one first
        this._healthCheckInterval = setInterval(async () => {
            try {
                // Health check via queue with 10s timeout to avoid getting stuck
                const state = await this._enqueue(
                    () => this.client.getState(),
                    { timeout: 10000 }
                );
                if (state !== 'CONNECTED') {
                    console.log(`[WhatsApp] Health check: state=${state}, attempting reconnect...`);
                    await this._reconnect(`health check: state=${state}`);
                }
            } catch (err) {
                // getState() failure usually means Puppeteer page is broken
                console.log(`[WhatsApp] Health check failed: ${err.message}, attempting reconnect...`);
                await this._reconnect('health check error: ' + err.message);
            }
        }, 2 * 60 * 1000); // 每 2 分鐘
    }

    _stopHealthCheck() {
        if (this._healthCheckInterval) {
            clearInterval(this._healthCheckInterval);
            this._healthCheckInterval = null;
        }
    }

    // ==================== Core Methods ====================

    async sendMessage(chatId, message, replyToMessageId = null) {
        // Ensure client is ready
        if (!this.client.info) {
            throw new Error('WhatsApp client not ready - please wait for connection');
        }

        // @lid format is system message, cannot send
        if (chatId.endsWith('@lid')) {
            console.log(`[WhatsApp] Skipping @lid chatId: ${chatId}`);
            throw new Error(`Cannot send to @lid format chatId: ${chatId}. This is usually a system message.`);
        }

        const options = {};
        if (replyToMessageId) {
            options.quotedMessageId = replyToMessageId;
        }

        // Via queue: serialized + retry
        const maxRetries = 1;
        let lastError;
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                const sentMsg = await this._enqueue(() =>
                    this.client.sendMessage(chatId, message, options)
                );
                if (attempt > 1) {
                    console.log(`[WhatsApp] Text sent successfully (attempt ${attempt})`);
                }
                return sentMsg;
            } catch (err) {
                lastError = err;
                if (this._isRetryableError(err) && attempt <= maxRetries) {
                    console.log(`[WhatsApp] Text send failed (attempt ${attempt}/${maxRetries + 1}): ${err.message}, retrying in 2s...`);
                    await new Promise(r => setTimeout(r, 2000));
                } else if (err.message && err.message.includes('getChat')) {
                    throw new Error(`Cannot find chat: ${chatId}. Make sure the chatId format is correct (e.g., 886912345678@c.us)`);
                } else {
                    break;
                }
            }
        }
        throw lastError;
    }

    /**
     * Determine if error is retryable (CDP-related transient errors)
     */
    _isRetryableError(err) {
        if (!err || !err.message) return false;
        const msg = err.message;
        return (
            msg.includes('timed out') ||
            msg.includes('Target closed') ||
            msg.includes('Promise was collected') ||
            msg.includes('Execution context was destroyed') ||
            msg.includes('execution context') ||
            msg.includes('Queue task timeout')
        );
    }

    /**
     * Send media file
     */
    async sendMedia(chatId, filePath, caption = '', replyToMessageId = null) {
        // Ensure client is ready
        if (!this.client.info) {
            throw new Error('WhatsApp client not ready - please wait for connection');
        }

        // @lid format is system message, cannot send
        if (chatId.endsWith('@lid')) {
            console.log(`[WhatsApp] Skipping @lid chatId: ${chatId}`);
            throw new Error(`Cannot send to @lid format chatId: ${chatId}. This is usually a system message.`);
        }

        let media;
        let tempOggPath = null; // Track temp file for cleanup

        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
            console.log(`[WhatsApp] Loading media from URL: ${filePath}`);
            media = await MessageMedia.fromUrl(filePath, { unsafeMime: true });
        } else {
            let absolutePath = path.resolve(filePath);
            if (!fs.existsSync(absolutePath)) {
                throw new Error(`File not found: ${absolutePath}`);
            }

            // Auto-convert non-OGG audio to OGG Opus (WhatsApp native format, avoids timeout)
            const ext = path.extname(absolutePath).toLowerCase();
            if (['.wav', '.mp3', '.m4a', '.flac', '.aac'].includes(ext)) {
                try {
                    const ffmpegPath = require('ffmpeg-static');
                    const { execSync } = require('child_process');
                    tempOggPath = absolutePath.replace(/\.[^.]+$/, '_converted.ogg');
                    execSync(`"${ffmpegPath}" -y -i "${absolutePath}" -c:a libopus -b:a 64k "${tempOggPath}"`, { stdio: 'pipe' });
                    console.log(`[WhatsApp] Audio converted to OGG: ${tempOggPath}`);
                    absolutePath = tempOggPath;
                } catch (err) {
                    console.error(`[WhatsApp] Audio conversion failed, using original: ${err.message}`);
                    tempOggPath = null; // Don't cleanup if conversion failed
                }
            }

            console.log(`[WhatsApp] Loading media from local: ${absolutePath}`);
            media = MessageMedia.fromFilePath(absolutePath);
        }

        const options = { caption };
        if (replyToMessageId) {
            options.quotedMessageId = replyToMessageId;
        }

        // Audio files: send as voice note (ptt) for better WhatsApp experience
        if (media.mimetype && media.mimetype.startsWith('audio/')) {
            options.sendAudioAsVoice = true;
        }

        // Retry logic via queue (serialized with other sends)
        const maxRetries = 2;
        let lastError;
        try {
            for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
                try {
                    const result = await this._enqueue(() =>
                        this.client.sendMessage(chatId, media, options)
                    );
                    if (attempt > 1) {
                        console.log(`[WhatsApp] Media sent successfully (attempt ${attempt})`);
                    }
                    return result;
                } catch (err) {
                    lastError = err;
                    if (this._isRetryableError(err) && attempt <= maxRetries) {
                        console.log(`[WhatsApp] Media send failed (attempt ${attempt}/${maxRetries + 1}): ${err.message}, retrying in 3s...`);
                        await new Promise(r => setTimeout(r, 3000));
                    } else {
                        break;
                    }
                }
            }
            // All retries failed
            throw lastError;
        } finally {
            // Always cleanup temp file regardless of success/failure
            if (tempOggPath && fs.existsSync(tempOggPath)) {
                try { fs.unlinkSync(tempOggPath); } catch (e) {}
            }
        }
    }

    async initialize() {
        const maxRetries = 5;
        const baseDelay = 5000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[WhatsApp] Initializing... (attempt ${attempt}/${maxRetries})`);
                await this.client.initialize();
                console.log('[WhatsApp] Initialization succeeded');
                return;
            } catch (err) {
                console.error(`[WhatsApp] Initialization failed (attempt ${attempt}/${maxRetries}): ${err.message}`);

                if (attempt >= maxRetries) {
                    console.error('[WhatsApp] Max retries reached, giving up initialization');
                    throw err;
                }

                try { await this.client.destroy(); } catch (e) {}
                await this._killZombieChrome();

                // Clear cache after 3rd failure
                if (attempt >= 3) {
                    this._clearWwebjsCache();
                }

                const delay = baseDelay * attempt;
                console.log(`[WhatsApp] Retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));

                this.client = this._createClient();
                this.setupEvents();
            }
        }
    }

    /**
     * Kill zombie Chrome processes (avoid port/lock conflicts)
     */
    async _killZombieChrome() {
        try {
            const { execSync } = require('child_process');
            if (process.platform === 'win32') {
                // Only kill Puppeteer-spawned Chrome (identified by --remote-debugging-port flag)
                // Use PowerShell to filter by command line args to avoid killing user's browser
                const psCmd = `powershell -Command "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*--remote-debugging-port*' } | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }"`;
                execSync(psCmd, { stdio: 'ignore' });
            } else {
                // Only kill headless/puppeteer chromium, not user's browser
                execSync('pkill -f "chromium.*--remote-debugging-port" 2>/dev/null || true', { stdio: 'ignore' });
            }
            console.log('[WhatsApp] Cleaned up zombie Puppeteer Chrome processes');
        } catch (e) {
            // No zombie processes is fine
        }
    }

    /**
     * Send welcome message
     */
    async sendWelcomeMessage() {
        try {
            const myId = this.client.info?.wid?._serialized;
            if (!myId) {
                console.log('[WhatsApp] Cannot get user ID, skipping welcome message');
                return;
            }

            const onboardingPath = path.join(__dirname, '../../../.kiro/steering/ONBOARDING.md');
            const parentOnboardingPath = path.join(__dirname, '../../../../.kiro/steering/ONBOARDING.md');
            const isNewUser = fs.existsSync(onboardingPath) || fs.existsSync(parentOnboardingPath);

            if (isNewUser) {
                // New user: skip welcome here — ONBOARDING.md script handles the first message
                console.log(`[WhatsApp] New user, ONBOARDING.md handles welcome`);
                return;
            }

            const isZh = config.language === 'zh';
            const welcomeMsg = isZh
                ? `嘿，我回來了～有什麼需要幫忙的嗎？`
                : `Hey! I'm back~ What can I help you with?`;
            console.log(`[WhatsApp] Returning user, sending welcome (${config.language})`);

            // Use Gateway's unified sendReply (adds prefix)
            await this.gateway.sendReply('whatsapp', myId, welcomeMsg);
        } catch (err) {
            console.error('[WhatsApp] Failed to send welcome message:', err.message);
        }
    }

    /**
     * Save media file to local disk
     */
    saveMedia(media, messageId) {
            // Determine media category from mimetype
            let category = 'file';
            if (media.mimetype.startsWith('image/')) category = 'image';
            else if (media.mimetype.startsWith('audio/')) category = 'audio';
            else if (media.mimetype.startsWith('video/')) category = 'video';

            // Organize by type and date: media/{category}/{YYYY-MM-DD}/
            const { getTodayDate } = require('../utils/timezone');
            const today = getTodayDate();
            const mediaDir = path.join(__dirname, '../../media', category, today);
            if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
            }

            const ext = this.getExtensionFromMime(media.mimetype);
            const filename = `${Date.now()}_${messageId.replace(/[^a-zA-Z0-9]/g, '_')}${ext}`;
            const filePath = path.join(mediaDir, filename);

            const buffer = Buffer.from(media.data, 'base64');
            fs.writeFileSync(filePath, buffer);

            return filePath;
        }


    getExtensionFromMime(mimetype) {
        const mimeMap = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'video/mp4': '.mp4',
            'video/3gpp': '.3gp',
            'audio/ogg': '.ogg',
            'audio/mpeg': '.mp3',
            'audio/mp4': '.m4a',
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        };

        return mimeMap[mimetype] || '.bin';
    }

    /**
     * Graceful shutdown
     */
    async destroy() {
        this._destroyed = true;
        this._stopHealthCheck();
        if (this._readyWatchdog) clearInterval(this._readyWatchdog);

        if (this.client) {
            try {
                await this.client.destroy();
                console.log('[WhatsApp] Client destroyed');
            } catch (err) {
                console.error('[WhatsApp] Error destroying client:', err.message);
            }
        }
    }
}

module.exports = WhatsAppAdapter;
