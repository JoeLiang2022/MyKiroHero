/**
 * TaskQueueSQLite — SQLite-backed TaskQueue (drop-in replacement)
 * 
 * Same API as TaskQueue (in-memory + JSON), but uses SQLite for persistence.
 * Uses the existing mission-control.db or a separate tasks.db.
 * 
 * Benefits over JSON persistence:
 * - Crash-safe (WAL mode)
 * - No debounced writes — immediate persistence
 * - Query by status/date without loading all tasks
 * - Unified with Mission Control task tracking
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { getNow, getTodayDate } = require('../utils/timezone');

const DEFAULT_DB_PATH = path.join(__dirname, '../../data/mission-control.db');
const JSON_QUEUE_PATH = path.join(__dirname, '../../data/task-queue.json');

class TaskQueueSQLite {
  /**
   * @param {object} config
   * @param {string} [config.dbPath] - SQLite DB path (default: data/mission-control.db)
   * @param {string} [config.taskOutputDir] - 任務結果輸出目錄
   * @param {object} [config.db] - Existing better-sqlite3 instance to reuse
   */
  constructor(config = {}) {
    const projectRoot = path.join(__dirname, '../..');
    this.outputDir = config.taskOutputDir || path.join(projectRoot, 'temp/tasks');

    if (config.db) {
      this.db = config.db;
      this._ownDb = false;
    } else {
      const dbPath = config.dbPath || DEFAULT_DB_PATH;
      if (dbPath !== ':memory:') {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this._ownDb = true;
    }

    this._ensureTable();
    this._migrateFromJson(config);
    this._resetRunningTasks();
  }

  // ── Schema ─────────────────────────────────────────────

  _ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exec_tasks (
        taskId TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'layer1',
        action TEXT,
        params TEXT,
        notify TEXT DEFAULT 'wa',
        priority TEXT DEFAULT 'normal',
        timeout INTEGER DEFAULT 300,
        workerId TEXT,
        tags TEXT,
        assignedTo TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        createdAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT,
        result TEXT,
        progressLog TEXT DEFAULT '[]',
        retryCount INTEGER DEFAULT 0,
        maxRetries INTEGER DEFAULT 3,
        retryAfter REAL,
        lastError TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_exec_tasks_status ON exec_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_exec_tasks_created ON exec_tasks(createdAt);
    `);
  }

  // ── Migration from JSON ────────────────────────────────

  _migrateFromJson(config) {
    const jsonPath = config._jsonPath || JSON_QUEUE_PATH;
    try {
      if (!fs.existsSync(jsonPath)) return;

      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return;

      // Check if already migrated (any tasks exist)
      const count = this.db.prepare('SELECT COUNT(*) as c FROM exec_tasks').get().c;
      if (count > 0) {
        // Already have data — rename JSON as backup and skip
        const backupPath = jsonPath + '.migrated';
        if (!fs.existsSync(backupPath)) {
          fs.renameSync(jsonPath, backupPath);
          console.log(`[TaskQueueSQLite] JSON already migrated, renamed to ${backupPath}`);
        }
        return;
      }

      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO exec_tasks
        (taskId, type, action, params, notify, priority, timeout, workerId, tags,
         assignedTo, status, createdAt, startedAt, completedAt, result, progressLog,
         retryCount, maxRetries, retryAfter, lastError)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const migrate = this.db.transaction((tasks) => {
        let migrated = 0;
        for (const t of tasks) {
          if (!t.taskId) continue;
          insert.run(
            t.taskId,
            t.type || 'layer1',
            t.action || null,
            t.params ? JSON.stringify(t.params) : null,
            t.notify || 'wa',
            t.priority || 'normal',
            t.timeout || 300,
            t.workerId || null,
            t.tags ? JSON.stringify(t.tags) : '[]',
            t.assignedTo || null,
            t.status || 'queued',
            t.createdAt || new Date().toISOString(),
            t.startedAt || null,
            t.completedAt || null,
            t.result ? JSON.stringify(t.result) : null,
            t.progressLog ? JSON.stringify(t.progressLog) : '[]',
            t.retryCount || 0,
            t.maxRetries ?? 3,
            t.retryAfter || null,
            t.lastError || null
          );
          migrated++;
        }
        return migrated;
      });

      const migrated = migrate(arr);
      // Rename original file
      const backupPath = jsonPath + '.migrated';
      fs.renameSync(jsonPath, backupPath);
      console.log(`[TaskQueueSQLite] Migrated ${migrated} tasks from JSON → SQLite (backup: ${backupPath})`);
    } catch (err) {
      console.error(`[TaskQueueSQLite] Migration failed: ${err.message}`);
    }
  }

  // ── Startup: reset running tasks ──────────────────────

  _resetRunningTasks() {
    const result = this.db.prepare(
      "UPDATE exec_tasks SET status = 'queued', startedAt = NULL, assignedTo = NULL WHERE status = 'running'"
    ).run();
    if (result.changes > 0) {
      console.warn(`[TaskQueueSQLite] Reset ${result.changes} running tasks to queued (Gateway restarted)`);
    }
  }

  // ── Task ID Generation ─────────────────────────────────

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

  // ── Core API (same as TaskQueue) ───────────────────────

  /**
   * 建立任務，加入佇列
   * @param {object} taskDef
   * @returns {{ taskId: string, status: string }}
   */
  enqueue(taskDef) {
      const taskId = taskDef.taskId || this._generateTaskId();
      const now = getNow().toISOString();

      this.db.prepare(`
        INSERT INTO exec_tasks
        (taskId, type, action, params, notify, priority, timeout, workerId, tags,
         assignedTo, status, createdAt, startedAt, completedAt, result, progressLog,
         retryCount, maxRetries, retryAfter, lastError)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL, '[]', 0, ?, NULL, NULL)
      `).run(
        taskId,
        taskDef.type || 'layer1',
        taskDef.action || null,
        taskDef.params ? JSON.stringify(taskDef.params) : null,
        taskDef.notify || 'wa',
        taskDef.priority || 'normal',
        taskDef.timeout || 300,
        taskDef.workerId || null,
        taskDef.tags ? JSON.stringify(taskDef.tags) : '[]',
        null, // assignedTo
        now,
        taskDef.maxRetries ?? 3
      );

      return { taskId, status: 'queued' };
    }


  /**
   * 取得任務狀態
   * @param {string} taskId
   * @returns {object|null}
   */
  getTask(taskId) {
    const row = this.db.prepare('SELECT * FROM exec_tasks WHERE taskId = ?').get(taskId);
    if (!row) return null;
    return this._rowToTask(row);
  }

  /**
   * 列出最近任務（按時間倒序）
   * @param {number} [limit=20]
   * @returns {object[]}
   */
  listTasks(limit = 20) {
    const rows = this.db.prepare(
      'SELECT * FROM exec_tasks ORDER BY createdAt DESC LIMIT ?'
    ).all(limit);
    return rows.map(r => this._rowToTask(r));
  }

  /**
   * Append a progress message to a task's progressLog
   * @param {string} taskId
   * @param {string} message
   */
  appendProgress(taskId, message) {
    const row = this.db.prepare('SELECT progressLog FROM exec_tasks WHERE taskId = ?').get(taskId);
    if (!row) return;
    const log = JSON.parse(row.progressLog || '[]');
    log.push({ message, timestamp: getNow().toISOString() });
    this.db.prepare('UPDATE exec_tasks SET progressLog = ? WHERE taskId = ?')
      .run(JSON.stringify(log), taskId);
  }

  /**
   * 更新任務狀態
   * @param {string} taskId
   * @param {string} status
   * @param {object} [result]
   */
  updateStatus(taskId, status, result, extraFields) {
    const sets = ['status = ?'];
    const params = [status];

    if (result !== undefined) {
      sets.push('result = ?');
      params.push(JSON.stringify(result));
    }
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      sets.push('completedAt = ?');
      params.push(getNow().toISOString());
    }
    // Allow caller to persist extra fields (e.g. startedAt)
    // Whitelist columns to prevent SQL injection via dynamic keys
    const ALLOWED_EXTRA = new Set(['startedAt', 'completedAt', 'assignedTo', 'retryCount', 'retryAfter', 'lastError']);
    if (extraFields && typeof extraFields === 'object') {
      for (const [key, val] of Object.entries(extraFields)) {
        if (!ALLOWED_EXTRA.has(key)) {
          console.warn(`[TaskQueueSQLite] updateStatus: ignoring unknown extraField "${key}"`);
          continue;
        }
        sets.push(`${key} = ?`);
        params.push(val);
      }
    }

    params.push(taskId);
    this.db.prepare(`UPDATE exec_tasks SET ${sets.join(', ')} WHERE taskId = ?`).run(...params);
  }

  /**
   * 存結果 JSON 到 temp/tasks/YYYY-MM-DD/taskId.json
   * @param {string} taskId
   */
  saveResult(taskId) {
    const task = this.getTask(taskId);
    if (!task) return;

    const dateDir = path.join(this.outputDir, getTodayDate());
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }

    const filePath = path.join(dateDir, `${taskId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf-8');
    console.log(`[TaskQueueSQLite] Result saved: ${filePath}`);
  }

  /**
   * Worker 取下一個待執行任務
   * Respects priority: high > normal > low
   * @returns {object|null}
   */
  dequeueForWorker() {
    // SQLite ORDER BY with CASE for priority
    const row = this.db.prepare(`
      SELECT * FROM exec_tasks
      WHERE status = 'queued'
      ORDER BY
        CASE priority
          WHEN 'high' THEN 0
          WHEN 'normal' THEN 1
          WHEN 'low' THEN 2
          ELSE 1
        END ASC,
        createdAt ASC
      LIMIT 1
    `).get();
    if (!row) return null;
    return this._rowToTask(row);
  }

  /**
   * Find all child tasks of a given parent task
   * @param {string} parentId - parent task ID
   * @param {string[]} [statusFilter] - optional status filter (e.g. ['queued', 'retry-pending'])
   * @returns {object[]}
   */
  findChildTasks(parentId, statusFilter) {
    let sql = `SELECT * FROM exec_tasks WHERE json_extract(params, '$._parentTaskId') = ?`;
    const args = [parentId];
    if (statusFilter && statusFilter.length > 0) {
      const placeholders = statusFilter.map(() => '?').join(', ');
      sql += ` AND status IN (${placeholders})`;
      args.push(...statusFilter);
    }
    const rows = this.db.prepare(sql).all(...args);
    return rows.map(r => this._rowToTask(r));
  }


  // ── Compatibility shims ────────────────────────────────
  // TaskExecutor calls _schedulePersist() directly in retry polling
  _schedulePersist() {
    // No-op: SQLite writes are immediate
  }

  // ── Row → Task object conversion ──────────────────────

  _rowToTask(row) {
    return {
      taskId: row.taskId,
      type: row.type,
      action: row.action,
      params: row.params ? JSON.parse(row.params) : {},
      notify: row.notify,
      priority: row.priority,
      timeout: row.timeout,
      workerId: row.workerId || null,
      tags: row.tags ? JSON.parse(row.tags) : [],
      assignedTo: row.assignedTo || null,
      status: row.status,
      createdAt: row.createdAt,
      startedAt: row.startedAt || null,
      completedAt: row.completedAt || null,
      result: row.result ? JSON.parse(row.result) : null,
      progressLog: row.progressLog ? JSON.parse(row.progressLog) : [],
      retryCount: row.retryCount || 0,
      maxRetries: row.maxRetries ?? 3,
      retryAfter: row.retryAfter || null,
      lastError: row.lastError || null,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────

  destroy() {
    if (this._ownDb && this.db) {
      this.db.close();
      this.db = null;
      console.log('[TaskQueueSQLite] DB closed');
    }
  }
}

module.exports = TaskQueueSQLite;
