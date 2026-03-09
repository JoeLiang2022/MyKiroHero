/**
 * PushQueueManager — Per-repo git push lock queue
 *
 * Prevents multiple Workers from pushing to the same git remote simultaneously,
 * which crashes Git for Windows. Uses a per-repo FIFO queue with auto-timeout.
 */

const AUTO_TIMEOUT_MS = 60000; // 60s

class PushQueueManager {
  /**
   * @param {object} [options]
   * @param {import('./worker-registry')} [options.workerRegistry] - for sendToWorker notifications
   * @param {number} [options.autoTimeoutMs] - override default 60s timeout
   */
  constructor(options = {}) {
    /** @type {Map<string, { currentHolder: string|null, queue: string[], grantedAt: number|null, timer: NodeJS.Timeout|null }>} */
    this.repos = new Map();
    this.workerRegistry = options.workerRegistry || null;
    this.autoTimeoutMs = options.autoTimeoutMs || AUTO_TIMEOUT_MS;
  }

  /**
   * Get or create repo queue entry
   * @param {string} repoPath
   * @returns {{ currentHolder: string|null, queue: string[], grantedAt: number|null, timer: NodeJS.Timeout|null }}
   */
  _getRepo(repoPath) {
    if (!this.repos.has(repoPath)) {
      this.repos.set(repoPath, { currentHolder: null, queue: [], grantedAt: null, timer: null });
    }
    return this.repos.get(repoPath);
  }

  /**
   * Request a push lock for a repo
   * @param {string} workerId
   * @param {string} repoPath
   * @returns {{ granted: boolean, position: number }}
   */
  requestLock(workerId, repoPath) {
    const repo = this._getRepo(repoPath);

    // Already holding the lock
    if (repo.currentHolder === workerId) {
      return { granted: true, position: 0 };
    }

    // No one holds the lock — grant immediately
    if (!repo.currentHolder) {
      repo.currentHolder = workerId;
      repo.grantedAt = Date.now();
      this._startAutoTimeout(repoPath);
      return { granted: true, position: 0 };
    }

    // Already in queue — return current position
    const idx = repo.queue.indexOf(workerId);
    if (idx >= 0) {
      return { granted: false, position: idx + 1 };
    }

    // Add to queue
    repo.queue.push(workerId);
    return { granted: false, position: repo.queue.length };
  }

  /**
   * Release a push lock and notify next in queue
   * @param {string} workerId
   * @param {string} repoPath
   * @returns {{ released: boolean, nextHolder: string|null }}
   */
  releaseLock(workerId, repoPath) {
    const repo = this.repos.get(repoPath);
    if (!repo) return { released: false, nextHolder: null };

    // Only the current holder can release
    if (repo.currentHolder !== workerId) {
      // Remove from queue if they were waiting
      const idx = repo.queue.indexOf(workerId);
      if (idx >= 0) repo.queue.splice(idx, 1);
      return { released: false, nextHolder: null };
    }

    this._clearAutoTimeout(repo);
    return this._grantNext(repoPath, repo);
  }

  /**
   * Grant lock to next worker in queue (internal)
   * @param {string} repoPath
   * @param {object} repo
   * @returns {{ released: boolean, nextHolder: string|null }}
   */
  _grantNext(repoPath, repo) {
    const next = repo.queue.shift() || null;
    repo.currentHolder = next;
    repo.grantedAt = next ? Date.now() : null;

    if (next) {
      this._startAutoTimeout(repoPath);
      this._notifyWorker(next, repoPath);
    }

    // Clean up empty repo entries
    if (!repo.currentHolder && repo.queue.length === 0) {
      this.repos.delete(repoPath);
    }

    return { released: true, nextHolder: next };
  }

  /**
   * Get current queue status for a repo
   * @param {string} repoPath
   * @returns {{ currentHolder: string|null, queue: string[], grantedAt: number|null }}
   */
  getQueueStatus(repoPath) {
    const repo = this.repos.get(repoPath);
    if (!repo) return { currentHolder: null, queue: [], grantedAt: null };
    return {
      currentHolder: repo.currentHolder,
      queue: [...repo.queue],
      grantedAt: repo.grantedAt,
    };
  }

  /**
   * Start auto-timeout timer for current lock holder
   * @param {string} repoPath
   */
  _startAutoTimeout(repoPath) {
    const repo = this.repos.get(repoPath);
    if (!repo) return;
    this._clearAutoTimeout(repo);

    repo.timer = setTimeout(() => {
      const r = this.repos.get(repoPath);
      if (!r || !r.currentHolder) return;
      const timedOutWorker = r.currentHolder;
      console.log(`[PushQueue] Auto-timeout: ${timedOutWorker} held lock on ${repoPath} for ${this.autoTimeoutMs / 1000}s, releasing`);
      this._grantNext(repoPath, r);
    }, this.autoTimeoutMs);
  }

  /**
   * Clear auto-timeout timer
   * @param {object} repo
   */
  _clearAutoTimeout(repo) {
    if (repo.timer) {
      clearTimeout(repo.timer);
      repo.timer = null;
    }
  }

  /**
   * Notify a worker that it's their turn to push
   * @param {string} workerId
   * @param {string} repoPath
   */
  async _notifyWorker(workerId, repoPath) {
    if (!this.workerRegistry) return;
    const message = `[Push Queue] Your turn to push. Run: git pull --rebase origin main && git push origin <your-branch>`;
    try {
      await this.workerRegistry.sendToWorker(workerId, message);
      console.log(`[PushQueue] Notified ${workerId} — lock granted for ${repoPath}`);
    } catch (err) {
      console.error(`[PushQueue] Failed to notify ${workerId}: ${err.message}`);
    }
  }

  /**
   * Clean up all timers
   */
  destroy() {
    for (const [, repo] of this.repos) {
      this._clearAutoTimeout(repo);
    }
    this.repos.clear();
  }
}

module.exports = PushQueueManager;
