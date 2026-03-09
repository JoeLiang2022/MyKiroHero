/**
 * JSON Fallback - better-sqlite3 載入失敗時的降級模式
 * 
 * 用 JSON 檔案存索引，記憶體內 BM25 搜尋。
 * 效能分級不可用（全部走 L3 等級）。
 */

const fs = require('fs');
const path = require('path');
const { tokenize, extractKeywords, extractFiles, extractToolCalls, parseJsonlBySession } = require('./indexer');
const { getNow } = require('../utils/timezone');

const INDEX_DIR_NAME = 'index';

/**
 * JSON 索引管理器
 */
class JsonFallback {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.indexDir = path.join(dataDir, INDEX_DIR_NAME);
        this.ensureDir();
    }

    ensureDir() {
        if (!fs.existsSync(this.indexDir)) {
            fs.mkdirSync(this.indexDir, { recursive: true });
        }
    }

    /**
     * 取得某天的索引檔路徑
     */
    getIndexPath(date) {
        return path.join(this.indexDir, `${date}.json`);
    }

    /**
     * 索引一個 JSONL 檔案
     * @param {string} filePath
     * @returns {{ indexed: number }}
     */
    indexFile(filePath) {
        const sessions = parseJsonlBySession(filePath);
        const date = path.basename(filePath, '.jsonl');
        const indexEntries = [];

        for (const [sessionId, records] of sessions) {
            indexEntries.push({
                id: sessionId,
                date,
                startTime: records[0]?.ts || '',
                endTime: records[records.length - 1]?.ts || '',
                messageCount: records.length,
                keywords: extractKeywords(records),
                files: extractFiles(records),
                toolCalls: extractToolCalls(records)
            });
        }

        const indexPath = this.getIndexPath(date);
        fs.writeFileSync(indexPath, JSON.stringify({ date, sessions: indexEntries }, null, 2), 'utf8');

        return { indexed: indexEntries.length };
    }

    /**
     * 索引所有 JSONL 檔案
     * @param {string} sessionsDir
     */
    indexAll(sessionsDir) {
        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
        let total = 0;
        for (const file of files) {
            const result = this.indexFile(path.join(sessionsDir, file));
            total += result.indexed;
        }
        return { totalIndexed: total, files: files.length };
    }

    /**
     * 搜尋（記憶體內 BM25 簡化版）
     * @param {string} query
     * @param {object} options - { days, maxResults }
     * @returns {object[]}
     */
    search(query, options = {}) {
        const days = options.days || 7;
        const maxResults = options.maxResults || 10;
        const queryTokens = tokenize(query);
        if (queryTokens.length === 0) return [];

        const results = [];
        const files = fs.readdirSync(this.indexDir).filter(f => f.endsWith('.json'));

        // 過濾日期範圍
        const since = getNow();
        since.setDate(since.getDate() - days);
        const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;

        for (const file of files) {
            const date = file.replace('.json', '');
            if (date < sinceStr) continue;

            try {
                const index = JSON.parse(fs.readFileSync(path.join(this.indexDir, file), 'utf8'));
                for (const session of (index.sessions || [])) {
                    const keywords = session.keywords || [];
                    const overlap = queryTokens.filter(t =>
                        keywords.some(k => k.includes(t) || t.includes(k))
                    );
                    if (overlap.length === 0) continue;

                    const score = overlap.length / queryTokens.length;
                    results.push({
                        sessionId: session.id,
                        date: session.date,
                        keywords,
                        score,
                        matchedKeywords: overlap,
                        source: 'session',
                        level: 'fallback'
                    });
                }
            } catch (e) { /* skip corrupt index */ }
        }

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults);
    }
}

module.exports = { JsonFallback };
