/**
 * Mission Control Dashboard — app.js
 * API calls, WebSocket, DOM rendering
 */

// ─── State ──────────────────────────────────────────────
const state = {
  plans: [],
  currentPlanId: null,
  stats: {},
  ws: null,
  wsRetryDelay: 1000,
  wsRetryCount: 0,
  wsConnected: false,
  projects: [],
  currentProjectId: '', // '' = all projects
  searchQuery: '',
  searchLayer: '',
  workerPanelOpen: false,
  taskPanelOpen: false,
  workers: [],
  sidebarIndex: -1,
  issuePanelOpen: false,
  issueStats: null,
  issues: [],
  activityDrawerState: (typeof localStorage !== 'undefined' && localStorage.getItem('activityDrawerState')) || 'collapsed',
  activityDrawerHeight: (typeof localStorage !== 'undefined' && parseInt(localStorage.getItem('activityDrawerHeight'))) || 40,
  activityData: null,
  activityRange: '7d',
  selectedDate: null,
};

const API = '/api/mc';

// ─── API Layer ──────────────────────────────────────────

async function api(path, opts = {}) {
  const silent = opts.silent; delete opts.silent;
  let res;
  try {
    res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
  } catch (e) {
    if (!silent) showToast('Gateway connection lost', 'error');
    throw e;
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    if (!silent) showToast('Network error', 'error');
    throw new Error('Non-JSON response from ' + path);
  }
  if (res.status >= 400) {
    const errMsg = data.error || data.message || `Request failed (${res.status})`;
    if (!silent) showToast(errMsg, 'error');
    throw new Error(errMsg);
  }
  return data;
}

// ─── Toast Notification System ──────────────────────────

const TOAST_MAX_VISIBLE = 3;

function showToast(message, level = 'info', duration = 5000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Enforce max visible — remove oldest when at limit
  while (container.children.length >= TOAST_MAX_VISIBLE) {
    container.removeChild(container.firstElementChild);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${level}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  const dismiss = () => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // Fallback removal if transitionend doesn't fire
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
  };

  setTimeout(dismiss, duration);
  toast.addEventListener('click', dismiss);
}

// ─── Confirm Dialog ──────────────────────────────────

/**
 * Show a reusable confirm dialog. Returns a Promise<boolean>.
 * @param {string} title - Dialog title
 * @param {string} message - Dialog body text
 * @param {string} confirmLabel - Confirm button text (default: 'Confirm')
 * @param {'danger'|'primary'} confirmStyle - Button style (default: 'primary')
 */
function showConfirm(title, message, confirmLabel = 'Confirm', confirmStyle = 'primary') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal confirm-modal">
      <h3>${esc(title)}</h3>
      <p class="confirm-message">${esc(message)}</p>
      <div class="modal-actions">
        <button class="modal-btn" id="confirm-cancel-btn">Cancel</button>
        <button class="modal-btn ${confirmStyle === 'danger' ? 'danger' : 'primary'}" id="confirm-ok-btn">${esc(confirmLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('#confirm-cancel-btn').onclick = () => cleanup(false);
    overlay.querySelector('#confirm-ok-btn').onclick = () => cleanup(true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    // Keyboard: Escape to cancel
    const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(false); } };
    document.addEventListener('keydown', onKey);
  });
}

// ─── Button Loading State ───────────────────────────

function setBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.origText = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;
    btn.classList.add('btn-loading');
  } else {
    btn.textContent = btn.dataset.origText || btn.textContent;
    btn.disabled = false;
    btn.classList.remove('btn-loading');
  }
}

async function fetchStats() {
  try {
    const stats = await api('/stats');
    state.stats = stats;
    renderStats(stats);
  } catch (e) { console.error('fetchStats:', e); }
}

async function fetchPlans() {
  try {
    const q = state.searchQuery.trim();
    const layer = state.searchLayer;
    let plans;
    if (q) {
      const params = new URLSearchParams({ q });
      if (layer) params.set('layer', layer);
      plans = await api(`/search?${params}`);
    } else if (layer) {
      // Layer filter without keyword — use search API with wildcard-like broad match
      plans = await api(`/search?q=%25&layer=${layer}`);
    } else {
      plans = await api('/plans');
    }
    state.plans = plans;
    renderSidebar();
  } catch (e) { console.error('fetchPlans:', e); }
}


async function fetchPlan(id) {
  try {
    const plan = await api('/plans/' + id);
    // Update in state
    const idx = state.plans.findIndex(p => p.id === id);
    if (idx >= 0) state.plans[idx] = plan;
    return plan;
  } catch (e) { console.error('fetchPlan:', e); return null; }
}

