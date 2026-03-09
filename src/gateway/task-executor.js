/**
 * TaskExecutor - Heartbeat Tasks + Task Dispatch Engine
 * 
 * Manages Heartbeat scheduled tasks (direct execution, no AI).
 * Also supports Task Dispatch: async task queue via TaskQueue,
 * loads plugin handlers from tasks/ directory.
 * 
 * Retry: transient errors auto-retry (rate_limit/network/server_error),
 * permanent errors fail immediately. Polling timer scans retry-pending every 10s.
 */

const path = require('path');
const fs = require('fs');
const { getNow } = require('../utils/timezone');

// Retry constants
const RETRY_POLL_INTERVAL = 10_000; // 10s
const DEFAULT_RETRY_AFTER_MS = 60_000; // default 60s before retry
const TASK_TIMEOUT_CHECK_INTERVAL = 30_000; // check every 30s

class TaskExecutor {
  /**
   * @param {object} gateway - MessageGateway instance
   * @param {object} config - Configuration object
   * @param {object} [taskQueue] - TaskQueue instance
   * @param {object} [sharedRouter] - Shared AiRouter instance
   */
  constructor(gateway, config, taskQueue, sharedRouter) {
    this.gateway = gateway;
    this.config = config;
    this.executors = new Map();       // heartbeat executors
    this.taskHandlers = new Map();    // task dispatch handlers
    this.taskQueue = taskQueue || null;
    this.sharedRouter = sharedRouter || null;
    this._retryTimer = null;
    this._watchdogTimer = null;
    this.registerBuiltinTasks();
    if (this.taskQueue) {
      this.loadPluginHandlers();
      this.startRetryPolling();
      this.startTaskWatchdog();
    }
  }

  // ─── Heartbeat Methods (unchanged) ─────────────────────────────

  registerBuiltinTasks() {
    this.register('memory-sync', this.executeMemorySync.bind(this));
    this.register('todo-reminder', this.executeTodoReminder.bind(this));
  }

  register(taskName, executor) {
    this.executors.set(taskName, executor);
  }

  async tryExecute(taskName) {
    const executor = this.executors.get(taskName);
    if (!executor) return false;
    try {
      await executor(taskName);
      return true;
    } catch (err) {
      console.error(`[TaskExecutor] ${taskName} failed: ${err.message}`);
      await this.notifyError(taskName, err);
      return true;
    }
  }

  // ─── Task Dispatch Methods ───────────────────────────────────────

  loadPluginHandlers() {
    try {
      const handlers = require('./tasks/index');
      for (const handler of handlers) {
        this.taskHandlers.set(handler.name, handler);
      }
      console.log(`[TaskExecutor] Loaded ${this.taskHandlers.size} task handlers`);
    } catch (err) {
      console.error(`[TaskExecutor] Failed to load plugin handlers: ${err.message}`);
    }
  }

  async submitTask(taskDef) {
    if (!this.taskQueue) throw new Error('TaskQueue not initialized');
    // Validate handler exists before enqueuing (fail fast instead of misleading 'queued' status)
    const action = taskDef.action;
    if (action && !this.taskHandlers.has(action)) {
      throw new Error(`Unknown task action: ${action}. Available: ${[...this.taskHandlers.keys()].join(', ')}`);
    }
    const { taskId, status } = this.taskQueue.enqueue(taskDef);
    const task = this.taskQueue.getTask(taskId);

    if (taskDef.type === 'layer3') {
      // L3: enqueue only, let drainQueue() dispatch when idle worker available
      this.drainQueue();
    } else {
      // L1/L2: execute immediately (original behavior)
      this.executeTask(task).catch(err => {
        console.error(`[TaskExecutor] Task ${taskId} failed: ${err.message}`);
      });
    }
    return { taskId, status };
  }

