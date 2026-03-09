/**
 * TaskQueue - 任務佇列 + 狀態管理
 * 
 * In-memory task queue，管理任務生命週期：
 * queued → running → done / failed
 * queued → running → retry-pending → running → done / failed
 * Any cancellable state → cancelled
 * 
 * 結果自動存檔到 temp/tasks/YYYY-MM-DD/
 */

const path = require('path');
const fs = require('fs');
const { getNow, getTodayDate } = require('../utils/timezone');

const PERSIST_DEBOUNCE_MS = 100;
const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — skip done/failed older than this

class TaskQueue {
  /**
   * @param {object} config
   * @param {string} [config.taskOutputDir] - 任務結果輸出目錄（預設 temp/tasks）
   */
  constructor(config = {}) {
    this.tasks = new Map(); // taskId → task object
    const projectRoot = path.join(__dirname, '../..');
    this.outputDir = config.taskOutputDir || path.join(projectRoot, 'temp/tasks');
    this._persistPath = config._persistPath || path.join(projectRoot, 'data', 'task-queue.json');
    this._persistTimer = null;
    this._loadFromDisk();
  }

  /**
   * 生成 taskId: task-YYYYMMDD-HHMMSS-xxx (xxx = 3-digit random hex)
   */
  _generateTaskId() {
    const now = getNow();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const hex = Math.floor(Math.random() * 0xfff).toString(16).padStart(3, '0');
    return `task-${y}${mo}${d}-${h}${mi}${s}-${hex}`;
  }

  /**
   * 建立任務，加入佇列
   * @param {object} taskDef - 任務定義 (type, action, params, notify, priority, timeout, workerId, tags)
   * @returns {{ taskId: string, status: string }}
   */
  enqueue(taskDef) {
    const taskId = this._generateTaskId();
    const task = {
      taskId,
      type: taskDef.type || 'layer1',
      action: taskDef.action,
      params: taskDef.params || {},
      notify: taskDef.notify || 'wa',
      priority: taskDef.priority || 'normal',
      timeout: taskDef.timeout || 300,
      workerId: taskDef.workerId || null,
      tags: taskDef.tags || [],
      assignedTo: null,
      status: 'queued',
      createdAt: getNow().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      progressLog: [],
      // Retry fields
      retryCount: 0,
      maxRetries: taskDef.maxRetries ?? 3,
      retryAfter: null,
      lastError: null,
    };
    this.tasks.set(taskId, task);
    this._schedulePersist();
    return { taskId, status: 'queued' };
  }

  /**
   * 取得任務狀態
   * @param {string} taskId
   * @returns {object|null} task object or null
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * 列出最近任務（按時間倒序）
   * @param {number} [limit=20]
   * @returns {object[]}
   */
  listTasks(limit = 20) {
    const all = Array.from(this.tasks.values());
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return all.slice(0, limit);
  }

  /**
   * Append a progress message to a task's progressLog
   * @param {string} taskId
   * @param {string} message
   */
  appendProgress(taskId, message) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (!task.progressLog) task.progressLog = [];
    task.progressLog.push({
      message,
      timestamp: getNow().toISOString(),
    });
    this._schedulePersist();
  }

  /**
   * 更新任務狀態
   * @param {string} taskId
   * @param {string} status - queued / running / done / failed
   * @param {object} [result] - 任務結果（done/failed 時帶入）
   */
  updateStatus(taskId, status, result) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = status;
    if (result !== undefined) {
      task.result = result;
    }
    // Set startedAt when task begins running (issue-ed5 fix)
    if (status === 'running' && !task.startedAt) {
      task.startedAt = getNow().toISOString();
    }
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      task.completedAt = getNow().toISOString();
    }
    this._schedulePersist();
  }

  /**
   * 存結果 JSON 到 temp/tasks/YYYY-MM-DD/taskId.json
   * 自動建立輸出目錄
   * @param {string} taskId
   */
  saveResult(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const dateDir = path.join(this.outputDir, getTodayDate());
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }

    const filePath = path.join(dateDir, `${taskId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf-8');
    console.log(`[TaskQueue] Result saved: ${filePath}`);
  }

  /**
   * Worker 取下一個待執行任務（Phase 2）
   * Respects priority: high > normal > low
   * @returns {object|null} task or null
   */
  dequeueForWorker() {
    const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };
    let best = null;
    let bestPriority = Infinity;

    for (const task of this.tasks.values()) {
      if (task.status !== 'queued') continue;
      const p = PRIORITY_ORDER[task.priority] ?? 1;
      if (p < bestPriority) {
        bestPriority = p;
        best = task;
      }
    }
    return best;
  }
  /**
   * Find all child tasks of a given parent task
   * @param {string} parentId - parent task ID
   * @param {string[]} [statusFilter] - optional status filter (e.g. ['queued', 'retry-pending'])
   * @returns {object[]}
   */
  findChildTasks(parentId, statusFilter) {
    const results = [];
    for (const task of this.tasks.values()) {
      if (task.params?._parentTaskId !== parentId) continue;
      if (statusFilter && !statusFilter.includes(task.status)) continue;
      results.push(task);
    }
    return results;
  }

  // ── Persistence ──────────────────────────────────────

  /**
   * Load tasks from disk on startup.
   * Restores pending/retry tasks; skips done/failed older than 24h.
   * Running tasks are reset to queued (Gateway restarted mid-execution).
   */
  _loadFromDisk() {
    try {
      if (!fs.existsSync(this._persistPath)) return;
      const raw = fs.readFileSync(this._persistPath, 'utf-8');
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;

      const now = Date.now();
      let loaded = 0;
      let skipped = 0;

      for (const task of arr) {
        if (!task.taskId) continue;

        // Skip done/failed/cancelled older than 24h
        if (['done', 'failed', 'cancelled'].includes(task.status)) {
          const completedAt = task.completedAt ? new Date(task.completedAt).getTime() : 0;
          if (now - completedAt > PERSIST_MAX_AGE_MS) {
            skipped++;
            continue;
          }
        }

        // Running tasks → reset to queued (Gateway restarted mid-execution)
        if (task.status === 'running') {
          console.warn(`[TaskQueue] Task ${task.taskId} was running when Gateway stopped — resetting to queued`);
          task.status = 'queued';
          // Preserve assignedTo so we know which Worker may still be busy
          // The Worker health check will reconcile the state
          task.startedAt = null;
        }

        this.tasks.set(task.taskId, task);
        loaded++;
      }

      if (loaded > 0) {
        console.log(`[TaskQueue] Restored ${loaded} tasks from disk (skipped ${skipped} expired)`);
      }
    } catch (err) {
      console.error(`[TaskQueue] Failed to load from disk: ${err.message}`);
    }
  }

  /**
   * Debounced save — coalesces rapid state changes into one write
   */
  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._saveToDisk();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * Write all tasks to data/task-queue.json
   */
  _saveToDisk() {
    try {
      const dir = path.dirname(this._persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const arr = Array.from(this.tasks.values());
      fs.writeFileSync(this._persistPath, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[TaskQueue] Failed to persist: ${err.message}`);
    }
  }

  /**
   * Cleanup: clear pending persist timer and flush to disk.
   * Called during graceful shutdown.
   */
  destroy() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    // Final flush to ensure no data loss
    this._saveToDisk();
  }
}

module.exports = TaskQueue;
