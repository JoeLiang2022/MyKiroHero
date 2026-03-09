/**
 * worker-dispatch.js — Layer 3 Handler: Worker Kiro 任務派發
 * 
 * 找到 idle Worker → 送任務訊息進 Worker chat → 等 Worker 回報
 * 
 * Params:
 *   description (required) — 任務描述
 *   branch (optional) — Worker 要開的 branch 名稱
 *   files (optional) — 相關檔案列表（提示用）
 *   action (optional) — 子動作類型 (fix-bug, add-feature, refactor, etc.)
 *   template (optional) — 模板名稱 (bug-fix, feature, refactor, code-review, study)
 *                         若提供，會用模板系統產生 prompt，忽略 raw description 組裝
 * 
 * 注意：這個 handler 只負責「派發」，不等 Worker 完成。
 * Worker 完成後透過 report_task_result 回報。
 */

const { getTemplate, renderPrompt } = require('../task-templates');

module.exports = {
  name: 'worker-dispatch',
  description: 'Layer 3: 派發任務給 Worker Kiro',
  type: 'layer3',

  execute: async (params, context) => {
    const { description, branch, files, action: subAction, template: templateName } = params;
    if (!description) throw new Error('Missing required param: description');

    // Get worker registry from gateway (injected via context)
    const registry = context && context.workerRegistry;
    if (!registry) throw new Error('WorkerRegistry not available');

    // Find idle worker — prefer specified workerId (e.g. review fix must go back to same worker)
    const preferredWorker = params.workerId || params._preferredWorker || null;
    const excludeWorker = params._excludeWorker || null;
    // Clean internal fields from params to avoid persisting them
    delete params._excludeWorker;
    delete params._preferredWorker;
    let worker;
    if (preferredWorker) {
      // Try to use the specified worker (must be idle)
      const preferred = registry.list().find(w => w.workerId === preferredWorker && w.status === 'idle');
      if (preferred) {
        worker = preferred;
        console.log(`[worker-dispatch] Using preferred worker: ${preferredWorker}`);
      } else {
        console.log(`[worker-dispatch] Preferred worker ${preferredWorker} not idle, falling back to any idle worker`);
        worker = registry.findIdle();
      }
    } else if (excludeWorker) {
      worker = registry.findIdleExcluding(excludeWorker) || registry.findIdle();
    } else {
      worker = registry.findIdle();
    }
    if (!worker) {
      // No idle worker — notify owner (auto-spawn disabled)
      const err = new Error('No idle Worker available. Please open a Worker Kiro window manually. Task will be queued for retry.');
      err.statusCode = 503; // triggers _isTransient → retry
      throw err;
    }

    // Get taskId from the task object (passed through context)
    const taskId = context.taskId || 'unknown';

    // Auto-generate branch name — use template default pattern if available
    let taskBranch = branch;
    if (!taskBranch && templateName) {
      const tpl = getTemplate(templateName);
      if (tpl && tpl.defaultBranchPattern) {
        taskBranch = tpl.defaultBranchPattern.replace('{{taskId}}', taskId);
      }
    }
    if (!taskBranch) taskBranch = `worker/${taskId}`;

    // Build task message — use template if specified, otherwise raw assembly
    let message;
    if (templateName) {
      const fileList = Array.isArray(files) ? files.join(', ') : (files || '');
      message = renderPrompt(templateName, {
        ...params,
        taskId,
        branch: taskBranch,
        files: fileList,
      });
    } else {
      const lines = [`[TASK] ${taskId}`];
      if (subAction) lines.push(`action: ${subAction}`);
      lines.push(`branch: ${taskBranch}`);
      if (files) {
        const fileList = Array.isArray(files) ? files.join(', ') : files;
        lines.push(`files: ${fileList}`);
      }
      lines.push(`description: ${description}`);
      lines.push('---');
      lines.push('Work on the specified branch. When done, commit and push the branch (NOT main).');
      lines.push('Then use report_task_result with the branch name and commit hash.');
      message = lines.join('\n');
    }

    // Mark worker as busy (may be rejected if worker is in reset cooldown)
    const busyOk = registry.markBusy(worker.workerId, taskId);
    if (!busyOk) {
      const retryErr = new Error(`Worker ${worker.workerId} rejected markBusy (reset cooldown or unavailable)`);
      retryErr.statusCode = 503; // triggers _isTransient → retry
      retryErr.failedWorker = worker.workerId;
      throw retryErr;
    }

    // NOTE: No newSession here. Worker session is already reset by _resetWorkerSession()
    // after the previous task completes. Calling newSession here causes a race condition:
    // MCP servers reinitialize while the task message arrives → MCP error → Worker stuck.

    // Send to worker chat
    try {
      await registry.sendToWorker(worker.workerId, message);
    } catch (err) {
      // Failed to send — mark worker idle (or offline) and throw with worker info for retry
      registry.markIdle(worker.workerId);
      const retryErr = new Error(`Failed to send task to ${worker.workerId}: ${err.message}`);
      retryErr.statusCode = 503; // triggers _isTransient → retry
      retryErr.failedWorker = worker.workerId;
      throw retryErr;
    }

    return {
      success: true,
      outputPath: null,
      message: `Task dispatched to ${worker.workerId}`,
      workerId: worker.workerId,
      branch: taskBranch,
      dispatched: true,
      // Task stays in 'running' state until Worker calls report_task_result
    };
  },
};
