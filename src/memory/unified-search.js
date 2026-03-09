/**
 * Unified Search - 統一搜尋入口
 * 
 * 同時搜尋 sessions (SQLite FTS5) + knowledge + journals
 * 用 RRF 融合排序 + 時間衰減
 */

const path = require('path');
const fs = require('fs');
// search() from search-engine.js is async (returns Promise for L3, resolves immediately for L1/L2)
const { search: searchSessions } = require('./search-engine');
const { JournalManager } = require('./journal-manager');
const { getTodayDate, getNow } = require('../utils/timezone');
const { SearchEngine } = require('../skills/search-engine');

// RRF 參數
const RRF_K = 60;

// Cached SearchEngine for knowledge search
let _knowledgeEngine = null;
let _knowledgeIndexMtime = null;

/**
 * 搜尋 knowledge base
 * @param {string} query
 * @param {string} knowledgePath - knowledge 資料夾路徑
 * @returns {object[]}
 */
function searchKnowledge(query, knowledgePath) {
    const indexPath = path.join(knowledgePath, 'index.json');
    if (!fs.existsSync(indexPath)) return [];

    try {
        // Check if cache needs invalidation (mtime changed)
        const currentMtime = fs.statSync(indexPath).mtimeMs;
        if (!_knowledgeEngine || _knowledgeIndexMtime !== currentMtime) {
            const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
            const entries = index.entries || [];

            // Build documents with concatenated searchable text
            const documents = entries.map(e => ({
                id: e.id,
                title: e.title || '',
                tags: e.tags || [],
                summary: e.summary || '',
                text: `${e.title || ''} ${(e.tags || []).join(' ')} ${e.summary || ''}`
            }));

            _knowledgeEngine = new SearchEngine();
            const synonymsPath = path.join(knowledgePath, 'synonyms.json');
            _knowledgeEngine.init(documents, fs.existsSync(synonymsPath) ? synonymsPath : null);
            _knowledgeIndexMtime = currentMtime;
        }

        const { results } = _knowledgeEngine.search(query, { limit: 10 });

        // Map back to expected format
        return results.map(r => ({
            id: r.id,
            title: r.title,
            tags: r.tags,
            summary: r.summary,
            score: r.score,
            source: 'knowledge'
        }));
    } catch (err) {
        console.error(`[UnifiedSearch] Knowledge 搜尋失敗: ${err.message}`);
        return [];
    }
}

/**
 * 搜尋 journals
 * @param {string} query
 * @param {string} journalDir
 * @param {number} days - 搜尋天數
 * @returns {object[]}
 */
function searchJournals(query, journalDir, days = 7) {
    const results = [];

    try {
        const jm = new JournalManager(journalDir);

        for (let i = 0; i < days; i++) {
            const d = getNow();
            d.setDate(d.getDate() - i);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            const matches = jm.search(query, dateStr);
            for (const entry of matches) {
                results.push({
                    ...entry,
                    date: dateStr,
                    score: 1 / (1 + i * 0.1),  // 簡單時間衰減
                    source: 'journal'
                });
            }
        }
    } catch (err) {
        console.error(`[UnifiedSearch] Journal 搜尋失敗: ${err.message}`);
    }

    return results.slice(0, 10);
}


/**
 * RRF 融合排序
 * 將多個來源的結果用 Reciprocal Rank Fusion 合併
 * Applies source weights: knowledge=1.3, session=1.0, journal=0.8
 * Caps each source to top 5 results before merging
 *
 * @param {object[][]} resultSets - 多組已排序的結果
 * @returns {object[]}
 */
function rrfMerge(resultSets) {
    const SOURCE_WEIGHTS = { knowledge: 1.3, session: 1.0, journal: 0.8 };
    const SOURCE_CAP = 5;
    const scoreMap = new Map();

    for (const results of resultSets) {
        // Cap each source to top 5 results
        const capped = results.slice(0, SOURCE_CAP);
        for (let rank = 0; rank < capped.length; rank++) {
            const item = capped[rank];
            const key = item.sessionId || item.id || `${item.source || 'unknown'}_${item.date || ''}_${rank}`;
            const weight = SOURCE_WEIGHTS[item.source] || 1.0;
            const rrfScore = weight * (1 / (RRF_K + rank + 1));

            if (scoreMap.has(key)) {
                const existing = scoreMap.get(key);
                existing.rrfScore += rrfScore;
            } else {
                scoreMap.set(key, { ...item, rrfScore });
            }
        }
    }

    return Array.from(scoreMap.values())
        .sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * 統一搜尋
 * @param {string} query
 * @param {object} options
 * @param {string} options.source - 'all' | 'session' | 'knowledge' | 'journal'
 * @param {string} options.level - 'L1' | 'L2' | 'L3'
 * @param {number} options.days - 搜尋天數
 * @param {number} options.maxResults - 最大結果數
 * @param {string} options.sessionsDir - sessions 資料夾路徑
 * @param {string} options.knowledgePath - knowledge 資料夾路徑
 * @param {string} options.journalDir - journal 資料夾路徑
 * @returns {Promise<object[]>}
 */
async function searchAll(query, options = {}) {
    const source = options.source || 'all';
    const maxResults = options.maxResults || 10;
    const resultSets = [];

    // Session 搜尋
    if (source === 'all' || source === 'session') {
        const sessionResults = await searchSessions(query, {
            level: options.level || 'L2',
            days: options.days || 7,
            maxResults: maxResults,
            decayRate: options.decayRate,
            sessionsDir: options.sessionsDir
        });
        // 標記來源
        for (const r of sessionResults) {
            r.source = 'session';
        }
        resultSets.push(sessionResults);
    }

    // Knowledge 搜尋
    if ((source === 'all' || source === 'knowledge') && options.knowledgePath) {
        const knowledgeResults = searchKnowledge(query, options.knowledgePath);
        resultSets.push(knowledgeResults);
    }

    // Journal 搜尋
    if ((source === 'all' || source === 'journal') && options.journalDir) {
        const journalResults = searchJournals(query, options.journalDir, options.days || 7);
        resultSets.push(journalResults);
    }

    // 如果只有一個來源，直接回傳
    if (resultSets.length === 1) {
        return resultSets[0].slice(0, maxResults);
    }

    // 多來源 RRF 融合
    if (resultSets.length > 1) {
        return rrfMerge(resultSets).slice(0, maxResults);
    }

    return [];
}

module.exports = {
    searchAll,
    searchKnowledge,
    searchJournals,
    rrfMerge
};