async function createPlan(title, description, projectId) {
  const body = { title, description, source: 'dashboard' };
  if (projectId) body.projectId = projectId;
  return api('/plans', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function executePlan(id) {
  return api('/plans/' + id + '/execute', { method: 'POST' });
}

async function archivePlan(id) {
  return api('/plans/' + id, { method: 'DELETE' });
}

async function updateTaskStatus(id, fields) {
  return api('/tasks/' + id, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

async function addTaskToPlan(planId, title, description, template) {
  const body = { title, description };
  if (template) body.template = template;
  return api('/plans/' + planId + '/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function analyzePlan(requirement, source) {
  return api('/plans/analyze', {
    method: 'POST',
    body: JSON.stringify({ requirement, source }),
  });
}

async function fetchProjects() {
  try {
    const projects = await api('/projects');
    state.projects = projects;
    renderProjectSelect();
  } catch (e) { console.error('fetchProjects:', e); }
}

async function createProject(id, name, description) {
  return api('/projects', {
    method: 'POST',
    body: JSON.stringify({ id, name, description }),
  });
}

async function deleteProject(id) {
  return api('/projects/' + id, { method: 'DELETE' });
}

// ─── WebSocket ──────────────────────────────────────────

function connectWS() {
  const wsProto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const wsUrl = wsProto + window.location.host;
  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.onopen = () => {
    console.log('[WS] Connected');
    ws.send(JSON.stringify({ type: 'subscribe' }));
    const wasReconnect = state.wsRetryCount > 0;
    state.wsRetryDelay = 1000;
    state.wsRetryCount = 0;
    state.wsConnected = true;
    updateGatewayBadge('online');
    if (wasReconnect) {
      showToast('Reconnected', 'success');
      // Refresh data after reconnect
      fetchStats();
      fetchIssueStats();
      fetchPlans();
      if (state.currentPlanId) fetchPlan(state.currentPlanId).then(p => { if (p) renderPlanDetail(p); });
    }
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleWSMessage(msg);
    } catch (e) { /* ignore non-JSON */ }
  };

  ws.onclose = () => {
    state.wsConnected = false;
    state.wsRetryCount++;
    console.log('[WS] Disconnected, retry #' + state.wsRetryCount + ' in', state.wsRetryDelay, 'ms');
    updateGatewayBadge('reconnecting');
    if (state.wsRetryCount === 1) showToast('Connection lost, reconnecting...', 'warning');
    setTimeout(connectWS, state.wsRetryDelay);
    state.wsRetryDelay = Math.min(state.wsRetryDelay * 2, 30000);
  };

  ws.onerror = () => { ws.close(); };
}

function handleWSMessage(msg) {
  const { type, data } = msg;
  if (!type || !type.startsWith('mc:')) return;

  switch (type) {
    case 'mc:plan_created':
      // Direct state update — add plan from WS data if available
      if (data.plan) {
        const exists = state.plans.findIndex(p => p.id === data.plan.id);
        if (exists >= 0) state.plans[exists] = data.plan;
        else state.plans.unshift(data.plan);
        renderSidebar();
      } else {
        fetchPlans();
      }
      fetchStats();
      debouncedActivityRefresh();
      break;

    case 'mc:plan_updated': {
      const planId = data.planId;
      // Direct state update from WS data
      if (data.plan) {
        const idx = state.plans.findIndex(p => p.id === planId);
        if (idx >= 0) {
          const oldStatus = state.plans[idx].status;
          state.plans[idx] = data.plan;
          renderSidebar();
          flashSidebarItem(planId, data.plan.status, oldStatus);
        } else {
          state.plans.unshift(data.plan);
          renderSidebar();
          flashSidebarItem(planId, data.plan.status);
        }
        if (planId === state.currentPlanId) renderPlanDetail(data.plan);
      } else if (data.status) {
        // Partial update — update status in-place
        const idx = state.plans.findIndex(p => p.id === planId);
        if (idx >= 0) {
          const oldStatus = state.plans[idx].status;
          state.plans[idx].status = data.status;
          renderSidebar();
          flashSidebarItem(planId, data.status, oldStatus);
        }
        // Need full plan for detail view
        if (planId === state.currentPlanId) {
          fetchPlan(planId).then(p => { if (p) renderPlanDetail(p); });
        }
      } else {
        fetchPlans();
        if (planId === state.currentPlanId) {
          fetchPlan(planId).then(p => { if (p) renderPlanDetail(p); });
        }
      }
      fetchStats();
      if (data.status === 'done') {
        const title = data.title || (data.plan && data.plan.title) || planId || 'Plan';
        showToast(`Plan ${title} completed 🎉`, 'success', 8000);
      }
      debouncedActivityRefresh();
      break;
    }

    case 'mc:plan_deleted':
      // Direct state removal
      state.plans = state.plans.filter(p => p.id !== data.planId);
      if (data.planId === state.currentPlanId) {
        state.currentPlanId = null;
        document.getElementById('plan-detail').style.display = 'none';
        document.getElementById('empty-state').style.display = 'flex';
      }
      renderSidebar();
      fetchStats();
      break;

    case 'mc:task_status': {
      const planId = data.planId;
      // Update task status in local state if we have the plan
      const planIdx = state.plans.findIndex(p => p.id === planId);
      if (planIdx >= 0 && state.plans[planIdx].tasks) {
        const taskIdx = state.plans[planIdx].tasks.findIndex(t => t.id === data.taskId);
        if (taskIdx >= 0) {
          const oldPlanStatus = state.plans[planIdx].status;
          state.plans[planIdx].tasks[taskIdx].status = data.status;
          if (data.output) state.plans[planIdx].tasks[taskIdx].output = data.output;
          if (data.taskTitle) state.plans[planIdx].tasks[taskIdx].title = data.taskTitle;
          renderSidebar();
          flashSidebarItem(planId, null, oldPlanStatus);
        }
      }
      // Refresh detail view for current plan
      if (planId === state.currentPlanId) {
        fetchPlan(planId).then(p => { if (p) renderPlanDetail(p); });
      }
      fetchStats();
      if (data.status === 'done') {
        const taskLabel = data.taskTitle || data.taskId || 'Task';
        showToast(`Task ${taskLabel} completed ✓`, 'success');
      } else if (data.status === 'failed') {
        const taskLabel = data.taskTitle || data.taskId || 'Task';
        showToast(`Task ${taskLabel} failed ✕`, 'error');
      }
      debouncedActivityRefresh();
      break;
    }

    case 'mc:task_output':
      if (data.planId === state.currentPlanId) {
        const outputEl = document.getElementById('task-output-' + data.taskId);
        if (outputEl) {
          outputEl.textContent += (outputEl.textContent ? '\n' : '') + data.message;
          outputEl.scrollTop = outputEl.scrollHeight;
          outputEl.style.display = 'block';
        }
        // Auto-expand the details element for streaming output
        const detailsEl = document.getElementById('task-output-details-' + data.taskId);
        if (detailsEl && !detailsEl.open) {
          detailsEl.open = true;
        }
      }
      break;

    case 'mc:worker_status':
      // Direct state update for workers
      if (data.workerId) {
        const wIdx = state.workers.findIndex(w => w.workerId === data.workerId);
        if (wIdx >= 0) {
          if (data.status) state.workers[wIdx].status = data.status;
          if (data.currentTaskId !== undefined) state.workers[wIdx].currentTaskId = data.currentTaskId;
          if (data.lastSeen) state.workers[wIdx].lastSeen = data.lastSeen;
          renderWorkerPanel(state.workers);
          // Update topbar worker count
          const onlineWorkers = state.workers.filter(w => w.status !== 'offline');
          document.getElementById('stat-workers').textContent = onlineWorkers.length;
        } else {
          // New worker — need full refresh
          fetchStats();
        }
        if (data.status === 'offline') {
          showToast(`${data.workerId} went offline`, 'warning');
        }
      } else {
        fetchStats();
      }
      break;
  }
}

function updateGatewayBadge(status) {
  const el = document.getElementById('gw-status');
  if (status === 'online') {
    el.textContent = '● Gateway Online';
    el.className = 'status-badge online';
  } else if (status === 'reconnecting') {
    el.innerHTML = '● Reconnecting' + (state.wsRetryCount > 1 ? ' <span class="ws-retry-count">(#' + state.wsRetryCount + ')</span>' : '');
    el.className = 'status-badge reconnecting';
  } else {
    el.textContent = '● Offline';
    el.className = 'status-badge offline';
  }
}

// ─── Sidebar Flash Animation ────────────────────────────

/** Flash a sidebar mission item to indicate a status change */
function flashSidebarItem(planId, newStatus, oldStatus) {
  if (newStatus && newStatus === oldStatus) return; // no change
  const el = document.querySelector(`.mission-item[data-id="${planId}"]`);
  if (!el) return;
  // Pick flash class based on new status
  let flashClass = 'flash-update';
  if (newStatus === 'done') flashClass = 'flash-done';
  else if (newStatus === 'failed') flashClass = 'flash-failed';
  // Remove existing animation, re-trigger
  el.classList.remove('flash-update', 'flash-done', 'flash-failed');
  // Force reflow to restart animation
  void el.offsetWidth;
  el.classList.add(flashClass);
  el.addEventListener('animationend', () => el.classList.remove(flashClass), { once: true });
}

// ─── Render ─────────────────────────────────────────────

function renderStats(stats) {
  document.getElementById('stat-plans').textContent = stats.activePlans || 0;
  const onlineWorkers = (stats.workers || []).filter(w => w.status !== 'offline');
  document.getElementById('stat-workers').textContent = onlineWorkers.length;
  document.getElementById('stat-tasks').textContent = stats.todayTasks || 0;
  state.workers = stats.workers || [];
  renderWorkerPanel(state.workers);
}

function renderProjectSelect() {
  const select = document.getElementById('project-select');
  const current = state.currentProjectId;
  select.innerHTML = '<option value="">All Projects</option>' +
    state.projects.map(p =>
      `<option value="${p.id}"${p.id === current ? ' selected' : ''}>${esc(p.name)}${p.activePlanCount ? ' (' + p.activePlanCount + ')' : ''}</option>`
    ).join('');
}

function renderSidebar() {
  const list = document.getElementById('mission-list');
  let plans = state.plans.filter(p => p.status !== 'archived');
  // Filter by project if selected
  if (state.currentProjectId) {
    plans = plans.filter(p => p.projectId === state.currentProjectId);
  }
  // Search query — used for highlighting and empty-state messaging only.
  // Actual filtering is done server-side by the /search API endpoint in fetchPlans().
  const q = state.searchQuery.trim().toLowerCase();

  if (plans.length === 0) {
    list.innerHTML = `<div style="padding:16px;color:#8b949e;text-align:center;font-size:13px">${q ? 'No matching missions' : 'No missions yet'}</div>`;
    return;
  }

  list.innerHTML = plans.map(p => {
    const tasks = p.tasks || [];
    const done = tasks.filter(t => t.status === 'done').length;
    const total = tasks.length;
    const pct = total > 0 ? Math.round(done / total * 100) : 0;
    const isActive = p.id === state.currentPlanId;
    const statusClass = p.status === 'active' ? 'running' : p.status;
    const statusText = getStatusText(p.status);
    const timeAgo = getTimeAgo(p.updatedAt || p.createdAt);

    // Highlight matching task titles under the plan
    let matchedTasksHtml = '';
    if (q) {
      const matched = tasks.filter(t => t.title && t.title.toLowerCase().includes(q));
      if (matched.length > 0) {
        matchedTasksHtml = '<div class="mission-matched-tasks">' +
          matched.slice(0, 3).map(t => `<div class="matched-task">↳ ${highlightMatch(t.title, state.searchQuery)}</div>`).join('') +
          (matched.length > 3 ? `<div class="matched-task more">+${matched.length - 3} more</div>` : '') +
          '</div>';
      }
    }

    return `<div class="mission-item${isActive ? ' active' : ''}" data-id="${p.id}">
      <div class="mission-title">${highlightMatch(p.title, state.searchQuery)}</div>
      <div class="mission-meta">
        <span class="mission-status ${statusClass}"></span>
        <span>${statusText}${total > 0 ? ' (' + done + '/' + total + ')' : ''}</span>
        <span>· ${timeAgo}</span>
      </div>
      ${matchedTasksHtml}
      ${total > 0 ? `<div class="mission-progress"><div class="mission-progress-bar ${statusClass}" style="width:${pct}%"></div></div>` : ''}
    </div>`;
  }).join('');

  // Click handlers
  list.querySelectorAll('.mission-item').forEach(el => {
    el.addEventListener('click', () => selectPlan(el.dataset.id));
  });
}

function renderPlanDetail(plan) {
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('today-tasks-view').style.display = 'none';
  document.getElementById('plan-detail').style.display = 'flex';
  state.taskPanelOpen = false;
  const label = document.querySelector('#task-stat-toggle .label');
  if (label) label.textContent = 'Tasks Today ▾';

  document.getElementById('plan-title').textContent = plan.title;
  const badge = document.getElementById('plan-badge');
  const statusClass = plan.status === 'active' ? 'running' : plan.status;
  badge.className = 'plan-badge ' + statusClass;
  const realTasks0 = (plan.tasks || []).filter(t => t.action !== 'plan-analyze');
  const doneCount0 = realTasks0.filter(t => t.status === 'done').length;
  const totalCount0 = realTasks0.length;
  const ratio = totalCount0 > 0 ? ' (' + doneCount0 + '/' + totalCount0 + ')' : '';
  badge.textContent = getStatusEmoji(plan.status) + ' ' + getStatusText(plan.status) + ratio;

  const source = plan.source || 'dashboard';
  const time = plan.createdAt ? new Date(plan.createdAt).toLocaleString() : '';
  document.getElementById('plan-source').textContent = `來源：${source} · ${time}`;

  // Plan action buttons
  const actionsEl = document.getElementById('plan-actions');
  const realTasks = (plan.tasks || []).filter(t => t.action !== 'plan-analyze');
  const pendingTasks = realTasks.filter(t => t.status === 'pending');
  const failedTasks = realTasks.filter(t => t.status === 'failed');
  const activeTasks = realTasks.filter(t => t.status === 'running' || t.status === 'queued');
  let actionsHtml = '';
  if (plan.status === 'pending' && pendingTasks.length > 0) {
    actionsHtml += `<button class="plan-action-btn execute" onclick="executeCurrentPlan()">▶ Execute All (${pendingTasks.length})</button>`;
  }
  if (failedTasks.length > 0) {
    actionsHtml += `<button class="plan-action-btn retry-all" onclick="retryAllFailed()">↻ Retry All Failed (${failedTasks.length})</button>`;
  }
  if (activeTasks.length > 0) {
    actionsHtml += `<button class="plan-action-btn cancel-all" onclick="cancelAllRunning()">✕ Cancel All (${activeTasks.length})</button>`;
  }
  actionsHtml += `<button class="plan-action-btn clone" onclick="clonePlan()">📋 Clone</button>`;
  if (plan.status !== 'archived') {
    actionsHtml += `<button class="plan-action-btn archive" onclick="archiveCurrentPlan()">🗑 Delete</button>`;
  }
  actionsEl.innerHTML = actionsHtml;

  // Strategy
  const stratSection = document.getElementById('strategy-section');
  if (plan.strategy) {
    stratSection.style.display = 'block';
    const stratEl = document.getElementById('strategy-text');
    if (typeof marked !== 'undefined') {
      const raw = marked.parse(plan.strategy);
      stratEl.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(raw) : raw;
    } else {
      stratEl.textContent = plan.strategy;
    }
  } else {
    stratSection.style.display = 'none';
  }

  // Tasks (filter out analysis meta-task)
  const tasks = (plan.tasks || []).filter(t => t.action !== 'plan-analyze');
  // Sort by status priority: running > queued > pending > retry > failed > cancelled > done
  const statusPriority = { running: 0, queued: 1, pending: 2, 'retry-pending': 3, failed: 4, cancelled: 5, done: 6 };
  tasks.sort((a, b) => (statusPriority[a.status] ?? 9) - (statusPriority[b.status] ?? 9) || a.orderIndex - b.orderIndex);
  const done = tasks.filter(t => t.status === 'done').length;
  document.getElementById('task-board-title').textContent =
    tasks.length > 0 ? `TASKS (${done}/${tasks.length} completed)` : 'TASKS';

  const taskList = document.getElementById('task-list');
  if (tasks.length === 0) {
    const isAnalyzing = plan.status === 'planning';
    taskList.innerHTML = `<div style="padding:24px;color:#8b949e;text-align:center">${isAnalyzing ? '🤯 AI 正在分析需求...' : '等待 AI 分析中... 或手動新增 task'}</div>`;
    return;
  }

  taskList.innerHTML = tasks.map((t, i) => {
    const statusClass = t.status;
    const progressLog = JSON.parse(t.progressLog || '[]');
    const progressText = progressLog.length > 0 ? progressLog.map(p => p.message).join('\n') : '';
    const finalOutput = t.output || '';
    const hasProgress = progressText.length > 0;
    const hasOutput = finalOutput.length > 0;
    const hasAnyOutput = hasProgress || hasOutput;
    const isRunning = t.status === 'running';
    const showActions = ['pending', 'queued', 'running'].includes(t.status);

    // Collapsed by default, auto-expand for running tasks
    const outputOpen = isRunning ? 'open' : '';

    let outputHtml = '';
    if (hasAnyOutput) {
      outputHtml = `<details class="task-output-details" id="task-output-details-${t.id}" ${outputOpen}>
        <summary class="task-output-toggle">
          <span class="toggle-icon">▶</span> Output
        </summary>
        <div class="task-output-sections">`;

      if (hasProgress) {
        outputHtml += `<div class="task-output-section">
            <div class="task-output-section-header">
              <span class="task-output-section-label">📋 Progress Log</span>
              <button class="copy-btn" onclick="copyOutputText(this, 'progress-${t.id}')" title="Copy">📋</button>
            </div>
            <div class="task-output" id="task-progress-${t.id}">${esc(progressText)}</div>
          </div>`;
      }

      if (hasOutput) {
        const formattedOutput = smartFormat(finalOutput);
        const renderedOutput = typeof marked !== 'undefined'
          ? (typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(marked.parse(formattedOutput, { breaks: true })) : marked.parse(formattedOutput, { breaks: true }))
          : esc(finalOutput);
        outputHtml += `<div class="task-output-section">
            <div class="task-output-section-header">
              <span class="task-output-section-label">📝 Result</span>
              <button class="copy-btn" onclick="copyOutputText(this, 'final-${t.id}')" title="Copy">📋</button>
            </div>
            <div class="task-output task-output-md" id="task-final-${t.id}">${renderedOutput}</div>
          </div>`;
      } else if (hasProgress && !hasOutput) {
        // Only progress, no final — still show a single copy button
      }

      outputHtml += `</div></details>`;
    }
    // Hidden container for streaming output (mc:task_output WS messages)
    outputHtml += `<div class="task-output task-output-stream" id="task-output-${t.id}" style="display:none"></div>`;

    return `<div class="task-card ${statusClass}" data-task-id="${esc(t.id)}">
      <div class="task-header">
        <div class="task-header-left">
          <span class="task-num">#${i + 1}</span>
          <span class="task-id" title="${esc(t.id)} (click to copy)" onclick="navigator.clipboard.writeText('${esc(t.id)}')">${esc(t.id)}</span>
        </div>
        <div class="task-header-right">
          ${(() => { const tl = getTemplateLabel(t.params); return tl ? `<span class="template-tag">${tl}</span>` : ''; })()}
          ${t.assignedTo ? `<span class="worker-tag">${esc(t.assignedTo)}</span>` : ''}
          <span class="task-status-label ${statusClass}">${getStatusEmoji(t.status)} ${getStatusText(t.status)}</span>
        </div>
      </div>
      <div class="task-name">${esc(t.title)}</div>
      ${t.description ? `<details class="task-desc-details"><summary class="task-desc-toggle">📄 Description</summary><div class="task-desc">${typeof marked !== 'undefined' ? (typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(marked.parse(t.description, { breaks: true })) : marked.parse(t.description, { breaks: true })) : esc(t.description)}</div></details>` : ''}
      ${outputHtml}
      ${showActions ? `<div class="task-actions">
        ${t.status === 'running' ? `<button class="task-btn danger" data-cancel-id="${t.id}" onclick="cancelTask('${t.id}')">✕ Cancel</button>` : ''}
        ${t.status === 'pending' ? `<button class="task-btn" data-exec-id="${t.id}" onclick="executeSingleTask('${t.id}')">▶ Execute</button><button class="task-btn danger" data-cancel-id="${t.id}" onclick="cancelTask('${t.id}')">✕ Cancel</button>` : ''}
      </div>` : ''}
      ${t.status === 'failed' ? `<div class="task-actions"><button class="task-btn" data-retry-id="${t.id}" onclick="retryTask('${t.id}')">↻ Retry & Execute</button></div>` : ''}
    </div>`;
  }).join('');

  // Update input placeholder
  updateInputPlaceholder(plan);
}

// ─── Helpers ────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/**
 * Smart-format plain text into readable markdown before rendering.
 * Detects numbered patterns like (1), (2), 1., 2. and inserts line breaks.
 * Also detects sentence boundaries after periods followed by uppercase letters.
 */
function smartFormat(text) {
  if (!text || text.includes('\n')) return text; // already has line breaks, skip
  let result = text;
  // Pattern: (1) (2) (3) etc — add newline before each
  result = result.replace(/\s*\((\d+)\)\s*/g, '\n($1) ');
  // Pattern: 1. 2. 3. etc (but not decimals like 3.14) — add newline before
  result = result.replace(/(?<=[.!?;])\s+(\d+)\.\s/g, '\n$1. ');
  // Pattern: sentence end (. or ;) followed by uppercase — likely new sentence/section
  result = result.replace(/([.;])\s+([A-Z])/g, '$1\n$2');
  // Pattern: long dashes used as separators — or —
  result = result.replace(/\s+—\s+/g, '\n— ');
  // Trim leading newline if first char became \n
  result = result.replace(/^\n+/, '');
  return result;
}

/** Copy text content of a task output section to clipboard */
function copyOutputText(btn, elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }).catch(() => {
    // Fallback for non-HTTPS
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

/** Escape HTML then wrap query matches in <mark> tags */
function highlightMatch(str, query) {
  const escaped = esc(str);
  if (!query) return escaped;
  // Escape regex special chars in query
  const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(' + safeQ + ')', 'gi');
  return escaped.replace(re, '<mark class="search-hl">$1</mark>');
}

function getStatusText(status) {
  const map = { pending: '待處理', planning: '規劃中', active: '進行中', done: '已完成', failed: '失敗', cancelled: '已取消', archived: '已歸檔', queued: '排隊中', running: '執行中', 'retry-pending': '重試中' };
  return map[status] || status;
}

function getStatusEmoji(status) {
  const map = { pending: '○', planning: '📝', active: '⏳', done: '✓', failed: '❌', cancelled: '⊘', queued: '⏳', running: '⏳', 'retry-pending': '↻' };
  return map[status] || '?';
}

function getTimeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function updateInputPlaceholder(plan) {
  const input = document.getElementById('input-field');
  const tplSelect = document.getElementById('template-select');
  if (!plan) {
    input.placeholder = '輸入新的需求來建立 plan...';
    tplSelect.style.display = 'none';
  } else if (['done', 'archived', 'cancelled'].includes(plan.status)) {
    input.placeholder = '輸入新的需求來建立 plan...';
    tplSelect.style.display = 'none';
  } else {
    input.placeholder = '新增 task 到此 plan...';
    tplSelect.style.display = '';
  }
}

function getTemplateLabel(params) {
  if (!params) return null;
  try {
    const p = typeof params === 'string' ? JSON.parse(params) : params;
    const map = { 'spec-writing': '📝 Spec', 'research': '🔍 Research', 'bug-fix': '🐛 Bug Fix', 'feature': '✨ Feature', 'refactor': '♻️ Refactor', 'code-review': '👀 Review' };
    return p.template ? (map[p.template] || p.template) : null;
  } catch { return null; }
}

// ─── Worker Panel ───────────────────────────────────────

function toggleWorkerPanel() {
  state.workerPanelOpen = !state.workerPanelOpen;
  const panel = document.getElementById('worker-panel');
  const label = document.querySelector('#worker-stat-toggle .label');
  if (state.workerPanelOpen) {
    panel.classList.add('open');
    if (label) label.textContent = 'Workers ▴';
  } else {
    panel.classList.remove('open');
    if (label) label.textContent = 'Workers ▾';
  }
}

function renderWorkerPanel(workers) {
  const inner = document.getElementById('worker-panel-inner');
  if (!inner) return;
  if (!workers || workers.length === 0) {
    inner.innerHTML = '<div class="worker-panel-empty">No workers registered</div>';
    return;
  }

  inner.innerHTML = workers.map(w => {
    const statusClass = w.status === 'idle' ? 'idle' : w.status === 'busy' ? 'busy' : 'offline';
    const icon = w.status === 'busy' ? '⚙️' : w.status === 'idle' ? '🟢' : '⭘';
    const lastSeenText = w.lastSeen ? getTimeAgo(w.lastSeen) : '';
    const taskHtml = w.currentTaskId
      ? `<span class="worker-card-task" onclick="navigateToWorkerTask('${esc(w.currentTaskId)}')" title="${esc(w.currentTaskId)}">${esc(truncateTaskId(w.currentTaskId))}</span>`
      : '<span class="worker-card-notask">—</span>';

    return `<div class="worker-card">
      <span class="worker-card-icon">${icon}</span>
      <span class="worker-card-id">${esc(w.workerId)}</span>
      <span class="worker-card-dot ${statusClass}"></span>
      <span class="worker-card-status">${statusClass}</span>
      ${lastSeenText ? `<span class="worker-card-seen">${lastSeenText}</span>` : ''}
      ${taskHtml}
    </div>`;
  }).join('');
}

function truncateTaskId(taskId) {
  if (!taskId) return '';
  return taskId.length > 24 ? taskId.slice(0, 24) + '…' : taskId;
}

/** Find the plan containing a task and navigate to it */
function navigateToWorkerTask(taskId) {
  if (!taskId) return;
  // taskId is an exec_task ID (task-...), MC tasks link via execTaskId
  const plan = state.plans.find(p => (p.tasks || []).some(t => t.id === taskId || t.execTaskId === taskId));
  if (plan) {
    selectPlan(plan.id);
  }
}

// ─── Task Panel ─────────────────────────────────────────

function toggleTaskPanel() {
  state.taskPanelOpen = !state.taskPanelOpen;
  const label = document.querySelector('#task-stat-toggle .label');
  if (state.taskPanelOpen) {
    // Hide other views, show today tasks in center
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('plan-detail').style.display = 'none';
    document.getElementById('today-tasks-view').style.display = 'flex';
    if (label) label.textContent = 'Tasks Today ▴';
    fetchTodayTasks();
  } else {
    closeTodayTasks();
  }
}

function closeTodayTasks() {
  state.taskPanelOpen = false;
  document.getElementById('today-tasks-view').style.display = 'none';
  const label = document.querySelector('#task-stat-toggle .label');
  if (label) label.textContent = 'Tasks Today ▾';
  // Restore previous view
  if (state.currentPlanId) {
    const plan = state.plans.find(p => p.id === state.currentPlanId);
    if (plan) { renderPlanDetail(plan); return; }
  }
  document.getElementById('empty-state').style.display = 'flex';
}

async function fetchTodayTasks() {
  const tasks = await api('/today-tasks');
  if (tasks) renderTaskPanel(tasks);
}

function renderTaskPanel(tasks) {
  const list = document.getElementById('today-tasks-list');
  if (!list) return;
  if (!tasks || tasks.length === 0) {
    list.innerHTML = '<div style="padding:48px;color:#8b949e;text-align:center;font-size:15px">No tasks today 🎉</div>';
    return;
  }
  list.innerHTML = tasks.map(t => {
    const icon = t.status === 'done' ? '✅' : t.status === 'failed' ? '❌' : t.status === 'cancelled' ? '🚫' : t.status === 'running' ? '⚙️' : '⏳';
    const title = esc(t.title || t.action || t.id);
    const plan = esc(t.planTitle || '');
    const time = t.createdAt ? getTimeAgo(t.createdAt) : '';
    const statusClass = t.status === 'done' ? 'done' : t.status === 'failed' ? 'failed' : t.status === 'running' ? 'running' : '';
    return `<div class="today-task-card ${statusClass}" onclick="navigateFromTodayTask('${esc(t.id)}')">
      <span class="today-task-icon">${icon}</span>
      <div class="today-task-info">
        <div class="today-task-title">${title}</div>
        <div class="today-task-plan">${plan}</div>
      </div>
      <div class="today-task-meta">
        <span class="today-task-status">${esc(t.status)}</span>
        <span class="today-task-time">${time}</span>
      </div>
    </div>`;
  }).join('');
}

function navigateFromTodayTask(taskId) {
  closeTodayTasks();
  navigateToWorkerTask(taskId);
}

// ─── Sidebar Drawer (Mobile) ────────────────────────────

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isOpen = sidebar.classList.contains('drawer-open');
  if (isOpen) {
    closeSidebar();
  } else {
    sidebar.classList.add('drawer-open');
    backdrop.classList.add('visible');
  }
}

function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  sidebar.classList.remove('drawer-open');
  backdrop.classList.remove('visible');
}

// ─── Actions ────────────────────────────────────────────

async function selectPlan(id) {
  state.currentPlanId = id;
  closeSidebar();
  renderSidebar();
  const plan = await fetchPlan(id);
  if (plan) renderPlanDetail(plan);
  // Reverse navigation: highlight matching timeline item
  highlightTimelineItem(id);
}

/** Navigate to the first active/pending plan when clicking Active Plans stat */
function goToActivePlan() {
  var active = (state.plans || []).filter(function(p) {
    return p.status === 'active' || p.status === 'pending' || p.status === 'planning';
  });
  if (active.length === 0) {
    showToast('No active plans', 'info');
    return;
  }
  selectPlan(active[0].id);
}

async function cancelTask(taskId) {
  const ok = await showConfirm('Cancel this task?', 'The task will be marked as cancelled.', 'Cancel Task', 'danger');
  if (!ok) return;
  const btn = document.querySelector(`[data-cancel-id="${taskId}"]`);
  if (btn) setBtnLoading(btn, true);
  try {
    await updateTaskStatus(taskId, { status: 'cancelled' });
  } finally {
    if (btn) setBtnLoading(btn, false);
  }
}

async function archiveCurrentPlan() {
  if (!state.currentPlanId) return;
  const ok = await showConfirm('Delete this plan?', 'This will permanently delete the plan and all its tasks.', 'Delete', 'danger');
  if (!ok) return;
  const btn = document.querySelector('.plan-action-btn.archive');
  if (btn) setBtnLoading(btn, true);
  try {
    await archivePlan(state.currentPlanId);
    state.currentPlanId = null;
    await fetchPlans();
    document.getElementById('plan-detail').style.display = 'none';
    document.getElementById('empty-state').style.display = 'flex';
  } finally {
    if (btn) setBtnLoading(btn, false);
  }
}

async function retryTask(taskId) {
  const btn = document.querySelector(`[data-retry-id="${taskId}"]`);
  if (btn) setBtnLoading(btn, true);
  try {
    await updateTaskStatus(taskId, { status: 'pending' });
    // Auto-execute: find the plan and execute just this task
    const plan = state.plans.find(p => (p.tasks || []).some(t => t.id === taskId));
    if (plan) {
      await api('/plans/' + plan.id + '/execute?taskId=' + taskId, { method: 'POST' });
    }
  } finally {
    if (btn) setBtnLoading(btn, false);
  }
}

async function executeSingleTask(taskId) {
  const btn = document.querySelector(`[data-exec-id="${taskId}"]`);
  if (btn) setBtnLoading(btn, true);
  try {
    if (!state.currentPlanId) return;
    await api('/plans/' + state.currentPlanId + '/execute?taskId=' + taskId, { method: 'POST' });
    const fresh = await fetchPlan(state.currentPlanId);
    if (fresh) renderPlanDetail(fresh);
  } finally {
    if (btn) setBtnLoading(btn, false);
  }
}

function showNewMissionModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const projectOpts = state.projects.map(p =>
    `<option value="${p.id}"${p.id === (state.currentProjectId || 'default') ? ' selected' : ''}>${esc(p.name)}</option>`
  ).join('');
  overlay.innerHTML = `<div class="modal">
    <h3>New Mission</h3>
    <select id="modal-project" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 16px;color:#e1e4e8;font-size:14px;margin-bottom:12px">${projectOpts}</select>
    <input type="text" id="modal-title" placeholder="Mission 標題" autofocus />
    <textarea id="modal-desc" placeholder="需求描述（選填）"></textarea>
    <div class="modal-actions">
      <button class="modal-btn" id="modal-cancel">Cancel</button>
      <button class="modal-btn primary" id="modal-create">Create</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#modal-cancel').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#modal-create').onclick = async () => {
    const title = overlay.querySelector('#modal-title').value.trim();
    if (!title) return;
    const desc = overlay.querySelector('#modal-desc').value.trim();
    const projectId = overlay.querySelector('#modal-project').value;
    overlay.remove();
    const plan = await createPlan(title, desc || undefined, projectId);
    if (plan && plan.id) {
      await fetchPlans();
      selectPlan(plan.id);
    }
  };

  overlay.querySelector('#modal-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') overlay.querySelector('#modal-create').click();
  });
}

function showManageProjectsModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  function renderList() {
    const listHtml = state.projects.map(p => {
      const isDefault = p.id === 'default';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #30363d">
        <div>
          <div style="font-weight:600">${esc(p.name)}</div>
          <div style="font-size:12px;color:#8b949e">${esc(p.id)} · ${p.planCount || 0} plans</div>
        </div>
        ${isDefault ? '' : `<button class="task-btn danger" data-delete="${p.id}" style="flex-shrink:0">✕</button>`}
      </div>`;
    }).join('');

    overlay.innerHTML = `<div class="modal">
      <h3>Manage Projects</h3>
      <div style="margin-bottom:16px">${listHtml || '<div style="color:#8b949e">No projects</div>'}</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input type="text" id="new-proj-id" placeholder="project-id" style="flex:1;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:8px 12px;color:#e1e4e8;font-size:13px" />
        <input type="text" id="new-proj-name" placeholder="Project Name" style="flex:1;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:8px 12px;color:#e1e4e8;font-size:13px" />
        <button class="modal-btn primary" id="btn-add-proj" style="flex-shrink:0">Add</button>
      </div>
      <div class="modal-actions"><button class="modal-btn" id="modal-close">Close</button></div>
    </div>`;

    overlay.querySelector('#modal-close').onclick = () => { overlay.remove(); fetchProjects(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); fetchProjects(); } });

    overlay.querySelector('#btn-add-proj').onclick = async () => {
      const id = overlay.querySelector('#new-proj-id').value.trim();
      const name = overlay.querySelector('#new-proj-name').value.trim();
      if (!id || !name) return;
      const result = await createProject(id, name);
      if (result && !result.error) {
        await fetchProjects();
        renderList();
      }
    };

    overlay.querySelectorAll('[data-delete]').forEach(btn => {
      btn.onclick = async () => {
        const pid = btn.dataset.delete;
        const result = await deleteProject(pid);
        if (result && result.success) {
          await fetchProjects();
          if (state.currentProjectId === pid) {
            state.currentProjectId = '';
            renderProjectSelect();
            renderSidebar();
          }
          renderList();
        }
      };
    });
  }

  document.body.appendChild(overlay);
  renderList();
}

