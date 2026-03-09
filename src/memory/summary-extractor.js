/**
 * summary-extractor.js — Extract structured summary from session messages
 *
 * Uses AiRouter (flash tier) to extract structured data from conversations.
 * Falls back to rule-based extraction if AI call fails.
 *
 * Output schema:
 *   { topic, decisions[], actions[], nextSteps[], entities{}, tags[], importance }
 */

const path = require('path');
const { AiRouter } = require('../ai-router');
const AiProviderManager = require('../ai-provider-manager');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FLASH_MODEL = 'gemini-2.5-flash';
const API_TIMEOUT_MS = 30000;
const MAX_TRANSCRIPT = 30000;

// ── Lazy-init AiRouter singleton for flash capability ───────────
let _router = null;

/**
 * Build a flash-tier AiRouter from Gemini provider keys.
 * @returns {AiRouter|null}
 */
function getFlashRouter() {
  if (_router) return _router;

  try {
    const projectDir = path.join(__dirname, '..', '..');
    const parentKiroDir = path.join(projectDir, '..', '.kiro');
    const manager = new AiProviderManager(projectDir, parentKiroDir);

    const keys = manager.getProviderKeys('gemini');
    if (!keys || keys.length === 0) return null;

    const chain = keys.map((key, idx) => ({
      provider: 'gemini',
      key,
      model: FLASH_MODEL,
      keyIndex: idx,
    }));

    _router = new AiRouter({ chains: { flash: chain } });
    return _router;
  } catch (err) {
    console.error(`[SummaryExtractor] Failed to init flash router: ${err.message}`);
    return null;
  }
}

/**
 * Validate and sanitize structured summary output
 * @param {object} raw - Raw parsed object
 * @returns {object} Validated structured summary
 */
function validateOutput(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const rawEntities = (obj.entities && typeof obj.entities === 'object' && !Array.isArray(obj.entities)) ? obj.entities : {};
  // Enforce entities sub-schema: always return { people, files, tools, projects } as string arrays.
  // Handles legacy data (branches/concepts) and AI output with unexpected keys.
  const ensureStringArray = (v) => Array.isArray(v) ? v.filter(s => typeof s === 'string') : [];
  const entities = {
    people: ensureStringArray(rawEntities.people),
    files: ensureStringArray(rawEntities.files),
    tools: ensureStringArray(rawEntities.tools),
    projects: ensureStringArray(rawEntities.projects),
  };
  return {
    topic: typeof obj.topic === 'string' ? obj.topic.slice(0, 200) : '',
    decisions: Array.isArray(obj.decisions) ? obj.decisions.filter(d => typeof d === 'string') : [],
    actions: Array.isArray(obj.actions) ? obj.actions.filter(a => typeof a === 'string') : [],
    nextSteps: Array.isArray(obj.nextSteps) ? obj.nextSteps.filter(s => typeof s === 'string') : [],
    entities,
    tags: Array.isArray(obj.tags) ? obj.tags.filter(t => typeof t === 'string') : [],
    importance: (Number.isInteger(obj.importance) && obj.importance >= 1 && obj.importance <= 10) ? obj.importance : 5,
  };
}

