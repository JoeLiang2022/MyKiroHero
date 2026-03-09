/**
 * Session Logger - Records conversation history
 * 
 * Format: JSONL (one JSON per line)
 * Location: sessions/YYYY-MM-DD.jsonl
 * 
 * Session ID rules:
 * - Format: YYYYMMDD-NNN (e.g. 20260206-001)
 * - Auto-creates new session after 30 min idle
 */

const fs = require('fs');
const path = require('path');
const { getTodayDate, getNowISO, getNow } = require('../utils/timezone');

// Session idle timeout (ms)
const SESSION_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 min

class SessionLogger {
    constructor(sessionsDir = null) {
        // Default: sessions/ under project root
        this.sessionsDir = sessionsDir || path.join(__dirname, '../../sessions');
        this.currentSessionId = null;
        this.lastActivityTime = null;
        this.previousSessionId = null;  // Track previous session for summary
        console.log(`[SessionLogger] Initialized, path: ${this.sessionsDir}`);
        this.ensureDir();
    }

    /**
     * Ensure sessions directory exists
     */
    ensureDir() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
            console.log(`[SessionLogger] Created directory: ${this.sessionsDir}`);
        }
    }

    /**
     * Get date string YYYYMMDD
     * @param {Date} date - Date object, defaults to timezone-corrected now
     */
    getDateStr(date) {
        const d = date || getNow();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    }

    /**
     * Get file path for a given date
     * @param {Date} date - Date object, defaults to timezone-corrected now
     */
    getFilePath(date) {
        const d = date || getNow();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        return path.join(this.sessionsDir, `${dateStr}.jsonl`);
    }

    /**
     * Get today's file path (using timezone-corrected time)
     */
    getTodayFile() {
        const dateStr = getTodayDate(); // YYYY-MM-DD
        return path.join(this.sessionsDir, `${dateStr}.jsonl`);
    }

    /**
     * Get or create session ID
     * Uses timezone-corrected time for date
     */
    getSessionId() {
        const now = Date.now();
        const dateStr = getTodayDate().replace(/-/g, ''); // YYYYMMDD
        
        // Check if new session needed
        const needNewSession = 
            !this.currentSessionId ||                                    // No session
            !this.currentSessionId.startsWith(dateStr) ||               // Date changed
            (this.lastActivityTime && (now - this.lastActivityTime) > SESSION_IDLE_TIMEOUT);  // Idle timeout
        
        if (needNewSession) {
            // Record previous session (for summary)
            if (this.currentSessionId) {
                this.previousSessionId = this.currentSessionId;
                console.log(`[SessionLogger] Session ended: ${this.previousSessionId}`);
                // Async notify Memory Engine to trigger indexing
                this.notifyMemoryEngine();
            }
            
            // Calculate session sequence number for today
            const sessionNum = this.countTodaySessions() + 1;
            this.currentSessionId = `${dateStr}-${String(sessionNum).padStart(3, '0')}`;
            console.log(`[SessionLogger] New session: ${this.currentSessionId}`);
        }
        
        this.lastActivityTime = now;
        return this.currentSessionId;
    }

    /**
     * Get previous ended session ID (for summary)
     * Clears after call to avoid duplicate summaries
     */
    popPreviousSession() {
        const prev = this.previousSessionId;
        this.previousSessionId = null;
        return prev;
    }

    /**
     * Check if there's a pending session for summary
     */
    hasPendingSession() {
        return this.previousSessionId !== null;
    }

    /**
     * Count how many sessions exist today
     */
    countTodaySessions() {
        const filePath = this.getTodayFile();
        if (!fs.existsSync(filePath)) {
            return 0;
        }
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line);
            const sessionIds = new Set();
            
            for (const line of lines) {
                try {
                    const record = JSON.parse(line);
                    if (record.sessionId) {
                        sessionIds.add(record.sessionId);
                    }
                } catch (e) {
                    // Skip malformed lines
                }
            }
            
            return sessionIds.size;
        } catch (err) {
            return 0;
        }
    }

    /**
     * Async notify Memory Engine to trigger indexing
     * Non-blocking, failure only logged
     */
    notifyMemoryEngine() {
        const portFile = path.join(this.sessionsDir, '../.memory-engine-port');
        try {
            if (!fs.existsSync(portFile)) return;
            const port = parseInt(fs.readFileSync(portFile, 'utf8').trim());
            if (!port || isNaN(port)) return;

            const filePath = this.getTodayFile();
            const data = JSON.stringify({ filePath });
            const http = require('http');
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path: '/index/file',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
                timeout: 3000
            }, (res) => {
                if (res.statusCode === 200) {
                    console.log('[SessionLogger] Memory Engine index notification sent');
                }
            });
            req.on('error', () => { /* silent fail */ });
            req.on('timeout', () => { req.destroy(); });
            req.write(data);
            req.end();

            // Trigger auto-summary for the ended session (fire-and-forget)
            if (this.previousSessionId) {
                this.triggerAutoSummary(this.previousSessionId, port);
            }
        } catch (err) {
            // Memory Engine unavailable, log only, don't affect main flow
            console.log(`[SessionLogger] Memory Engine notification skipped: ${err.message}`);
        }
    }

    /**
     * Trigger auto-summary for a completed session via Memory Engine.
     * Skips sessions with fewer than 3 messages. Fire-and-forget.
     * @param {string} sessionId - The session ID to summarize
     * @param {number} port - Memory Engine port
     */
    triggerAutoSummary(sessionId, port) {
        try {
            // Count messages in the session to skip trivial ones
            const records = this.getSession(sessionId);
            const messageCount = records.filter(r => r.role === 'user' || r.role === 'assistant').length;
            if (messageCount < 3) {
                console.log(`[SessionLogger] Auto-summary skipped for ${sessionId}: only ${messageCount} messages`);
                return;
            }

            const data = JSON.stringify({ sessionId });
            const http = require('http');
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path: '/summary/auto',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
                timeout: 5000
            }, (res) => {
                if (res.statusCode === 200) {
                    console.log(`[SessionLogger] Auto-summary triggered for ${sessionId}`);
                } else {
                    console.log(`[SessionLogger] Auto-summary response ${res.statusCode} for ${sessionId}`);
                }
            });
            req.on('error', (err) => {
                console.log(`[SessionLogger] Auto-summary request failed: ${err.message}`);
            });
            req.on('timeout', () => { req.destroy(); });
            req.write(data);
            req.end();
        } catch (err) {
            console.log(`[SessionLogger] Auto-summary error: ${err.message}`);
        }
    }

    /**
     * Log user message
     */
    logUser(text, media = null) {
        this.log({
            role: 'user',
            text: text || '',
            media: media
        });
    }

    /**
     * Log DirectRouter direct reply interaction
     * @param {string} handler - Handler name (e.g. 'weather')
     * @param {string} query - Original query text
     * @param {string} response - Reply content
     */
    logDirect(handler, query, response) {
        this.log({
            type: 'message',
            role: 'direct',
            handler,
            query,
            response,
            text: response  // Compatible with existing getRecent() etc.
        });
    }

    /**
     * Log assistant reply
     */
    logAssistant(text, toolCalls = null) {
        this.log({
            role: 'assistant',
            text: text || '',
            toolCalls: toolCalls
        });
    }

    /**
     * Write a log entry (with retry logic)
     *
     * Requirements: 9.1, 9.2
     * - Uses atomic append mode
     * - Retries up to 3 times on failure
     */
    log(entry) {
        const sessionId = this.getSessionId();
        const record = {
            ts: getNowISO(),
            sessionId: sessionId,
            ...entry
        };

        const line = JSON.stringify(record) + '\n';
        const filePath = this.getTodayFile();

        // Use atomic append
        const success = this.atomicAppend(filePath, line);
        
        if (success) {
            console.log(`[SessionLogger] ${entry.role}: ${(entry.text || '').substring(0, 50)}...`);
        } else {
            console.error(`[SessionLogger] Write failed (retried 3 times)`);
        }
    }

    /**
     * Append write (with retry logic)
     *
     * Uses appendFileSync directly, same as JournalManager.
     * No rename because Windows file handles from other processes block rename.
     *
     * @param {string} filePath - Target file path
     * @param {string} content - Content to append
     * @param {number} maxRetries - Max retry count (default 3)
     * @returns {boolean} Whether write succeeded
     *
     * Requirements: 9.1, 9.2
     */
    atomicAppend(filePath, content, maxRetries = 3) {
        console.log(`[SessionLogger] appendFileSync: ${filePath}`);
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                fs.appendFileSync(filePath, content, 'utf8');
                console.log(`[SessionLogger] Write succeeded`);
                return true;
            } catch (err) {
                console.log(`[SessionLogger] Write failed ${attempt}/${maxRetries}: ${err.message}`);
                
                if (attempt < maxRetries) {
                    const delay = 100 * Math.pow(2, attempt - 1);
                    this.sleep(delay);
                }
            }
        }

        console.error(`[SessionLogger] Write failed (retried ${maxRetries} times)`);
        return false;
    }

    /**
     * Synchronous sleep (for retry intervals)
     * Uses Atomics.wait for non-busy-wait sync sleep (supported on Node.js main thread)
     * @param {number} ms - Milliseconds
     */
    sleep(ms) {
        try {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
        } catch (e) {
            // SharedArrayBuffer unavailable, use busy-wait (short delay, avoids spawnSync 1s minimum)
            const end = Date.now() + ms;
            while (Date.now() < end) { /* busy wait */ }
        }
    }


    /**
     * Read conversation records for a given date
     * @param {string} date - YYYY-MM-DD format, defaults to today
     * @returns {Array} Array of conversation records
     */
    read(date = null) {
        const targetDate = date || getTodayDate();
        const filePath = path.join(this.sessionsDir, `${targetDate}.jsonl`);

        if (!fs.existsSync(filePath)) {
            return [];
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line);
            const records = [];
            for (const line of lines) {
                try {
                    records.push(JSON.parse(line));
                } catch (e) {
                    // Skip malformed JSONL lines (e.g. partial writes, corruption)
                    console.warn(`[SessionLogger] Skipping invalid JSONL line: ${line.substring(0, 80)}`);
                }
            }
            return records;
        } catch (err) {
            console.error(`[SessionLogger] Read failed: ${err.message}`);
            return [];
        }
    }

    /**
     * Get recent N conversation records
     */
    getRecent(count = 10, date = null) {
        const records = this.read(date);
        return records.slice(-count);
    }

    /**
     * Get conversation records for a specific session
     */
    getSession(sessionId) {
        // Infer date from sessionId
        const dateStr = sessionId.substring(0, 8); // YYYYMMDD
        const date = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
        
        const records = this.read(date);
        return records.filter(r => r.sessionId === sessionId);
    }

    /**
     * List all sessions for today
     */
    listTodaySessions() {
        const records = this.read();
        const sessions = new Map();
        
        for (const record of records) {
            if (!record.sessionId) continue;
            
            if (!sessions.has(record.sessionId)) {
                sessions.set(record.sessionId, {
                    id: record.sessionId,
                    startTime: record.ts,
                    endTime: record.ts,
                    messageCount: 0
                });
            }
            
            const session = sessions.get(record.sessionId);
            session.endTime = record.ts;
            session.messageCount++;
        }
        
        return Array.from(sessions.values());
    }

    /**
     * Get current session ID (without creating new one)
     */
    getCurrentSessionId() {
        return this.currentSessionId;
    }

    /**
     * Read latest session ID from file (for cross-process sync)
     * MCP Server uses this to know Gateway's session
     */
    getLatestSessionIdFromFile() {
        const filePath = this.getTodayFile();
        if (!fs.existsSync(filePath)) {
            return null;
        }
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line);
            if (lines.length === 0) return null;
            
            // Read sessionId from last line
            const lastLine = lines[lines.length - 1];
            const record = JSON.parse(lastLine);
            return record.sessionId || null;
        } catch (err) {
            console.error(`[SessionLogger] Failed to read latest session ID: ${err.message}`);
            return null;
        }
    }

    /**
     * Log assistant reply (cross-process safe version)
     * Reads latest session ID from file instead of memory
     */
    logAssistantSafe(text, toolCalls = null) {
        // Read latest session ID from file
        const sessionId = this.getLatestSessionIdFromFile();
        if (!sessionId) {
            console.error('[SessionLogger] Cannot get session ID, skipping log');
            return;
        }
        
        const record = {
            ts: getNowISO(),
            sessionId: sessionId,
            role: 'assistant',
            text: text || '',
            toolCalls: toolCalls
        };

        const line = JSON.stringify(record) + '\n';
        const filePath = this.getTodayFile();

        // Use atomic append
        const success = this.atomicAppend(filePath, line);
        if (success) {
            console.log(`[SessionLogger] assistant: ${(text || '').substring(0, 50)}...`);
        } else {
            console.error(`[SessionLogger] Write failed: assistant`);
        }
    }

    /**
     * Log tool call (cross-process safe version)
     * OpenClaw style: records tool calls for summary context
     */
    logToolCall(toolName, args = null, result = null) {
        const sessionId = this.getLatestSessionIdFromFile();
        if (!sessionId) {
            return; // Silent fail, don't affect main flow
        }
        
        const record = {
            ts: getNowISO(),
            sessionId: sessionId,
            role: 'tool',
            toolName: toolName,
            args: args,
            result: typeof result === 'string' ? result.substring(0, 200) : result
        };

        const line = JSON.stringify(record) + '\n';
        const filePath = this.getTodayFile();

        // Use atomic append (silent fail)
        if (this.atomicAppend(filePath, line)) {
            console.log(`[SessionLogger] tool: ${toolName}`);
        }
    }

    /**
     * Format session conversation as readable text (for summary)
     * OpenClaw style: includes tool calls for summary context
     */
    formatSessionForSummary(sessionId) {
        const records = this.getSession(sessionId);
        if (records.length === 0) {
            return null;
        }

        const lines = [];
        const toolCalls = [];
        
        for (const r of records) {
            if (r.role === 'tool') {
                // Collect tool calls
                toolCalls.push(`• ${r.toolName}${r.args ? `: ${JSON.stringify(r.args).substring(0, 100)}` : ''}`);
            } else {
                // user or assistant
                const role = r.role === 'user' ? 'User' : 'Assistant';
                let text = r.text || '';
                // Truncate long messages
                if (text.length > 500) {
                    text = text.substring(0, 500) + '...';
                }
                lines.push(`${role}: ${text}`);
            }
        }

        // Combine output
        let conversation = lines.join('\n\n');
        if (toolCalls.length > 0) {
            conversation += `\n\n---\n🔧 Tool Calls:\n${toolCalls.join('\n')}`;
        }

        return {
            sessionId,
            messageCount: records.length,
            toolCallCount: toolCalls.length,
            startTime: records[0].ts,
            endTime: records[records.length - 1].ts,
            conversation: conversation
        };
    }

    /**
     * List unsummarized sessions
     */
    listUnsummarizedSessions(date = null) {
        const targetDate = date || getTodayDate();
        const records = this.read(targetDate);

        // Collect all session IDs
        const sessionIds = new Set();
        for (const r of records) {
            if (r.sessionId) sessionIds.add(r.sessionId);
        }

        // TODO: Replace marker file system with SQLite query to Memory Engine
        // (read .memory-engine-port, call GET /api/summaries/sessions to get
        // already-summarized session IDs, then filter them out).
        // The old .summarized marker file approach was dead code — markSummarized()
        // was never called — so for now we return all sessions.
        return [...sessionIds];
    }

    /**
     * Log journal entry
     * Used for syncing daily journal to JSONL
     *
     * @param {string} category - Category: 'event' | 'thought' | 'lesson' | 'todo'
     * @param {string} content - Journal content
     * @param {string} source - Source file path, e.g. "memory/2026-02-06.md"
     */
    logJournal(category, content, source) {
        const validCategories = ['event', 'thought', 'lesson', 'todo'];
        if (!validCategories.includes(category)) {
            console.warn(`[SessionLogger] Invalid category: ${category}, using 'event'`);
            category = 'event';
        }

        const sessionId = this.getLatestSessionIdFromFile() || this.getSessionId();
        const record = {
            ts: getNowISO(),
            sessionId: sessionId,
            role: 'journal',
            category: category,
            content: content || '',
            source: source || ''
        };

        const line = JSON.stringify(record) + '\n';
        const filePath = this.getTodayFile();

        // Use atomic append
        const success = this.atomicAppend(filePath, line);
        if (success) {
            console.log(`[SessionLogger] journal (${category}): ${(content || '').substring(0, 50)}...`);
        } else {
            console.error(`[SessionLogger] Write journal failed`);
        }
    }

    /**
     * Log important operation
     * Used for git commits, config changes, errors, context transfers, etc.
     *
     * @param {string} type - Type: 'git_commit' | 'config_change' | 'error' | 'context_transfer'
     * @param {object} details - Operation details
     */
    logOperation(type, details = {}) {
        const validTypes = ['git_commit', 'config_change', 'error', 'context_transfer'];
        if (!validTypes.includes(type)) {
            console.warn(`[SessionLogger] Invalid operation type: ${type}`);
        }

        const sessionId = this.getLatestSessionIdFromFile() || this.getSessionId();
        const record = {
            ts: getNowISO(),
            sessionId: sessionId,
            role: 'operation',
            type: type,
            details: details || {}
        };

        const line = JSON.stringify(record) + '\n';
        const filePath = this.getTodayFile();

        // Use atomic append
        const success = this.atomicAppend(filePath, line);
        if (success) {
            console.log(`[SessionLogger] operation (${type}): ${JSON.stringify(details).substring(0, 50)}...`);
        } else {
            console.error(`[SessionLogger] Write operation failed`);
        }
    }

}

// Singleton pattern
let instance = null;

function getSessionLogger(sessionsDir = null) {
    if (!instance) {
        instance = new SessionLogger(sessionsDir);
    }
    return instance;
}

module.exports = { SessionLogger, getSessionLogger };