async function handleInputSubmit() {
  const input = document.getElementById('input-field');
  const tplSelect = document.getElementById('template-select');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  if (state.currentPlanId) {
    const plan = state.plans.find(p => p.id === state.currentPlanId);
    if (plan && !['done', 'archived', 'cancelled'].includes(plan.status)) {
      // Add task to current plan (with optional template)
      const template = tplSelect.value || undefined;
      await addTaskToPlan(state.currentPlanId, text, undefined, template);
      const fresh = await fetchPlan(state.currentPlanId);
      if (fresh) renderPlanDetail(fresh);
      return;
    }
  }

  // Analyze requirement via Worker AI
  setInputLoading(true);
  try {
    const plan = await analyzePlan(text, 'dashboard');
    if (plan && plan.id) {
      await fetchPlans();
      selectPlan(plan.id);
    }
  } catch (e) {
    console.error('analyzePlan failed:', e);
  } finally {
    setInputLoading(false);
  }
}

function setInputLoading(loading) {
  const input = document.getElementById('input-field');
  const btn = document.getElementById('btn-send');
  if (loading) {
    input.disabled = true;
    input.placeholder = '🤯 AI 分析中...';
    btn.disabled = true;
    btn.textContent = '⏳';
  } else {
    input.disabled = false;
    input.placeholder = '輸入新的需求來建立 plan...';
    btn.disabled = false;
    btn.textContent = 'Send';
  }
}

