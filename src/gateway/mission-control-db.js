/**
 * MissionControlDB — SQLite 持久化層
 * 
 * 管理 Mission Control 的 projects / plans / tasks
 * 使用 better-sqlite3（同步、WAL mode）
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { getNow, getTodayDate } = require('../utils/timezone');

const DEFAULT_DB_PATH = path.join(__dirname, '../../data/mission-control.db');

class MissionControlDB {
  /**
   * @param {string} dbPath - DB 路徑，':memory:' 用於測試
   */
  constructor(dbPath = DEFAULT_DB_PATH) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new Database(dbPath, { timeout: 5000 });
    this.db.pragma('journal_mode = WAL');
    this._createSchema();
    console.log(`[MissionControlDB] Initialized: ${dbPath}`);
  }

  // ─── Schema ───────────────────────────────────────────

  _createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL DEFAULT 'default',
        title TEXT NOT NULL,
        description TEXT,
        strategy TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        source TEXT,
        sourceInfo TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT,
        FOREIGN KEY (projectId) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        planId TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'layer1',
        action TEXT,
        params TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        orderIndex INTEGER NOT NULL,
        assignedTo TEXT,
        execTaskId TEXT,
        timeout INTEGER DEFAULT 300,
        output TEXT,
        result TEXT,
        progressLog TEXT,
        createdAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT,
        FOREIGN KEY (planId) REFERENCES plans(id)
      );

      CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(projectId);
      CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(planId);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_exec ON tasks(execTaskId);
    `);

    // Default project
    this.db.prepare(
      `INSERT OR IGNORE INTO projects (id, name, createdAt) VALUES (?, ?, ?)`
    ).run('default', 'MyKiroHero', getNow().toISOString());
  }

  // ─── ID Generation ────────────────────────────────────

  _generateId(prefix) {
    const now = getNow();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const rand = Math.random().toString(16).slice(2, 5);
    return `${prefix}-${date}-${time}-${rand}`;
  }

  _now() {
    return getNow().toISOString();
  }

  // ─── Projects ─────────────────────────────────────────

  getProject(id) {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null;
  }

  listProjects() {
    return this.db.prepare('SELECT * FROM projects ORDER BY createdAt').all();
  }

  createProject({ id, name, description }) {
    if (!id || !name) throw new Error('Project id and name are required');
    const now = this._now();
    this.db.prepare(
      'INSERT INTO projects (id, name, description, createdAt) VALUES (?, ?, ?, ?)'
    ).run(id, name, description || null, now);
    return { id, name, description: description || null, createdAt: now };
  }

  updateProject(id, fields) {
    const allowed = ['name', 'description'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (sets.length === 0) return false;
    params.push(id);
    const result = this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return result.changes > 0;
  }

  deleteProject(id) {
    if (id === 'default') return false; // protect default project
    // Check if any non-archived plans exist
    const activePlans = this.db.prepare(
      "SELECT COUNT(*) as count FROM plans WHERE projectId = ? AND status != 'archived'"
    ).get(id).count;
    if (activePlans > 0) return false;
    // Delete archived plans' tasks first, then plans, then project
    const archivedPlanIds = this.db.prepare(
      "SELECT id FROM plans WHERE projectId = ? AND status = 'archived'"
    ).all(id).map(r => r.id);
    for (const pid of archivedPlanIds) {
      this.db.prepare('DELETE FROM tasks WHERE planId = ?').run(pid);
      this.db.prepare('DELETE FROM plans WHERE id = ?').run(pid);
    }
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  }
  deletePlan(id) {
      // Clean up related exec_tasks (linked via tasks.execTaskId)
      const mcTasks = this.db.prepare('SELECT execTaskId FROM tasks WHERE planId = ? AND execTaskId IS NOT NULL').all(id);
      if (mcTasks.length > 0) {
        const deleteExec = this.db.prepare('DELETE FROM exec_tasks WHERE taskId = ?');
        for (const t of mcTasks) {
          deleteExec.run(t.execTaskId);
        }
      }
      this.db.prepare('DELETE FROM tasks WHERE planId = ?').run(id);
      const result = this.db.prepare('DELETE FROM plans WHERE id = ?').run(id);
      return result.changes > 0;
    }



  // ─── Plans ────────────────────────────────────────────

  createPlan({ title, description, projectId = 'default', source, sourceInfo }) {
    const id = this._generateId('plan');
    const now = this._now();
    this.db.prepare(`
      INSERT INTO plans (id, projectId, title, description, source, sourceInfo, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, projectId, title, description || null, source || null,
      sourceInfo ? JSON.stringify(sourceInfo) : null, now, now);
    return { id, status: 'pending', createdAt: now };
  }

  getPlan(id) {
    const plan = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
    if (!plan) return null;
    plan.tasks = this.listTasksByPlan(id);
    return plan;
  }

  listPlans({ projectId, status, limit } = {}) {
    let sql = 'SELECT * FROM plans WHERE 1=1';
    const params = [];
    if (projectId) { sql += ' AND projectId = ?'; params.push(projectId); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY createdAt DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(limit); }
    const plans = this.db.prepare(sql).all(...params);
    // Attach tasks to each plan for sidebar display
    for (const plan of plans) {
      plan.tasks = this.listTasksByPlan(plan.id);
    }
    return plans;
  }

  updatePlan(id, fields) {
    const allowed = ['title', 'description', 'strategy', 'status', 'completedAt'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (sets.length === 0) return false;
    sets.push('updatedAt = ?');
    params.push(this._now());
    params.push(id);
    const result = this.db.prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return result.changes > 0;
  }

  // ─── Tasks ────────────────────────────────────────────

  createTask({ planId, title, description, type = 'layer1', action, params, orderIndex, timeout = 300 }) {
    const id = this._generateId('mctask');
    const now = this._now();
    this.db.prepare(`
      INSERT INTO tasks (id, planId, title, description, type, action, params, orderIndex, timeout, status, progressLog, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '[]', ?)
    `).run(id, planId, title, description || null, type, action || null,
      params ? JSON.stringify(params) : null, orderIndex, timeout, now);
    return { id, status: 'pending', createdAt: now };
  }

  getTask(id) {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) || null;
  }

  listTasksByPlan(planId) {
    return this.db.prepare(
      'SELECT * FROM tasks WHERE planId = ? ORDER BY orderIndex ASC'
    ).all(planId);
  }

  updateTask(id, fields) {
    const allowed = ['status', 'output', 'result', 'assignedTo', 'execTaskId', 'startedAt', 'completedAt'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (sets.length === 0) return false;
    params.push(id);
    const result = this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    // Auto-close plan when all tasks reach terminal state
    if (result.changes > 0 && fields.status) {
      const terminal = ['done', 'failed', 'cancelled'];
      if (terminal.includes(fields.status)) {
        const task = this.getTask(id);
        if (task) {
          const tasks = this.listTasksByPlan(task.planId);
          const realTasks = tasks.filter(t => t.action !== 'plan-analyze');
          if (realTasks.length > 0 && realTasks.every(t => terminal.includes(t.status))) {
            const hasDone = realTasks.some(t => t.status === 'done');
            const hasFailed = realTasks.some(t => t.status === 'failed');
            const newStatus = hasDone ? 'done' : hasFailed ? 'failed' : 'cancelled';
            this.updatePlan(task.planId, { status: newStatus, completedAt: this._now() });
          }
        }
      }
    }

    return result.changes > 0;
  }

  appendProgress(id, message) {
    const task = this.getTask(id);
    if (!task) return false;
    const log = JSON.parse(task.progressLog || '[]');
    log.push({ message, timestamp: this._now() });
    this.db.prepare('UPDATE tasks SET progressLog = ? WHERE id = ?')
      .run(JSON.stringify(log), id);
    return true;
  }

  findByExecTaskId(execTaskId) {
    return this.db.prepare(
      'SELECT * FROM tasks WHERE execTaskId = ?'
    ).get(execTaskId) || null;
  }

  // ─── Stats ────────────────────────────────────────────

  getStats(workerRegistry) {
    // Convert local midnight to UTC for DB comparison (createdAt is stored in UTC)
    const localMidnight = new Date(getTodayDate() + 'T00:00:00');
    const todayUtc = localMidnight.toISOString();

    const activePlans = this.db.prepare(
      `SELECT COUNT(*) as count FROM plans WHERE status IN ('pending','planning','active')`
    ).get().count;

    const todayTasks = this.db.prepare(
      `SELECT COUNT(*) as count FROM tasks t
       JOIN plans p ON t.planId = p.id
       WHERE t.createdAt >= ? AND p.status != 'archived'`
    ).get(todayUtc).count;

    const workers = workerRegistry ? workerRegistry.list() : [];

    return { activePlans, todayTasks, workers };
  }

  getTodayTasks() {
    const localMidnight = new Date(getTodayDate() + 'T00:00:00');
    const todayUtc = localMidnight.toISOString();
    return this.db.prepare(
      `SELECT t.*, p.title as planTitle FROM tasks t
       JOIN plans p ON t.planId = p.id
       WHERE t.createdAt >= ? AND p.status != 'archived'
       ORDER BY t.createdAt DESC`
    ).all(todayUtc);
  }

  /**
   * Search plans and tasks by keyword (fuzzy title/description match) with optional layer filter.
   * Returns matching plans with their tasks attached.
   * @param {string} keyword - Search keyword for LIKE matching
   * @param {string} [layer] - Optional layer filter (layer1|layer2|layer3)
   * @returns {Array} Matching plans with tasks
   */
  searchPlans(keyword, layer) {
    const like = `%${keyword}%`;

    // Find plan IDs matching by plan title/description OR by task title/description
    let taskFilter = '';
    const taskParams = [like, like];
    if (layer) {
      taskFilter = ' AND t.type = ?';
      taskParams.push(layer);
    }

    const matchingPlanIds = this.db.prepare(`
      SELECT DISTINCT p.id FROM plans p
      LEFT JOIN tasks t ON t.planId = p.id
      WHERE (p.title LIKE ? OR p.description LIKE ?
        OR (t.title LIKE ? OR t.description LIKE ?)${taskFilter})
        AND p.status != 'archived'
    `).all(like, like, ...taskParams).map(r => r.id);

    if (matchingPlanIds.length === 0) return [];

    // Fetch full plans with tasks
    const placeholders = matchingPlanIds.map(() => '?').join(',');
    const plans = this.db.prepare(
      `SELECT * FROM plans WHERE id IN (${placeholders}) ORDER BY createdAt DESC`
    ).all(...matchingPlanIds);

    for (const plan of plans) {
      let taskSql = 'SELECT * FROM tasks WHERE planId = ?';
      const tParams = [plan.id];
      if (layer) {
        taskSql += ' AND type = ?';
        tParams.push(layer);
      }
      taskSql += ' ORDER BY orderIndex ASC';
      plan.tasks = this.db.prepare(taskSql).all(...tParams);
    }

    return plans;
  }

  // ─── Timeline ─────────────────────────────────────────

  timeline({ from, to, tz = 0 } = {}) {
    if (!from || !to) {
      const today = getNow().toISOString().slice(0, 10);
      to = to || today;
      const d = new Date(to);
      d.setDate(d.getDate() - 6);
      from = from || d.toISOString().slice(0, 10);
    }
    // tz is the client's getTimezoneOffset() in minutes (e.g. -480 for UTC+8)
    // We offset the UTC boundaries so "2/20 local" maps to the correct UTC range
    const offsetMs = tz * 60 * 1000; // positive tz = behind UTC, negative = ahead
    const fromDt = new Date(from + 'T00:00:00.000Z');
    fromDt.setTime(fromDt.getTime() + offsetMs);
    const toDt = new Date(to + 'T23:59:59.999Z');
    toDt.setTime(toDt.getTime() + offsetMs);
    const fromISO = fromDt.toISOString();
    const toISO = toDt.toISOString();

    // Plans completed in range (status = done)
    const completed = this.db.prepare(
      "SELECT * FROM plans WHERE completedAt >= ? AND completedAt <= ? AND status = 'done' ORDER BY completedAt DESC"
    ).all(fromISO, toISO);

    // Plans failed in range
    const failed = this.db.prepare(
      "SELECT * FROM plans WHERE completedAt >= ? AND completedAt <= ? AND status = 'failed' ORDER BY completedAt DESC"
    ).all(fromISO, toISO);

    // Plans cancelled in range
    const cancelled = this.db.prepare(
      "SELECT * FROM plans WHERE completedAt >= ? AND completedAt <= ? AND status = 'cancelled' ORDER BY completedAt DESC"
    ).all(fromISO, toISO);

    // Plans created in range
    const created = this.db.prepare(
      'SELECT * FROM plans WHERE createdAt >= ? AND createdAt <= ? ORDER BY createdAt DESC'
    ).all(fromISO, toISO);

    // Currently active plans
    const active = this.db.prepare(
      "SELECT * FROM plans WHERE status IN ('pending','planning','active') ORDER BY createdAt DESC"
    ).all();

    // Tasks completed in range
    const tasksDone = this.db.prepare(
      'SELECT * FROM tasks WHERE completedAt >= ? AND completedAt <= ? AND status = ? ORDER BY completedAt DESC'
    ).all(fromISO, toISO, 'done');

    // Tasks created in range
    const tasksCreated = this.db.prepare(
      'SELECT * FROM tasks WHERE createdAt >= ? AND createdAt <= ? ORDER BY createdAt DESC'
    ).all(fromISO, toISO);

    // Attach tasks to plans for display
    for (const plan of [...completed, ...failed, ...cancelled, ...created, ...active]) {
      if (!plan.tasks) plan.tasks = this.listTasksByPlan(plan.id);
    }

    return { from, to, completed, failed, cancelled, created, active, tasksDone, tasksCreated };
  }



  // ─── Lifecycle ────────────────────────────────────────

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[MissionControlDB] Closed');
    }
  }
}

module.exports = MissionControlDB;
