/**
 * Kiro Handler - Kiro IDE 專屬
 * 透過 vscode-rest-control extension 將訊息送到 Kiro chat
 * 
 * 需要安裝 vscode-rest-control extension:
 * https://github.com/dpar39/vscode-rest-control
 * 
 * 這是 IDE 專屬層，實作 BaseHandler 介面
 */

const http = require('http');
const path = require('path');
const BaseHandler = require('./base-handler');
const SkillLoader = require('../../skills/skill-loader');
const { classifyMessage, isSpecialMessage } = require('./message-classifier');
const { DispatchController } = require('./dispatch-controller');

class KiroHandler extends BaseHandler {
    constructor(config) {
        super(config);
        this.command = 'kiroAgent.sendMainUserInput';
        this.port = null;
        this.portDetected = false;
        
        // Port 偵測（優先順序：env → 檔案 → workspace hash）
        const restPortFile = path.join(__dirname, '../../../.rest-control-port');
        const envPort = process.env.REMOTE_CONTROL_PORT;
        let filePort = null;
        try {
            if (require('fs').existsSync(restPortFile)) {
                const p = parseInt(require('fs').readFileSync(restPortFile, 'utf-8').trim(), 10);
                if (p > 0 && p < 65536) filePort = p;
            }
        } catch (err) { /* ignore */ }
        const calcPort = this.calculatePortFromWorkspace();
        
        console.log(`[Kiro] Port 偵測: env=${envPort || 'unset'}, file=${filePort || 'missing'}(${restPortFile}), calc=${calcPort}, ideRestPort=${config.ideRestPort}`);
        
        if (envPort) {
            this.port = parseInt(envPort);
            this.portDetected = true;
            console.log(`[Kiro] → 使用 env port: ${this.port}`);
        } else if (filePort) {
            this.port = filePort;
            this.portDetected = true;
            console.log(`[Kiro] → 使用 file port: ${this.port}`);
        } else {
            this.port = calcPort;
            console.log(`[Kiro] → 使用 calc port: ${this.port}`);
        }
        
        // 初始化 SkillLoader（用於 skill suggestion）
        this.skillLoader = null;
        this._initSkillLoader();
        
        // Fragment handling: track last message time per chatId for timeDelta calculation
        this._lastMessageTime = new Map();
        
        // Auto-recall: track chatIds that triggered a new session (timeDelta > 30min)
        this._newSessionFlags = new Set();
        
        // Fragment handling: store gateway reference for _onDispatch callback
        this._gateway = null;
        
        // DispatchController: manages per-chatId fragment collection and merging
        const fragmentCfg = config.fragment || {};
        this.dispatchController = new DispatchController(
            {
                collectTimeout: fragmentCfg.collectTimeout || 3000,
                maxMessages: fragmentCfg.maxMessages || 3,
                maxWait: fragmentCfg.maxWait || 7000,
                threshold: fragmentCfg.scoreThreshold || 0.6
            },
            (chatId, mergedText, messages) => {
                return this._onDispatch(chatId, mergedText, messages);
            }
        );
    }
    
    /**
     * 初始化 SkillLoader
     */
    _initSkillLoader() {
        try {
            const skillsPath = path.join(__dirname, '../../../skills');
            if (require('fs').existsSync(skillsPath)) {
                this.skillLoader = new SkillLoader(skillsPath);
                this.skillLoader.scan();
                console.log(`[Kiro] SkillLoader 初始化完成，${this.skillLoader.skills.size} 個 skills`);
            }
        } catch (err) {
            console.error(`[Kiro] SkillLoader 初始化失敗: ${err.message}`);
        }
    }

