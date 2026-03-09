/**
 * Database - SQLite 連線管理
 * 
 * 使用 better-sqlite3（同步、快速、預編譯 binary）
 * WAL mode 支援並行讀寫
 * JSONL 仍為 source of truth；SQLite 只是索引層
 */

const path = require('path');
const fs = require('fs');

const SCHEMA_VERSION = '3';

let Database = null;
let db = null;
let available = false;
let fallbackMode = false;

// 嘗試載入 better-sqlite3
try {
    Database = require('better-sqlite3');
} catch (err) {
    console.warn('[Database] better-sqlite3 載入失敗，將使用 JSON fallback 模式');
    console.warn(`[Database] 錯誤: ${err.message}`);
    fallbackMode = true;
}

const DEFAULT_DB_PATH = path.join(__dirname, '../../data/memory.db');

/**
 * 初始化資料庫
 * @param {string} dbPath - 資料庫路徑，預設 data/memory.db，':memory:' 用於測試
 * @returns {object|null} SQLite 連線或 null
 */
function initDatabase(dbPath = DEFAULT_DB_PATH) {
    if (fallbackMode) {
        console.warn('[Database] fallback 模式，不初始化 SQLite');
        return null;
    }

    try {
        // 確保資料夾存在
        if (dbPath !== ':memory:') {
            const dir = path.dirname(dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        db = new Database(dbPath, { timeout: 5000 });
        
        // 啟用 WAL mode
        db.pragma('journal_mode = WAL');
        
        // 檢查版本，決定是否需要重建
        const needsRebuild = checkSchemaVersion();
        
        // 建立 schema
        createSchema();
        
        if (needsRebuild) {
            console.log('[Database] Schema 版本不符，需要重建索引');
        }

        available = true;
        console.log(`[Database] SQLite 初始化完成: ${dbPath}`);
        return db;
    } catch (err) {
        console.error(`[Database] SQLite 初始化失敗: ${err.message}`);
        fallbackMode = true;
        available = false;
        return null;
    }
}


/**
 * 檢查 schema 版本
 * @returns {boolean} 是否需要重建
 */
function checkSchemaVersion() {
    try {
        const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
        if (!row || row.value !== SCHEMA_VERSION) {
            return true;
        }
        return false;
    } catch (err) {
        // meta 表不存在，需要建立
        return true;
    }
}

/**
 * 建立 schema
 */
function createSchema() {
    db.exec(`
        -- 元資料表
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        -- Session 表
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            start_time TEXT,
            end_time TEXT,
            message_count INTEGER DEFAULT 0,
            keywords TEXT,
            files TEXT,
            tool_calls TEXT
        );

        -- 摘要表
        CREATE TABLE IF NOT EXISTS summaries (
            session_id TEXT PRIMARY KEY,
            summary TEXT,
            created_at TEXT
        );
    `);

    // FTS5 表要單獨建（CREATE VIRTUAL TABLE 不支援 IF NOT EXISTS 在某些版本）
    try {
        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(
                session_id,
                role,
                content,
                timestamp UNINDEXED,
                tokenize='unicode61'
            );
        `);
    } catch (err) {
        // 表已存在，忽略
        if (!err.message.includes('already exists')) {
            throw err;
        }
    }

    // FTS5 for summaries — weighted columns for ranked search
    try {
        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS summary_fts USING fts5(
                session_id UNINDEXED,
                topic,
                tags,
                decisions,
                actions,
                summary_text,
                tokenize='unicode61'
            );
        `);
    } catch (err) {
        if (!err.message.includes('already exists')) {
            throw err;
        }
    }

    // Structured summary columns (additive — safe for existing data)
    const structuredCols = [
        { name: 'topic', type: 'TEXT' },
        { name: 'decisions', type: 'TEXT' },       // JSON array
        { name: 'actions', type: 'TEXT' },          // JSON array
        { name: 'next_steps', type: 'TEXT' },       // JSON array
        { name: 'entities', type: 'TEXT' },          // JSON object
        { name: 'tags', type: 'TEXT' },              // JSON array
        { name: 'importance', type: 'INTEGER' },
    ];
    for (const col of structuredCols) {
        try {
            db.exec(`ALTER TABLE summaries ADD COLUMN ${col.name} ${col.type}`);
        } catch (err) {
            // Column already exists — safe to ignore
            if (!err.message.includes('duplicate column')) {
                throw err;
            }
        }
    }

    // 設定版本
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);
    
    // 初始化 last_indexed
    db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('last_indexed', '');
}