async function executeCurrentPlan() {
  if (!state.currentPlanId) return;
  const btn = document.querySelector('.plan-action-btn.execute');
  if (btn) setBtnLoading(btn, true);
  try {
    const result = await executePlan(state.currentPlanId);
    if (result) {
      const fresh = await fetchPlan(state.currentPlanId);
      if (fresh) renderPlanDetail(fresh);
    }
  } finally {
    if (btn) setBtnLoading(btn, false);
  }
}

// ─── Issue Panel ────────────────────────────────────────

const PRIORITY_EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };

async function retryAllFailed() {
  if (!state.currentPlanId) return;
  const plan = state.plans.find(p => p.id === state.currentPlanId);
  if (!plan) return;
  const realTasks = (plan.tasks || []).filter(t => t.action !== 'plan-analyze');
  const failedTasks = realTasks.filter(t => t.status === 'failed');
  if (failedTasks.length === 0) return;

  const ok = await showConfirm('Retry All Failed', `Retry ${failedTasks.length} failed task(s)?`, 'Retry All', 'primary');
  if (!ok) return;

  const btn = document.querySelector('.plan-action-btn.retry-all');
  if (btn) setBtnLoading(btn, true);
  try {
    for (const t of failedTasks) {
      await updateTaskStatus(t.id, { status: 'pending' });
    }
    await api('/plans/' + state.currentPlanId + '/execute', { method: 'POST' });
    showToast(`Retried ${failedTasks.length} tasks`, 'success');
  } catch (err) {
    showToast('Retry failed: ' + (err.message || err), 'error');
  } finally {
    if (btn) setBtnLoading(btn, false);
  }
}

