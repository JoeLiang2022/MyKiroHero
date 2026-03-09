/**
 * Indexer - JSONL → SQLite 索引建構器
 * 
 * 從 JSONL 對話記錄提取關鍵字，建立 FTS5 全文索引。
 * 支援增量索引和全量重建。
 */

const fs = require('fs');
const path = require('path');
const { getDatabase, isDatabaseAvailable } = require('./database');
const { getNowISO } = require('../utils/timezone');

// 停用詞（複用 knowledge skill 的停用詞表）
const STOPWORDS = new Set([
    // English
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'between',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
    'it', 'its', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
    'they', 'them', 'their', 'about', 'all', 'also', 'any', 'because',
    // Chinese
    '的', '是', '在', '了', '和', '與', '或', '也', '都', '就', '而', '及', '著', '過',
    '這', '那', '個', '些', '什麼', '怎麼', '如何', '為什麼', '哪', '誰', '何',
    '我', '你', '他', '她', '它', '我們', '你們', '他們', '自己',
    '可以', '能', '會', '要', '想', '讓', '把', '被', '給', '對', '從', '到', '向',
    '很', '太', '更', '最', '非常', '十分', '相當', '比較', '稍微',
    // Common in chat
    'ok', 'yes', 'no', 'hi', 'hello', 'hey', 'thanks', 'thank', 'please',
    '好', '嗯', '喔', '哦', '啊', '吧', '呢', '嘛', '啦', '耶'
]);

// Domain stopwords — common dev syntax/boilerplate terms too generic for meaningful search
const DOMAIN_STOPWORDS = new Set([
    'function', 'const', 'let', 'var', 'return', 'class', 'new', 'true', 'false',
    'null', 'undefined', 'else', 'switch', 'case', 'break', 'continue',
    'while', 'try', 'catch', 'throw', 'async', 'await', 'import', 'export',
    'require', 'module', 'default', 'console', 'string', 'number',
    'boolean', 'object', 'array', 'type', 'interface', 'enum', 'void',
    'value', 'item', 'param', 'args', 'option', 'setting', 'info'
]);

/**
 * Split camelCase/PascalCase into parts, preserving number segments attached to letters.
 * e.g. 'searchL3Results' → ['search', 'L3', 'Results']
 *      'getHTTPResponse' → ['get', 'HTTP', 'Response']
 *      'v2beta' → ['v2', 'beta']
 *      'fts5Index' → ['fts5', 'Index']
 * @param {string} word
 * @returns {string[]}
 */
function splitCamelCase(word) {
    if (!word) return [];
    // Match sequences in priority order:
    // 1. Uppercase acronym before another capitalized word: HTTP in HTTPResponse
    // 2. Single uppercase + digits: L3, V2
    // 3. Capitalized word (optionally with trailing digits): Search, Results, fts5
    // 4. Lowercase run with optional trailing digits: search, v2, fts5
    // 5. Digit run with optional trailing lowercase: 3d, 25
    const parts = word.match(
        /[A-Z]{2,}(?=[A-Z][a-z]|$)|[A-Z]\d+|[A-Z][a-z]+\d*|[a-z]+\d*|\d+[a-z]*|[A-Z]/g
    );
    return parts || [word];
}

/**
 * Check if a token passes all stopword filters.
 * @param {string} token - lowercased token
 * @returns {boolean}
 */
function isUsefulToken(token) {
    return token.length > 1 && !STOPWORDS.has(token) && !DOMAIN_STOPWORDS.has(token);
}

/**
 * 分詞（英文空格分割 + CamelCase拆分 + 數字保留 + 領域停用詞 + 英文bigram，中文 2-gram）
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
    if (!text) return [];
    const tokens = [];

    // English: split by whitespace and punctuation (before lowercasing, to preserve case for camelCase)
    const rawWords = text.split(/[\s\-_.,;:!?()[\]{}'"\/\\`~@#$%^&*+=<>|]+/);
    const englishUnigrams = []; // collect for bigram generation

    for (const raw of rawWords) {
        if (!raw || !/[a-zA-Z0-9]/.test(raw)) continue;

        // Split camelCase/PascalCase
        const parts = splitCamelCase(raw);

        for (const part of parts) {
            const lower = part.toLowerCase();

            // Keep alphanumeric tokens (e.g. 'l3', 'v2', 'fts5')
            if (/^[a-z0-9]+$/.test(lower) && isUsefulToken(lower)) {
                tokens.push(lower);
                englishUnigrams.push(lower);
            }
        }

        // Also add the full compound word (lowercased) if it differs from parts
        // e.g. 'searchl3' from 'searchL3' — useful for exact matching
        if (parts.length > 1) {
            const compound = raw.toLowerCase();
            if (isUsefulToken(compound)) {
                tokens.push(compound);
            }
        }
    }

    // English bigrams: adjacent unigram pairs for phrase-like matching
    for (let i = 0; i < englishUnigrams.length - 1; i++) {
        const bigram = englishUnigrams[i] + '_' + englishUnigrams[i + 1];
        tokens.push(bigram);
    }

    // Chinese: extract continuous characters + 2-gram
    const chineseMatches = text.match(/[\u4e00-\u9fff]+/g) || [];
    for (const match of chineseMatches) {
        if (match.length >= 2 && !STOPWORDS.has(match)) {
            tokens.push(match);
            if (match.length > 2) {
                for (let i = 0; i < match.length - 1; i++) {
                    const bigram = match.substring(i, i + 2);
                    if (!STOPWORDS.has(bigram)) tokens.push(bigram);
                }
            }
        }
    }

    return tokens;
}


/**
 * 從訊息提取關鍵字（top N by frequency）
 * @param {object[]} records - JSONL 記錄
 * @param {number} topN - 取前 N 個關鍵字
 * @returns {string[]}
 */