// ── Rule-based pattern matchers for fallback extraction ─────────
const DECISION_PATTERNS = [
  /\b(?:decided|confirmed|agreed|will use|go with|chose|picked|approved|settled on|let'?s do)\b/i,
  /\b(?:決定|確認|同意|選擇|核准)\b/,
];
const ACTION_PATTERNS = [
  /\b(?:done|completed|fixed|created|committed|pushed|merged|deployed|installed|updated|deleted|removed|added|wrote|built|shipped)\b/i,
  /\b(?:cherry-pick(?:ed)?|refactor(?:ed)?)\b/i,
  /\b(?:完成|修好|建立|推送|合併|部署|安裝|更新|刪除|新增)\b/,
];
const NEXT_STEP_PATTERNS = [
  /\b(?:TODO|next step|later|afterwards|follow[- ]?up|need to|should|will need|plan to|going to)\b/i,
  /\b(?:之後|待辦|下一步|接下來|還要|需要)\b/,
];
const ERROR_PATTERNS = [
  /\b(?:error|bug|crash|fail(?:ed|ure)?|broken|exception|issue|problem)\b/i,
  /\b(?:錯誤|壞了|失敗|問題)\b/,
];
const FILE_PATTERN = /(?:^|\s|['"`(])([a-zA-Z0-9_\-./]+\.(?:js|ts|jsx|tsx|json|md|css|html|py|sh|yml|yaml|sql|env|mjs|cjs))\b/g;
const BRANCH_PATTERN = /\b(?:feat|fix|hotfix|release|worker|bug)\/.[\w\-]+/g;
const COMMIT_PATTERN = /\b[0-9a-f]{7,40}\b/g;

/**
 * Extract sentences matching any pattern from messages
 * @param {Array} messages - Messages to scan
 * @param {RegExp[]} patterns - Patterns to match
 * @param {string} role - Filter by role ('user'|'assistant'|null for all)
 * @param {number} max - Max results
 * @returns {string[]}
 */
function extractByPattern(messages, patterns, role, max = 5) {
  const results = [];
  for (const m of messages) {
    if (role && m.role !== role) continue;
    if (!m.content) continue;
    const lines = m.content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 5 || trimmed.length > 300) continue;
      if (patterns.some(p => p.test(trimmed))) {
        results.push(trimmed.slice(0, 150));
        if (results.length >= max) return results;
      }
    }
  }
  return results;
}

/**
 * Extract named entities from messages using regex patterns.
 * Categories: people, files, tools, projects
 * @param {Array} messages
 * @returns {object} { people: [], files: [], tools: [], projects: [] }
 */
function extractEntities(messages) {
  const people = new Set();
  const files = new Set();
  const tools = new Set();
  const projects = new Set();
  const allText = messages.map(m => m.content || '').join('\n');

  // ── Files: source code paths ──
  let match;
  const fileRe = new RegExp(FILE_PATTERN.source, 'g');
  while ((match = fileRe.exec(allText)) !== null) {
    const f = match[1];
    if (f.length > 3 && !f.startsWith('.')) files.add(f);
  }

  // ── People: @mentions and quoted names ──
  const mentionRe = /@([a-zA-Z][\w-]{1,30})\b/g;
  while ((match = mentionRe.exec(allText)) !== null) {
    people.add(match[1]);
  }
  // Named references: "by Alice", "from Bob", "Assigned to Charlie"
  const namedRe = /\b(?:[Bb]y|[Ff]rom|[Aa]sked|[Tt]old|[Pp]ing|[Cc]c|[Aa]ssigned to|[Nn]otify)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/g;
  while ((match = namedRe.exec(allText)) !== null) {
    const name = match[1];
    // Filter out common false positives (code keywords that start with uppercase)
    const falsePositives = new Set(['Error', 'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Function', 'Date', 'Map', 'Set', 'True', 'False', 'None', 'Null']);
    if (!falsePositives.has(name)) people.add(name);
  }

  // ── Tools: MCP tool patterns, npm packages, CLI tools ──
  // MCP tool calls like tool_name or tool-name (snake_case / kebab-case with underscores)
  const mcpToolRe = /\b(?:mcp_\w+|run_tests|report_task_result|dispatch_task|git_remote_ops|save_knowledge|create_issue|update_issue)\b/g;
  while ((match = mcpToolRe.exec(allText)) !== null) {
    tools.add(match[0]);
  }
  // npm packages: npm install/i <pkg>, require('<pkg>'), from '<pkg>'
  const npmRe = /\bnpm\s+(?:install|i|add)\s+([a-z@][\w./-]{1,50})\b/g;
  while ((match = npmRe.exec(allText)) !== null) {
    tools.add(match[1]);
  }
  const requireRe = /(?:require\s*\(\s*['"]|from\s+['"])([a-z@][\w./-]{1,50})['"]/g;
  while ((match = requireRe.exec(allText)) !== null) {
    // Skip relative paths
    if (!match[1].startsWith('.')) tools.add(match[1]);
  }

  // ── Projects: repo names, package names, branch-derived project names ──
  // GitHub-style repo refs: org/repo
  const repoRe = /\b([a-zA-Z][\w-]+\/[a-zA-Z][\w.-]+)\b/g;
  while ((match = repoRe.exec(allText)) !== null) {
    const r = match[1];
    // Filter out file paths (contain extensions) and common non-repo patterns
    if (!r.includes('.') && !r.startsWith('src/') && !r.startsWith('node_modules/')) {
      projects.add(r);
    }
  }
  // Branch-derived project names: feat/project-name, worker/project-name
  const branchRe = new RegExp(BRANCH_PATTERN.source, 'g');
  while ((match = branchRe.exec(allText)) !== null) {
    projects.add(match[0]);
  }

  return {
    people: [...people].slice(0, 10),
    files: [...files].slice(0, 10),
    tools: [...tools].slice(0, 10),
    projects: [...projects].slice(0, 10),
  };
}


/**
 * Extract top tags from word frequency (simple TF approach)
 * @param {Array} messages
 * @returns {string[]}
 */
function extractTags(messages) {
  const stopwords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
    'or', 'if', 'while', 'this', 'that', 'these', 'those', 'it', 'its',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
    'them', 'what', 'which', 'who', 'whom', 'ok', 'yes', 'no', 'get',
    'got', 'let', 'put', 'set', 'use', 'used', 'using', 'also', 'like',
    'make', 'made', 'take', 'see', 'know', 'think', 'want', 'need',
    'try', 'run', 'file', 'code', 'null', 'true', 'false', 'undefined',
  ]);
  const freq = new Map();
  for (const m of messages) {
    if (!m.content) continue;
    const words = m.content.toLowerCase().match(/[a-z]{3,20}/g) || [];
    for (const w of words) {
      if (stopwords.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}

/**
 * Estimate importance based on message signals
 * @param {Array} messages
 * @returns {number} 1-10
 */
function estimateImportance(messages) {
  let score = 5;
  const allText = messages.map(m => m.content || '').join('\n');
  if (messages.length > 20) score += 1;
  if (COMMIT_PATTERN.test(allText)) score += 1;
  if (ERROR_PATTERNS.some(p => p.test(allText))) score += 1;
  if (messages.length < 4) score -= 2;
  return Math.max(1, Math.min(10, score));
}

/**
 * Rule-based fallback: extract structured summary without AI
 * Scans messages for decisions, actions, next steps, entities, and tags
 * using keyword patterns, regex, and word frequency.
 *
 * @param {Array<{role: string, content: string, timestamp?: string}>} messages
 * @returns {object} Structured summary
 */
function extractFallback(messages) {
  // Topic: first user message, cleaned up
  const firstUser = messages.find(m => m.role === 'user' && m.content);
  const topic = firstUser
    ? firstUser.content.split('\n')[0].slice(0, 120).trim() || firstUser.content.slice(0, 120).replace(/\n/g, ' ').trim()
    : 'Unknown topic';

  const decisions = extractByPattern(messages, DECISION_PATTERNS, null, 5);
  const actions = extractByPattern(messages, ACTION_PATTERNS, null, 5);
  const nextSteps = extractByPattern(messages, NEXT_STEP_PATTERNS, null, 5);
  const entities = extractEntities(messages);
  const tags = extractTags(messages);
  const importance = estimateImportance(messages);

  return validateOutput({
    topic,
    decisions,
    actions,
    nextSteps,
    entities,
    tags,
    importance,
  });
}

const PROMPT_TEMPLATE = `Analyze this conversation and extract a structured summary as JSON.

Return ONLY valid JSON with this exact schema (no markdown, no explanation):
{
  "topic": "one-line topic description",
  "decisions": ["decision 1", "decision 2"],
  "actions": ["action taken 1", "action taken 2"],
  "nextSteps": ["next step 1", "next step 2"],
  "entities": {"people": [], "tools": [], "files": [], "projects": []},
  "tags": ["tag1", "tag2"],
  "importance": 5
}

Rules:
- topic: concise one-line summary of the main topic
- decisions: key decisions made during the conversation
- actions: concrete actions that were taken or completed
- nextSteps: planned future actions or follow-ups
- entities: named entities grouped by type (people, tools, files, projects)
- tags: 2-5 relevant keywords for search/categorization
- importance: integer 1-10 (1=trivial, 5=normal, 10=critical)
- All text in English
- Empty arrays if nothing applies

Conversation:
`;

/**
 * Call Gemini flash API with the given key and model
 * @param {string} apiKey - Gemini API key
 * @param {string} modelId - Model ID (e.g. gemini-2.5-flash)
 * @param {string} prompt - Full prompt text
 * @returns {Promise<object>} Parsed structured summary
 */
async function callGeminiFlash(apiKey, modelId, prompt) {
  const model = modelId || FLASH_MODEL;
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`Gemini API ${res.status}: ${errText.substring(0, 200)}`);
      err.statusCode = res.status;
      throw err;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      throw new Error('Empty Gemini response');
    }

    const cleaned = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract structured summary from session messages using AiRouter (flash tier).
 * Falls back to rule-based extraction if AI call fails.
 *
 * @param {Array<{role: string, content: string, timestamp?: string}>} messages
 * @param {object} [options]
 * @param {string} [options.projectDir] - Project root for API key lookup
 * @returns {Promise<{topic: string, decisions: string[], actions: string[], nextSteps: string[], entities: object, tags: string[], importance: number}>}
 */
async function extractStructuredSummary(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return validateOutput({ topic: 'Empty session', importance: 1 });
  }

  // Build transcript
  let transcript = messages
    .map(m => `[${m.role}] ${m.content || ''}`)
    .join('\n');
  if (transcript.length > MAX_TRANSCRIPT) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT);
  }

  const prompt = PROMPT_TEMPLATE + transcript;

  // Try AiRouter with flash capability (automatic key rotation + cooldown)
  const router = getFlashRouter();
  if (!router) {
    console.warn('[SummaryExtractor] No Gemini API key available, using fallback');
    return extractFallback(messages);
  }

  try {
    const raw = await router.execute('flash', async (candidate) => {
      return callGeminiFlash(candidate.key, candidate.model, prompt);
    });
    return validateOutput(raw);
  } catch (err) {
    console.error(`[SummaryExtractor] AI extraction failed: ${err.message}`);
    return extractFallback(messages);
  }
}

module.exports = {
  extractStructuredSummary,
  extractFallback,
  validateOutput,
};
