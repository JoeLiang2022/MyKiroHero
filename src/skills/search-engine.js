/**
 * Lightweight Hybrid Search Engine
 * 
 * 輕量混合搜尋引擎，參考 OpenClaw 架構但不依賴外部服務
 * 
 * Features:
 * - BM25 scoring with term frequency saturation
 * - RRF (Reciprocal Rank Fusion) for multi-field ranking
 * - Stopwords filtering (130+ Chinese/English)
 * - Synonym expansion (configurable)
 * - N-gram fallback (3-gram English, 2-gram Chinese)
 * - Fuzzy matching (Levenshtein)
 * - Pre-computed IDF for efficiency
 */

const fs = require('fs');
const path = require('path');

// ============================================
// Constants
// ============================================

const STOPWORDS = new Set([
    // English (80+)
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'between',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
    'it', 'its', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
    'they', 'them', 'their', 'about', 'all', 'also', 'any', 'because', 'been',
    // Chinese (50+)
    '的', '是', '在', '了', '和', '與', '或', '也', '都', '就', '而', '及', '著', '過',
    '這', '那', '個', '些', '什麼', '怎麼', '如何', '為什麼', '哪', '誰', '何',
    '我', '你', '他', '她', '它', '我們', '你們', '他們', '自己',
    '可以', '能', '會', '要', '想', '讓', '把', '被', '給', '對', '從', '到', '向',
    '很', '太', '更', '最', '非常', '十分', '相當', '比較', '稍微'
]);

// BM25 parameters
const BM25_K1 = 1.5;  // Term frequency saturation
const BM25_B = 0.75;  // Document length normalization

// RRF parameters
const RRF_K = 60;     // Smoothing constant
const RRF_WEIGHTS = { title: 0.5, tag: 0.3, summary: 0.2 };

// ============================================
// Search Engine Class
// ============================================

class SearchEngine {
    constructor() {
        this.documents = [];
        this.synonymMap = new Map();
        this.idfCache = new Map();
        this.tokenCache = new Map();
        this.avgDocLength = 0;
        this.initialized = false;
    }

    /**
     * Initialize with documents and synonyms
     */
    init(documents, synonymsPath = null) {
        this.documents = documents;
        this.tokenCache.clear();
        this.idfCache.clear();
        
        // Load synonyms
        if (synonymsPath && fs.existsSync(synonymsPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(synonymsPath, 'utf-8'));
                this.buildSynonymMap(data.groups || []);
            } catch (err) {
                console.error('[SearchEngine] Failed to load synonyms:', err.message);
            }
        }
        
        // Pre-compute IDF and document lengths
        this.precomputeStats();
        this.initialized = true;
        
