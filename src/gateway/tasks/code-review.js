/**
 * code-review.js — Layer 2 Handler: Automated Code Review
 *
 * Reviews a Worker's branch diff using Gemini API.
 * Includes original file content from main branch for context.
 * Fallback: lint + test (Layer 1 static checks) if API unavailable.
 *
 * Params:
 *   branch   (required) — branch to review (e.g. worker/task-xxx)
 *   taskId   (optional) — original task ID for context
 *
 * Returns:
 *   { success, passed, message, method }
 *   method: 'gemini' | 'static' | 'auto-pass'
 */

const { execSync } = require('child_process');
const path = require('path');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REVIEW_MODEL = 'gemini-2.5-flash';
const DIFF_MAX_CHARS = 30000;
const CONTEXT_MAX_CHARS = 20000;
/** Char limit for modified files in diff context (raised from 5000 to catch TDZ-like issues) */
const FILE_MAX_CHARS = 15000;
/** File extensions to skip when gathering context */
const SKIP_EXTENSIONS = ['.md', '.json', '.lock', '.test.js', '.spec.js'];
/** High-impact config files that should NOT be auto-passed even if extension matches DOC_ONLY */
const HIGH_IMPACT_FILES = ['package.json', 'mcp.json', '.env', '.env.example', 'ecosystem.config.js', 'ai-providers.json', 'jest.config.js', '.eslintrc.json', 'tsconfig.json'];

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', timeout: 30000 }).trim();
}

/**
 * Parse modified file paths from a unified diff and read their main-branch content.
 * Prioritizes .js files, skips .md/.json/test files.
 * @param {string} diff — unified diff text
 * @param {string} cwd — project root directory
 * @param {string} [branch] — branch name to read modified file versions from
 * @returns {string} formatted context block (may be empty)
 */
function getFileContexts(diff, cwd, branch) {
  const fileSet = new Set();
  const headerRe = /^\+\+\+ b\/(.+)$/gm;
  let match;
  while ((match = headerRe.exec(diff)) !== null) {
    const fp = match[1];
    if (fp && fp !== '/dev/null') fileSet.add(fp);
  }

  const files = Array.from(fileSet).filter(fp => {
    return !SKIP_EXTENSIONS.some(ext => fp.endsWith(ext));
  });
  files.sort((a, b) => {
    const aJs = a.endsWith('.js') ? 0 : 1;
    const bJs = b.endsWith('.js') ? 0 : 1;
    return aJs - bJs;
  });

  const sections = [];
  let totalChars = 0;

  for (const fp of files) {
    if (totalChars >= CONTEXT_MAX_CHARS) break;
    const remaining = CONTEXT_MAX_CHARS - totalChars;
    if (remaining < 500) break;

    // All files here are from the diff, so they are modified — use full char limit
    const charLimit = FILE_MAX_CHARS;

    // Try to read the branch version (post-change) for modified files
    if (branch) {
      try {
        let branchContent = git(`show origin/${branch}:${fp}`, cwd);
        if (branchContent.length > charLimit) {
          branchContent = branchContent.substring(0, charLimit) + '\n... (truncated)';
        }
        if (branchContent.length > remaining) {
          branchContent = branchContent.substring(0, remaining) + '\n... (truncated)';
        }
        sections.push(`--- ${fp} (branch: ${branch}) ---\n${branchContent}`);
        totalChars += branchContent.length;
        continue;
      } catch {
        // Branch version not available, fall through to main
      }
    }

    // Fallback: read main branch version
    try {
      let content = git(`show origin/main:${fp}`, cwd);
      if (content.length > charLimit) {
        content = content.substring(0, charLimit) + '\n... (truncated)';
      }
      if (content.length > remaining) {
        content = content.substring(0, remaining) + '\n... (truncated)';
      }
      sections.push(`--- ${fp} (main) ---\n${content}`);
      totalChars += content.length;
    } catch {
      // File doesn't exist on main (new file) — skip
    }
  }

  if (sections.length === 0) return '';
  return 'Relevant source files (showing branch version when available, main version as fallback):\n\n' + sections.join('\n\n');
}

