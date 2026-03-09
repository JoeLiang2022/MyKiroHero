/**
 * Mission Control REST API Routes
 * 
 * 掛載到 /api/mc，提供 plans + tasks CRUD
 * 橋接 TaskExecutor 執行 plan tasks
 */

const express = require('express');
const path = require('path');
const { listTemplates, getTemplate } = require('./task-templates');
const { getNow } = require('../utils/timezone');

function createRoutes(mcDB, taskExecutor, gateway) {
  const router = express.Router();

  // ─── Templates ──────────────────────────────────────

  router.get('/templates', (req, res) => {
    res.json(listTemplates());
  });

  // ─── Projects ───────────────────────────────────────

  router.get('/projects', (req, res) => {
    try {
      const projects = mcDB.listProjects();
      // Attach plan counts per project
      const enriched = projects.map(p => {
        const plans = mcDB.listPlans({ projectId: p.id });
        const active = plans.filter(pl => ['pending', 'planning', 'active'].includes(pl.status)).length;
        return { ...p, planCount: plans.length, activePlanCount: active };
      });
      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/projects', (req, res) => {
    try {
      const { id, name, description } = req.body;
      if (!id || !name) return res.status(400).json({ error: 'Missing required fields: id, name' });
      // Validate id format (lowercase, alphanumeric + dashes)
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        return res.status(400).json({ error: 'Project id must be lowercase alphanumeric with dashes' });
      }
      const existing = mcDB.getProject(id);
      if (existing) return res.status(409).json({ error: 'Project already exists' });
      const project = mcDB.createProject({ id, name, description });
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/projects/:id', (req, res) => {
    try {
      const project = mcDB.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const updated = mcDB.updateProject(req.params.id, req.body);
      if (!updated) return res.status(400).json({ error: 'No valid fields to update' });
      res.json(mcDB.getProject(req.params.id));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/projects/:id', (req, res) => {
    try {
      if (req.params.id === 'default') {
        return res.status(400).json({ error: 'Cannot delete default project' });
      }
      const project = mcDB.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const deleted = mcDB.deleteProject(req.params.id);
      if (!deleted) return res.status(409).json({ error: 'Project has active plans, archive them first' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── AI Analyze (dispatch to Worker for analysis) ───

  router.post('/plans/analyze', async (req, res) => {
    try {
      const { requirement, source } = req.body;
      if (!requirement || typeof requirement !== 'string' || !requirement.trim()) {
        return res.status(400).json({ error: 'Missing required field: requirement' });
      }

      // 1. Create plan with 'planning' status
      const plan = mcDB.createPlan({
        title: requirement.trim().substring(0, 100),
        description: requirement.trim(),
        source: source || 'dashboard',
      });
      mcDB.updatePlan(plan.id, { status: 'planning' });

      const fullPlan = mcDB.getPlan(plan.id);
      gateway.broadcast({ type: 'mc:plan_created', data: { plan: fullPlan } });

      // 2. Dispatch analysis task to Worker
      try {
        const { taskId: execTaskId } = await taskExecutor.submitTask({
          type: 'layer3',
          action: 'worker-dispatch',
          params: {
            description: [
              `[PLAN-ANALYZE] planId: ${plan.id}`,
              '',
              '用戶需求：',
              requirement.trim(),
              '',
              '---',
              '請分析這個需求，然後呼叫 mc MCP tool（action: "set-analysis"）回報結果。',
              '參數：',
              '  - action: "set-analysis"',
              '  - planId: ' + plan.id,
              '  - strategy: 你的策略分析（繁體中文，2-5 句話）',
              '  - tasks: 拆解後的子任務陣列，每個 task 要有 title 和 description',
              '',
              '範例：',
              'mc({',
              '  action: "set-analysis",',
              '  planId: "' + plan.id + '",',
              '  strategy: "先建立 DB schema，再寫 API，最後做前端...",',
              '  tasks: [',
              '    { title: "建立 DB", description: "建立 SQLite schema" },',
              '    { title: "寫 REST API", description: "實作 CRUD endpoints" }',
              '  ]',
              '})',
              '',
              '分析完就好，不需要執行任何 task。',
            ].join('\n'),
          },
          timeout: 120,
          notify: 'silent',
        });

        // Link the exec task to the plan for tracking
        const analyzeTask = mcDB.createTask({
          planId: plan.id,
          title: 'AI 需求分析',
          description: '分析用戶需求，產生策略和子任務',
          type: 'layer3',
          action: 'plan-analyze',
          orderIndex: -1, // special: analysis task, not a real task
          timeout: 120,
        });
        mcDB.updateTask(analyzeTask.id, { status: 'running', execTaskId });

        res.json(mcDB.getPlan(plan.id));
      } catch (dispatchErr) {
        // No Worker available — fall back to pending, user can manually add tasks
        mcDB.updatePlan(plan.id, {
          strategy: '⚠️ 目前沒有可用的 Worker 進行 AI 分析。你可以手動新增 tasks。',
          status: 'pending',
        });
        const fallbackPlan = mcDB.getPlan(plan.id);
        gateway.broadcast({ type: 'mc:plan_updated', data: { planId: plan.id, plan: fallbackPlan } });
        res.json(fallbackPlan);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Plan Analysis Result (Worker writes back) ──────

  router.patch('/plans/:id/analysis', (req, res) => {
    try {
      const plan = mcDB.getPlan(req.params.id);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      const { strategy, tasks } = req.body;

      // Update strategy
      if (strategy) {
        mcDB.updatePlan(req.params.id, { strategy });
      }

      // Create tasks from AI analysis
      if (Array.isArray(tasks)) {
        tasks.forEach((t, i) => {
          if (!t.title || typeof t.title !== 'string') return;
          mcDB.createTask({
            planId: req.params.id,
            title: t.title.substring(0, 200),
            description: typeof t.description === 'string' ? t.description : undefined,
            type: t.type || 'layer3',
            action: t.action || 'worker-dispatch',
            params: t.params,
            orderIndex: i,
            timeout: t.timeout || 300,
          });
        });
      }

      // Remove the analysis task (orderIndex -1) and set plan to pending
      const allTasks = mcDB.listTasksByPlan(req.params.id);
      const analyzeTask = allTasks.find(t => t.orderIndex === -1 || t.action === 'plan-analyze');
      if (analyzeTask) {
        mcDB.updateTask(analyzeTask.id, { status: 'done', output: 'Analysis complete', completedAt: getNow().toISOString() });
      }

      mcDB.updatePlan(req.params.id, { status: 'pending' });

      const fullPlan = mcDB.getPlan(req.params.id);
      gateway.broadcast({ type: 'mc:plan_updated', data: { planId: req.params.id, plan: fullPlan } });

      // Auto-dispatch: analysis 完成後自動 drain queue，讓子任務被 Worker 接走
      if (gateway.taskExecutor) gateway.taskExecutor.drainQueue();

      res.json(fullPlan);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Timeline ────────────────────────────────────────

  router.get('/timeline', (req, res) => {
    try {
      const { from, to, tz } = req.query;
      const data = mcDB.timeline({ from, to, tz: tz ? parseInt(tz, 10) : 0 });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ─── Stats ──────────────────────────────────────────

  router.get('/stats', async (req, res) => {
    try {
      const workerRegistry = gateway.workerRegistry || null;
      // Live-ping workers before returning stats
      if (workerRegistry) await workerRegistry.refreshStatus();
      const stats = mcDB.getStats(workerRegistry);
      // Add spawner capacity info
      const spawner = gateway.workerSpawner || null;
      if (spawner) {
        const cap = spawner.getCapacity();
        stats.spawner = {
          canSpawn: cap.canSpawn,
          maxByRam: cap.maxByRam,
          maxByHardCap: cap.maxByHardCap,
          freeGB: cap.resources.freeGB,
          availableFolders: cap.availableFolders.map(f => f.name),
        };
      }
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/today-tasks', (req, res) => {
    try {
      res.json(mcDB.getTodayTasks());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Worker Spawn ───────────────────────────────────

  router.get('/workers/capacity', (req, res) => {
    try {
      const spawner = gateway.workerSpawner;
      if (!spawner) return res.status(501).json({ error: 'WorkerSpawner not available' });
      const cap = spawner.getCapacity();
      res.json(cap);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/workers/spawn', async (req, res) => {
    try {
      const spawner = gateway.workerSpawner;
      if (!spawner) return res.status(501).json({ error: 'WorkerSpawner not available' });

      const cap = spawner.getCapacity();
      if (cap.canSpawn <= 0) {
        const reason = cap.maxByRam <= 0 ? 'insufficient RAM'
          : cap.maxByHardCap <= 0 ? 'max workers reached'
          : 'no available Worker folders';
        return res.status(409).json({ error: `Cannot spawn: ${reason}`, capacity: cap });
      }

      const workerId = await spawner.spawnOne();
      if (workerId) {
        gateway.broadcast({ type: 'mc:worker_status', data: { workerId, status: 'idle', spawned: true } });
        res.json({ success: true, workerId });
      } else {
        res.status(500).json({ error: 'Spawn failed or timed out' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Search ─────────────────────────────────────────

  router.get('/search', (req, res) => {
    try {
      const { q, layer } = req.query;
      if (!q || !q.trim()) {
        return res.status(400).json({ error: 'Missing required query parameter: q' });
      }
      if (layer && !['layer1', 'layer2', 'layer3'].includes(layer)) {
        return res.status(400).json({ error: 'Invalid layer. Must be layer1, layer2, or layer3' });
      }
      const results = mcDB.searchPlans(q.trim(), layer || undefined);
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Plans ──────────────────────────────────────────

  router.get('/plans', (req, res) => {
    try {
      const { projectId, status, limit } = req.query;
      const plans = mcDB.listPlans({
        projectId,
        status,
        limit: limit ? parseInt(limit) : undefined,
      });
      res.json(plans);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/plans', (req, res) => {
    try {
      const { title, description, projectId, source, sourceInfo, strategy, tasks } = req.body;
      if (!title) return res.status(400).json({ error: 'Missing required field: title' });

      const plan = mcDB.createPlan({ title, description, projectId, source, sourceInfo });

      // Optional: set strategy immediately
      if (strategy) {
        mcDB.updatePlan(plan.id, { strategy, status: 'planning' });
      }

      // Optional: create tasks inline
      if (Array.isArray(tasks)) {
        tasks.forEach((t, i) => {
          mcDB.createTask({
            planId: plan.id,
            title: t.title,
            description: t.description,
            type: t.type || 'layer1',
            action: t.action,
            params: t.params,
            orderIndex: t.orderIndex !== undefined ? t.orderIndex : i,
            timeout: t.timeout,
          });
        });
      }

      const full = mcDB.getPlan(plan.id);
      gateway.broadcast({ type: 'mc:plan_created', data: { plan: full } });
      res.json(full);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/plans/:id', (req, res) => {
    try {
      const plan = mcDB.getPlan(req.params.id);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });
      res.json(plan);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/plans/:id', (req, res) => {
    try {
      const plan = mcDB.getPlan(req.params.id);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      const updated = mcDB.updatePlan(req.params.id, req.body);
      if (!updated) return res.status(400).json({ error: 'No valid fields to update' });

      const fresh = mcDB.getPlan(req.params.id);
      gateway.broadcast({ type: 'mc:plan_updated', data: { planId: req.params.id, plan: fresh } });
      res.json(fresh);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/plans/:id', (req, res) => {
    try {
      const plan = mcDB.getPlan(req.params.id);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      mcDB.deletePlan(req.params.id);
      gateway.broadcast({ type: 'mc:plan_deleted', data: { planId: req.params.id } });
      res.json({ success: true, deleted: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Plan Execution ─────────────────────────────────

  router.post('/plans/:id/execute', async (req, res) => {
    try {
      const plan = mcDB.getPlan(req.params.id);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      let tasks = mcDB.listTasksByPlan(req.params.id)
        .filter(t => t.status === 'pending')
        .sort((a, b) => a.orderIndex - b.orderIndex);

      // Optional: execute a single task by ID
      const singleTaskId = req.query.taskId;
      if (singleTaskId) {
        tasks = tasks.filter(t => t.id === singleTaskId);
        if (tasks.length === 0) {
          // Check if the task exists but isn't pending
          const task = mcDB.getTask(singleTaskId);
          if (!task) return res.status(404).json({ error: 'Task not found' });
          return res.status(400).json({ error: `Task is ${task.status}, not pending` });
        }
      }

      if (tasks.length === 0) {
        return res.status(400).json({ error: 'No pending tasks to execute' });
      }

      const errors = [];
      for (const task of tasks) {
        try {
          const taskParams = JSON.parse(task.params || '{}');
          // Bug fix: worker-dispatch requires description in params.
          // MC tasks store description separately — inject it if missing.
          if (task.action === 'worker-dispatch' && !taskParams.description) {
            taskParams.description = task.description || task.title || 'No description';
          }
          // Pre-generate execTaskId and link to MC task BEFORE submitTask,
          // so that _syncToMC can find the MC task when executeTask fires async.
          // (Fixes race condition: executeTask calling _syncToMC before execTaskId was set)
          const now = getNow();
          const hex = Math.floor(Math.random() * 0xfff).toString(16).padStart(3, '0');
          const preTaskId = `task-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}-${hex}`;
          mcDB.updateTask(task.id, { status: 'queued', execTaskId: preTaskId });
          gateway.broadcast({
            type: 'mc:task_status',
            data: { taskId: task.id, planId: req.params.id, status: 'queued' },
          });
          await taskExecutor.submitTask({
            taskId: preTaskId,
            type: task.type || 'layer1',
            action: task.action,
            params: taskParams,
            timeout: task.timeout || 300,
          });
        } catch (err) {
          mcDB.updateTask(task.id, { status: 'failed', output: err.message, completedAt: getNow().toISOString() });
          errors.push({ taskId: task.id, error: err.message });
          gateway.broadcast({
            type: 'mc:task_status',
            data: { taskId: task.id, planId: req.params.id, status: 'failed', output: err.message },
          });
        }
      }

      const newStatus = errors.length < tasks.length ? 'active' : 'failed';
      mcDB.updatePlan(req.params.id, { status: newStatus });
      gateway.broadcast({ type: 'mc:plan_updated', data: { planId: req.params.id, status: newStatus } });

      res.json({ planId: req.params.id, status: newStatus, submitted: tasks.length - errors.length, errors });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Plan Clone ─────────────────────────────────────

  router.post('/plans/:id/clone', (req, res) => {
    try {
      const original = mcDB.getPlan(req.params.id);
      if (!original) return res.status(404).json({ error: 'Plan not found' });

      // Create new plan with [Clone] prefix
      const newPlan = mcDB.createPlan({
        title: `[Clone] ${original.title}`,
        description: original.description || '',
        projectId: original.projectId || 'default',
        source: 'dashboard',
      });

      // Copy strategy if present
      if (original.strategy) {
        mcDB.updatePlan(newPlan.id, { strategy: original.strategy });
      }

      // Copy all non-analyze tasks with status reset to pending
      const tasks = mcDB.listTasksByPlan(req.params.id);
      const realTasks = tasks.filter(t => t.action !== 'plan-analyze');
      realTasks.forEach((t, i) => {
        mcDB.createTask({
          planId: newPlan.id,
          title: t.title,
          description: t.description,
          type: t.type || 'layer3',
          action: t.action,
          params: typeof t.params === 'string' ? JSON.parse(t.params || '{}') : (t.params || {}),
          orderIndex: t.orderIndex !== undefined ? t.orderIndex : i,
          timeout: t.timeout || 300,
          status: 'pending',
        });
      });

      const full = mcDB.getPlan(newPlan.id);
      gateway.broadcast({ type: 'mc:plan_created', data: { plan: full } });
      res.json(full);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Tasks ──────────────────────────────────────────

  router.post('/plans/:id/tasks', (req, res) => {
    try {
      const plan = mcDB.getPlan(req.params.id);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      const { title, description, type, action, params, orderIndex, timeout, template } = req.body;
      if (!title) return res.status(400).json({ error: 'Missing required field: title' });

      // Validate template if provided
      if (template && !getTemplate(template)) {
        return res.status(400).json({ error: `Unknown template: ${template}` });
      }

      // If template provided, default action to worker-dispatch and type to layer3
      const taskAction = action || (template ? 'worker-dispatch' : undefined);
      const taskType = type || (template ? 'layer3' : 'layer1');

      // Build params — merge template into params for worker-dispatch
      let taskParams = params;
      if (template) {
        const existing = typeof params === 'string' ? JSON.parse(params || '{}') : (params || {});
        taskParams = { ...existing, template, description: description || title };
      }

      // Auto orderIndex: max existing + 1
      const existingTasks = mcDB.listTasksByPlan(req.params.id);
      const autoIndex = orderIndex !== undefined ? orderIndex
        : (existingTasks.length > 0 ? Math.max(...existingTasks.map(t => t.orderIndex)) + 1 : 0);

      const task = mcDB.createTask({
        planId: req.params.id,
        title, description, type: taskType, action: taskAction, params: taskParams, timeout,
        orderIndex: autoIndex,
      });

      const full = mcDB.getTask(task.id);
      gateway.broadcast({ type: 'mc:task_status', data: { taskId: task.id, planId: req.params.id, status: 'pending' } });
      res.json(full);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/tasks/:id', (req, res) => {
    try {
      const task = mcDB.getTask(req.params.id);
      if (!task) return res.status(404).json({ error: 'Task not found' });

      const updated = mcDB.updateTask(req.params.id, req.body);
      if (!updated) return res.status(400).json({ error: 'No valid fields to update' });

      const fresh = mcDB.getTask(req.params.id);
      gateway.broadcast({
        type: 'mc:task_status',
        data: { taskId: req.params.id, planId: task.planId, status: fresh.status, output: fresh.output },
      });
      res.json(fresh);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── BugTracker Proxy ─────────────────────────────────
  // Reads BugTracker port from ../BugTracker/.issue-tracker-port
  // and proxies /api/mc/issues and /api/mc/issues/stats

  let _btPortCache = { port: null, ts: 0 };
  async function getBugTrackerUrl() {
    const now = Date.now();
    if (_btPortCache.port && now - _btPortCache.ts < 10000) {
      return `http://localhost:${_btPortCache.port}`;
    }
    const fs = require('fs').promises;
    const itPortFile = path.join(__dirname, '..', '..', '..', 'BugTracker', '.issue-tracker-port');
    const raw = (await fs.readFile(itPortFile, 'utf-8')).trim();
    const port = parseInt(raw, 10);
    if (!port || port < 1 || port > 65535) throw new Error('Invalid BugTracker port');
    _btPortCache = { port, ts: now };
    return `http://localhost:${port}`;
  }

  router.get('/issues/stats', async (req, res) => {
    try {
      const baseUrl = await getBugTrackerUrl();
      const resp = await fetch(`${baseUrl}/api/stats`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'BugTracker offline', detail: e.message });
    }
  });

  router.get('/issues', async (req, res) => {
    try {
      const baseUrl = await getBugTrackerUrl();
      const params = new URLSearchParams();
      if (req.query.status) params.set('status', req.query.status);
      if (req.query.priority) params.set('priority', req.query.priority);
      if (req.query.limit) params.set('limit', req.query.limit);
      const qs = params.toString();
      const resp = await fetch(`${baseUrl}/api/issues${qs ? '?' + qs : ''}`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'BugTracker offline', detail: e.message });
    }
  });

  return router;
}

module.exports = createRoutes;
