/**
 * task-splitter.js — 自動任務拆分模組
 *
 * 判斷任務是否可拆分，並將複雜任務拆成多個獨立子任務。
 *
 * 拆分策略：
 *   1. 按檔案拆：params.files 有多個獨立檔案
 *   2. 按步驟拆：description 包含編號步驟或列表
 *   3. 不拆：任務太簡單或有依賴關係
 */

// Keywords that suggest a task can be split
const SPLIT_KEYWORDS = [
  '多個檔案', '多個步驟', '獨立的子任務',
  'multiple files', 'multiple steps', 'independent subtasks',
  'each file', 'respectively', '分別', '各自',
];

// Keywords that suggest dependencies (should NOT split)
const DEPENDENCY_KEYWORDS = [
  '依賴', '先後順序', 'depends on', 'after step',
  'then use the result', '用上一步的結果',
];

/**
 * Determine if a task description suggests it can be split.
 * @param {string} description - task description text
 * @returns {boolean}
 */
function canSplit(description) {
  if (!description || typeof description !== 'string') return false;
  const lower = description.toLowerCase();

  for (const kw of DEPENDENCY_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return false;
  }

  for (const kw of SPLIT_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return true;
  }

  const numberedSteps = description.match(/^\s*\d+[\.\)]\s+/gm);
  if (numberedSteps && numberedSteps.length >= 2) return true;

  const bulletItems = description.match(/^\s*[-*]\s+/gm);
  if (bulletItems && bulletItems.length >= 3) return true;

  return false;
}

/**
 * Split a task into multiple subtasks.
 * @param {object} task - task object with { params, notify, ... }
 * @returns {object[]} array of subtask definitions (ready for enqueue)
 */
function splitTask(task) {
  const params = task.params || {};
  const description = params.description || '';
  const files = params.files;

  // Strategy A: split by files
  const fileList = Array.isArray(files) ? files : (typeof files === 'string' && files.includes(',') ? files.split(',').map(f => f.trim()).filter(Boolean) : null);
  if (fileList && fileList.length >= 2) {
    return fileList.map((file, idx) => ({
      type: 'layer3',
      action: 'worker-dispatch',
      params: {
        description: `${description}\n\n（子任務 ${idx + 1}/${fileList.length}：只處理 ${file}）`,
        files: [file],
        template: params.template,
        _parentTaskId: task.taskId || null,
      },
      notify: task.notify || 'wa',
    }));
  }

  // Strategy B: split by numbered steps
  const stepPattern = /^\s*(\d+)[\.\)]\s+(.+)/gm;
  const steps = [];
  let match;
  while ((match = stepPattern.exec(description)) !== null) {
    steps.push(match[2].trim());
  }
  if (steps.length >= 2) {
    return steps.map((step, idx) => ({
      type: 'layer3',
      action: 'worker-dispatch',
      params: {
        description: `${step}\n\n（原任務步驟 ${idx + 1}/${steps.length}）`,
        files: params.files,
        template: params.template,
        _parentTaskId: task.taskId || null,
      },
      notify: task.notify || 'wa',
    }));
  }

  // Strategy C: split by bullet list
  const bulletPattern = /^\s*[-*]\s+(.+)/gm;
  const bullets = [];
  while ((match = bulletPattern.exec(description)) !== null) {
    bullets.push(match[1].trim());
  }
  if (bullets.length >= 3) {
    return bullets.map((item, idx) => ({
      type: 'layer3',
      action: 'worker-dispatch',
      params: {
        description: `${item}\n\n（原任務項目 ${idx + 1}/${bullets.length}）`,
        files: params.files,
        template: params.template,
        _parentTaskId: task.taskId || null,
      },
      notify: task.notify || 'wa',
    }));
  }

  // Cannot split — return single subtask wrapping the original
  return [{
    type: 'layer3',
    action: 'worker-dispatch',
    params: { ...params, _parentTaskId: task.taskId || null },
    notify: task.notify || 'wa',
  }];
}

module.exports = { canSplit, splitTask };