function extractKeywords(records, topN = 20) {
    const freq = new Map();

    for (const r of records) {
        if (r.role !== 'user' && r.role !== 'assistant') continue;
        const text = r.text || '';
        const tokens = tokenize(text);
        for (const t of tokens) {
            freq.set(t, (freq.get(t) || 0) + 1);
        }
    }

    // 按頻率排序，取 top N
    return Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([word]) => word);
}

/**
 * 從 tool call 記錄提取檔案名稱
 * @param {object[]} records - JSONL 記錄
 * @returns {string[]}
 */
function extractFiles(records) {
    const files = new Set();

    for (const r of records) {
        // 從 tool call 的 args 提取檔案路徑
        if (r.role === 'tool' && r.args) {
            const argsStr = typeof r.args === 'string' ? r.args : JSON.stringify(r.args);
            // 匹配常見檔案路徑模式
            const fileMatches = argsStr.match(/[\w\-./]+\.\w{1,10}/g) || [];
            for (const f of fileMatches) {
                // 過濾掉太短或明顯不是檔案的
                if (f.length > 3 && !f.startsWith('http')) {
                    files.add(path.basename(f));
                }
            }
        }

        // 從 assistant 的 toolCalls 提取
        if (r.role === 'assistant' && r.toolCalls) {
            for (const tc of r.toolCalls) {
                if (tc.args) {
                    const argsStr = typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args);
                    const fileMatches = argsStr.match(/[\w\-./]+\.\w{1,10}/g) || [];
                    for (const f of fileMatches) {
                        if (f.length > 3 && !f.startsWith('http')) {
                            files.add(path.basename(f));
                        }
                    }
                }
            }
        }
    }

    return Array.from(files);
}

/**
 * 從 records 提取 tool call 名稱
 * @param {object[]} records
 * @returns {string[]}
 */
function extractToolCalls(records) {
    const tools = new Set();
    for (const r of records) {
        if (r.role === 'tool' && r.toolName) {
            tools.add(r.toolName);
        }
    }
    return Array.from(tools);
}

/**
 * 索引單一 session 到 SQLite
 * @param {string} sessionId
 * @param {object[]} records - 該 session 的所有記錄
 */