        return this;
    }

    /**
     * Build synonym lookup map
     */
    buildSynonymMap(groups) {
        this.synonymMap.clear();
        for (const group of groups) {
            const terms = (group.terms || []).map(t => t.toLowerCase());
            for (const term of terms) {
                this.synonymMap.set(term, terms);
            }
        }
    }

    /**
     * Pre-compute IDF values and average document length
     */
    precomputeStats() {
        const docCount = this.documents.length || 1;
        const termDocFreq = new Map();
        let totalLength = 0;
        
        for (const doc of this.documents) {
            const text = `${doc.title || ''} ${(doc.tags || []).join(' ')} ${doc.summary || ''}`;
            const tokens = this.tokenize(text);
            const uniqueTokens = new Set(tokens);
            
            // Cache tokenized content
            this.tokenCache.set(doc.id, {
                title: this.tokenize(doc.title || ''),
                tags: (doc.tags || []).flatMap(t => this.tokenize(t)),
                summary: this.tokenize(doc.summary || ''),
                all: tokens
            });
            
            totalLength += tokens.length;
            
            for (const t of uniqueTokens) {
                termDocFreq.set(t, (termDocFreq.get(t) || 0) + 1);
            }
        }
        
        this.avgDocLength = totalLength / docCount;
        
        // Compute IDF for each term (BM25 style)
        for (const [term, df] of termDocFreq) {
            const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
            this.idfCache.set(term, idf);
        }
    }

    /**
     * Tokenize text (supports Chinese and English)
     */
    tokenize(text) {
        if (!text) return [];
        const lower = text.toLowerCase();
        const tokens = new Set();
        
        // English: split by whitespace and punctuation
        const englishTokens = lower
            .split(/[\s\-_.,;:!?()[\]{}'"\/\\]+/)
            .filter(t => t.length > 1 && /[a-z]/.test(t) && !STOPWORDS.has(t));
        
        for (const t of englishTokens) {
            tokens.add(t);
            const stemmed = this.stem(t);
            if (stemmed !== t && stemmed.length > 1 && !STOPWORDS.has(stemmed)) {
                tokens.add(stemmed);
            }
        }
        
        // Chinese: extract continuous characters, 2-gram for longer words
        const chineseMatches = lower.match(/[\u4e00-\u9fff]+/g) || [];
        for (const match of chineseMatches) {
            if (match.length >= 2 && !STOPWORDS.has(match)) {
                tokens.add(match);
                if (match.length > 2) {
                    for (let i = 0; i < match.length - 1; i++) {
                        const bigram = match.substring(i, i + 2);
                        if (!STOPWORDS.has(bigram)) tokens.add(bigram);
                    }
                }
            }
        }
        
        return Array.from(tokens);
    }

    /**
     * Simple English stemmer
     */
    stem(word) {
        if (word.length < 4 || !/^[a-z]+$/.test(word)) return word;
        return word
            .replace(/ing$/, '').replace(/ed$/, '').replace(/es$/, '').replace(/s$/, '')
            .replace(/tion$/, 't').replace(/ment$/, '').replace(/ness$/, '')
            .replace(/able$/, '').replace(/ible$/, '').replace(/ful$/, '').replace(/less$/, '');
    }

    /**
     * Generate N-grams
     */
    ngrams(text, n = null) {
        if (!text || text.length < 2) return [text];
        const isChinese = /[\u4e00-\u9fff]/.test(text);
        const size = n || (isChinese ? 2 : 3);
        if (text.length < size) return [text];
        
        const result = [];
        for (let i = 0; i <= text.length - size; i++) {
            result.push(text.substring(i, i + size));
        }
        return result;
    }

    /**
     * Fuzzy match (simplified Levenshtein)
     */
    fuzzyMatch(a, b, maxDist = 2) {
        if (Math.abs(a.length - b.length) > maxDist) return false;
        
        // Chinese: use contains matching
        if (/[\u4e00-\u9fff]/.test(a)) {
            return a.includes(b) || b.includes(a) || Math.abs(a.length - b.length) <= 1;
        }
        
        // English: character-by-character comparison
        if (a.length < 3 || b.length < 3) return a === b;
        let dist = 0;
        for (let i = 0; i < Math.min(a.length, b.length) && dist <= maxDist; i++) {
            if (a[i] !== b[i]) dist++;
        }
        return dist + Math.abs(a.length - b.length) <= maxDist;
    }

    /**
     * Get IDF value for a term
     */
    getIdf(term) {
        return this.idfCache.get(term) || 1;
    }

    /**
     * BM25 score for a term in a document
     */
    bm25Score(term, termFreq, docLength) {
        const idf = this.getIdf(term);
        const lengthNorm = 1 - BM25_B + BM25_B * (docLength / this.avgDocLength);
        return idf * (termFreq * (BM25_K1 + 1)) / (termFreq + BM25_K1 * lengthNorm);
    }

    /**
     * Expand query with synonyms
     */
    expandQuery(tokens) {
        const expanded = new Set(tokens);
        const synonymTerms = new Set();
        
        for (const token of tokens) {
            // Add stemmed version
            const stemmed = this.stem(token);
            if (stemmed !== token) expanded.add(stemmed);
            
            // Add synonyms (limit to 5 per term)
            const group = this.synonymMap.get(token);
            if (group) {
                const sorted = group
                    .filter(s => s !== token && s.length > 1)
                    .sort((a, b) => a.length - b.length)
                    .slice(0, 5);
                sorted.forEach(s => {
                    expanded.add(s);
                    synonymTerms.add(s);
                });
            }
        }
        
        return {
            terms: Array.from(expanded).filter(t => t.length > 1),
            synonymTerms
        };
    }

    /**
     * Search documents
     */
    search(query, options = {}) {
        if (!this.initialized) {
            throw new Error('SearchEngine not initialized. Call init() first.');
        }
        
        const { limit = 10, debug = false } = options;
        const queryLower = query.toLowerCase().trim();
        const queryTokens = this.tokenize(query);
        const { terms: queryTerms, synonymTerms } = this.expandQuery(queryTokens);
        
        // Calculate raw scores for each document
        const rawScores = this.documents.map(doc => {
            const cached = this.tokenCache.get(doc.id) || {
                title: this.tokenize(doc.title || ''),
                tags: (doc.tags || []).flatMap(t => this.tokenize(t)),
                summary: this.tokenize(doc.summary || ''),
                all: []
            };
            
            const titleLower = (doc.title || '').toLowerCase();
            const allText = `${doc.title || ''} ${(doc.tags || []).join(' ')} ${doc.summary || ''}`.toLowerCase();
            const matchedTerms = new Set();
            
            const termFreq = (tokens, term) => tokens.filter(t => t === term).length;
            
            // Exact match bonus
            let exactBonus = allText.includes(queryLower) ? 10 : 0;
            if (exactBonus > 0) queryTokens.forEach(t => matchedTerms.add(t));
            
            // Title score
            let titleScore = 0;
            for (const term of queryTerms) {
                const tf = termFreq(cached.title, term);
                if (tf > 0) {
                    const posBonus = titleLower.startsWith(term) ? 2 : 
                                    (titleLower.indexOf(term) < 10 ? 1.5 : 1);
                    titleScore += this.bm25Score(term, tf, cached.title.length) * posBonus;
                    matchedTerms.add(term);
                } else if (cached.title.some(t => t.startsWith(term) || term.startsWith(t))) {
                    titleScore += this.getIdf(term) * 0.5;
                    matchedTerms.add(term);
                }
            }
            
            // Tag score
            let tagScore = 0;
            for (const term of queryTerms) {
                const tf = termFreq(cached.tags, term);
                if (tf > 0) {
                    tagScore += this.bm25Score(term, tf, cached.tags.length);
                    matchedTerms.add(term);
                }
            }
            
            // Summary score
            let summaryScore = 0;
            for (const term of queryTerms) {
                const tf = termFreq(cached.summary, term);
                if (tf > 0) {
                    summaryScore += this.bm25Score(term, tf, cached.summary.length);
                    matchedTerms.add(term);
                }
            }
            
            // N-gram fallback
            let ngramScore = 0;
            if (titleScore + tagScore + summaryScore === 0 && query.length >= 3) {
                const queryNgrams = this.ngrams(queryLower);
                const textNgrams = this.ngrams(allText.replace(/\s+/g, ''));
                ngramScore = queryNgrams.filter(ng => textNgrams.includes(ng)).length * 0.1;
                if (ngramScore > 0) matchedTerms.add('ngram');
            }
            
            // Fuzzy fallback
            let fuzzyScore = 0;
            if (titleScore + tagScore + summaryScore + ngramScore === 0) {
                const allTokens = [...cached.title, ...cached.tags, ...cached.summary];
                if (queryTokens.some(qt => allTokens.some(t => this.fuzzyMatch(qt, t)))) {
                    fuzzyScore = 0.1;
                    matchedTerms.add('fuzzy');
                }
            }
            
            return {
                doc,
                titleScore,
                tagScore,
                summaryScore,
                exactBonus,
                ngramScore,
                fuzzyScore,
                matchCount: matchedTerms.size,
                hasMatch: titleScore + tagScore + summaryScore + exactBonus + ngramScore + fuzzyScore > 0
            };
        }).filter(r => r.hasMatch);
        
        // RRF ranking fusion
        const addRank = (arr, field) => {
            const sorted = [...arr].sort((a, b) => b[field] - a[field]);
            sorted.forEach((item, idx) => {
                item[`${field}Rank`] = item[field] > 0 ? idx + 1 : arr.length + 1;
            });
        };
        
        addRank(rawScores, 'titleScore');
        addRank(rawScores, 'tagScore');
        addRank(rawScores, 'summaryScore');
        
        // Calculate final RRF score
        const results = rawScores.map(r => {
            const rrfTitle = r.titleScore > 0 ? RRF_WEIGHTS.title / (RRF_K + r.titleScoreRank) : 0;
            const rrfTag = r.tagScore > 0 ? RRF_WEIGHTS.tag / (RRF_K + r.tagScoreRank) : 0;
            const rrfSummary = r.summaryScore > 0 ? RRF_WEIGHTS.summary / (RRF_K + r.summaryScoreRank) : 0;
            
            const bonusScore = r.exactBonus * 0.01 + r.ngramScore + r.fuzzyScore;
            const coverage = r.matchCount / Math.max(queryTokens.length, 1);
            const rrfScore = (rrfTitle + rrfTag + rrfSummary + bonusScore) * (1 + coverage * 0.2);
            
            const result = {
                ...r.doc,
                score: Math.round(rrfScore * 10000) / 10000,
                matchCount: r.matchCount
            };
            
            if (debug) {
                result._debug = {
                    title: `${Math.round(r.titleScore * 10) / 10}(#${r.titleScoreRank})`,
                    tag: `${Math.round(r.tagScore * 10) / 10}(#${r.tagScoreRank})`,
                    summary: `${Math.round(r.summaryScore * 10) / 10}(#${r.summaryScoreRank})`
                };
            }
            
            return result;
        })
        .sort((a, b) => b.score - a.score || b.matchCount - a.matchCount)
        .slice(0, limit);
        
        return {
            results,
            query: queryLower,
            expandedTerms: queryTerms.length > queryTokens.length ? queryTerms.slice(0, 10) : null
        };
    }

    /**
     * Add a document to the index
     */
    addDocument(doc) {
        // Remove existing document with same ID
        this.documents = this.documents.filter(d => d.id !== doc.id);
        this.documents.push(doc);
        
        // Re-compute stats (could be optimized for incremental updates)
        this.precomputeStats();
    }

    /**
     * Remove a document from the index
     */
    removeDocument(id) {
        this.documents = this.documents.filter(d => d.id !== id);
        this.tokenCache.delete(id);
        this.precomputeStats();
    }
}

module.exports = SearchEngine;