/**
 * Parse summary JSON and extract structured fields for FTS5
 * @param {string} summaryJson - JSON string from summaries.summary column
 * @returns {object} { topic, tags, decisions, actions, summaryText }
 */
function parseSummaryForFts(summaryJson) {
    const defaults = { topic: '', tags: '', decisions: '', actions: '', summaryText: '' };
    if (!summaryJson) return defaults;
    try {
        const obj = JSON.parse(summaryJson);
        return {
            topic: (typeof obj.topic === 'string') ? obj.topic : '',
            tags: Array.isArray(obj.tags) ? obj.tags.join(' ') : '',
            decisions: Array.isArray(obj.decisions) ? obj.decisions.join(' ') : '',
            actions: Array.isArray(obj.actions) ? obj.actions.join(' ') : '',
            summaryText: (typeof obj.summary === 'string') ? obj.summary :
                         (typeof obj.topic === 'string') ? obj.topic : ''
        };
    } catch (err) {
        // Not valid JSON — treat entire string as summary text
        return { ...defaults, summaryText: summaryJson };
    }
}

/**
 * Populate summary_fts from all existing summaries (full rebuild)
 * Safe to call multiple times — clears and repopulates
 */
function populateSummaryFts() {
    if (!db) return;
    try {
        const rows = db.prepare('SELECT session_id, summary FROM summaries').all();
        const ins = db.prepare(
            'INSERT INTO summary_fts (session_id, topic, tags, decisions, actions, summary_text) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const txn = db.transaction(() => {
            db.exec("DELETE FROM summary_fts");
            for (const row of rows) {
                const f = parseSummaryForFts(row.summary);
                ins.run(row.session_id, f.topic, f.tags, f.decisions, f.actions, f.summaryText);
            }
        });
        txn();
        console.log(`[Database] summary_fts populated: ${rows.length} rows`);
    } catch (err) {
        console.error(`[Database] populateSummaryFts failed: ${err.message}`);
    }
}

/**
 * Sync a single session's summary into summary_fts (upsert pattern)
 * Call after inserting/updating a summary row
 * @param {string} sessionId
 */
function syncSummaryFts(sessionId) {
    if (!db) return;
    try {
        const row = db.prepare('SELECT summary FROM summaries WHERE session_id = ?').get(sessionId);
        // Delete old entry first (FTS5 doesn't support UPDATE well)
        db.prepare("DELETE FROM summary_fts WHERE session_id = ?").run(sessionId);
        if (row) {
            const f = parseSummaryForFts(row.summary);
            db.prepare(
                'INSERT INTO summary_fts (session_id, topic, tags, decisions, actions, summary_text) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(sessionId, f.topic, f.tags, f.decisions, f.actions, f.summaryText);
        }
    } catch (err) {
        console.error(`[Database] syncSummaryFts failed for ${sessionId}: ${err.message}`);
    }
}

/**
 * 取得資料庫連線
 * @returns {object|null}
 */
function getDatabase() {
    return db;
}

/**
 * 安全關閉資料庫
 */
function closeDatabase() {
    if (db) {
        try {
            db.close();
            console.log('[Database] SQLite 已關閉');
        } catch (err) {
            console.error(`[Database] 關閉失敗: ${err.message}`);
        }
        db = null;
        available = false;
    }
}

/**
 * 檢查 SQLite 是否可用
 */
function isDatabaseAvailable() {
    return available && !fallbackMode && db !== null;
}

/**
 * 是否在 fallback 模式
 */
function isFallbackMode() {
    return fallbackMode;
}

/**
 * 重置狀態（用於測試）
 */
function resetDatabase() {
    closeDatabase();
    fallbackMode = false;
    available = false;
}

module.exports = {
    initDatabase,
    getDatabase,
    closeDatabase,
    isDatabaseAvailable,
    isFallbackMode,
    resetDatabase,
    populateSummaryFts,
    syncSummaryFts,
    parseSummaryForFts,
    SCHEMA_VERSION
};