async function cancelAllRunning() {
  if (!state.currentPlanId) return;
  const plan = state.plans.find(p => p.id === state.currentPlanId);
  if (!plan) return;
  const realTasks = (plan.tasks || []).filter(t => t.action !== 'plan-analyze');
  const activeTasks = realTasks.filter(t => t.status === 'running' || t.status === 'queued');
  if (activeTasks.length === 0) return;

  const ok = await showConfirm('Cancel All Running', `Cancel ${activeTasks.length} running/queued task(s)?`, 'Cancel All', 'danger');
  if (!ok) return;

  const btn = document.querySelector('.plan-action-btn.cancel-all');
  if (btn) setBtnLoading(btn, true);
  try {
    for (const t of activeTasks) {
      await updateTaskStatus(t.id, { status: 'cancelled' });
    }
    showToast(`Cancelled ${activeTasks.length} tasks`, 'success');
  } catch (err) {
    showToast('Cancel failed: ' + (err.message || err), 'error');
  } finally {
    if (btn) setBtnLoading(btn, false);
  }
}

async function clonePlan() {
  if (!state.currentPlanId) return;
  const btn = document.querySelector('.plan-action-btn.clone');
  if (btn) setBtnLoading(btn, true);
  try {
    const result = await api('/plans/' + state.currentPlanId + '/clone', { method: 'POST' });
    if (result && result.id) {
      await fetchPlans();
      await selectPlan(result.id);
      showToast('Plan cloned', 'success');
    }
  } catch (err) {
    showToast('Clone failed: ' + (err.message || err), 'error');
  } finally {
    if (btn) setBtnLoading(btn, false);
  }
}

function toggleIssuePanel() {
  state.issuePanelOpen = !state.issuePanelOpen;
  const panel = document.getElementById('issue-panel');
  if (state.issuePanelOpen) {
    panel.classList.add('open');
    fetchIssues();
  } else {
    panel.classList.remove('open');
  }
}

async function fetchIssueStats() {
  try {
    const data = await api('/issues/stats', { silent: true });
    // BugTracker returns { ok, stats: { total, openCount, byStatus: [{status,count}], byPriority: [{priority,count}] } }
    const raw = data.stats || data;
    const byStatus = Array.isArray(raw.byStatus) ? raw.byStatus : [];
    const byPriority = Array.isArray(raw.byPriority) ? raw.byPriority : [];
    const parsed = {
      open: raw.openCount || byStatus.find(s => s.status === 'open')?.count || 0,
      critical: byPriority.find(p => p.priority === 'critical')?.count || 0,
      inProgress: byStatus.find(s => s.status === 'in-progress')?.count || 0,
      total: raw.total || 0,
    };
    state.issueStats = parsed;
    renderIssueCounts(parsed);
  } catch (e) {
    state.issueStats = null;
    renderIssueCounts(null);
  }
}


async function fetchIssues() {
  const loading = document.getElementById('issue-loading');
  const list = document.getElementById('issue-list');
  if (loading) loading.style.display = 'block';
  if (list) list.innerHTML = '';
  try {
    const data = await api('/issues?limit=20');
    state.issues = Array.isArray(data) ? data : (data.issues || []);
    renderIssueList(state.issues);
  } catch (e) {
    if (list) list.innerHTML = '<div class="issue-empty">BugTracker offline</div>';
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

function renderIssueCounts(stats) {
  const el = document.getElementById('issue-panel-counts');
  if (!el) return;
  if (!stats) {
    el.innerHTML = '<span class="issue-count-badge offline">offline</span>';
    return;
  }
  const parts = [];
  const open = stats.open || 0;
  const critical = stats.critical || 0;
  const inProgress = stats.inProgress || 0;
  if (critical > 0) parts.push(`<span class="issue-count-badge critical">🔴 ${critical} critical</span>`);
  if (open > 0) parts.push(`<span class="issue-count-badge open">${open} open</span>`);
  if (inProgress > 0) parts.push(`<span class="issue-count-badge in-progress">${inProgress} in-progress</span>`);
  if (parts.length === 0) parts.push('<span class="issue-count-badge" style="color:#3fb950">✓ no issues</span>');
  el.innerHTML = parts.join('');
}

function renderIssueList(issues) {
  const list = document.getElementById('issue-list');
  if (!list) return;
  if (!issues || issues.length === 0) {
    list.innerHTML = '<div class="issue-empty">No issues found</div>';
    return;
  }
  list.innerHTML = issues.map(issue => {
    const emoji = PRIORITY_EMOJI[issue.priority] || '⚪';
    const statusClass = (issue.status || 'open').replace(/\s+/g, '-');
    const title = esc(issue.title || 'Untitled');
    return `<div class="issue-item">
      <span class="issue-priority">${emoji}</span>
      <span class="issue-title-text" title="${title}">${title}</span>
      <span class="issue-status-tag ${statusClass}">${issue.status || 'open'}</span>
    </div>`;
  }).join('');
}

// ─── Keyboard Shortcuts ─────────────────────────────────

/** Show or hide the keyboard shortcut help overlay */
function toggleShortcutHelp() {
  const overlay = document.getElementById('shortcut-overlay');
  if (!overlay) return;
  overlay.style.display = overlay.style.display === 'none' ? 'flex' : 'none';
}

/** Close shortcut help overlay if open */
function hideShortcutHelp() {
  const overlay = document.getElementById('shortcut-overlay');
  if (overlay) overlay.style.display = 'none';
}

/** Update the .keyboard-active class on sidebar items */
function updateSidebarHighlight() {
  document.querySelectorAll('.mission-item.keyboard-active').forEach(el => el.classList.remove('keyboard-active'));
  if (state.sidebarIndex < 0) return;
  const items = document.querySelectorAll('.mission-item');
  if (items[state.sidebarIndex]) {
    items[state.sidebarIndex].classList.add('keyboard-active');
    items[state.sidebarIndex].scrollIntoView({ block: 'nearest' });
  }
}

/** Global keyboard shortcut handler */
function handleKeyboardShortcut(e) {
  const tag = document.activeElement?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const shortcutOverlay = document.getElementById('shortcut-overlay');
  const shortcutVisible = shortcutOverlay && shortcutOverlay.style.display !== 'none';

  // Escape always works — close any open modal/overlay
  if (e.key === 'Escape') {
    // Close shortcut help first
    if (shortcutVisible) { hideShortcutHelp(); e.preventDefault(); return; }
    // Close any modal overlay
    const modal = document.querySelector('.modal-overlay');
    if (modal) { modal.remove(); e.preventDefault(); return; }
    // Blur focused input
    if (isTyping) { document.activeElement.blur(); e.preventDefault(); return; }
    return;
  }

  // ? toggles shortcut help (even when typing, except in input fields)
  if (e.key === '?' && !isTyping) {
    toggleShortcutHelp();
    e.preventDefault();
    return;
  }

  // All other shortcuts disabled when typing or modal is open
  if (isTyping) return;
  if (document.querySelector('.modal-overlay')) return;
  if (shortcutVisible) return;

  // Ctrl+K → focus search
  if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.getElementById('sidebar-search')?.focus();
    return;
  }

  // / → focus search
  if (e.key === '/') {
    e.preventDefault();
    document.getElementById('sidebar-search')?.focus();
    return;
  }

  // ↑ / ↓ → navigate sidebar plan list
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const items = document.querySelectorAll('.mission-item');
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      state.sidebarIndex = state.sidebarIndex < items.length - 1 ? state.sidebarIndex + 1 : 0;
    } else {
      state.sidebarIndex = state.sidebarIndex > 0 ? state.sidebarIndex - 1 : items.length - 1;
    }
    updateSidebarHighlight();
    return;
  }

  // Enter → select highlighted plan
  if (e.key === 'Enter') {
    const items = document.querySelectorAll('.mission-item');
    if (state.sidebarIndex >= 0 && items[state.sidebarIndex]) {
      const id = items[state.sidebarIndex].dataset.id;
      if (id) selectPlan(id);
    }
    return;
  }

  // E → execute current plan
  if (e.key === 'e' || e.key === 'E') {
    executeCurrentPlan();
    return;
  }

  // N → new mission
  if (e.key === 'n' || e.key === 'N') {
    showNewMissionModal();
    return;
  }

  // W → toggle worker panel
  if (e.key === 'w' || e.key === 'W') {
    toggleWorkerPanel();
    return;
  }
  // T → toggle task panel
  if (e.key === 't' || e.key === 'T') {
    toggleTaskPanel();
    return;
  }

  // T → toggle activity drawer
  if (e.key === 't' || e.key === 'T') {
    toggleActivityDrawer();
    return;
  }
}

// ─── Init ───────────────────────────────────────────────

function init() {
  fetchStats();
  fetchIssueStats();
  fetchProjects();
  fetchPlans();
  connectWS();

  // Refresh stats every 30s
  setInterval(fetchStats, 30000);
  // Refresh issue stats every 60s
  setInterval(fetchIssueStats, 60000);

  // Auto-refresh on tab focus (visibility change)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      fetchStats();
      fetchIssueStats();
      fetchPlans();
      if (state.currentPlanId) {
        fetchPlan(state.currentPlanId).then(p => { if (p) renderPlanDetail(p); });
      }
    }
  });

  // Event listeners
  document.getElementById('btn-new-mission').addEventListener('click', showNewMissionModal);
  document.getElementById('btn-send').addEventListener('click', handleInputSubmit);
  document.getElementById('input-field').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleInputSubmit();
  });

  // Project switcher
  document.getElementById('project-select').addEventListener('change', (e) => {
    state.currentProjectId = e.target.value;
    renderSidebar();
  });

  // Sidebar search — debounce to avoid excessive API calls
  let searchTimer = null;
  document.getElementById('sidebar-search').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    state.sidebarIndex = -1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => fetchPlans(), 250);
  });

  // Layer filter
  document.getElementById('layer-filter').addEventListener('change', (e) => {
    state.searchLayer = e.target.value;
    fetchPlans();
  });

  document.getElementById('btn-manage-projects').addEventListener('click', showManageProjectsModal);

  // Issue panel toggle
  const issuePanelHeader = document.getElementById('issue-panel-header');
  if (issuePanelHeader) issuePanelHeader.addEventListener('click', toggleIssuePanel);

  // Hamburger menu (mobile sidebar drawer)
  const hamburgerBtn = document.getElementById('hamburger-btn');
  if (hamburgerBtn) hamburgerBtn.addEventListener('click', toggleSidebar);
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboardShortcut);
  const shortcutCloseBtn = document.getElementById('shortcut-close-btn');
  if (shortcutCloseBtn) shortcutCloseBtn.addEventListener('click', hideShortcutHelp);

  // Activity drawer
  initActivityDrawer();
}

document.addEventListener('DOMContentLoaded', init);


// ─── MC Timeline ────────────────────────────────────────

function switchMainTab(tab) {
  // Legacy — no-op, tabs removed. Kept for backward compat.
}

// ─── Collapsible Day State (in-memory only) ─────────────
const collapsedDays = {};
// Track which timeline sections user has explicitly expanded (default: all collapsed)
const expandedSections = {};

// ─── Activity WS Refresh ────────────────────────────────
let activityRefreshTimer = null;
let previousItemKeys = new Set();
let _renderNewKeys = new Set();