    /**
     * 根據 workspace 路徑計算 port（跟 vscode-rest-control 一樣的算法）
     * 
     * Extension 使用 VS Code 的 workspace URI 格式：
     *   file:///c%3A/Users/norl/Desktop/MyAIHero
     * 注意：小寫 drive letter + URL encode 冒號（%3A）+ 正斜線
     * 
     * Gateway 的 cwd 可能是子目錄（MyKiroHero），但 workspace 是父目錄
     * 所以往上找 .kiro 資料夾來判斷 workspace root
     */
    calculatePortFromWorkspace() {
        const fs = require('fs');
        // 找到 workspace root（往上找 .kiro 資料夾）
        let workspacePath = process.cwd();
        let current = workspacePath;
        while (current) {
            const parent = path.dirname(current);
            if (parent === current) break; // reached filesystem root
            // 如果父目錄有 .kiro，那父目錄才是 workspace root
            if (fs.existsSync(path.join(parent, '.kiro'))) {
                workspacePath = parent;
                break;
            }
            current = parent;
        }
        
        // 轉成 VS Code workspace URI 格式
        let uriPath = workspacePath.replace(/\\/g, '/');
        // Windows: 小寫 drive letter + URL encode 冒號（%3A）
        if (/^[A-Za-z]:/.test(uriPath)) {
            uriPath = uriPath[0].toLowerCase() + '%3A' + uriPath.slice(2);
        }
        // 移除尾部斜線
        uriPath = uriPath.replace(/\/+$/, '');
        const identifier = 'file:///' + uriPath;
        
        // 跟 extension 一樣的 hash 算法
        let hash = 0;
        for (let i = 0; i < identifier.length; i++) {
            hash = ((hash << 5) - hash) + identifier.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }
        
        const port = 37100 + (Math.abs(hash) % (65535 - 37100));
        console.log(`[Kiro] calculatePort: "${identifier}" → ${port}`);
        return port;
    }

    getName() {
        return 'kiro';
    }

    /**
     * 取得目前的 REST Control port
     */
    getPort() {
        return this.port || null;
    }

    /**
     * 更新 REST Control port（由 Gateway middleware 從 X-Kiro-Port header 呼叫）
     */
    updatePort(newPort) {
        if (newPort !== this.port) {
            console.log(`[Kiro] REST port 更新: ${this.port} → ${newPort}`);
            this.port = newPort;
            this.portDetected = true;
        }
    }
    /**
     * 重新偵測 Kiro REST port（ECONNREFUSED 時呼叫）
     * 依序嘗試：.rest-control-port 檔案 → calculatePortFromWorkspace → config.ideRestPort
     * @returns {number|null} 新偵測到的 port，或 null
     */
    async _redetectPort() {
        const fs = require('fs');
        const candidates = new Set();
        
        // 1. 重新讀 .rest-control-port 檔案
        const restPortFile = path.join(__dirname, '../../../.rest-control-port');
        try {
            if (fs.existsSync(restPortFile)) {
                const p = parseInt(fs.readFileSync(restPortFile, 'utf-8').trim(), 10);
                if (p > 0 && p < 65536 && p !== this.port) candidates.add(p);
            }
        } catch (e) { /* ignore */ }
        
        // 2. calculatePortFromWorkspace
        const calcPort = this.calculatePortFromWorkspace();
        if (calcPort !== this.port) candidates.add(calcPort);
        
        // 3. config.ideRestPort
        const cfgPort = parseInt(this.config.ideRestPort, 10);
        if (cfgPort > 0 && cfgPort < 65536 && cfgPort !== this.port) candidates.add(cfgPort);
        
        // 逐一 probe
        for (const candidate of candidates) {
            if (await this.tryPort(candidate)) {
                console.log(`[Kiro] 🔄 Port 重新偵測成功: ${this.port} → ${candidate}`);
                this.port = candidate;
                this.portDetected = true;
                // 寫回檔案供下次使用
                try { fs.writeFileSync(restPortFile, candidate.toString(), 'utf-8'); } catch (e) { /* ignore */ }
                return candidate;
            }
        }
        
        console.log(`[Kiro] 🔄 Port 重新偵測失敗，候選: [${[...candidates].join(', ')}]`);
        return null;
    }

