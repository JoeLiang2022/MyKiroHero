/**
 * task-templates.js — Unit Tests
 */
const { getTemplate, listTemplates, renderPrompt } = require('./task-templates');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

console.log('\n=== task-templates tests ===\n');

// ─── getTemplate ──────────────────────────────────────

console.log('getTemplate:');
assert(getTemplate('spec-writing') !== null, 'spec-writing exists');
assert(getTemplate('research') !== null, 'research exists');
assert(getTemplate('bug-fix') !== null, 'bug-fix exists');
assert(getTemplate('feature') !== null, 'feature exists');
assert(getTemplate('refactor') !== null, 'refactor exists');
assert(getTemplate('code-review') !== null, 'code-review exists');
assert(getTemplate('nonexistent') === null, 'nonexistent returns null');

const spec = getTemplate('spec-writing');
assert(spec.name === 'Spec Writing', 'spec-writing has correct name');
assert(spec.defaultBranchPattern === 'spec/{{taskId}}', 'spec-writing has branch pattern');
assert(typeof spec.prompt === 'string' && spec.prompt.length > 0, 'spec-writing has prompt');

// ─── listTemplates ────────────────────────────────────

console.log('\nlistTemplates:');
const list = listTemplates();
assert(Array.isArray(list), 'returns array');
assert(list.length === 7, 'has 7 templates');
assert(list.every(t => t.key && t.name && t.description), 'all have key, name, description');
assert(list.find(t => t.key === 'spec-writing'), 'includes spec-writing');
assert(list.find(t => t.key === 'research'), 'includes research');

// ─── renderPrompt ─────────────────────────────────────

console.log('\nrenderPrompt:');

// Basic variable substitution
const rendered = renderPrompt('bug-fix', {
  taskId: 'task-001',
  branch: 'fix/task-001',
  description: 'Fix login timeout bug',
});
assert(rendered.includes('[TASK] task-001'), 'taskId substituted');
assert(rendered.includes('branch: fix/task-001'), 'branch substituted');
assert(rendered.includes('Fix login timeout bug'), 'description substituted');

// Conditional block — files present
const withFiles = renderPrompt('feature', {
  taskId: 'task-002',
  branch: 'feat/task-002',
  description: 'Add dark mode',
  files: 'src/theme.js, src/app.css',
});
assert(withFiles.includes('files: src/theme.js, src/app.css'), 'files rendered when present');

// Conditional block — files absent
const noFiles = renderPrompt('feature', {
  taskId: 'task-003',
  branch: 'feat/task-003',
  description: 'Add dark mode',
});
assert(!noFiles.includes('files:'), 'files block removed when absent');

// Spec-writing template
const specPrompt = renderPrompt('spec-writing', {
  taskId: 'task-004',
  branch: 'spec/task-004',
  description: '設計 Mission Control 的多專案支援',
});
assert(specPrompt.includes('撰寫技術規格文件'), 'spec template has correct header');
assert(specPrompt.includes('report_task_result'), 'spec template mentions report');

// Research template
const researchPrompt = renderPrompt('research', {
  taskId: 'task-005',
  branch: 'research/task-005',
  description: '調查 SQLite WAL mode 效能',
});
assert(researchPrompt.includes('研究調查'), 'research template has correct header');

// Unknown template throws
let threw = false;
try { renderPrompt('unknown', {}); } catch { threw = true; }
assert(threw, 'unknown template throws error');

// ─── Summary ──────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