/** Collect unique keys from timeline data for new-item detection */
function collectItemKeys(data) {
  const keys = new Set();
  (data.completed || []).forEach(p => keys.add('plan:' + p.id));
  (data.failed || []).forEach(p => keys.add('plan:' + p.id));
  (data.cancelled || []).forEach(p => keys.add('plan:' + p.id));
  (data.created || []).forEach(p => keys.add('plan:' + p.id));
  (data.active || []).forEach(p => keys.add('plan:' + p.id));
  return keys;
}

/** Debounced refresh for activity drawer on WS events */
function debouncedActivityRefresh() {
  if (state.activityDrawerState === 'hidden') return;
  if (activityRefreshTimer) clearTimeout(activityRefreshTimer);
  activityRefreshTimer = setTimeout(() => {
    activityRefreshTimer = null;
    fetchActivitySummary();
    if (state.activityDrawerState === 'expanded') {
      // Snapshot current keys before reload
      if (state.activityData) {
        previousItemKeys = collectItemKeys(state.activityData);
      }
      mcLoadTimeline();
    }
  }, 2000);
}

// ─── Activity Drawer ────────────────────────────────────

/** Check if viewport is mobile (≤768px) */
function isMobileViewport() {
  return window.innerWidth <= 768;
}

/** Toggle activity drawer between expanded and collapsed */
function toggleActivityDrawer() {
  const s = state.activityDrawerState;
  if (s === 'collapsed' || s === 'hidden') {
    expandActivityDrawer();
  } else {
    collapseActivityDrawer();
  }
}

/** Expand the activity drawer to full or saved height */
function expandActivityDrawer() {
  state.activityDrawerState = 'expanded';
  localStorage.setItem('activityDrawerState', 'expanded');
  const drawer = document.getElementById('activity-drawer');
  if (!drawer) return;
  drawer.className = 'activity-drawer expanded';
  drawer.setAttribute('aria-expanded', 'true');
  // On mobile, CSS handles full-screen; on desktop, use saved percentage
  if (!isMobileViewport()) {
    drawer.style.height = state.activityDrawerHeight + '%';
  } else {
    drawer.style.height = '';
  }
  const reopenBtn = document.getElementById('activity-reopen-btn');
  if (reopenBtn) reopenBtn.style.display = 'none';
  // Fetch fresh data when expanding
  fetchActivitySummary();
  mcLoadTimeline();
}

/** Collapse the activity drawer to summary bar only */
function collapseActivityDrawer() {
  state.activityDrawerState = 'collapsed';
  localStorage.setItem('activityDrawerState', 'collapsed');
  const drawer = document.getElementById('activity-drawer');
  if (!drawer) return;
  drawer.className = 'activity-drawer collapsed';
  drawer.setAttribute('aria-expanded', 'false');
  drawer.style.height = '';
  const reopenBtn = document.getElementById('activity-reopen-btn');
  if (reopenBtn) reopenBtn.style.display = 'none';
}

/** Hide the activity drawer completely */
function hideActivityDrawer() {
  state.activityDrawerState = 'hidden';
  localStorage.setItem('activityDrawerState', 'hidden');
  if (activityRefreshTimer) { clearTimeout(activityRefreshTimer); activityRefreshTimer = null; }
  const drawer = document.getElementById('activity-drawer');
  if (!drawer) return;
  drawer.className = 'activity-drawer hidden';
  drawer.setAttribute('aria-expanded', 'false');
  drawer.style.height = '';
  const reopenBtn = document.getElementById('activity-reopen-btn');
  if (reopenBtn) reopenBtn.style.display = 'flex';
}

/** Render the summary bar text from activity data */
function renderSummaryBar(data) {
  const el = document.getElementById('activity-summary-text');
  if (!el) return;
  const completed = (data.completed || []).length;
  const failed = (data.failed || []).length;
  const cancelled = (data.cancelled || []).length;
  const active = (data.active || []).length;
  let parts = [completed + ' done'];
  if (failed > 0) parts.push(failed + ' failed');
  if (cancelled > 0) parts.push(cancelled + ' cancelled');
  if (active > 0) parts.push(active + ' active');
  el.textContent = '\u{1F4CA} Plans (7d): ' + parts.join(' \u00B7 ');
}

/** Fetch activity summary from API and update drawer UI */
async function fetchActivitySummary() {
  var range = getDateRange();
  var toStr = mcFmt(range.to);
  var fromStr = mcFmt(range.from);
  try {
    const data = await api(tlUrl(fromStr, toStr));
    if (data.ok === false) return;
    renderSummaryBar(data);
    state.activityData = data;
    renderDateBar(data);
    renderActivityDrawerStats(data);
  } catch (e) { console.error('fetchActivitySummary:', e); }
}

/** Set the activity date range and reload timeline data */
function setActivityRange(range) {
  state.activityRange = range;
  state.selectedDate = null;
  const today = new Date();
  let from;
  let label;
  if (range === 'today') { from = new Date(today); label = '1d'; }
  else if (range === '7d') { from = new Date(today); from.setDate(from.getDate() - 6); label = '7d'; }
  else { from = new Date(today); from.setDate(from.getDate() - 29); label = '30d'; }
  const rangeEl = document.getElementById('activity-drawer-range');
  if (rangeEl) rangeEl.textContent = label;
  // Update active button
  const btns = document.querySelectorAll('.activity-drawer-controls .mc-tl-range-btn');
  btns.forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-range') === range); });
  // Fetch with new range
  const toStr = mcFmt(today);
  const fromStr = mcFmt(from);
  api(tlUrl(fromStr, toStr)).then(function(data) {
    if (data.ok === false) return;
    state.activityData = data;
    renderActivityDrawerStats(data);
    renderDateBar(data);
    mcRenderTimeline(data);
  }).catch(function(e) { console.error('setActivityRange:', e); });
}

/** Get the current date range based on activityRange state */
function getDateRange() {
  var today = new Date();
  var from;
  var range = state.activityRange || '7d';
  if (range === 'today') { from = new Date(today); }
  else if (range === '7d') { from = new Date(today); from.setDate(from.getDate() - 6); }
  else { from = new Date(today); from.setDate(from.getDate() - 29); }
  return { from: from, to: today };
}

/** Render the visual date bar with density dots for each day */
function renderDateBar(data) {
  var container = document.getElementById('activity-date-bar');
  if (!container) return;
  var range = getDateRange();
  var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var todayStr = mcFmt(new Date());

  // Build activity counts per day (using local dates)
  var dayCounts = {};
  var countItems = function(items, dateField, category) {
    (items || []).forEach(function(item) {
      var d = utcToLocalDate(item[dateField]);
      if (!d) return;
      if (!dayCounts[d]) dayCounts[d] = { completed: 0, created: 0, active: 0 };
      dayCounts[d][category]++;
    });
  };
  countItems(data.completed, 'completedAt', 'completed');
  countItems(data.created, 'createdAt', 'created');
  countItems(data.active, 'updatedAt', 'active');
  countItems(data.tasksDone, 'completedAt', 'completed');
  countItems(data.tasksCreated, 'createdAt', 'created');

  // Generate cells for each day in range
  var html = '';
  var cur = new Date(range.from);
  cur.setHours(12, 0, 0, 0);
  var end = new Date(range.to);
  end.setHours(12, 0, 0, 0);
  while (cur <= end) {
    var dateStr = mcFmt(cur);
    var dayName = dayNames[cur.getDay()];
    var dateLabel = dateStr.slice(5); // MM-DD
    var classes = 'date-cell';
    if (dateStr === todayStr) classes += ' today';
    if (state.selectedDate === dateStr) classes += ' selected';

    var counts = dayCounts[dateStr] || { completed: 0, created: 0, active: 0 };
    var dotsHtml = '';
    var i;
    for (i = 0; i < Math.min(counts.completed, 5); i++) dotsHtml += '<span class="density-dot completed"></span>';
    for (i = 0; i < Math.min(counts.created, 5); i++) dotsHtml += '<span class="density-dot created"></span>';
    for (i = 0; i < Math.min(counts.active, 5); i++) dotsHtml += '<span class="density-dot active"></span>';

    html += '<div class="' + classes + '" data-date="' + dateStr + '">';
    html += '<span class="date-cell-day">' + dayName + '</span>';
    html += '<span class="date-cell-date">' + dateLabel + '</span>';
    html += '<div class="date-cell-dots">' + dotsHtml + '</div>';
    html += '</div>';

    cur.setDate(cur.getDate() + 1);
  }
  container.innerHTML = html;

  // Click handlers
  container.querySelectorAll('.date-cell').forEach(function(cell) {
    cell.addEventListener('click', function() {
      var clickedDate = cell.getAttribute('data-date');
      if (state.selectedDate === clickedDate) {
        state.selectedDate = null;
      } else {
        state.selectedDate = clickedDate;
      }
      // Update selected class on all cells
      container.querySelectorAll('.date-cell').forEach(function(c) {
        c.classList.toggle('selected', c.getAttribute('data-date') === state.selectedDate);
      });
      renderDateFilterMessage();
    });
  });

  // Auto-scroll to today
  scrollDateBarToToday();
  renderDateFilterMessage();
}

