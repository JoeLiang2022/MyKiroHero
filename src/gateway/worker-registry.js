/**
 * WorkerRegistry — Worker Kiro 註冊與管理
 * 
 * 管理 Worker Kiro instances 的生命週期：
 * - 註冊：Worker MCP server 啟動時 POST /api/worker/register
 * - 狀態：idle / busy / offline
 * - 心跳：定期 ping Worker 確認存活
 * - Round-robin：輪流分配任務
 */

const http = require('http');

const HEALTH_CHECK_INTERVAL = 30000; // 30s
const WORKER_TIMEOUT = 90000; // 90s no heartbeat → offline

class WorkerRegistry {
  constructor() {
    this.workers = new Map(); // workerId → { port, status, lastSeen, currentTaskId }
    this._lastAssigned = null; // round-robin tracking
    this._healthTimer = null;
    this._onRegister = null; // callback: (workerId, port, isNew) => void
    this._onChange = null;   // callback: (workerId, status, currentTaskId) => void
  }

  /**
   * 啟動定期健康檢查
   */
  startHealthCheck() {
    if (this._healthTimer) return;
    this._healthTimer = setInterval(() => this._checkAllWorkers(), HEALTH_CHECK_INTERVAL);
    console.log(`[WorkerRegistry] Health check started (every ${HEALTH_CHECK_INTERVAL / 1000}s)`);
  }

