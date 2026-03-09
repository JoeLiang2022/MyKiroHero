/**
 * split-dispatch.js — Layer 3 Handler: 自動任務拆分派發
 *
 * 接受一個複雜任務，自動拆成多個子任務並行派給 Worker。
 *
 * Params:
 *   description (required) — 任務描述
 *   files (optional) — 相關檔案列表
 *   subtasks (optional) — 預先拆好的子任務 array，若提供則直接派發
 *
 * Returns:
 *   { success, subtaskIds: [...], message }
 */

const { canSplit, splitTask } = require('../task-splitter');

module.exports = {
  name: 'split-dispatch',
  description: 'Layer 3: 自動拆分任務並派發給多個 Worker',
  type: 'layer3',

  execute: async (params, context) => {
    const { description, subtasks: preDefinedSubtasks } = params;
    if (!description && !preDefinedSubtasks) {
      throw new Error('Missing required param: description or subtasks');
    }

    const taskExecutor = context && context.taskExecutor;
    const taskQueue = context && context.taskQueue;
    if (!taskExecutor && !taskQueue) throw new Error('TaskExecutor or TaskQueue not available');

    try {
      let subtaskDefs;

      if (Array.isArray(preDefinedSubtasks) && preDefinedSubtasks.length > 0) {
        // Use pre-defined subtasks directly
        subtaskDefs = preDefinedSubtasks.map((st, idx) => ({
          type: 'layer3',
          action: 'worker-dispatch',
          params: {
            description: st.description || description,
            files: st.files || params.files,
            template: st.template || params.template,
            _parentTaskId: context.taskId || null,
          },
          notify: params.notify || 'wa',
        }));
      } else {
        // Auto-split using task-splitter
        const task = {
          taskId: context.taskId || null,
          params,
          notify: params.notify || 'wa',
        };

        if (!canSplit(description)) {
          // Cannot split — dispatch as single worker-dispatch task
          const submit = taskExecutor
            ? taskExecutor.submitTask.bind(taskExecutor)
            : (def) => taskQueue.enqueue(def);
          const result = await submit({
            type: 'layer3',
            action: 'worker-dispatch',
            params: { description, files: params.files, template: params.template },
            notify: params.notify || 'wa',
          });
          return {
            success: true,
            subtaskIds: [result.taskId],
            message: `Task not splittable, dispatched as single task: ${result.taskId}`,
          };
        }

        subtaskDefs = splitTask(task);
      }

      // Enqueue and execute all subtasks
      const submit = taskExecutor
        ? taskExecutor.submitTask.bind(taskExecutor)
        : (def) => taskQueue.enqueue(def);
      const subtaskIds = [];
      for (const def of subtaskDefs) {
        const result = await submit(def);
        subtaskIds.push(result.taskId);
      }

      return {
        success: true,
        subtaskIds,
        message: `Split into ${subtaskIds.length} subtasks: ${subtaskIds.join(', ')}`,
      };
    } catch (err) {
      console.error(`[SplitDispatch] Error: ${err.message}`);
      throw err;
    }
  },
};