/** Scroll the date bar so today's cell is centered */
function scrollDateBarToToday() {
  var container = document.getElementById('activity-date-bar');
  if (!container) return;
  var todayCell = container.querySelector('.date-cell.today');
  if (todayCell) {
    todayCell.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
}

/** Re-render timeline when date filter selection changes */
function renderDateFilterMessage() {
  // Date filter message is now rendered inside mcRenderTimeline
  // Just re-render the timeline when date selection changes
  if (state.activityData) {
    mcRenderTimeline(state.activityData);
  }
}

/** Render stats line inside the expanded drawer */
function renderActivityDrawerStats(data) {
  const statsEl = document.getElementById('activity-drawer-stats');
  if (!statsEl) return;
  const completed = (data.completed || []).length;
  const created = (data.created || []).length;
  const active = (data.active || []).length;
  const tasksDone = (data.tasksDone || []).length;
  statsEl.textContent = completed + ' plans completed \u00B7 ' + created + ' created \u00B7 ' + active + ' active \u00B7 ' + tasksDone + ' tasks done';
}

/** Initialize the activity drawer state, drag resize, and navigation */
function initActivityDrawer() {
  const drawer = document.getElementById('activity-drawer');
  if (!drawer) return;
  const s = state.activityDrawerState;
  // Auto-collapse on medium screens (≤1024px)
  if (window.innerWidth <= 1024 && s === 'expanded' && !localStorage.getItem('activityDrawerState')) {
    state.activityDrawerState = 'collapsed';
    drawer.className = 'activity-drawer collapsed';
    drawer.setAttribute('aria-expanded', 'false');
  } else if (s === 'expanded') {
    drawer.className = 'activity-drawer expanded';
    drawer.setAttribute('aria-expanded', 'true');
    drawer.style.height = isMobileViewport() ? '' : state.activityDrawerHeight + '%';
  } else if (s === 'hidden') {
    drawer.className = 'activity-drawer hidden';
    drawer.setAttribute('aria-expanded', 'false');
    const reopenBtn = document.getElementById('activity-reopen-btn');
    if (reopenBtn) reopenBtn.style.display = 'flex';
  } else {
    drawer.className = 'activity-drawer collapsed';
    drawer.setAttribute('aria-expanded', 'false');
  }
  initDragResize();
  initTimelineNavigation();
  initMobileSwipeDismiss();
  fetchActivitySummary();
}

/** Initialize drag-to-resize on the activity drawer handle */
function initDragResize() {
  const handle = document.getElementById('activity-drag-handle');
  const drawer = document.getElementById('activity-drawer');
  const content = document.getElementById('content-area');
  if (!handle || !drawer || !content) return;

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  function getY(e) {
    return e.touches ? e.touches[0].clientY : e.clientY;
  }

  function onStart(e) {
    if (state.activityDrawerState !== 'expanded') return;
    if (isMobileViewport()) return; // Disable drag resize on mobile
    e.preventDefault();
    dragging = true;
    startY = getY(e);
    startHeight = drawer.offsetHeight;
    drawer.classList.add('dragging');
    drawer.style.transition = 'none';
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const dy = startY - getY(e);
    const contentH = content.offsetHeight;
    const minH = 200;
    const maxH = Math.floor(contentH * 0.7);
    let newH = Math.max(minH, Math.min(maxH, startHeight + dy));
    drawer.style.height = newH + 'px';
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    drawer.classList.remove('dragging');
    drawer.style.transition = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Save as percentage of content area
    const contentH = content.offsetHeight;
    if (contentH > 0) {
      const pct = Math.round((drawer.offsetHeight / contentH) * 100);
      state.activityDrawerHeight = pct;
      localStorage.setItem('activityDrawerHeight', String(pct));
    }
    // Also save pixel height for restore
    localStorage.setItem('mc-activity-height', String(drawer.offsetHeight));
  }

  handle.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  handle.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);

  // Double-click: toggle collapsed/expanded
  handle.addEventListener('dblclick', function() {
    if (state.activityDrawerState === 'expanded') {
      collapseActivityDrawer();
    } else {
      expandActivityDrawer();
    }
  });
}

function mcInitTimelineDates() {
  // Legacy — timeline dates now driven by activity drawer range
}

function mcFmt(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
/** Convert UTC ISO timestamp to local YYYY-MM-DD */
function utcToLocalDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return mcFmt(d);
}
/** Build timeline API URL with timezone offset */
function tlUrl(fromStr, toStr) {
  var tz = new Date().getTimezoneOffset();
  return '/timeline?from=' + fromStr + '&to=' + toStr + '&tz=' + tz;
}

function mcSetRange(range) {
  // Legacy — use setActivityRange() instead
  setActivityRange(range === 'week' ? '7d' : range === 'month' ? '30d' : 'today');
}

/** Load timeline data from API and render it */
async function mcLoadTimeline() {
  const range = getDateRange();
  const fromStr = mcFmt(range.from);
  const toStr = mcFmt(range.to);
  try {
    const data = await api(tlUrl(fromStr, toStr));
    if (data.ok === false) return;
    state.activityData = data;
    mcRenderTimeline(data);
  } catch (e) { console.error('mcLoadTimeline:', e); }
}

