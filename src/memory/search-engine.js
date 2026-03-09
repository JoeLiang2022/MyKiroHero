/**
 * SearchEngine - FTS5 搜尋 + 時間衰減 + 去重
 * 
 * 效能分級：
 * - L1 (<10ms): session 主題列表（查 sessions 表 keywords）
 * - L2 (<100ms): 匹配訊息 + 前後文（FTS5 搜尋 messages 表）
 * - L3 (<500ms): 完整 session 對話（FTS5 找 session → 讀 JSONL 原文）
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getDatabase, isDatabaseAvailable } = require('./database');
const { tokenize, STOPWORDS } = require('./indexer');
const { getNow } = require('../utils/timezone');

// 時間衰減預設參數
const DEFAULT_DECAY_RATE = 0.05;  // 20 天後權重降到約 50%
const DEFAULT_DAYS = 7;
const DEFAULT_MAX_RESULTS = 10;
const DEDUP_THRESHOLD = 0.7;  // Jaccard 相似度閾值

/**
 * L1 搜尋：session 主題列表（最快）
 * 查 sessions 表的 keywords 欄位
 * 
 * @param {string} query
 * @param {object} options - { days, maxResults }
 * @returns {object[]}
 */
function searchL1(query, options = {}) {
    if (!isDatabaseAvailable()) return [];

    const db = getDatabase();
    const days = options.days || DEFAULT_DAYS;
    const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;
    const queryTokens = tokenize(query);

    if (queryTokens.length === 0) return [];

    // 計算日期範圍 — cache getNow() to avoid repeated calls
    const now = getNow();
    const since = new Date(now.getTime());
    since.setDate(since.getDate() - days);
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
    const nowMs = now.getTime();

    const rows = db.prepare(
        'SELECT id, date, start_time, end_time, message_count, keywords, files, tool_calls FROM sessions WHERE date >= ? ORDER BY date DESC'
    ).all(sinceStr);

    const results = [];
    for (const row of rows) {
        const keywords = JSON.parse(row.keywords || '[]');
        // 計算 query tokens 和 session keywords 的重疊
        const overlap = queryTokens.filter(t => keywords.some(k => k.includes(t) || t.includes(k)));
        if (overlap.length === 0) continue;

        const score = overlap.length / queryTokens.length;
        const ageDays = Math.max(0, (nowMs - new Date(row.date + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));
        const decayedScore = score * (1 / (1 + ageDays * (options.decayRate || DEFAULT_DECAY_RATE)));

        results.push({
            sessionId: row.id,
            date: row.date,
            startTime: row.start_time,
            endTime: row.end_time,
            messageCount: row.message_count,
            keywords,
            files: JSON.parse(row.files || '[]'),
            toolCalls: JSON.parse(row.tool_calls || '[]'),
            score: decayedScore,
            matchedKeywords: overlap,
            level: 'L1'
        });
    }

    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
}


/**
 * L2 搜尋：匹配訊息 + 前後文（中等速度）
 * 使用 FTS5 MATCH + bm25() 排序
 * 
 * @param {string} query
 * @param {object} options - { days, maxResults, decayRate }
 * @returns {object[]}
 */
function searchL2(query, options = {}) {
    if (!isDatabaseAvailable()) return [];

    const db = getDatabase();
    const days = options.days || DEFAULT_DAYS;
    const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;

    // 建構 FTS5 查詢（用 OR 連接 tokens）
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    // FTS5 查詢：sanitize tokens to prevent FTS5 syntax injection
    // Remove FTS5 special characters: *, ", NEAR, AND, OR, NOT, etc.
    const sanitizeToken = (t) => t.replace(/[*"(){}[\]^~:]/g, '').trim();
    const safeTokens = queryTokens.map(sanitizeToken).filter(t => t.length > 0);
    if (safeTokens.length === 0) return [];

    // #8 NEAR/5 phrase matching with OR fallback
    const nearQuery = safeTokens.length > 1
        ? safeTokens.join(' NEAR/5 ')
        : safeTokens[0];
    const orQuery = safeTokens.join(' OR ');
    // Try NEAR/5 first; if 0 results, fallback to OR
    let ftsQuery = nearQuery;

    const since = getNow();
    const nowMs = since.getTime();
    const sinceDate = new Date(nowMs);
    sinceDate.setDate(sinceDate.getDate() - days);
    const sinceStr = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, '0')}-${String(sinceDate.getDate()).padStart(2, '0')}`;

    try {
        // FTS5 搜尋 + BM25 排序
        const stmt = db.prepare(`
            SELECT 
                m.session_id,
                m.role,
                m.content,
                m.timestamp,
                bm25(messages) as bm25_score,
                s.date,
                s.keywords
            FROM messages m
            JOIN sessions s ON m.session_id = s.id
            WHERE messages MATCH ?
            AND s.date >= ?
            ORDER BY bm25(messages)
            LIMIT ?
        `);

        // #8 Try NEAR/5 first, fallback to OR if 0 results or syntax error
        let rows;
        try {
            rows = stmt.all(ftsQuery, sinceStr, maxResults * 3);
        } catch (nearErr) {
            // NEAR/5 with bigram tokens can cause FTS5 syntax errors — fallback to OR
            ftsQuery = orQuery;
            rows = stmt.all(ftsQuery, sinceStr, maxResults * 3);
        }
        if (rows.length === 0 && ftsQuery !== orQuery) {
            ftsQuery = orQuery;
            rows = stmt.all(ftsQuery, sinceStr, maxResults * 3);
        }

        // #10 BM25 sigmoid normalization + recency blend
        const sigmoid = (x) => 1 / (1 + Math.exp(-x * 0.5));

        const results = rows.map(row => {
            const ageDays = Math.max(0, (nowMs - new Date(row.date + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));
            const decayRate = options.decayRate || DEFAULT_DECAY_RATE;
            // bm25() returns negative (lower = better), take abs for sigmoid input
            const rawBm25 = Math.abs(row.bm25_score);
            const sigmoidScore = sigmoid(rawBm25);
            const recency = 1 / (1 + ageDays * decayRate);
            const finalScore = 0.6 * sigmoidScore + 0.4 * recency;

            return {
                sessionId: row.session_id,
                date: row.date,
                role: row.role,
                content: row.content,
                timestamp: row.timestamp,
                score: finalScore,
                keywords: JSON.parse(row.keywords || '[]'),
                level: 'L2'
            };
        });

        // Session-level dedup: O(n) Map — keep highest score per session
        const seen = new Map();
        for (const r of results) {
            if (!seen.has(r.sessionId) || r.score > seen.get(r.sessionId).score) {
                seen.set(r.sessionId, r);
            }
        }

        // Query summary_fts for distilled session content (1.2x boost)
        try {
            const SUMMARY_BOOST = 1.2;
            const summaryStmt = db.prepare(`
                SELECT
                    session_id,
                    topic,
                    snippet(summary_fts, 4, '>>>', '<<<', '...', 40) as snippet_text,
                    bm25(summary_fts, 0, 10, 5, 3, 2, 1) as bm25_score
                FROM summary_fts
                WHERE summary_fts MATCH ?
                LIMIT ?
            `);

            let summaryRows = summaryStmt.all(ftsQuery, maxResults * 2);
            if (summaryRows.length === 0 && ftsQuery !== orQuery) {
                summaryRows = summaryStmt.all(orQuery, maxResults * 2);
            }

            for (const row of summaryRows) {
                // Look up session date from sessions table
                const sess = db.prepare('SELECT date FROM sessions WHERE id = ?').get(row.session_id);
                const sessDate = sess ? sess.date : getNow().toISOString().slice(0, 10);
                const ageDays = Math.max(0, (nowMs - new Date(sessDate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));
                const decayRate = options.decayRate || DEFAULT_DECAY_RATE;
                const rawBm25 = Math.abs(row.bm25_score);
                const sigmoidScore = sigmoid(rawBm25);
                const recency = 1 / (1 + ageDays * decayRate);
                const finalScore = (0.6 * sigmoidScore + 0.4 * recency) * SUMMARY_BOOST;

                const existing = seen.get(row.session_id);
                if (!existing || finalScore > existing.score) {
                    seen.set(row.session_id, {
                        sessionId: row.session_id,
                        date: sessDate,
                        score: finalScore,
                        snippet: row.snippet_text || row.topic || '',
                        level: 'L2'
                    });
                }
            }
        } catch (summaryErr) {
            // summary_fts may not exist yet — non-fatal
            if (!summaryErr.message.includes('no such table')) {
                console.error(`[SearchEngine] summary_fts query failed: ${summaryErr.message}`);
            }
        }

        return [...seen.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults);
    } catch (err) {
        console.error(`[SearchEngine] L2 搜尋失敗: ${err.message}`);
        return [];
    }
}

/**
 * Read records for a specific session from a JSONL file using streaming.
 * Uses readline + early termination: after finding session records,
 * stops after 50 consecutive non-matching lines (sessions cluster in JSONL).
 *
 * @param {string} filePath - Path to the JSONL file
 * @param {string} targetSessionId - Session ID to extract
 * @param {number} [maxRecords=200] - Max records to collect
 * @returns {Promise<object[]>} Matching records
 */
async function readSessionFromJsonl(filePath, targetSessionId, maxRecords = 200) {
    const records = [];
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity
    });

    let foundSession = false;
    let consecutiveMisses = 0;
    const EARLY_TERMINATION_THRESHOLD = 50;

    try {
        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const r = JSON.parse(line);
                if (r.sessionId === targetSessionId) {
                    records.push(r);
                    foundSession = true;
                    consecutiveMisses = 0;
                } else if (foundSession) {
                    consecutiveMisses++;
                    if (consecutiveMisses >= EARLY_TERMINATION_THRESHOLD) break;
                }
            } catch (e) { /* skip malformed lines */ }

            if (records.length >= maxRecords) break;
        }
    } finally {
        rl.close();
    }

    return records;
}

/**
 * L3 搜尋：完整 session 對話（最慢但最完整）
 * FTS5 找到 session → 用 readline stream 讀 JSONL 原文（early termination）
 * 
 * @param {string} query
 * @param {object} options - { days, maxResults, sessionsDir }
 * @returns {Promise<object[]>}
 */
async function searchL3(query, options = {}) {
    // 用 L2 找到相關 session（比 L1 更豐富的 FTS5 結果）
    const l2Results = searchL2(query, { ...options, maxResults: 20 });
    if (l2Results.length === 0) return [];

    // Deduplicate by sessionId — keep highest score per session
    const sessionMap = new Map();
    for (const r of l2Results) {
        if (!sessionMap.has(r.sessionId) || r.score > sessionMap.get(r.sessionId).score) {
            sessionMap.set(r.sessionId, r);
        }
    }
    const uniqueSessions = [...sessionMap.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    const sessionsDir = options.sessionsDir;
    if (!sessionsDir) {
        console.error('[SearchEngine] L3 搜尋需要 sessionsDir 參數');
        return [];
    }

    const results = [];
    for (const session of uniqueSessions) {
        const date = session.date;
        const filePath = path.join(sessionsDir, `${date}.jsonl`);
        if (!fs.existsSync(filePath)) continue;

        try {
            const records = await readSessionFromJsonl(filePath, session.sessionId);

            if (records.length > 0) {
                results.push({
                    sessionId: session.sessionId,
                    date: session.date,
                    score: session.score,
                    keywords: session.keywords,
                    messageCount: records.length,
                    conversation: records.map(r => ({
                        role: r.role,
                        text: r.text || '',
                        timestamp: r.ts,
                        toolName: r.toolName
                    })),
                    level: 'L3'
                });
            }
        } catch (err) {
            console.error(`[SearchEngine] L3 讀取 ${filePath} 失敗: ${err.message}`);
        }
    }

    return results;
}

/**
 * 時間衰減函數
 * @param {number} score - 原始分數
 * @param {number} ageDays - 天數
 * @param {number} decayRate - 衰減率
 * @returns {number}
 */
function applyTimeDecay(score, ageDays, decayRate = DEFAULT_DECAY_RATE) {
    return score * (1 / (1 + ageDays * decayRate));
}

/**
 * 去重：Jaccard 相似度 > 閾值時只保留最新
 * @param {object[]} results
 * @returns {object[]}
 */
function deduplicateResults(results) {
    if (results.length <= 1) return results;

    // 為每個結果提取關鍵字集合
    const keywordSets = results.map(r => {
        const text = r.content || r.keywords?.join(' ') || '';
        return new Set(tokenize(text));
    });

    const removed = new Set();

    for (let i = 0; i < results.length; i++) {
        if (removed.has(i)) continue;
        for (let j = i + 1; j < results.length; j++) {
            if (removed.has(j)) continue;

            const similarity = jaccardSimilarity(keywordSets[i], keywordSets[j]);
            if (similarity > DEDUP_THRESHOLD) {
                // 保留較新的（比較 timestamp 或 date）
                const dateI = results[i].timestamp || results[i].date || '';
                const dateJ = results[j].timestamp || results[j].date || '';
                if (dateI >= dateJ) {
                    removed.add(j);
                    results[i].dedupCount = (results[i].dedupCount || 0) + 1;
                } else {
                    removed.add(i);
                    results[j].dedupCount = (results[j].dedupCount || 0) + 1;
                    break;  // i 被移除，跳出內層迴圈
                }
            }
        }
    }

    return results.filter((_, idx) => !removed.has(idx));
}

/**
 * Jaccard 相似度
 * @param {Set} setA
 * @param {Set} setB
 * @returns {number} 0-1
 */
function jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }

    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * 統一搜尋入口
 * @param {string} query
 * @param {object} options - { level, days, maxResults, decayRate, sessionsDir }
 * @returns {Promise<object[]>|object[]} L3 returns Promise, others return sync
 */
async function search(query, options = {}) {
    const level = (options.level || 'L2').toUpperCase();

    switch (level) {
        case 'L1': return searchL1(query, options);
        case 'L2': return searchL2(query, options);
        case 'L3': return await searchL3(query, options);
        default: return searchL2(query, options);
    }
}

module.exports = {
    searchL1,
    searchL2,
    searchL3,
    readSessionFromJsonl,
    search,
    applyTimeDecay,
    deduplicateResults,
    jaccardSimilarity,
    DEFAULT_DECAY_RATE,
    DEFAULT_DAYS,
    DEFAULT_MAX_RESULTS,
    DEDUP_THRESHOLD
};
