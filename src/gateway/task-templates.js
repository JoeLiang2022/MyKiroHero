/**
 * task-templates.js — Task Template System
 * 
 * 提供不同類型任務的 prompt 模板，供 worker-dispatch 使用。
 * 模板類型：
 *   - spec: Spec-Driven Development（需求分析→設計→實作）
 *   - spec-writing: 撰寫技術規格文件
 *   - research: 研究調查任務
 *   - code-review: 程式碼審查（已有獨立 handler，此為 Worker 版）
 *   - bug-fix: 修 bug
 *   - feature: 新功能開發
 *   - refactor: 重構
 */

const TEMPLATES = {
  'spec': {
    name: 'Spec-Driven Development',
    description: '需求分析 + 設計 + 實作（Worker 自主完成整個 spec 流程）',
    defaultBranchPattern: 'spec/{{taskId}}',
    prompt: `[TASK] {{taskId}}
action: spec
branch: {{branch}}
{{#files}}files: {{files}}{{/files}}

## 任務：Spec-Driven Development

{{description}}

---

### 流程（依序執行）

**Phase 1 — 需求分析**
1. Study 相關 codebase（讀懂現有架構）
2. 建立 spec 目錄：\`.kiro/specs/{{taskId}}/\`
3. 寫 \`requirements.md\`：
   - User Stories（As a... I want... So that...）
   - Acceptance Criteria（每個 story 的驗收條件）
   - 不確定的地方標註 ⚠️

**Phase 2 — 設計**
4. 寫 \`design.md\`：
   - 架構方案（影響哪些檔案、新增什麼）
   - 資料流 / API 設計（如適用）
   - 邊界情況處理
   - 測試策略

**Phase 3 — 實作**
5. 寫 \`tasks.md\`：把設計拆成可執行的步驟清單
6. 依序完成每個步驟
7. 每完成一個步驟，在 tasks.md 標記 ✅
8. 跑測試確認沒壞

**Phase 4 — 回報**
9. Commit 所有變更（含 spec 文件 + 程式碼）
10. Push branch
11. 用 report_task_result 回報，message 包含：
    - spec 路徑
    - 完成了哪些步驟
    - 測試結果

### 注意
- Spec 文件用繁體中文
- 所有寫入 DB / Dashboard 的內容一律用英文（避免 SQLite encoding 問題）
- 如果需求太模糊無法拆解，在 report_task_result 中說明需要什麼資訊
- 不要跳過 Phase 1-2 直接寫 code`,
  },

  'spec-writing': {
    name: 'Spec Writing',
    description: '撰寫技術規格文件（需求分析、設計文件、API spec）',
    defaultBranchPattern: 'spec/{{taskId}}',
    prompt: `[TASK] {{taskId}}
action: spec-writing
branch: {{branch}}
{{#files}}files: {{files}}{{/files}}

## 任務：撰寫技術規格文件

{{description}}

---

### 產出要求
1. 在 branch 上建立規格文件（Markdown 格式）
2. 文件結構建議：
   - 概述 / 目標
   - 架構設計 / 技術方案
   - API 或介面定義（如適用）
   - 資料模型（如適用）
   - 實作步驟 / 任務拆解
   - 風險與注意事項
3. 用繁體中文撰寫
4. 完成後 commit + push branch
5. 使用 report_task_result 回報，message 中附上文件路徑和摘要`,
  },

  'research': {
    name: 'Research',
    description: '研究調查任務（技術調研、方案比較、可行性分析）',
    defaultBranchPattern: 'research/{{taskId}}',
    prompt: `[TASK] {{taskId}}
action: research
branch: {{branch}}
{{#files}}files: {{files}}{{/files}}

## 任務：研究調查

{{description}}

---

### 產出要求
1. 在 branch 上建立研究報告（Markdown 格式）
2. 報告結構建議：
   - 研究目標
   - 調查結果 / 發現
   - 方案比較（如適用）
   - 建議方案 + 理由
   - 參考資料
3. 用繁體中文撰寫
4. 完成後 commit + push branch
5. 使用 report_task_result 回報，message 中附上報告路徑和結論摘要`,
  },

  'bug-fix': {
    name: 'Bug Fix',
    description: '修復 bug',
    defaultBranchPattern: 'fix/{{taskId}}',
    prompt: `[TASK] {{taskId}}
action: bug-fix
branch: {{branch}}
{{#files}}files: {{files}}{{/files}}

## 任務：修復 Bug

{{description}}

---

### 要求
1. 在 branch 上修復問題
2. 確認修復後跑相關測試
3. Commit message 格式：fix: <簡述>
4. 完成後 push branch
5. 使用 report_task_result 回報，附上修改的檔案和測試結果`,
  },

  'feature': {
    name: 'Feature',
    description: '新功能開發',
    defaultBranchPattern: 'feat/{{taskId}}',
    prompt: `[TASK] {{taskId}}
action: feature
branch: {{branch}}
{{#files}}files: {{files}}{{/files}}

## 任務：新功能開發

{{description}}

---

### 要求
1. 在 branch 上實作功能
2. 寫對應的測試
3. Commit message 格式：feat: <簡述>
4. 完成後 push branch
5. 使用 report_task_result 回報，附上新增/修改的檔案清單`,
  },

  'refactor': {
    name: 'Refactor',
    description: '程式碼重構',
    defaultBranchPattern: 'refactor/{{taskId}}',
    prompt: `[TASK] {{taskId}}
action: refactor
branch: {{branch}}
{{#files}}files: {{files}}{{/files}}

## 任務：重構

{{description}}

---

### 要求
1. 在 branch 上進行重構
2. 確保現有測試仍然通過
3. Commit message 格式：refactor: <簡述>
4. 完成後 push branch
5. 使用 report_task_result 回報，附上重構摘要和測試結果`,
  },

  'code-review': {
    name: 'Code Review (Worker)',
    description: 'Worker 進行程式碼審查',
    defaultBranchPattern: null, // no branch needed
    prompt: `[TASK] {{taskId}}
action: code-review
{{#files}}files: {{files}}{{/files}}

## 任務：程式碼審查

{{description}}

---

### 要求
1. 審查指定的程式碼或 branch diff
2. 檢查：bug、安全問題、效能、可讀性
3. 使用 report_task_result 回報審查結果
4. message 格式：passed/failed + 問題清單（如有）`,
  },
};