/** Render the full timeline grouped by day with sections */
function mcRenderTimeline(data) {
  const body = document.getElementById('activity-drawer-body');
  if (!body) return;

  // Detect new items by comparing with previous snapshot
  const currentKeys = collectItemKeys(data);
  const newKeys = new Set();
  if (previousItemKeys.size > 0) {
    currentKeys.forEach(k => { if (!previousItemKeys.has(k)) newKeys.add(k); });
  }
  previousItemKeys = currentKeys;
  _renderNewKeys = newKeys;

  const completed = data.completed || [];
  const failed = data.failed || [];
  const cancelled = data.cancelled || [];
  const created = data.created || [];
  const active = data.active || [];

  // Build sets of plan IDs that appear in finished/active sections
  const shownPlanIds = new Set();
  completed.forEach(p => { if (p.id) shownPlanIds.add(p.id); });
  failed.forEach(p => { if (p.id) shownPlanIds.add(p.id); });
  cancelled.forEach(p => { if (p.id) shownPlanIds.add(p.id); });
  active.forEach(p => { if (p.id) shownPlanIds.add(p.id); });
  // Only show "created" plans that aren't already shown in another section
  const createdOnly = created.filter(p => !shownPlanIds.has(p.id));

  // Group all items by day (using local dates)
  const days = {};
  const addToDay = (item, dateField, category) => {
    const date = utcToLocalDate(item[dateField]);
    if (!date) return;
    if (!days[date]) days[date] = { completed: [], failed: [], cancelled: [], created: [], active: [] };
    days[date][category].push(item);
  };

  completed.forEach(p => addToDay(p, 'completedAt', 'completed'));
  failed.forEach(p => addToDay(p, 'completedAt', 'failed'));
  cancelled.forEach(p => addToDay(p, 'completedAt', 'cancelled'));
  createdOnly.forEach(p => addToDay(p, 'createdAt', 'created'));
  active.forEach(p => addToDay(p, 'updatedAt', 'active'));

  // Filter by selected date if set
  let sortedDates = Object.keys(days).sort().reverse();
  if (state.selectedDate) {
    sortedDates = sortedDates.filter(d => d === state.selectedDate);
  }

  let html = '';

  // Date filter indicator
  if (state.selectedDate) {
    const fd = new Date(state.selectedDate + 'T12:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const filterLabel = months[fd.getMonth()] + ' ' + fd.getDate();
    html += '<div class="tl-date-filter-bar">';
    html += '<span>Showing ' + filterLabel + ' only</span>';
    html += '<button class="tl-date-filter-clear" onclick="clearDateFilter()">Clear</button>';
    html += '</div>';
  }

  // Empty state
  if (sortedDates.length === 0) {
    html += '<div class="tl-empty"><div class="tl-empty-icon">\u{1F4CA}</div><div>No activity in this period</div></div>';
    body.innerHTML = html;
    return;
  }

  const today = mcFmt(new Date());
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  for (let di = 0; di < sortedDates.length; di++) {
    const date = sortedDates[di];
    const d = new Date(date + 'T12:00:00');
    const dayName = dayNames[d.getDay()];
    const isToday = date === today;
    const todayLabel = isToday ? ' \u2014 Today' : '';
    const day = days[date];

    // Count total plans for this day
    const totalPlans = day.completed.length + day.failed.length + day.cancelled.length + day.created.length + day.active.length;
    const donePlans = day.completed.length;

    // Collapsed state: today defaults expanded, older days collapsed
    if (collapsedDays[date] === undefined) {
      collapsedDays[date] = !isToday;
    }
    const isCollapsed = collapsedDays[date];
    const toggleIcon = isCollapsed ? '\u25B6' : '\u25BC';
    const toggleClass = isCollapsed ? ' collapsed' : '';

    html += '<div class="tl-day-group" data-date="' + date + '">';
    html += '<div class="tl-day-header" onclick="toggleDaySection(\'' + date + '\')">';
    html += '<span class="tl-day-toggle' + toggleClass + '">' + toggleIcon + '</span>';

    const dateLabel = monthNames[d.getMonth()] + ' ' + d.getDate() + ' (' + dayName + ')' + todayLabel;
    html += '<span>' + dateLabel + '</span>';
    html += '<span class="tl-day-count">' + donePlans + '/' + totalPlans + ' plans</span>';
    html += '</div>';

    html += '<div class="tl-day-items' + (isCollapsed ? ' collapsed' : '') + '">';

    // Helper: render a collapsible section (default collapsed, remembers user toggle)
    const renderSection = (secId, icon, label, cssClass, items, renderFn) => {
      if (items.length === 0) return;
      const isOpen = expandedSections[secId] === true;
      const arrow = isOpen ? '\u25BC' : '\u25B6';
      const hideStyle = isOpen ? '' : ' style="display:none"';
      const cls = cssClass ? ' ' + cssClass : '';
      html += '<div class="tl-section-label tl-section-toggle' + cls + '" onclick="toggleTimelineSection(\'' + secId + '\')">';
      html += '<span class="tl-section-icon">' + arrow + '</span> ' + icon + ' ' + label;
      html += '</div>';
      html += '<div class="tl-items-container tl-section-items" id="tl-sec-' + secId + '"' + hideStyle + '>';
      for (let i = 0; i < items.length; i++) {
        html += renderFn(items[i], i === items.length - 1);
      }
      html += '</div>';
    };

    // Sections in order: done, failed, cancelled, active, created (only non-duplicate)
    const totalFinished = day.completed.length + day.failed.length + day.cancelled.length;
    const doneLabel = 'Plans Done (' + day.completed.length + (totalFinished > day.completed.length ? '/' + totalFinished : '') + ')';
    renderSection(date + '-completed', '\u2705', doneLabel, '', day.completed, mcRenderTlPlanItem);
    renderSection(date + '-failed', '\u274C', 'Plans Failed (' + day.failed.length + ')', 'tl-section-failed', day.failed, mcRenderTlPlanItem);
    renderSection(date + '-cancelled', '\u2014', 'Plans Cancelled (' + day.cancelled.length + ')', 'tl-section-cancelled', day.cancelled, mcRenderTlPlanItem);
    renderSection(date + '-active', '\u23F3', 'Plans Active (' + day.active.length + ')', '', day.active, mcRenderTlPlanItem);
    renderSection(date + '-created', '\u{1F4CB}', 'Plans Created (' + day.created.length + ')', '', day.created, mcRenderTlPlanItem);

    html += '</div>'; // tl-day-items
    html += '</div>'; // tl-day-group
  }

  body.innerHTML = html;
  _renderNewKeys = new Set();

  // Remove new-item class after animation completes
  if (newKeys.size > 0) {
    const newItems = body.querySelectorAll('.tl-item.new-item');
    newItems.forEach(el => {
      el.addEventListener('animationend', () => el.classList.remove('new-item'), { once: true });
    });
  }
}

/** Render a plan item in the timeline list */
function mcRenderTlPlanItem(plan, isLast) {
  const tasks = plan.tasks || [];
  const done = tasks.filter(t => t.status === 'done').length;
  const total = tasks.length;
  const statusText = getStatusText(plan.status);
  const meta = [statusText + (total > 0 ? ' (' + done + '/' + total + ')' : '')];
  if (plan.source) meta.push(plan.source);
  const planId = plan.id || '';
  const newCls = _renderNewKeys.has('plan:' + planId) ? ' new-item' : '';
  const title = esc(plan.title);

  const st = plan.status || '';
  return '<div class="tl-item' + newCls + '" data-plan-id="' + esc(planId) + '" data-status="' + esc(st) + '" role="button" tabindex="0" aria-label="' + title + '">' +
    '<div class="tl-connector"></div>' +
    '<div class="tl-item-title">' + title + '</div>' +
    '<div class="tl-item-meta">' + esc(meta.join(' \u00B7 ')) + '</div>' +
    '</div>';
}

/** Render a task item in the timeline list */
function mcRenderTlTaskItem(task, isLast) {
  const meta = [getStatusText(task.status)];
  if (task.type) meta.push(task.type);
  if (task.assignedTo) meta.push(task.assignedTo);
  const taskId = task.id || '';
  const planId = task.planId || '';
  const newCls = _renderNewKeys.has('task:' + taskId) ? ' new-item' : '';
  const title = esc(task.title);

  const st = task.status || '';
  return '<div class="tl-item' + newCls + '" data-task-id="' + esc(taskId) + '" data-plan-id="' + esc(planId) + '" data-status="' + esc(st) + '" role="button" tabindex="0" aria-label="' + title + '">' +
    '<div class="tl-connector"></div>' +
    '<div class="tl-item-title">' + title + '</div>' +
    '<div class="tl-item-meta">' + esc(meta.join(' \u00B7 ')) + '</div>' +
    '</div>';
}

/** Toggle a timeline section between collapsed and expanded */
function toggleTimelineSection(secId) {
  const container = document.getElementById('tl-sec-' + secId);
  const label = container ? container.previousElementSibling : null;
  if (!container || !label) return;
  const isHidden = container.style.display === 'none';
  container.style.display = isHidden ? '' : 'none';
  expandedSections[secId] = isHidden; // true = now expanded
  const icon = label.querySelector('.tl-section-icon');
  if (icon) icon.textContent = isHidden ? '\u25BC' : '\u25B6';
}

/** Toggle a day section between collapsed and expanded */
function toggleDaySection(date) {
  collapsedDays[date] = !collapsedDays[date];
  const group = document.querySelector('.tl-day-group[data-date="' + date + '"]');
  if (!group) return;
  const items = group.querySelector('.tl-day-items');
  const toggle = group.querySelector('.tl-day-toggle');
  if (items) items.classList.toggle('collapsed');
  if (toggle) {
    toggle.classList.toggle('collapsed');
    toggle.textContent = collapsedDays[date] ? '\u25B6' : '\u25BC';
  }
}


/** Clear the date filter and show all days */
function clearDateFilter() {
  state.selectedDate = null;
  // Update date bar selection
  const container = document.getElementById('activity-date-bar');
  if (container) {
    container.querySelectorAll('.date-cell').forEach(c => {
      c.classList.remove('selected');
    });
  }
  if (state.activityData) {
    mcRenderTimeline(state.activityData);
  }
}

// Legacy timeline helpers kept for backward compat
function mcRenderTlPlan(icon, plan) {
  return mcRenderTlPlanItem(plan, false);
}

function mcRenderTlTask(icon, task) {
  return mcRenderTlTaskItem(task, false);
}

// ─── Timeline Navigation ────────────────────────────────

/**
 * Navigate from timeline item to plan detail.
 * Auto-shrinks drawer if it takes >50% of content area.
 */
function navigateTimelineToPlan(planId) {
  if (!planId) return;
  mobileCloseAndNavigate(function() {
    autoShrinkDrawer();
    selectPlan(planId);
  });
}

/**
 * Navigate from timeline task item to task card in plan detail.
 * Selects parent plan, then scrolls to and flashes the task card.
 */
async function navigateTimelineToTask(planId, taskId) {
  if (!planId || !taskId) return;
  mobileCloseAndNavigate(async function() {
    autoShrinkDrawer();
    state.currentPlanId = planId;
    closeSidebar();
    renderSidebar();
    const plan = await fetchPlan(planId);
    if (plan) renderPlanDetail(plan);
    // Scroll to task card after render
    setTimeout(function() {
      const taskCard = document.querySelector('.task-card[data-task-id="' + taskId + '"]');
      if (taskCard) {
        taskCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        taskCard.classList.add('flash');
        taskCard.addEventListener('animationend', function() {
          taskCard.classList.remove('flash');
        }, { once: true });
      }
    }, 100);
  });
}

/**
 * Auto-shrink drawer to 35% if it's taking >50% of content area.
 */
function autoShrinkDrawer() {
  if (state.activityDrawerState !== 'expanded') return;
  const content = document.getElementById('content-area');
  const drawer = document.getElementById('activity-drawer');
  if (!content || !drawer) return;
  const contentH = content.offsetHeight;
  if (contentH <= 0) return;
  const drawerH = drawer.offsetHeight;
  if (drawerH / contentH > 0.5) {
    const targetPct = 35;
    state.activityDrawerHeight = targetPct;
    localStorage.setItem('activityDrawerHeight', String(targetPct));
    drawer.style.height = targetPct + '%';
  }
}

/**
 * Highlight a plan's timeline item (reverse navigation from plan detail).
 * Auto-expands drawer if collapsed/hidden, waits for timeline to load.
 */
function highlightTimelineItem(planId) {
  if (!planId) return;

  // If drawer not expanded, expand it and retry after data loads
  if (state.activityDrawerState !== 'expanded') {
    console.log('[DEBUG-HL] drawer not expanded, expanding...');
    try { expandActivityDrawer(); } catch(e) { /* test env */ }
    setTimeout(function() { _doHighlightTimelineItem(planId); }, 800);
    return;
  }
  _doHighlightTimelineItem(planId);
}

/** Internal: perform the actual highlight after drawer is ready */
function _doHighlightTimelineItem(planId) {
  var item = document.querySelector('#activity-drawer-body .tl-item[data-plan-id="' + planId + '"]');
  if (!item) {
    // Plan not in timeline DOM — try to sync date bar to plan's date anyway
    var plan = (state.plans || []).find(function(p) { return p.id === planId; });
    if (plan) {
      var planDate = utcToLocalDate(plan.completedAt || plan.createdAt);
      if (planDate && state.selectedDate !== planDate) {
        state.selectedDate = planDate;
        var dateBar = document.getElementById('activity-date-bar');
        if (dateBar) {
          dateBar.querySelectorAll('.date-cell').forEach(function(c) {
            c.classList.toggle('selected', c.getAttribute('data-date') === planDate);
          });
          // Scroll date bar to the selected cell
          var cell = dateBar.querySelector('.date-cell[data-date="' + planDate + '"]');
          if (cell) cell.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        }
        if (state.activityData) {
          mcRenderTimeline(state.activityData);
          // Retry finding the item after re-render
          item = document.querySelector('#activity-drawer-body .tl-item[data-plan-id="' + planId + '"]');
        }
      }
    }
    if (!item) return;
  }

  // Sync date bar to the plan's day
  var dayGroup = item.closest('.tl-day-group');
  var planDate = dayGroup ? dayGroup.getAttribute('data-date') : null;
  if (planDate && state.selectedDate !== planDate) {
    state.selectedDate = planDate;
    // Update date bar cell selection
    var dateBar = document.getElementById('activity-date-bar');
    if (dateBar) {
      dateBar.querySelectorAll('.date-cell').forEach(function(c) {
        c.classList.toggle('selected', c.getAttribute('data-date') === planDate);
      });
    }
    // Re-render timeline filtered to that date, then highlight
    if (state.activityData) {
      mcRenderTimeline(state.activityData);
      // Re-query item after re-render
      item = document.querySelector('#activity-drawer-body .tl-item[data-plan-id="' + planId + '"]');
      if (!item) return;
      dayGroup = item.closest('.tl-day-group');
    }
  }

  // Expand collapsed day section if needed
  if (dayGroup) {
    var dayItems = dayGroup.querySelector('.tl-day-items');
    if (dayItems && dayItems.classList.contains('collapsed')) {
      var date = dayGroup.getAttribute('data-date');
      if (date) toggleDaySection(date);
    }
  }
  // Expand collapsed timeline section (e.g. "Plans Done") if needed
  var sectionContainer = item.closest('.tl-section-items');
  if (sectionContainer && sectionContainer.style.display === 'none') {
    var secId = sectionContainer.id ? sectionContainer.id.replace('tl-sec-', '') : '';
    if (secId) toggleTimelineSection(secId);
  }
  item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  item.classList.add('highlight');
  item.addEventListener('animationend', function() {
    item.classList.remove('highlight');
  }, { once: true });
}


/**
 * Initialize click and keyboard handlers for timeline navigation.
 * Uses event delegation on the drawer body.
 */
function initTimelineNavigation() {
  const body = document.getElementById('activity-drawer-body');
  if (!body) return;

  function handleItemActivation(item) {
    const taskId = item.getAttribute('data-task-id');
    const planId = item.getAttribute('data-plan-id');
    item.classList.add('highlight');
    item.addEventListener('animationend', function() {
      item.classList.remove('highlight');
    }, { once: true });
    if (taskId && planId) {
      navigateTimelineToTask(planId, taskId);
    } else if (planId) {
      navigateTimelineToPlan(planId);
    }
  }

  body.addEventListener('click', function(e) {
    const item = e.target.closest('.tl-item');
    if (!item) return;
    handleItemActivation(item);
  });

  // Keyboard: Enter/Space on focused .tl-item triggers navigation
  body.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.tl-item');
    if (!item) return;
    e.preventDefault();
    handleItemActivation(item);
  });
}

// Init — no longer needs date inputs
mcInitTimelineDates();

// ─── Mobile Swipe-Down to Dismiss ───────────────────────

/**
 * Initialize swipe-down gesture on the activity drawer header.
 * Only active when viewport ≤768px and drawer is expanded (full-screen overlay).
 * Swipe down >120px to dismiss, otherwise snap back.
 */
function initMobileSwipeDismiss() {
  const header = document.querySelector('.activity-drawer-header');
  if (!header) return;

  let startY = 0;
  let currentY = 0;
  let swiping = false;

  header.addEventListener('touchstart', function(e) {
    if (!isMobileViewport()) return;
    if (state.activityDrawerState !== 'expanded') return;
    startY = e.touches[0].clientY;
    currentY = startY;
    swiping = true;
    header.classList.add('swiping');
  }, { passive: true });

  header.addEventListener('touchmove', function(e) {
    if (!swiping) return;
    currentY = e.touches[0].clientY;
    const dy = currentY - startY;
    if (dy > 0) {
      // Only allow downward swipe, cap visual at 150px
      header.style.transform = 'translateY(' + Math.min(dy, 150) + 'px)';
    }
  }, { passive: true });

  header.addEventListener('touchend', function() {
    if (!swiping) return;
    swiping = false;
    const dy = currentY - startY;
    header.style.transform = '';
    header.classList.remove('swiping');
    if (dy > 120) {
      collapseActivityDrawer();
    }
  });
}

// ─── Mobile Navigation Helper ───────────────────────────

/**
 * On mobile, close the overlay before navigating to plan detail.
 * Adds a brief delay so the transition completes before rendering plan.
 */
function mobileCloseAndNavigate(callback) {
  if (isMobileViewport() && state.activityDrawerState === 'expanded') {
    collapseActivityDrawer();
    setTimeout(callback, 200);
  } else {
    callback();
  }
}
