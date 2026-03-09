/**
 * Auto-Recall Context Builder
 * 
 * Loads relevant context for cold-start sessions.
 * Called when a new session begins to provide the AI with recent context.
 * 
 * Returns a compact text block suitable for system prompt injection,
 * with token estimate and source references.
 */

const { getDatabase, isDatabaseAvailable } = require('./database');
const { searchL1 } = require('./search-engine');

const MAX_TOKENS = 250;
const TOKEN_MULTIPLIER = 1.3;
const RELATED_SESSION_LIMIT = 3;
const RELATED_SESSION_DAYS = 7;

/**
 * Check if auto-recall is enabled via env var
 * @returns {boolean}
 */
function isEnabled() {
    const val = process.env.AUTO_RECALL_ENABLED;
    if (val === undefined || val === null || val === '') return true;
    return val !== 'false' && val !== '0';
}

/**
 * Estimate token count from text (word count * 1.3)
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
    if (!text) return 0;
    const words = text.split(/\s+/).filter(w => w.length > 0);
    return Math.ceil(words.length * TOKEN_MULTIPLIER);
}

/**
 * Truncate text to fit within max token budget
 * @param {string} text
 * @param {number} maxTokens
 * @returns {string}
 */
function truncateToTokenBudget(text, maxTokens) {
    if (!text) return '';
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const maxWords = Math.floor(maxTokens / TOKEN_MULTIPLIER);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(' ') + '...';
}

/**
 * Load the most recent session summary from SQLite
 * @returns {object|null} { sessionId, topic, decisions, actions, tags } or null
 */
function getLastSummary() {
    if (!isDatabaseAvailable()) return null;

    try {
        const db = getDatabase();
        const row = db.prepare(
            'SELECT session_id, summary, created_at FROM summaries ORDER BY created_at DESC LIMIT 1'
        ).get();

        if (!row || !row.summary) return null;

        const parsed = JSON.parse(row.summary);
        return {
            sessionId: row.session_id,
            topic: parsed.topic || '',
            decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
            actions: Array.isArray(parsed.actions) ? parsed.actions : [],
            tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            createdAt: row.created_at
        };
    } catch (err) {
        console.error(`[AutoRecall] Failed to load last summary: ${err.message}`);
        return null;
    }
}

/**
 * Build auto-recall context for cold-start sessions
 * @param {object} [options] - { maxTokens }
 * @returns {Promise<{context: string, tokenEstimate: number, sources: string[]}>}
 */
async function buildAutoRecallContext(options = {}) {
    const empty = { context: '', tokenEstimate: 0, sources: [] };

    if (!isEnabled()) return empty;
    if (!isDatabaseAvailable()) return empty;

    try {
        const maxTokens = options.maxTokens || MAX_TOKENS;
        const sources = [];
        const parts = [];

        // 1. Load last session summary
        const lastSummary = getLastSummary();

        if (lastSummary) {
            sources.push(lastSummary.sessionId);

            // Build last session line
            let lastLine = `Last session: ${lastSummary.topic}`;
            if (lastSummary.decisions.length > 0) {
                lastLine += `. Decisions: ${lastSummary.decisions.join('; ')}`;
            }
            parts.push(lastLine);

            // 2. Search for related sessions using L1 (keyword match)
            const query = [lastSummary.topic, ...lastSummary.tags].filter(Boolean).join(' ');
            if (query) {
                const related = await searchL1(query, {
                    days: RELATED_SESSION_DAYS,
                    maxResults: RELATED_SESSION_LIMIT + 1 // +1 to exclude self
                });

                // Filter out the last session itself
                const others = related.filter(r => r.sessionId !== lastSummary.sessionId);
                const top = others.slice(0, RELATED_SESSION_LIMIT);

                if (top.length > 0) {
                    const relatedParts = top.map(r => {
                        sources.push(r.sessionId);
                        return `${r.date}: ${r.keywords.slice(0, 5).join(', ')}`;
                    });
                    parts.push(`Related: ${relatedParts.join(' | ')}`);
                }
            }
        } else {
            // No summary available — try L1 keyword search with generic recent query
            const related = await searchL1('recent session', {
                days: RELATED_SESSION_DAYS,
                maxResults: RELATED_SESSION_LIMIT
            });

            if (related.length > 0) {
                const relatedParts = related.map(r => {
                    sources.push(r.sessionId);
                    return `${r.date}: ${r.keywords.slice(0, 5).join(', ')}`;
                });
                parts.push(`Recent sessions: ${relatedParts.join(' | ')}`);
            }
        }

        if (parts.length === 0) return empty;

        let context = `[Auto-recall] ${parts.join('. ')}`;
        context = truncateToTokenBudget(context, maxTokens);
        const tokenEstimate = estimateTokens(context);

        return { context, tokenEstimate, sources };
    } catch (err) {
        console.error(`[AutoRecall] buildAutoRecallContext failed: ${err.message}`);
        return empty;
    }
}

module.exports = {
    buildAutoRecallContext,
    isEnabled,
    estimateTokens,
    truncateToTokenBudget,
    getLastSummary
};