    /**
     * 嘗試連接指定 port
     */
    async tryPort(port) {
        return new Promise((resolve) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: port,
                path: '/',
                method: 'GET',
                timeout: 500
            }, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.end();
        });
    }

    async isAvailable() {
        return this.tryPort(this.port);
    }

    async sendToChat(message) {
        return new Promise((resolve, reject) => {
            // 先 JSON.stringify，再 encodeURIComponent
            // 注意：vscode-rest-control 會做雙重 decodeURIComponent
            // 所以要先把 % 替換成 %25，讓 double decode 後還原正確
            const jsonStr = JSON.stringify([message]);
            const args = encodeURIComponent(jsonStr).replace(/%25/g, '%2525');
            const url = `/?command=${this.command}&args=${args}`;
            
            const options = {
                hostname: '127.0.0.1',
                port: this.port,
                path: url,
                method: 'GET',
                timeout: 5000
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });

            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    async handle(message, gateway) {
        // Store gateway reference for _onDispatch callback
        this._gateway = gateway;
        
        // 處理 system heartbeat 訊息
        if (message.platform === 'system' && message.type === 'heartbeat') {
            console.log(`[Kiro] 🫀 收到 heartbeat: ${message.task || 'unknown'}`);
            
            const prompt = `[Heartbeat] 執行任務：${message.task}\n\n請根據 HEARTBEAT.md 中「${message.task}」的說明執行此任務。完成後簡短回報結果。`;
            
            try {
                await this.sendToChat(prompt);
                console.log(`[Kiro] ✓ Heartbeat 已送到 Kiro chat`);
            } catch (error) {
                if (error.message.includes('ECONNREFUSED')) {
                    console.log(`[Kiro] ⚡ Heartbeat ECONNREFUSED，嘗試重新偵測 port...`);
                    const newPort = await this._redetectPort();
                    if (newPort) {
                        try {
                            await this.sendToChat(prompt);
                            console.log(`[Kiro] ✓ Heartbeat 重試成功 (port ${this.port})`);
                            return;
                        } catch (e) { /* fall through */ }
                    }
                }
                console.error(`[Kiro] ✗ Heartbeat 發送失敗: ${error.message}`);
            }
            return;
        }
        
        // 只處理主人自己發的訊息
        if (!message.fromMe) return;
        
        // 跳過系統訊息（@lid 結尾的 chatId）
        if (message.chatId && message.chatId.endsWith('@lid')) return;
        
        // 跳過空訊息（但如果有媒體檔案就不跳過）
        if ((!message.text || message.text.trim() === '') && !message.mediaPath) return;
        
        // 跳過 AI 的回覆（避免迴圈）
        const prefixStart = this.config.aiPrefix.split(' ')[0];
        if (message.text && message.text.startsWith(prefixStart)) return;

        console.log(`[Kiro] 準備送到 Kiro: ${message.text || '[媒體檔案]'}`);

        // 特殊訊息（媒體、URL、純 emoji）→ bypass classifier，直接 dispatch
        if (isSpecialMessage(message)) {
            console.log(`[Kiro] 特殊訊息（媒體/URL/emoji），直接 dispatch`);
            await this._onDispatch(message.chatId, message.text || '', [{ text: message.text || '', message, timestamp: Date.now() }]);
            return;
        }

        // 一般訊息：評分 → DispatchController
        const timeDelta = this._getTimeDelta(message.chatId);
        
        // Auto-recall: flag new session (timeDelta > 30 min)
        const NEW_SESSION_THRESHOLD = 30 * 60 * 1000;
        if (timeDelta > NEW_SESSION_THRESHOLD) {
            this._newSessionFlags.add(message.chatId);
        }
        
        const classification = classifyMessage(message.text, timeDelta, { threshold: this.config.fragment ? this.config.fragment.scoreThreshold : 0.6 });
        console.log(`[Kiro] 訊息評分: ${classification.score.toFixed(2)} (${classification.isComplete ? '完整' : '碎片'})`);
        this.dispatchController.handleMessage(message.chatId, message, classification);
    }

    /**
     * 計算距離上一則訊息的時間差（毫秒）
     * @param {string} chatId
     * @returns {number} 毫秒，首則訊息回傳 Infinity
     */
    _getTimeDelta(chatId) {
        const now = Date.now();
        const last = this._lastMessageTime.get(chatId);
        this._lastMessageTime.set(chatId, now);
        
        // 清理超過 5 分鐘沒活動的 chatId，防止 Map 無限增長
        if (this._lastMessageTime.size > 50) {
            const staleThreshold = now - 5 * 60 * 1000;
            for (const [id, ts] of this._lastMessageTime) {
                if (ts < staleThreshold) {
                    this._lastMessageTime.delete(id);
                }
            }
        }
        
        return last ? (now - last) : Infinity;
    }

    /**
     * Dispatch 回呼：組裝 prompt + skill suggestion + 媒體資訊 + sendToChat
     * 由 DispatchController 合併完成後呼叫，或特殊訊息直接呼叫
     * 
     * @param {string} chatId
     * @param {string} mergedText - 合併後的文字（>= 2 則時含 [合併 N 則訊息] 標記）
     * @param {Array<{ text: string, message: object, timestamp: number }>} messages - 原始訊息陣列
     */
    async _onDispatch(chatId, mergedText, messages) {
        // 使用第一則訊息的 metadata（sender, chatId 等）
        const firstMsg = messages[0] && messages[0].message ? messages[0].message : {};
        // 使用最後一則訊息的媒體資訊（如果有）
        const lastMsg = messages[messages.length - 1] && messages[messages.length - 1].message ? messages[messages.length - 1].message : {};
        
        const sender = firstMsg.sender || 'unknown';
        const msgChatId = firstMsg.chatId || chatId;
        
        // 組合訊息
        let prompt = `[WhatsApp] ${sender}: ${mergedText} (chatId: ${msgChatId})`;
        
        // Auto-recall: inject context on new session's first dispatch
        const isNewSession = this._newSessionFlags.has(chatId);
        if (isNewSession) {
            this._newSessionFlags.delete(chatId);
            
            const autoRecallEnabled = process.env.AUTO_RECALL_ENABLED !== 'false' && process.env.AUTO_RECALL_ENABLED !== '0';
            if (autoRecallEnabled) {
                try {
                    const recall = await this._fetchAutoRecallContext();
                    if (recall) {
                        prompt = `[System Context - Auto Recall]\n${recall.context}\n---\n${prompt}`;
                        console.log(`[Kiro] Auto-recall injected (${recall.tokenEstimate} tokens)`);
                    }
                } catch (err) {
                    console.log(`[Kiro] Auto-recall skipped (error: ${err.message})`);
                }
            } else {
                console.log('[Kiro] Auto-recall skipped (disabled)');
            }
        }
        
        // Skill Suggestion（純 ASCII 格式，避免 emoji 導致 Kiro 卡住）
        // 在合併後的文字上執行（不是每則碎片都做）
        if (this.skillLoader && mergedText.trim() && mergedText.length < 200) {
            try {
                const searchResults = this.skillLoader.searchSkills(mergedText);
                const suggestions = searchResults.filter(r => r.score >= 0.8);
                
                if (suggestions.length > 0) {
                    const best = suggestions[0];
                    console.log(`[Kiro] Skill: ${best.name} (${best.isExternal ? 'ext' : 'int'}, ${Math.round(best.score * 100)}%)`);
                    prompt += `\n\n[Skill: ${best.name}]`;
                }
            } catch (err) {
                console.error(`[Kiro] Skill search error: ${err.message}`);
            }
        }
        
        // STT 攔截：語音訊息自動轉文字
        // 不做 isEnabled() 判斷 — 直接丟 router，讓它統一處理成敗
        if (lastMsg.mediaPath && this._isAudioMessage(lastMsg.mediaMimeType)) {
            const sttService = this._gateway?.sttService;
            if (sttService) {
                try {
                    const result = await sttService.transcribe(lastMsg.mediaPath, lastMsg.mediaMimeType);
                    if (result && result.text) {
                        mergedText = `[語音訊息] ${result.text}`;
                        prompt = `[WhatsApp] ${sender}: ${mergedText} (chatId: ${msgChatId})`;
                        lastMsg.mediaPath = null;
                        // Usage tracking (reuse singleton to avoid re-reading JSON on every call)
                        try {
                            if (!this._usageTracker) {
                                const UsageTracker = require('../../gateway/usage-tracker');
                                this._usageTracker = new UsageTracker();
                            }
                            this._usageTracker.record(sttService.getProviderName(), sttService.getModelId(), { capability: 'stt' });
                        } catch (e) { /* usage tracking failure is non-critical */ }
                        console.log(`[Kiro] STT 轉寫成功 (${result.text.length} 字)`);
                    }
                } catch (err) {
                    console.error(`[Kiro] STT 轉寫失敗: ${err.message}`);
                    mergedText = `[語音訊息 - STT 轉寫失敗: ${err.message.substring(0, 100)}]`;
                    prompt = `[WhatsApp] ${sender}: ${mergedText} (chatId: ${msgChatId})`;
                }
            }
        }

        // 如果最後一則訊息有媒體檔案，加入路徑資訊並提示使用 analyze_image
        if (lastMsg.mediaPath) {
            const isImage = lastMsg.mediaMimeType && lastMsg.mediaMimeType.startsWith('image/');
            if (isImage) {
                prompt += `\n\n🖼️ 圖片: ${lastMsg.mediaPath}`;
                prompt += `\n💡 使用 MCP tool \`analyze_image\` 並傳入 imagePath: "${lastMsg.mediaPath}" 來查看這張圖片`;
            } else {
                prompt += `\n\n📎 附件: ${lastMsg.mediaPath} (${lastMsg.mediaMimeType || 'unknown'})`;
            }
        }
        
        try {
            await this.sendToChat(prompt);
            const msgCount = messages.length;
            console.log(`[Kiro] ✓ 已送到 Kiro chat (port ${this.port}${msgCount > 1 ? `, 合併 ${msgCount} 則` : ''})`);
        } catch (error) {
            const isConnRefused = error.message.includes('ECONNREFUSED');
            
            // ECONNREFUSED → 嘗試重新偵測 port 並重試一次
            if (isConnRefused) {
                console.log(`[Kiro] ⚡ ECONNREFUSED on port ${this.port}，嘗試重新偵測...`);
                const newPort = await this._redetectPort();
                if (newPort) {
                    try {
                        await this.sendToChat(prompt);
                        const msgCount = messages.length;
                        console.log(`[Kiro] ✓ 重試成功！已送到 Kiro chat (port ${this.port}${msgCount > 1 ? `, 合併 ${msgCount} 則` : ''})`);
                        return; // 成功，不需要錯誤通知
                    } catch (retryError) {
                        console.error(`[Kiro] ✗ 重試也失敗: ${retryError.message}`);
                    }
                }
            }
            
            console.error(`[Kiro] ✗ 發送失敗: ${error.message}`);
            console.error(`[Kiro] 請確認 Kiro 已開啟且 vscode-rest-control extension 正在運行`);
            
            // 錯誤通知（但 timeout 不通知，因為訊息可能已送達）
            const isTimeout = error.message.includes('timeout');
            if (this.config.errorNotification !== false && !isTimeout && this._gateway) {
                try {
                    // Use sendDirectReply to avoid adding AI_PREFIX to system error messages
                    await this._gateway.sendDirectReply(
                        firstMsg.platform || 'whatsapp',
                        msgChatId,
                        `⚠️ 訊息轉發失敗：${error.message}\n請確認 Kiro 有開啟。`
                    );
                } catch (notifyError) {
                    console.error(`[Kiro] 無法發送錯誤通知: ${notifyError.message}`);
                }
            } else if (isTimeout) {
                console.log(`[Kiro] ⏱️ Timeout（訊息可能已送達，不發通知）`);
            }
        }
    }
    /**
     * 判斷是否為音訊訊息
     * @param {string} mimetype
     * @returns {boolean}
     */
    _isAudioMessage(mimetype) {
        if (!mimetype) return false;
        // WhatsApp 語音訊息: 'audio/ogg; codecs=opus'
        // WhatsApp 音訊檔案: 'audio/mpeg', 'audio/mp4' 等
        // WhatsApp PTT: 有時是 'video/ogg'
        return mimetype.startsWith('audio/') || mimetype === 'video/ogg';
    }

    /**
     * Read Memory Engine port from .memory-engine-port file
     * @returns {string|null} URL like http://127.0.0.1:PORT or null
     */
    _getMemoryEngineUrl() {
        const fs = require('fs');
        const portFile = path.join(__dirname, '../../../.memory-engine-port');
        try {
            if (fs.existsSync(portFile)) {
                const port = fs.readFileSync(portFile, 'utf-8').trim();
                if (port && !isNaN(port)) {
                    return `http://127.0.0.1:${port}`;
                }
            }
        } catch (err) { /* ignore */ }
        return null;
    }

    /**
     * Fetch auto-recall context from Memory Engine (3s timeout, non-blocking)
     * @returns {Promise<{context: string, tokenEstimate: number, sources: string[]}|null>}
     */
    async _fetchAutoRecallContext() {
        const url = this._getMemoryEngineUrl();
        if (!url) {
            console.log('[Kiro] Auto-recall skipped (Memory Engine port not found)');
            return null;
        }

        return new Promise((resolve) => {
            const parsed = new URL(`${url}/recall/auto`);
            const req = http.request({
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                method: 'GET',
                timeout: 3000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        if (result.context && result.context.length > 0) {
                            resolve(result);
                        } else {
                            console.log('[Kiro] Auto-recall skipped (empty context)');
                            resolve(null);
                        }
                    } catch (err) {
                        console.log(`[Kiro] Auto-recall skipped (parse error: ${err.message})`);
                        resolve(null);
                    }
                });
            });
            req.on('error', (err) => {
                console.log(`[Kiro] Auto-recall skipped (fetch error: ${err.message})`);
                resolve(null);
            });
            req.on('timeout', () => {
                req.destroy();
                console.log('[Kiro] Auto-recall skipped (timeout)');
                resolve(null);
            });
            req.end();
        });
    }

}

module.exports = KiroHandler;