  /**
   * Drain queued L3 tasks: find idle workers and dispatch one-by-one.
   * Called after: worker markIdle, worker register, submitTask(L3).
   * Only dispatches as many tasks as there are idle workers.
   * If queued tasks remain but no idle workers, triggers WorkerSpawner.
   */
  drainQueue() {
    if (!this.taskQueue) return;
    const registry = this.gateway.workerRegistry;
    if (!registry) return;

    const tasks = this.taskQueue.listTasks(100);
    const queuedL3 = tasks
      .filter(t => t.status === 'queued' && t.type === 'layer3');

    if (queuedL3.length === 0) return;

    // Sort: priority first (high > normal > low), then createdAt ASC (FIFO)
    const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };
    queuedL3.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 1;
      const pb = PRIORITY_ORDER[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return new Date(a.createdAt) - new Date(b.createdAt) || a.taskId.localeCompare(b.taskId);
    });

    let dispatched = 0;
    for (const task of queuedL3) {
      const idle = registry.findIdle();
      if (!idle) break; // no more idle workers, rest stay queued
      dispatched++;
      console.log(`[drainQueue] Dispatching ${task.taskId} (priority: ${task.priority}) → found idle worker`);
      this.executeTask(task).catch(err => {
        console.error(`[drainQueue] ${task.taskId} failed: ${err.message}`);
      });
    }

    // If queued tasks remain but no idle workers, notify owner to open Worker Kiro
    const remaining = queuedL3.length - dispatched;
    if (remaining > 0) {
      console.log(`[drainQueue] ${remaining} queued task(s) waiting, no idle worker — notifying owner`);
      // Notify via WA (debounce: only if not notified recently)
      if (!this._lastNoWorkerNotify || Date.now() - this._lastNoWorkerNotify > 60000) {
        this._lastNoWorkerNotify = Date.now();
        const gateway = this.gateway;
        if (gateway && gateway.sendDirectReply) {
          const ownerChat = this.config.ownerChatId;
          if (ownerChat) {
            gateway.sendDirectReply('whatsapp', ownerChat,
              `⚠️ ${remaining} task(s) queued but no idle Worker available.\nPlease open a Worker Kiro window manually.`
            ).catch(() => {});
          }
        }
      }
    }
  }

  /**
   * Execute a single task with retry support.
   * On transient error: retry-pending → polling picks it up later.
   * On permanent error or max retries: failed.
   */
  async executeTask(task) {
    const startedAt = getNow().toISOString();
    this.taskQueue.updateStatus(task.taskId, 'running', undefined, { startedAt });
    this._syncToMC(task.taskId, 'running', null);
    const handler = this.taskHandlers.get(task.action);
    if (!handler) {
      const unknownErr = new Error(`Unknown action: ${task.action}`);
      this.taskQueue.updateStatus(task.taskId, 'failed', {
        success: false,
        message: unknownErr.message
      });
      this.taskQueue.saveResult(task.taskId);
      this._syncToMC(task.taskId, 'failed', { message: unknownErr.message });
      await this.notifyError(task, unknownErr);
      return;
    }

    try {
      const startTime = getNow().getTime();
      // Build context for handler (shared router + projectDir + workerRegistry + taskId)
      const context = {
        router: this.sharedRouter,
        projectDir: path.join(__dirname, '../..'),
        workerRegistry: this.gateway.workerRegistry || null,
        workerSpawner: this.gateway.workerSpawner || null,
        taskId: task.taskId,
        taskQueue: this.taskQueue,
        taskExecutor: this,
      };
      const result = await handler.execute(task.params, context);
      result.duration = getNow().getTime() - startTime;

      // Layer 3 dispatched tasks stay 'running' until Worker reports back
      if (result.dispatched) {
        task.assignedTo = result.workerId;
        // Persist assignedTo to SQLite so report handler can markIdle correctly
        // (previously only set in-memory, lost on Gateway restart)
        this.taskQueue.updateStatus(task.taskId, 'running', undefined, { assignedTo: result.workerId });
        this.taskQueue.saveResult(task.taskId);
        // Sync assignedTo + running status to MC DB (fix: was missing, causing MC assignedTo=null)
        this._syncToMC(task.taskId, 'running', { workerId: result.workerId });
        await this.notifyCompletion(task, result);
        return; // Don't mark as done yet
      }

      this.taskQueue.updateStatus(task.taskId, 'done', result);
      this.taskQueue.saveResult(task.taskId);
      this._syncToMC(task.taskId, 'done', result);
      // Record worker stats for non-dispatched tasks (Layer 1/2)
      if (task.assignedTo && this.gateway.workerStats) {
        this.gateway.workerStats.recordTaskResult(task.assignedTo, task.taskId, {
          success: true, duration: result.duration || 0,
        });
      }
      await this.notifyCompletion(task, result);
    } catch (err) {
      // Retry logic
      if (this._isTransient(err) && task.retryCount < task.maxRetries) {
        task.retryCount++;
        task.lastError = err.message;
        task.retryAfter = this._getRetryAfter(task.action);
        // Persist retry fields to SQLite (previously only in-memory, lost on restart)
        this.taskQueue.updateStatus(task.taskId, 'retry-pending', undefined, {
          retryCount: task.retryCount,
          retryAfter: task.retryAfter,
          lastError: task.lastError,
        });

        // Worker dispatch retry: record failed worker so next attempt tries a different one
        if (err.failedWorker && task.action === 'worker-dispatch') {
          task.params._excludeWorker = err.failedWorker;
        }

        this.taskQueue.saveResult(task.taskId);
        console.log(`[TaskExecutor] Task ${task.taskId} retry-pending (${task.retryCount}/${task.maxRetries}), retryAfter: ${new Date(task.retryAfter).toLocaleTimeString()}`);
        await this._notifyRetry(task);
      } else {
        this.taskQueue.updateStatus(task.taskId, 'failed', {
          success: false,
          message: err.message
        });
        this.taskQueue.saveResult(task.taskId);
        this._syncToMC(task.taskId, 'failed', { message: err.message });
        // Record worker stats — task failed permanently
        if (task.assignedTo && this.gateway && this.gateway.workerStats) {
          const duration = task.startedAt ? getNow().getTime() - new Date(task.startedAt).getTime() : 0;
          this.gateway.workerStats.recordTaskResult(task.assignedTo, task.taskId, {
            success: false, duration,
          });
        }
        await this.notifyError(task, err);
      }
    }
  }

  // ─── Retry Helpers ───────────────────────────────────────────────

  /**
   * Determine if an error is transient (worth retrying).
   * AiRouterError: check the most severe reason across all candidates.
   * Generic errors: check statusCode.
   */
  _isTransient(err) {
    if (err.name === 'AiRouterError' && Array.isArray(err.errors)) {
      const dominated = this._getMostSevereReason(err.errors);
      // Special case: billing/quota errors are permanent (unfunded account)
      const hasBillingLimit = err.errors.some(
        e => (e.reason === 'rate_limit') && e.message && /billing|exceeded your current quota/i.test(e.message)
      );
      if (hasBillingLimit) return false;
      return ['rate_limit', 'server_error', 'network_error'].includes(dominated);
    }
    const code = err.statusCode || 0;
    if (code === 429) {
      // Check for quota exceeded in message
      if (err.message && err.message.includes('exceeded your current quota')) return false;
      return true;
    }
    if (code >= 500) return true;
    return false;
  }

  /**
   * Get the most severe (lowest severity order) reason from error array.
   */
  _getMostSevereReason(errors) {
    const ORDER = { auth_error: 0, permission_denied: 1, region_blocked: 2, rate_limit: 3, server_error: 4, network_error: 5, not_found: 6, bad_request: 7 };
    let best = null;
    let bestScore = 99;
    for (const e of errors) {
      const score = ORDER[e.reason] ?? 99;
      if (score < bestScore) {
        bestScore = score;
        best = e.reason;
      }
    }
    return best;
  }

  /**
   * Calculate retryAfter timestamp from shared AiRouter cooldown state.
   * Looks at the handler's capability and finds the shortest remaining cooldown.
   */
  _getRetryAfter(action) {
    if (!this.sharedRouter) return Date.now() + DEFAULT_RETRY_AFTER_MS;

    // Map action → capability
    const capMap = { tts: 'tts', 'image-gen': 'image' };
    const capability = capMap[action];
    if (!capability) return Date.now() + DEFAULT_RETRY_AFTER_MS;

    // Query router status for this capability
    const status = this.sharedRouter.getStatus(capability);
    const capStatus = status[capability];
    if (!capStatus) return Date.now() + DEFAULT_RETRY_AFTER_MS;

    // Find shortest remaining cooldown
    let minRemaining = Infinity;
    const now = Date.now();
    for (const entry of capStatus.chain) {
      if (entry.status === 'cooling' && entry.cooldownRemaining > 0) {
        const remaining = entry.cooldownRemaining * 1000; // seconds → ms
        if (remaining < minRemaining) minRemaining = remaining;
      }
    }

    if (minRemaining < Infinity) {
      return now + minRemaining + 2000; // +2s buffer
    }
    return now + DEFAULT_RETRY_AFTER_MS;
  }

  /**
   * Check if all providers for a capability are in cooldown.
   */
  _isCapabilityFullyCooling(action) {
    if (!this.sharedRouter) return false;
    const capMap = { tts: 'tts', 'image-gen': 'image' };
    const capability = capMap[action];
    if (!capability) return false;

    const status = this.sharedRouter.getStatus(capability);
    const capStatus = status[capability];
    if (!capStatus || capStatus.totalCount === 0) return false;
    return capStatus.activeCount === 0;
  }

  // ─── Retry Polling ───────────────────────────────────────────────

  startRetryPolling() {
    if (this._retryTimer) return;
    this._retryTimer = setInterval(() => this._pollRetryTasks(), RETRY_POLL_INTERVAL);
    console.log(`[TaskExecutor] Retry polling started (${RETRY_POLL_INTERVAL / 1000}s interval)`);
  }

  stopRetryPolling() {
    if (this._retryTimer) {
      clearInterval(this._retryTimer);
      this._retryTimer = null;
      console.log(`[TaskExecutor] Retry polling stopped`);
    }
  }

  /**
   * Start Layer 3 running task timeout watchdog.
   * Detects tasks stuck in 'running' state (e.g. worker crash) and marks them failed.
   * Called from constructor; stopped via destroy().
   */
  startTaskWatchdog() {
    if (this._watchdogTimer) return;
    this._watchdogTimer = setInterval(() => this._checkRunningTasks(), TASK_TIMEOUT_CHECK_INTERVAL);
    console.log(`[TaskExecutor] Task watchdog started (${TASK_TIMEOUT_CHECK_INTERVAL / 1000}s interval)`);
  }

  /**
   * Stop the running-task timeout watchdog.
   * Clears the interval timer set by startTaskWatchdog().
   * Called from destroy() during shutdown.
   */
  stopTaskWatchdog() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  /**
   * Watchdog: check if running tasks have timed out.
   * Layer 3 dispatched tasks are reported by Worker; if Worker crashes they stay stuck forever.
   * Re-fetches each task from queue to guard against race conditions.
   * Uses startedAt (when task began running) instead of createdAt for accuracy.
   */
    _checkRunningTasks() {
      if (!this.taskQueue) return;
      const now = Date.now();
      const tasks = this.taskQueue.listTasks(100);
      const runningTasks = tasks.filter(t => t.status === 'running');

      for (const task of runningTasks) {
        // Re-fetch from queue to guard against race condition (task may have completed)
        const fresh = this.taskQueue.getTask(task.taskId);
        if (!fresh || fresh.status !== 'running') continue;

        // Use startedAt for accurate timeout; fall back to createdAt for legacy tasks
        const elapsed = now - new Date(fresh.startedAt || fresh.createdAt).getTime();
        const timeoutMs = (fresh.timeout || 300) * 1000;

        // Skip timeout for worker-dispatch tasks — Workers report back via report_task_result
        if (fresh.action === 'worker-dispatch') {
          continue;
        }

        if (elapsed > timeoutMs) {
          console.log(`[TaskExecutor] ⏰ Task ${fresh.taskId} timed out (${Math.round(elapsed / 1000)}s > ${fresh.timeout}s)`);

          // Mark worker idle if assigned
          if (fresh.assignedTo && this.gateway.workerRegistry) {
            this.gateway.workerRegistry.markIdle(fresh.assignedTo);
            console.log(`[TaskExecutor] Marked ${fresh.assignedTo} idle after timeout`);
            // Reset Worker session (path 4: watchdog timeout)
            this.gateway.workerRegistry.sendCommandToWorker(fresh.assignedTo, 'kiroAgent.newSession').catch(() => {});
            // Worker freed — drain queued L3 tasks
            this.drainQueue();
          }

          // Mark task failed
          const timeoutResult = {
            success: false,
            message: `Task timed out after ${fresh.timeout}s (Worker: ${fresh.assignedTo || 'none'})`,
          };
          this.taskQueue.updateStatus(fresh.taskId, 'failed', timeoutResult);
          this.taskQueue.saveResult(fresh.taskId);
          // Sync to Mission Control so dashboard reflects the timeout
          this._syncToMC(fresh.taskId, 'failed', timeoutResult);
          this.notifyError(fresh, new Error(`Task timed out after ${fresh.timeout}s`)).catch(() => {});
        }
      }
    }


  /**
   * Scan queue for retry-pending tasks ready to re-execute.
   */
  _pollRetryTasks() {
    if (!this.taskQueue) return;
    const now = Date.now();
    const tasks = this.taskQueue.listTasks(100);
    const readyTasks = tasks.filter(
      t => t.status === 'retry-pending' && t.retryAfter && t.retryAfter <= now
    );

    for (const task of readyTasks) {
      // Smart skip: if all providers for this capability are cooling, skip this round
      if (this._isCapabilityFullyCooling(task.action)) {
        // Extend retryAfter by 10s and persist the change
        task.retryAfter = now + RETRY_POLL_INTERVAL;
        const qTask = this.taskQueue.getTask(task.taskId);
        if (qTask) {
          qTask.retryAfter = task.retryAfter;
          this.taskQueue._schedulePersist();
        }
        continue;
      }
      console.log(`[TaskExecutor] Retrying task ${task.taskId} (attempt ${task.retryCount}/${task.maxRetries})`);
      this.executeTask(task).catch(err => {
        console.error(`[TaskExecutor] Retry of ${task.taskId} failed: ${err.message}`);
      });
    }
  }

  // ─── Cancel ──────────────────────────────────────────────────────

  /**
   * Cancel a task. Only queued or retry-pending tasks can be cancelled.
   * @returns {{ success: boolean, message: string }}
   */
  cancelTask(taskId, options = {}) {
    if (!this.taskQueue) return { success: false, message: 'TaskQueue not initialized' };
    const task = this.taskQueue.getTask(taskId);
    if (!task) return { success: false, message: 'Task not found' };
    if (!['queued', 'retry-pending'].includes(task.status)) {
      return { success: false, message: `Cannot cancel task in status: ${task.status}` };
    }
    this.taskQueue.updateStatus(taskId, 'cancelled');
    // completedAt is set by updateStatus() for terminal states (done/failed/cancelled)
    this.taskQueue.saveResult(taskId);
    // Sync to Mission Control so dashboard reflects the cancellation
    this._syncToMC(taskId, 'cancelled', { message: 'Cancelled by user' });
    console.log(`[TaskExecutor] Task ${taskId} cancelled`);

    // Cascade cancel: also cancel queued/retry-pending child tasks
    if (options.cascade !== false) {
      const children = this.taskQueue.findChildTasks(taskId, ['queued', 'retry-pending']);
      for (const child of children) {
        this.taskQueue.updateStatus(child.taskId, 'cancelled');
        this.taskQueue.saveResult(child.taskId);
        this._syncToMC(child.taskId, 'cancelled', { message: `Cascade cancelled (parent: ${taskId})` });
        console.log(`[TaskExecutor] Cascade cancelled child task ${child.taskId}`);
      }
    }

    return { success: true, message: `Task ${taskId} cancelled` };
  }

  // ─── Notifications ───────────────────────────────────────────────

  /**
   * Map action/capability names to user-friendly Chinese labels.
   */
  _friendlyName(name) {
    const map = {
      tts: 'Text-to-Speech (TTS)',
      stt: 'Speech-to-Text (STT)',
      'image-gen': 'Image Generation',
      crawl: 'Web Crawl',
      'pdf-to-md': 'PDF to Markdown',
      summarize: 'Text Summary',
      'code-review': 'Code Review',
      'git-ops': 'Git Operations',
      'worker-dispatch': 'Worker Task Dispatch',
    };
    return map[name] || name;
  }

  async notifyCompletion(task, result) {
    const chatId = this.config.ownerChatId;
    if (!chatId || task.notify === 'silent') return;

    try {
      // worker-dispatch "completion" is just dispatch success, use different wording
      let caption;
      if (task.action === 'worker-dispatch' && result.dispatched) {
        const desc = (task.params && task.params.description) || '';
        const summary = desc.length > 40 ? desc.substring(0, 40) + '...' : desc;
        caption = `📤 Dispatched to ${result.workerId || 'Worker'}${summary ? '\n📝 ' + summary : ''}`;
      } else {
        const worker = task.assignedTo ? ` (${task.assignedTo})` : '';
        caption = `✅ Task complete${worker}: ${this._friendlyName(task.action)}\n💬 ${result.message || ''}`;
      }
      const hasFile = result.outputPath && fs.existsSync(result.outputPath);
      const isMedia = hasFile && /\.(png|jpg|jpeg|gif|ogg|mp3|mp4|pdf)$/i.test(result.outputPath);

      if (isMedia) {
        await this.gateway.sendMedia('whatsapp', chatId, result.outputPath, caption);
      } else {
        const msg = hasFile ? `${caption}\n📁 ${result.outputPath}` : caption;
        await this.gateway.sendDirectReply('whatsapp', chatId, msg);
      }
    } catch (err) {
      console.error(`[TaskExecutor] Notification failed: ${err.message}`);
    }
  }

  async _notifyRetry(task) {
    const chatId = this.config.ownerChatId;
    if (!chatId || task.notify === 'silent') return;

    try {
      const retryTime = task.retryAfter
        ? new Date(task.retryAfter).toLocaleTimeString('en-US')
        : 'soon';
      const msg = `⏳ Task "${this._friendlyName(task.action)}" queued for retry (${task.retryCount}/${task.maxRetries})\n⏱ Estimated retry: ${retryTime}\n💬 ${task.lastError || ''}`;
      await this.gateway.sendDirectReply('whatsapp', chatId, msg);
    } catch (err) {
      console.error(`[TaskExecutor] Retry notification failed: ${err.message}`);
    }
  }

  /**
   * Format a human-readable error summary for WhatsApp notification.
   * Avoids dumping raw JSON error bodies to the user.
   */
  _formatErrorSummary(err) {
    if (err.name === 'AiRouterError' && Array.isArray(err.errors)) {
      // Group by reason
      const reasons = {};
      for (const e of err.errors) {
        // Reclassify: billing errors come as bad_request(400) but are really billing issues
        let key = e.reason || 'unknown';
        if (key === 'bad_request' && e.message && /billing|quota|exceeded.*limit/i.test(e.message)) {
          key = 'billing_limit';
        }
        if (!reasons[key]) reasons[key] = { count: 0, providers: new Set(), code: e.statusCode };
        reasons[key].count++;
        reasons[key].providers.add(e.provider);
      }

      const reasonLabels = {
        rate_limit: 'Rate limit / quota exceeded',
        billing_limit: 'Billing limit reached',
        auth_error: 'Invalid API Key',
        permission_denied: 'Permission denied',
        region_blocked: 'Region blocked / billing not enabled',
        not_found: 'Model or resource not found',
        bad_request: 'Bad request parameters',
        server_error: 'Server error',
        network_error: 'Network error / timeout',
      };

      const providerLabels = {
        openai: 'OpenAI',
        gemini: 'Gemini',
        elevenlabs: 'ElevenLabs',
        stability: 'Stability AI',
        xai: 'xAI',
      };

      const lines = [];
      for (const [reason, info] of Object.entries(reasons)) {
        const providers = [...info.providers].map(p => providerLabels[p] || p).join(', ');
        const label = reasonLabels[reason] || reason;
        const code = info.code ? ` (${info.code})` : '';
        lines.push(`${providers} key(s) ${label}${code}`);
      }
      return lines.join('\n');
    }
    // Generic error: truncate to 200 chars
    const msg = err.message || 'Unknown error';
    return msg.length > 200 ? msg.substring(0, 200) + '...' : msg;
  }

  /**
   * Build a short content preview from task params for notifications.
   * Used by notifyError to provide context about the failed task.
   * @param {object} task - Task object with params property
   * @returns {string} Formatted preview string (empty if no relevant content)
   */
  _contentPreview(task) {
    if (!task || !task.params) return '';
    const p = task.params;
    // TTS → show text
    if (p.text) {
      const t = p.text.length > 50 ? p.text.substring(0, 50) + '...' : p.text;
      return `\n📝 ${t}`;
    }
    // Image → show prompt
    if (p.prompt) {
      const t = p.prompt.length > 50 ? p.prompt.substring(0, 50) + '...' : p.prompt;
      return `\n📝 ${t}`;
    }
    // Crawl → show url
    if (p.url) return `\n🔗 ${p.url}`;
    return '';
  }

  async notifyError(taskOrName, err) {
        // Support both task object and plain string (for heartbeat tasks)
        const isTask = typeof taskOrName === 'object' && taskOrName.action;
        const actionName = isTask ? taskOrName.action : taskOrName;
        const taskId = isTask ? taskOrName.taskId : null;
        const workerId = isTask ? taskOrName.assignedTo : null;
        const workerTag = workerId ? ` (${workerId})` : '';
        const summary = this._formatErrorSummary(err);

        // Always log the error
        console.error(`[TaskExecutor] Task failed: ${actionName}${workerTag}, error: ${summary}${taskId ? `, taskId: ${taskId}` : ''}`);

        // Build content preview for better context in notifications
        const preview = isTask ? this._contentPreview(taskOrName) : '';

        const heartbeatMsg = `Task failed: ${actionName}${workerTag}, error: ${summary}${preview}${taskId ? `, taskId: ${taskId}` : ''}`;

        // Kiro chat notification (pure notification, no handler chain)
        if (this.gateway && this.gateway._notifyCommander) {
          this.gateway._notifyCommander(heartbeatMsg);
        }

        // WA notification (sent simultaneously, not as fallback)
        try {
          const ownerChatId = this.config && this.config.ownerChatId;
          if (ownerChatId && this.gateway && this.gateway.sendDirectReply) {
            const waMsg = `⚠️ ${heartbeatMsg}`;
            await this.gateway.sendDirectReply('whatsapp', ownerChatId, waMsg);
          } else if (!ownerChatId) {
            console.warn(`[TaskExecutor] WA notify skipped: OWNER_CHAT_ID not configured`);
          }
        } catch (waErr) {
          console.error(`[TaskExecutor] WA notify failed: ${waErr.message}`);
        }
      }




  // ─── Heartbeat Task Implementations ──────────────────────────────

  async executeMemorySync() {
    if (!this.config.memoryRepo) {
      console.log(`[TaskExecutor] Memory sync skipped: MEMORY_REPO not configured`);
      return;
    }
    await this.truncateDailyLogs();
    const { backup } = require('../memory-backup');
    const result = await backup();
    if (result.success) {
      console.log(`[TaskExecutor] Memory sync complete: ${result.reason}`);
    } else {
      throw new Error(`Backup failed: ${result.reason} ${result.error || ''}`);
    }
  }

  async truncateDailyLogs() {
    const memoryDir = path.join(__dirname, '../../../.kiro/steering/memory');
    const MAX_LINES = 150;

    try {
      if (!fs.existsSync(memoryDir)) return;
      const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));

      for (const file of files) {
        const filePath = path.join(memoryDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        let frontmatterEnd = 0;
        if (lines[0] && lines[0].trim() === '---') {
          for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
              frontmatterEnd = i + 1;
              break;
            }
          }
        }

        const contentLines = lines.slice(frontmatterEnd);
        if (contentLines.length <= MAX_LINES) continue;

        const frontmatter = lines.slice(0, frontmatterEnd).join('\n');
        const truncatedContent = contentLines.slice(0, MAX_LINES).join('\n') +
          `\n\n---\n> Truncated (${contentLines.length} lines → ${MAX_LINES} lines). Full conversation available via recall L3 query\n`;

        const result = frontmatterEnd > 0
          ? frontmatter + '\n' + truncatedContent
          : truncatedContent;
        fs.writeFileSync(filePath, result, 'utf-8');
        console.log(`[TaskExecutor] Log truncated: ${file} (${contentLines.length} → ${MAX_LINES} lines)`);
      }
    } catch (err) {
      console.error(`[TaskExecutor] Log truncation failed: ${err.message}`);
    }
  }

  async executeTodoReminder() {
    const { getNow } = require('../utils/timezone');
    const now = getNow();
    const hour = parseInt(
      now.toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: 'numeric', hour12: false })
    );
    if (hour < 11 || hour >= 18) {
      console.log(`[TaskExecutor] Not work hours (${hour}:00), skipping todo reminder`);
      return;
    }

    const { JournalManager } = require('../memory/journal-manager');
    const journalsPath = path.join(__dirname, '../../memory/journals');
    const jm = new JournalManager(journalsPath);
    const pendingTodos = jm.getPendingTodos();

    if (pendingTodos.length === 0) {
      console.log(`[TaskExecutor] No pending todos, skipping`);
      return;
    }

    const todoList = pendingTodos.map((t) => {
      const dateTag = t._date ? ` (${t._date})` : '';
      return `• ${t.content}${dateTag}`;
    }).join('\n');
    const reminder = `📋 Todo reminder (${pendingTodos.length} items):\n${todoList}`;

    const chatId = this.config.ownerChatId;
    if (!chatId) {
      console.log(`[TaskExecutor] Todo reminder skipped: OWNER_CHAT_ID not configured`);
      return;
    }
    await this.gateway.sendDirectReply('whatsapp', chatId, reminder);
    console.log(`[TaskExecutor] Sent ${pendingTodos.length} todo reminder(s)`);
  }

  /**
   * Cleanup: stop polling timer.
   */
  // ─── Mission Control Sync ─────────────────────────────

  /**
   * Sync task status to Mission Control DB + broadcast WS event
   */
  _syncToMC(execTaskId, status, result) {
    if (!this.mcDB) return;
    try {
      const mcTask = this.mcDB.findByExecTaskId(execTaskId);
      if (!mcTask) return;

      const output = (result && result.message) || '';
      const fields = { status, output };
      if (result) fields.result = JSON.stringify(result);
      // Sync assignedTo when available (fix: MC task assignedTo was always null)
      if (result && result.workerId) {
        fields.assignedTo = result.workerId;
      }
      if (status === 'done' || status === 'failed' || status === 'cancelled') {
        fields.completedAt = getNow().toISOString();
      }
      if (status === 'running') {
        fields.startedAt = getNow().toISOString();
      }
      this.mcDB.updateTask(mcTask.id, fields);

      if (this.gateway && this.gateway.broadcast) {
        this.gateway.broadcast({
          type: 'mc:task_status',
          data: { taskId: mcTask.id, planId: mcTask.planId, status, output, workerId: (result && result.workerId) || undefined },
        });
      }

      if (status === 'done' || status === 'failed' || status === 'cancelled') {
        this._checkPlanCompletion(mcTask.planId);
      }
    } catch (err) {
      console.error(`[TaskExecutor] MC sync error: ${err.message}`);
    }
  }

  /**
   * Check if all tasks in a plan are done/failed → auto-update plan status
   */
  _checkPlanCompletion(planId) {
    if (!this.mcDB) return;
    try {
      // Guard: skip if plan is already in terminal state (issue-b08 fix)
      const plan = this.mcDB.getPlan(planId);
      if (!plan || ['done', 'failed', 'cancelled'].includes(plan.status)) return;

      const allTasks = this.mcDB.listTasksByPlan(planId);
      // Filter out plan-analyze meta-tasks (same as mission-control-db.js auto-close logic)
      const tasks = allTasks.filter(t => t.action !== 'plan-analyze');
      if (tasks.length === 0) return;

      const allDone = tasks.every(t => t.status === 'done');
      const allTerminal = tasks.every(t => ['done', 'failed', 'cancelled'].includes(t.status));
      const anyFailed = tasks.some(t => t.status === 'failed');
      const anyActive = tasks.some(t => ['running', 'queued', 'pending', 'retry-pending'].includes(t.status));

      let newStatus = null;
      if (allDone) {
        newStatus = 'done';
      } else if (allTerminal && !anyActive) {
        // All tasks finished but some failed or were cancelled
        const anyDone = tasks.some(t => t.status === 'done');
        newStatus = anyDone ? 'done' : anyFailed ? 'failed' : 'cancelled';
      }

      if (newStatus) {
        this.mcDB.updatePlan(planId, { status: newStatus, completedAt: getNow().toISOString() });
        if (this.gateway && this.gateway.broadcast) {
          this.gateway.broadcast({
            type: 'mc:plan_updated',
            data: { planId, status: newStatus },
          });
        }
      }
    } catch (err) {
      console.error(`[TaskExecutor] Plan completion check error: ${err.message}`);
    }
  }

  /**
   * Sync progress to MC DB + broadcast
   */
  _syncProgressToMC(execTaskId, message) {
    if (!this.mcDB) return;
    try {
      const mcTask = this.mcDB.findByExecTaskId(execTaskId);
      if (!mcTask) return;
      this.mcDB.appendProgress(mcTask.id, message);
      if (this.gateway && this.gateway.broadcast) {
        this.gateway.broadcast({
          type: 'mc:task_output',
          data: { taskId: mcTask.id, message, timestamp: getNow().toISOString() },
        });
      }
    } catch (err) {
      // silent
    }
  }

  destroy() {
    this.stopRetryPolling();
    this.stopTaskWatchdog();
  }

}

module.exports = TaskExecutor;