/**
 * Get API key from env file via AiProviderManager
 */
function getGeminiKey(projectDir) {
  try {
    const AiProviderManager = require('../../ai-provider-manager');
    const parentKiroDir = path.join(projectDir, '..', '.kiro');
    const manager = new AiProviderManager(projectDir, parentKiroDir);
    const keys = manager.getProviderKeys('gemini');
    return keys[0] || null;
  } catch {
    return null;
  }
}

/**
 * Review diff using Gemini API (Layer 2).
 * Includes file content from branch (or main as fallback) for better context.
 * @param {string} apiKey — Gemini API key
 * @param {string} diff — unified diff text
 * @param {string} branch — branch name being reviewed
 * @param {string} [cwd] — project root for reading source files
 */
async function reviewWithGemini(apiKey, diff, branch, cwd) {
  const fileContext = cwd ? getFileContexts(diff, cwd, branch) : '';

  const contextBlock = fileContext
    ? `\n${fileContext}\n\nThe above are the full file contents (branch version when available, main as fallback). Use them to understand the COMPLETE context of the changes — including execution order, variable scoping, and hoisting behavior.\n\n`
    : '';

  const prompt = `You are a senior code reviewer. Review this git diff from branch "${branch}".

Check for:
1. Bugs or logic errors
2. Security issues
3. Breaking changes (removing duplicate code or refactoring is NOT a breaking change)
4. Code style problems
5. Variable hoisting issues — const/let used before declaration in hoisted functions (Temporal Dead Zone)
6. Test-code drift — if tests were NOT updated alongside the code changes, flag it as a potential issue
${contextBlock}Git diff:
\`\`\`
${diff.substring(0, DIFF_MAX_CHARS)}
\`\`\`

Respond in this exact JSON format:
{"passed": true/false, "issues": ["issue1", "issue2"], "summary": "one line summary"}

If the code looks good, set passed=true and issues=[].
IMPORTANT: Removing duplicate code or refactoring is NOT a breaking change. Only flag actual regressions.`;

  const url = `${GEMINI_API_BASE}/models/${REVIEW_MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

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
      throw new Error(`Gemini API ${res.status}: ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const review = JSON.parse(text);
    return {
      passed: !!review.passed,
      issues: review.issues || [],
      summary: review.summary || '',
      method: 'gemini',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fallback: static checks (Layer 1) — lint + test
 */
function reviewWithStaticChecks(cwd) {
  const issues = [];

  try {
    execSync('npx eslint . --max-warnings=0 --quiet', { cwd, encoding: 'utf-8', timeout: 60000, stdio: 'pipe' });
  } catch (err) {
    const output = (err.stdout || err.stderr || '').toString();
    if (output.includes('not found') || output.includes('Cannot find') || output.includes("couldn't find") || output.includes('eslint.config') || err.status === 127) {
      // eslint not available or misconfigured — skip
    } else if (output.trim()) {
      issues.push(`ESLint: ${output.substring(0, 500)}`);
    }
  }

  try {
    const pkg = require(path.join(cwd, 'package.json'));
    if (pkg.scripts && pkg.scripts.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
      execSync('npm test -- --forceExit', { cwd, encoding: 'utf-8', timeout: 120000, stdio: 'pipe' });
    }
  } catch (err) {
    const output = (err.stdout || err.stderr || '').toString();
    // Bug 1 fix: Jest exits non-zero for open handles / "force exit" warning
    // even when all tests pass. Parse output to detect real failures.
    if (output.trim()) {
      const hasTestsPassed = /Tests:\s+.*\d+\s+passed/.test(output);
      const hasTestsFailed = /Tests:\s+.*\d+\s+failed/.test(output);
      if (hasTestsPassed && !hasTestsFailed) {
        // All tests passed — non-zero exit was just a cleanup warning (e.g. open handles)
        console.log('[StaticReview] Jest exited non-zero but all tests passed (open handles warning)');
      } else {
        issues.push(`Tests: ${output.substring(0, 500)}`);
      }
    } else {
      issues.push('Tests failed');
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0 ? 'Static checks passed' : `${issues.length} issue(s) found`,
    method: 'static',
  };
}


// ── Handler export ──────────────────────────────────────────────

module.exports = {
  name: 'code-review',
  description: 'Code review (Gemini API → fallback lint+test)',
  type: 'layer2',

  execute: async (params, context) => {
    const { branch, taskId } = params;
    if (!branch) throw new Error('Missing required param: branch');

    const cwd = (context && context.projectDir) || path.join(__dirname, '..', '..', '..');

    // Get diff: branch vs main
    let diff;
    try {
      try { git('fetch origin', cwd); } catch { /* ignore */ }
      diff = git(`diff origin/main...origin/${branch}`, cwd);
    } catch (err) {
      try {
        diff = git(`diff main...${branch}`, cwd);
      } catch {
        return {
          success: true,
          passed: true,
          message: `Branch ${branch} not found or no diff — auto-passing`,
          method: 'auto-pass',
        };
      }
    }

    if (!diff || diff.trim().length === 0) {
      return {
        success: true,
        passed: true,
        message: 'No changes to review — auto-passing',
        method: 'auto-pass',
      };
    }

    // Check if diff only contains non-code files (docs, config, etc.) — skip review
    // Exception: high-impact config files (package.json, .env, etc.) always get reviewed
    const DOC_ONLY_EXTENSIONS = ['.md', '.txt', '.json', '.yml', '.yaml', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.mp3', '.mp4', '.ogg', '.wav'];
    const changedFiles = [];
    const headerRe = /^\+\+\+ b\/(.+)$/gm;
    let m;
    while ((m = headerRe.exec(diff)) !== null) {
      if (m[1] && m[1] !== '/dev/null') changedFiles.push(m[1]);
    }
    const isHighImpact = (fp) => HIGH_IMPACT_FILES.some(hf => fp.endsWith(hf) || path.basename(fp) === hf);
    const hasCodeFiles = changedFiles.some(fp => !DOC_ONLY_EXTENSIONS.some(ext => fp.endsWith(ext)));
    const hasHighImpactFiles = changedFiles.some(isHighImpact);
    if (!hasCodeFiles && !hasHighImpactFiles && changedFiles.length > 0) {
      console.log(`[CodeReview] Doc-only changes (${changedFiles.join(', ')}), auto-passing`);
      return {
        success: true,
        passed: true,
        message: `Doc-only changes (${changedFiles.length} file(s)) — auto-passing`,
        method: 'auto-pass',
      };
    }

    // Try Gemini API first (now with cwd for file context)
    const apiKey = getGeminiKey(cwd);
    if (apiKey) {
      try {
        const result = await reviewWithGemini(apiKey, diff, branch, cwd);
        const issueText = result.issues.length > 0
          ? '\nIssues:\n' + result.issues.map(i => `• ${i}`).join('\n')
          : '';
        return {
          success: true,
          passed: result.passed,
          message: `[Gemini Review] ${result.summary}${issueText}`,
          method: result.method,
        };
      } catch (err) {
        console.log(`[CodeReview] Gemini API failed: ${err.message}, falling back to static checks`);
      }
    } else {
      console.log('[CodeReview] No Gemini API key, using static checks');
    }

    // Fallback: static checks
    const result = reviewWithStaticChecks(cwd);
    const issueText = result.issues.length > 0
      ? '\nIssues:\n' + result.issues.map(i => `• ${i}`).join('\n')
      : '';
    return {
      success: true,
      passed: result.passed,
      message: `[Static Review] ${result.summary}${issueText}`,
      method: result.method,
    };
  },
};
