/**
 * MissionControlDB unit tests
 */
const MissionControlDB = require('./mission-control-db');

function run() {
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) { passed++; console.log(`  ✅ ${msg}`); }
    else { failed++; console.error(`  ❌ ${msg}`); }
  }

  // Use in-memory DB for tests
  const db = new MissionControlDB(':memory:');

  // --- Default Project ---
  console.log('\n[Default Project]');
  const defProject = db.getProject('default');
  assert(defProject !== null, 'default project exists');
  assert(defProject.name === 'MyKiroHero', 'default project name is MyKiroHero');

  const projects = db.listProjects();
  assert(projects.length === 1, 'listProjects returns 1');

  // --- Create Plan ---
  console.log('\n[Create Plan]');
  const plan1 = db.createPlan({ title: 'Build feature X', description: 'Need a new feature' });
  assert(plan1.id.startsWith('plan-'), `planId starts with plan-: ${plan1.id}`);
  assert(plan1.status === 'pending', 'new plan status is pending');

  const plan2 = db.createPlan({
    title: 'Fix bug Y',
    description: 'Critical bug',
    source: 'whatsapp',
    sourceInfo: { chatId: '886912345678@c.us' },
  });
  assert(plan2.id !== plan1.id, 'plan IDs are unique');

  // --- Get Plan ---
  console.log('\n[Get Plan]');
  const fetched = db.getPlan(plan1.id);
  assert(fetched !== null, 'getPlan returns plan');
  assert(fetched.title === 'Build feature X', 'title matches');
  assert(fetched.projectId === 'default', 'default projectId');
  assert(Array.isArray(fetched.tasks), 'tasks is array');
  assert(fetched.tasks.length === 0, 'no tasks yet');
  assert(db.getPlan('nonexistent') === null, 'nonexistent returns null');

  // --- List Plans ---
  console.log('\n[List Plans]');
  const allPlans = db.listPlans();
  assert(allPlans.length === 2, `listPlans returns 2 (got ${allPlans.length})`);

  const filtered = db.listPlans({ status: 'pending' });
  assert(filtered.length === 2, 'filter by status works');

  const limited = db.listPlans({ limit: 1 });
  assert(limited.length === 1, 'limit works');

  // --- Update Plan ---
  console.log('\n[Update Plan]');
  const updated = db.updatePlan(plan1.id, { strategy: '## Step 1\nDo this', status: 'planning' });
  assert(updated === true, 'updatePlan returns true');
  const afterUpdate = db.getPlan(plan1.id);
  assert(afterUpdate.strategy === '## Step 1\nDo this', 'strategy updated');
  assert(afterUpdate.status === 'planning', 'status updated to planning');
  assert(afterUpdate.updatedAt > afterUpdate.createdAt, 'updatedAt changed');

  assert(db.updatePlan('nonexistent', { status: 'done' }) === false, 'update nonexistent returns false');
  assert(db.updatePlan(plan1.id, {}) === false, 'update with empty fields returns false');
  assert(db.updatePlan(plan1.id, { badField: 'x' }) === false, 'update with invalid field returns false');

  // --- Create Task ---
  console.log('\n[Create Task]');
  const task1 = db.createTask({
    planId: plan1.id,
    title: 'Setup DB',
    description: 'Create SQLite schema',
    type: 'layer3',
    action: 'worker-dispatch',
    params: { repo: 'MyKiroHero' },
    orderIndex: 0,
  });
  assert(task1.id.startsWith('mctask-'), `taskId starts with mctask-: ${task1.id}`);
  assert(task1.status === 'pending', 'new task status is pending');

  const task2 = db.createTask({
    planId: plan1.id,
    title: 'Write API',
    orderIndex: 1,
  });

  const task3 = db.createTask({
    planId: plan1.id,
    title: 'Write tests',
    orderIndex: 2,
    timeout: 600,
  });

  // --- Get Task ---
  console.log('\n[Get Task]');
  const fetchedTask = db.getTask(task1.id);
  assert(fetchedTask !== null, 'getTask returns task');
  assert(fetchedTask.title === 'Setup DB', 'title matches');
  assert(fetchedTask.type === 'layer3', 'type is layer3');
  assert(fetchedTask.timeout === 300, 'default timeout is 300');
  assert(fetchedTask.progressLog === '[]', 'progressLog starts as empty JSON array');
  assert(db.getTask('nonexistent') === null, 'nonexistent returns null');

  const t3 = db.getTask(task3.id);
  assert(t3.timeout === 600, 'custom timeout preserved');

  // --- List Tasks by Plan ---
  console.log('\n[List Tasks by Plan]');
  const planTasks = db.listTasksByPlan(plan1.id);
  assert(planTasks.length === 3, `3 tasks for plan1 (got ${planTasks.length})`);
  assert(planTasks[0].orderIndex === 0, 'ordered by orderIndex');
  assert(planTasks[1].orderIndex === 1, 'second task orderIndex 1');
  assert(planTasks[2].orderIndex === 2, 'third task orderIndex 2');

  // getPlan includes tasks
  const planWithTasks = db.getPlan(plan1.id);
  assert(planWithTasks.tasks.length === 3, 'getPlan includes tasks');

  // --- Update Task ---
  console.log('\n[Update Task]');
  db.updateTask(task1.id, { status: 'queued', execTaskId: 'task-20260216-120000-abc' });
  const queued = db.getTask(task1.id);
  assert(queued.status === 'queued', 'status updated to queued');
  assert(queued.execTaskId === 'task-20260216-120000-abc', 'execTaskId set');

  db.updateTask(task1.id, { status: 'running', assignedTo: 'Worker-1', startedAt: new Date().toISOString() });
  const running = db.getTask(task1.id);
  assert(running.status === 'running', 'status updated to running');
  assert(running.assignedTo === 'Worker-1', 'assignedTo set');
  assert(running.startedAt !== null, 'startedAt set');

  db.updateTask(task1.id, {
    status: 'done',
    output: 'Schema created successfully',
    result: JSON.stringify({ success: true }),
    completedAt: new Date().toISOString(),
  });
  const done = db.getTask(task1.id);
  assert(done.status === 'done', 'status updated to done');
  assert(done.output === 'Schema created successfully', 'output set');
  assert(done.completedAt !== null, 'completedAt set');

  // --- Append Progress ---
  console.log('\n[Append Progress]');
  db.appendProgress(task2.id, 'Starting API routes');
  db.appendProgress(task2.id, 'GET /plans done');
  db.appendProgress(task2.id, 'POST /plans done');
  const withProgress = db.getTask(task2.id);
  const log = JSON.parse(withProgress.progressLog);
  assert(log.length === 3, `progressLog has 3 entries (got ${log.length})`);
  assert(log[0].message === 'Starting API routes', 'first message correct');
  assert(log[2].message === 'POST /plans done', 'third message correct');
  assert(log[0].timestamp, 'entry has timestamp');

  assert(db.appendProgress('nonexistent', 'nope') === false, 'appendProgress on nonexistent returns false');

  // --- Find by ExecTaskId ---
  console.log('\n[Find by ExecTaskId]');
  const found = db.findByExecTaskId('task-20260216-120000-abc');
  assert(found !== null, 'findByExecTaskId returns task');
  assert(found.id === task1.id, 'correct MC task found');
  assert(db.findByExecTaskId('nonexistent') === null, 'nonexistent returns null');

  // --- Stats ---
  console.log('\n[Stats]');
  const mockRegistry = {
    list: () => [
      { workerId: 'Worker-1', status: 'idle', port: 3001 },
      { workerId: 'Worker-2', status: 'busy', port: 3002 },
    ],
  };
  const stats = db.getStats(mockRegistry);
  assert(stats.activePlans >= 1, `activePlans >= 1 (got ${stats.activePlans})`);
  assert(stats.todayTasks >= 3, `todayTasks >= 3 (got ${stats.todayTasks})`);
  assert(stats.workers.length === 2, 'workers from registry');

  const statsNoRegistry = db.getStats(null);
  assert(Array.isArray(statsNoRegistry.workers), 'workers is array even without registry');
  assert(statsNoRegistry.workers.length === 0, 'empty workers without registry');

  // --- Archive (soft delete) ---
  console.log('\n[Archive]');
  db.updatePlan(plan2.id, { status: 'archived' });
  const archived = db.getPlan(plan2.id);
  assert(archived.status === 'archived', 'plan archived');
  const nonArchived = db.listPlans({ status: 'pending' });
  assert(nonArchived.every(p => p.id !== plan2.id), 'archived plan not in pending list');

  // --- Close ---
  console.log('\n[Close]');
  db.close();
  assert(db.db === null, 'db set to null after close');

  // --- Summary ---
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
