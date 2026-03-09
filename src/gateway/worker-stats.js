'use strict';

const fs = require('fs');
const path = require('path');
const { getNowISO } = require('../utils/timezone');

const DATA_FILE = path.join(__dirname, '../../data/worker-stats.json');
const MAX_RECENT_TASKS = 20;
const SAVE_DEBOUNCE_MS = 200;

/**
 * Worker performance tracking module.
 * Records task results per worker and provides statistics.
 */
class WorkerStats {
  constructor(filePath = DATA_FILE) {
    this.filePath = filePath;
    this.stats = {};
    this._saveTimer = null;
    this._load();
  }

  /** Load stats from disk. */
  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.stats = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch (err) {
      console.error(`[WorkerStats] Failed to load: ${err.message}`);
      this.stats = {};
    }
  }

  /** Persist stats to disk. */
  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.stats, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[WorkerStats] Failed to save: ${err.message}`);
    }
  }

  /**
   * Record a task result for a worker.
   * @param {string} workerId - Worker identifier
   * @param {string} taskId - Task identifier
   * @param {{ success: boolean, duration?: number, reviewPassed?: boolean }} result
   */
  recordTaskResult(workerId, taskId, { success, duration = 0, reviewPassed = null }) {
    if (!workerId) return;

    if (!this.stats[workerId]) {
      this.stats[workerId] = {
        workerId,
        totalTasks: 0,
        successCount: 0,
        failCount: 0,
        totalDuration: 0,
        avgDuration: 0,
        reviewPassCount: 0,
        reviewTotalCount: 0,
        reviewPassRate: 0,
        lastTaskAt: null,
        recentTasks: [],
      };
    }

    const ws = this.stats[workerId];
    ws.totalTasks++;
    if (success) {
      ws.successCount++;
    } else {
      ws.failCount++;
    }

    ws.totalDuration += duration;
    ws.avgDuration = Math.round(ws.totalDuration / ws.totalTasks);

    if (reviewPassed !== null && reviewPassed !== undefined) {
      ws.reviewTotalCount++;
      if (reviewPassed) ws.reviewPassCount++;
      ws.reviewPassRate = ws.reviewTotalCount > 0
        ? parseFloat((ws.reviewPassCount / ws.reviewTotalCount).toFixed(2))
        : 0;
    }

    const timestamp = getNowISO();
    ws.lastTaskAt = timestamp;

    ws.recentTasks.push({ taskId, success, duration, reviewPassed, timestamp });
    if (ws.recentTasks.length > MAX_RECENT_TASKS) {
      ws.recentTasks = ws.recentTasks.slice(-MAX_RECENT_TASKS);
    }

    this._scheduleSave();
  }

  /**
   * Debounced save — coalesces rapid updates into one write.
   */
  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Flush pending save and cleanup timer. Call during graceful shutdown.
   */
  destroy() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._save();
  }

  /**
   * Get stats for a specific worker.
   * @param {string} workerId
   * @returns {object|null}
   */
  getWorkerStats(workerId) {
    return this.stats[workerId] || null;
  }

  /**
   * Get stats for all workers.
   * @returns {object}
   */
  getAllStats() {
    return this.stats;
  }

  /**
   * Get the worker with the highest success rate (min 1 task).
   * @returns {string|null} workerId or null if no data
   */
  getBestWorker() {
    let best = null;
    let bestRate = -1;
    for (const [id, ws] of Object.entries(this.stats)) {
      if (ws.totalTasks === 0) continue;
      const rate = ws.successCount / ws.totalTasks;
      if (rate > bestRate) {
        bestRate = rate;
        best = id;
      }
    }
    return best;
  }
}

module.exports = WorkerStats;