/**
 * 取得模板定義
 * @param {string} name — 模板名稱
 * @returns {object|null} 模板物件或 null
 */
function getTemplate(name) {
  return TEMPLATES[name] || null;
}

/**
 * 列出所有可用模板
 * @returns {Array<{name, description}>}
 */
function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, tpl]) => ({
    key,
    name: tpl.name,
    description: tpl.description,
  }));
}

/**
 * 用模板產生 prompt
 * @param {string} templateName — 模板名稱
 * @param {object} vars — 變數（taskId, branch, description, files, ...）
 * @returns {string} 渲染後的 prompt
 */
function renderPrompt(templateName, vars = {}) {
  const tpl = TEMPLATES[templateName];
  if (!tpl) throw new Error(`Unknown template: ${templateName}`);

  let prompt = tpl.prompt;

  // Simple mustache-like rendering
  // {{var}} — direct replacement
  // {{#var}}content{{/var}} — conditional block (render if var is truthy)
  
  // Handle conditional blocks first
  prompt = prompt.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return vars[key] ? content : '';
  });

  // Handle variable substitution
  prompt = prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] !== undefined ? String(vars[key]) : '';
  });

  // Clean up empty lines from removed conditionals
  prompt = prompt.replace(/\n{3,}/g, '\n\n');

  return prompt.trim();
}

module.exports = { getTemplate, listTemplates, renderPrompt };