function indexSession(sessionId, records) {
    const db = getDatabase();
    if (!db || records.length === 0) return;

    const date = `${sessionId.substring(0, 4)}-${sessionId.substring(4, 6)}-${sessionId.substring(6, 8)}`;
    const startTime = records[0].ts || '';
    const endTime = records[records.length - 1].ts || '';
    const keywords = extractKeywords(records);
    const files = extractFiles(records);
    const toolCalls = extractToolCalls(records);

    const insertOrReplace = db.transaction(() => {
        // Upsert session 元資料
        db.prepare(`
            INSERT OR REPLACE INTO sessions (id, date, start_time, end_time, message_count, keywords, files, tool_calls)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            sessionId, date, startTime, endTime, records.length,
            JSON.stringify(keywords), JSON.stringify(files), JSON.stringify(toolCalls)
        );

        // 先刪除舊的 messages（冪等性）
        db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);

        // 批次插入 messages 到 FTS5
        const insertMsg = db.prepare(
            'INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)'
        );
        for (const r of records) {
            if (r.role === 'user' || r.role === 'assistant') {
                insertMsg.run(sessionId, r.role, r.text || '', r.ts || '');
            }
        }
    });

    insertOrReplace();
}

/**
 * 解析 JSONL 檔案，按 session 分組
 * @param {string} filePath
 * @returns {Map<string, object[]>} sessionId → records
 */
function parseJsonlBySession(filePath) {
    const sessions = new Map();

    if (!fs.existsSync(filePath)) return sessions;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
        try {
            const record = JSON.parse(line);
            if (!record.sessionId) continue;
            if (!sessions.has(record.sessionId)) {
                sessions.set(record.sessionId, []);
            }
            sessions.get(record.sessionId).push(record);
        } catch (err) {
            // 跳過無效行
        }
    }

    return sessions;
}

/**
 * 增量索引一個 JSONL 檔案
 * @param {string} filePath
 * @returns {{ indexed: number, skipped: number }}
 */
function indexJsonlFile(filePath) {
    if (!isDatabaseAvailable()) {
        return { indexed: 0, skipped: 0, error: 'Database not available' };
    }

    const db = getDatabase();
    const sessions = parseJsonlBySession(filePath);
    let indexed = 0;
    let skipped = 0;

    for (const [sessionId, records] of sessions) {
        // 檢查是否已索引（且記錄數相同）
        const existing = db.prepare('SELECT message_count FROM sessions WHERE id = ?').get(sessionId);
        if (existing && existing.message_count === records.length) {
            skipped++;
            continue;
        }

        indexSession(sessionId, records);
        indexed++;
    }

    return { indexed, skipped };
}

/**
 * 索引 sessions 目錄下所有 JSONL 檔案（增量，mtime 檢查）
 * @param {string} sessionsDir
 * @returns {{ totalIndexed: number, totalSkipped: number, files: number, filesSkippedByMtime: number }}
 */
function indexAllFiles(sessionsDir) {
    if (!isDatabaseAvailable()) {
        return { totalIndexed: 0, totalSkipped: 0, files: 0, filesSkippedByMtime: 0, error: 'Database not available' };
    }

    const db = getDatabase();
    let totalIndexed = 0;
    let totalSkipped = 0;
    let fileCount = 0;
    let filesSkippedByMtime = 0;

    // Get last_indexed timestamp for mtime comparison
    const metaRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('last_indexed');
    const lastIndexedMs = metaRow && metaRow.value ? new Date(metaRow.value).getTime() : 0;

    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
        const filePath = path.join(sessionsDir, file);

        // Skip files not modified since last indexing
        if (lastIndexedMs > 0) {
            try {
                const mtimeMs = fs.statSync(filePath).mtimeMs;
                if (mtimeMs < lastIndexedMs) {
                    filesSkippedByMtime++;
                    continue;
                }
            } catch (err) {
                // If stat fails, process the file anyway
            }
        }

        const result = indexJsonlFile(filePath);
        totalIndexed += result.indexed;
        totalSkipped += result.skipped;
        fileCount++;
    }

    // 更新 last_indexed 時間
    db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(getNowISO(), 'last_indexed');

    console.log(`[Indexer] 索引完成: ${totalIndexed} sessions indexed, ${totalSkipped} skipped, ${fileCount} files processed, ${filesSkippedByMtime} files skipped by mtime`);
    return { totalIndexed, totalSkipped, files: fileCount, filesSkippedByMtime };
}

/**
 * 全量重建索引（清空 SQLite，從所有 JSONL 重建）
 * @param {string} sessionsDir
 * @returns {{ totalIndexed: number, files: number }}
 */
function rebuildAll(sessionsDir) {
    if (!isDatabaseAvailable()) {
        return { totalIndexed: 0, files: 0, error: 'Database not available' };
    }

    const db = getDatabase();

    // Backup summaries — these are LLM-generated primary data and must survive rebuilds
    const savedSummaries = db.prepare('SELECT * FROM summaries').all();

    // 清空 sessions + messages (but NOT summaries)
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM messages');

    console.log('[Indexer] 清空索引，開始全量重建...');

    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
    let totalIndexed = 0;

    for (const file of files) {
        const filePath = path.join(sessionsDir, file);
        const sessions = parseJsonlBySession(filePath);
        for (const [sessionId, records] of sessions) {
            indexSession(sessionId, records);
            totalIndexed++;
        }
    }

    // Restore saved summaries
    const insertSummary = db.prepare('INSERT OR REPLACE INTO summaries (session_id, summary, created_at) VALUES (?, ?, ?)');
    for (const s of savedSummaries) {
        insertSummary.run(s.session_id, s.summary, s.created_at);
    }

    // 更新 last_indexed
    db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(getNowISO(), 'last_indexed');

    console.log(`[Indexer] 全量重建完成: ${totalIndexed} sessions, ${files.length} files`);
    return { totalIndexed, files: files.length };
}


module.exports = {
    tokenize,
    splitCamelCase,
    isUsefulToken,
    extractKeywords,
    extractFiles,
    extractToolCalls,
    indexSession,
    parseJsonlBySession,
    indexJsonlFile,
    indexAllFiles,
    rebuildAll,
    STOPWORDS,
    DOMAIN_STOPWORDS
};