  /**
   * 停止健康檢查
   */
  stopHealthCheck() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }

  /**
   * 檢查所有 Worker 健康狀態
   */
  async _checkAllWorkers() {
    for (const [workerId, info] of this.workers) {
      if (info.status === 'offline') {
        // 嘗試恢復 offline worker
        const alive = await this._ping(info.port);
        if (alive) {
          info.status = 'idle';
          info.lastSeen = Date.now();
          console.log(`[WorkerRegistry] ${workerId} recovered → idle`);
          this._fireChange(workerId);
        }
        continue;
      }
      // Check lastSeen timeout
      if (Date.now() - info.lastSeen > WORKER_TIMEOUT) {
        const alive = await this._ping(info.port);
        if (!alive) {
          const wasBusy = info.status === 'busy';
          info.status = 'offline';
          console.log(`[WorkerRegistry] ${workerId} → offline (no heartbeat for ${WORKER_TIMEOUT / 1000}s)`);
          this._fireChange(workerId);
          if (wasBusy && info.currentTaskId) {
            console.log(`[WorkerRegistry] ⚠️ ${workerId} was busy with ${info.currentTaskId}`);
          }
        } else {
          info.lastSeen = Date.now();
        }
      }
    }
  }

  /**
   * Ping Worker Kiro REST port
   * @returns {Promise<boolean>}
   */
  _ping(port) {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        timeout: 3000,
      }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  /**
   * 設定 Worker 註冊回調
   * @param {(workerId: string, port: number, isNew: boolean) => void} callback
   */
  onRegister(callback) {
    this._onRegister = callback;
  }

  /**
   * 設定狀態變更回調（用於 MC WebSocket broadcast）
   * @param {(workerId: string, status: string, currentTaskId: string|null) => void} callback
   */
  onChange(callback) {
    this._onChange = callback;
  }

  /**
   * 觸發 onChange callback（內部用）
   */
  _fireChange(workerId) {
    if (!this._onChange) return;
    const w = this.workers.get(workerId);
    if (!w) return;
    try {
      this._onChange(workerId, w.status, w.currentTaskId);
    } catch (e) {
      console.error(`[WorkerRegistry] onChange callback error: ${e.message}`);
    }
  }

  /**
   * 註冊或更新 Worker
   */
  register(workerId, port) {
    const existing = this.workers.get(workerId);
    let isNew = false;
    if (existing) {
      existing.port = port;
      existing.lastSeen = Date.now();
      if (existing.status === 'offline') {
        existing.status = 'idle';
        isNew = true; // recovered from offline counts as "new"
        console.log(`[WorkerRegistry] ${workerId} re-registered → idle (port ${port})`);
        this._fireChange(workerId);
      } else {
        console.log(`[WorkerRegistry] Updated: ${workerId} → port ${port}`);
      }
    } else {
      isNew = true;
      this.workers.set(workerId, {
        port,
        status: 'idle',
        lastSeen: Date.now(),
        currentTaskId: null,
      });
      console.log(`[WorkerRegistry] Registered: ${workerId} → port ${port}`);
      this._fireChange(workerId);
    }
    // Auto-start health check when first worker registers
    if (!this._healthTimer && this.workers.size > 0) {
      this.startHealthCheck();
    }
    // Fire registration callback
    if (isNew && this._onRegister) {
      try { this._onRegister(workerId, port, isNew); } catch (e) {
        console.error(`[WorkerRegistry] onRegister callback error: ${e.message}`);
      }
    }
  }

  /**
   * Worker 主動下線（graceful shutdown）
   */
  unregister(workerId) {
    const w = this.workers.get(workerId);
    if (!w) return false;
    w.status = 'offline';
    console.log(`[WorkerRegistry] ${workerId} unregistered (graceful shutdown)`);
    this._fireChange(workerId);
    return true;
  }

  /**
   * 快速刷新所有非 offline workers 的狀態（ping 確認存活）
   * 用於 stats API 即時回報
   */
  async refreshStatus() {
    const checks = [];
    for (const [workerId, info] of this.workers) {
      if (info.status === 'offline') continue;
      checks.push(
        this._ping(info.port).then(alive => {
          if (!alive && info.status !== 'offline') {
            info.status = 'offline';
            console.log(`[WorkerRegistry] ${workerId} → offline (refreshStatus ping failed)`);
            this._fireChange(workerId);
          } else if (alive) {
            info.lastSeen = Date.now();
          }
        })
      );
    }
    await Promise.all(checks);
  }

  /**
   * 找一個 idle Worker（round-robin）
   * @returns {{ workerId: string, port: number } | null}
   */
  findIdle() {
    const now = Date.now();
    const entries = Array.from(this.workers.entries())
      .filter(([, info]) => info.status === 'idle' && !(info._resetUntil && now < info._resetUntil));
    if (entries.length === 0) return null;

    // Round-robin: find next after _lastAssigned
    let startIdx = 0;
    if (this._lastAssigned) {
      const lastIdx = entries.findIndex(([id]) => id === this._lastAssigned);
      if (lastIdx >= 0) {
        startIdx = (lastIdx + 1) % entries.length;
      }
    }

    const [workerId, info] = entries[startIdx];
    this._lastAssigned = workerId;
    return { workerId, port: info.port };
  }

  /**
   * 找一個 idle Worker，排除指定的 Worker（用於 retry 換 Worker）
   * @param {string} excludeWorkerId
   * @returns {{ workerId: string, port: number } | null}
   */
  findIdleExcluding(excludeWorkerId) {
    const now = Date.now();
    const entries = Array.from(this.workers.entries())
      .filter(([id, info]) => info.status === 'idle' && id !== excludeWorkerId && !(info._resetUntil && now < info._resetUntil));
    if (entries.length === 0) return null;

    // Round-robin: find next after _lastAssigned
    let startIdx = 0;
    if (this._lastAssigned) {
      const lastIdx = entries.findIndex(([id]) => id === this._lastAssigned);
      if (lastIdx >= 0) {
        startIdx = (lastIdx + 1) % entries.length;
      }
    }

    const [workerId, info] = entries[startIdx];
    this._lastAssigned = workerId;
    return { workerId, port: info.port };
  }

  markBusy(workerId, taskId) {
    const w = this.workers.get(workerId);
    if (!w) return false;
    // Defense-in-depth: respect reset cooldown even if findIdle was bypassed
    if (w._resetUntil && Date.now() < w._resetUntil) {
      console.log(`[WorkerRegistry] ${workerId} in reset cooldown, rejecting markBusy for ${taskId}`);
      return false;
    }
    w.status = 'busy';
    w.currentTaskId = taskId;
    this._fireChange(workerId);
    return true;
  }

  markIdle(workerId, { forceReset = false } = {}) {
    const w = this.workers.get(workerId);
    if (w) {
      w.status = 'idle';
      w.currentTaskId = null;
      w.lastSeen = Date.now();
      if (forceReset) {
        w._resetUntil = Date.now() + 5000;
        console.log(`[WorkerRegistry] ${workerId} force-reset, cooldown until ${new Date(w._resetUntil).toLocaleTimeString()}`);
      }
      this._fireChange(workerId);
    }
  }

  /**
   * 更新 Worker 心跳（每次 MCP call 時自動觸發）
   * Gracefully handles non-existent worker IDs (e.g. disconnected workers).
   */
  heartbeat(workerId) {
    const w = this.workers.get(workerId);
    if (w) {
      w.lastSeen = Date.now();
    } else {
      console.log(`[WorkerRegistry] heartbeat for unknown worker: ${workerId} (may have disconnected)`);
    }
  }

  list() {
    const result = [];
    for (const [workerId, info] of this.workers) {
      result.push({ workerId, ...info });
    }
    return result;
  }

  /**
   * 取得特定 Worker 正在執行的 taskId
   */
  getTaskId(workerId) {
    const w = this.workers.get(workerId);
    return w ? w.currentTaskId : null;
  }

  /**
   * 送 command 到 Worker Kiro（例如 newSession）
   * Fire-and-forget，失敗只 log 不 throw
   */
  async sendCommandToWorker(workerId, command) {
    const w = this.workers.get(workerId);
    if (!w) {
      console.log(`[WorkerRegistry] sendCommand: worker ${workerId} not found, skipping`);
      return;
    }

    return new Promise((resolve) => {
      const url = `/?command=${encodeURIComponent(command)}`;
      const req = http.request({
        hostname: '127.0.0.1',
        port: w.port,
        path: url,
        method: 'GET',
        timeout: 5000,
      }, (res) => {
        res.resume();
        console.log(`[WorkerRegistry] Sent ${command} to ${workerId}`);
        resolve(true);
      });
      req.on('error', (err) => {
        console.log(`[WorkerRegistry] Failed to send ${command} to ${workerId}: ${err.message}`);
        resolve(false);
      });
      req.on('timeout', () => {
        req.destroy();
        console.log(`[WorkerRegistry] Timeout sending ${command} to ${workerId}`);
        resolve(false);
      });
      req.end();
    });
  }

  /**
   * 送訊息到 Worker Kiro chat
   */
  async sendToWorker(workerId, message) {
    const w = this.workers.get(workerId);
    if (!w) throw new Error(`Worker not found: ${workerId}`);

    return new Promise((resolve, reject) => {
      const jsonStr = JSON.stringify([message]);
      // vscode-rest-control does double decodeURIComponent,
      // so pre-encode % → %25 to survive the double decode
      const args = encodeURIComponent(jsonStr).replace(/%25/g, '%2525');
      const url = `/?command=kiroAgent.sendMainUserInput&args=${args}`;

      const options = {
        hostname: '127.0.0.1',
        port: w.port,
        path: url,
        method: 'GET',
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Worker ${workerId} timeout`));
      });

      req.end();
    });
  }


  destroy() {
    this.stopHealthCheck();
  }
}

module.exports = WorkerRegistry;
