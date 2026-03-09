/**
 * Mission Control REST API Routes — Unit Tests
 * 
 * Tests all 9 endpoints using in-memory DB + mock gateway/executor
 */
const http = require('http');
const express = require('express');
const MissionControlDB = require('./mission-control-db');
const createRoutes = require('./mission-control-routes');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

// ─── Mock Gateway + TaskExecutor ──────────────────────

function createMocks() {
  const broadcasts = [];
  const gateway = {
    workerRegistry: {
      list: () => [{ workerId: 'W-1', status: 'idle', port: 3001 }],
    },
    broadcast: (msg) => broadcasts.push(msg),
  };

  let submitCount = 0;
  const taskExecutor = {
    submitTask: async (opts) => {
      submitCount++;
      return { taskId: `exec-task-${submitCount}` };
    },
  };

  return { gateway, taskExecutor, broadcasts, getSubmitCount: () => submitCount };
}

// ─── HTTP helpers ─────────────────────────────────────

function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: `/api/mc${path}`,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const GET = (s, p) => request(s, 'GET', p);
const POST = (s, p, b) => request(s, 'POST', p, b);
const PATCH = (s, p, b) => request(s, 'PATCH', p, b);
const DELETE = (s, p) => request(s, 'DELETE', p);

// ─── Test Runner ──────────────────────────────────────

async function run() {
  const db = new MissionControlDB(':memory:');
  const { gateway, taskExecutor, broadcasts } = createMocks();

  const app = express();
  app.use(express.json());
  app.use('/api/mc', createRoutes(db, taskExecutor, gateway));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    // ─── GET /stats ───────────────────────────────────
    console.log('\n[GET /stats]');
    const stats = await GET(server, '/stats');
    assert(stats.status === 200, 'stats returns 200');
    assert(stats.body.activePlans !== undefined, 'has activePlans');
    assert(stats.body.todayTasks !== undefined, 'has todayTasks');
    assert(Array.isArray(stats.body.workers), 'has workers array');

    // ─── POST /plans ──────────────────────────────────
    console.log('\n[POST /plans]');
    const create1 = await POST(server, '/plans', {
      title: 'Test Plan A',
      description: 'A test plan',
      strategy: '## Strategy\nDo stuff',
      tasks: [
        { title: 'Task 1', type: 'layer1', action: 'echo', params: { msg: 'hi' } },
        { title: 'Task 2', type: 'layer3', action: 'worker-dispatch' },
      ],
    });
    assert(create1.status === 200, 'create plan returns 200');
    assert(create1.body.id.startsWith('plan-'), `plan id starts with plan-`);
    assert(create1.body.strategy === '## Strategy\nDo stuff', 'strategy set');
    assert(create1.body.tasks.length === 2, 'inline tasks created');
    assert(create1.body.tasks[0].title === 'Task 1', 'task 1 title');
    assert(create1.body.tasks[1].orderIndex === 1, 'task 2 auto orderIndex');
    const planId = create1.body.id;

    // Missing title
    const noTitle = await POST(server, '/plans', { description: 'no title' });
    assert(noTitle.status === 400, 'missing title returns 400');

    // Broadcast check
    assert(broadcasts.length >= 1, 'plan_created broadcast sent');
    assert(broadcasts[0].type === 'mc:plan_created', 'broadcast type is mc:plan_created');

    // ─── GET /plans ───────────────────────────────────
    console.log('\n[GET /plans]');
    const list1 = await GET(server, '/plans');
    assert(list1.status === 200, 'list plans returns 200');
    assert(list1.body.length >= 1, 'at least 1 plan');

    const filtered = await GET(server, '/plans?status=planning');
    assert(filtered.status === 200, 'filter by status works');

    const limited = await GET(server, '/plans?limit=1');
    assert(limited.body.length === 1, 'limit works');

    // ─── GET /plans/:id ───────────────────────────────
    console.log('\n[GET /plans/:id]');
    const get1 = await GET(server, `/plans/${planId}`);
    assert(get1.status === 200, 'get plan returns 200');
    assert(get1.body.title === 'Test Plan A', 'title matches');
    assert(get1.body.tasks.length === 2, 'includes tasks');

    const get404 = await GET(server, '/plans/nonexistent');
    assert(get404.status === 404, 'nonexistent plan returns 404');

    // ─── PATCH /plans/:id ─────────────────────────────
    console.log('\n[PATCH /plans/:id]');
    broadcasts.length = 0;
    const patch1 = await PATCH(server, `/plans/${planId}`, { status: 'active', title: 'Updated Plan A' });
    assert(patch1.status === 200, 'patch plan returns 200');
    assert(patch1.body.status === 'active', 'status updated');
    assert(patch1.body.title === 'Updated Plan A', 'title updated');
    assert(broadcasts.some(b => b.type === 'mc:plan_updated'), 'plan_updated broadcast sent');

    const patch404 = await PATCH(server, '/plans/nonexistent', { status: 'done' });
    assert(patch404.status === 404, 'patch nonexistent returns 404');

    // ─── DELETE /plans/:id (archive) ──────────────────
    console.log('\n[DELETE /plans/:id]');
    // Create a throwaway plan to archive
    const plan2 = await POST(server, '/plans', { title: 'To Archive' });
    const archiveRes = await DELETE(server, `/plans/${plan2.body.id}`);
    assert(archiveRes.status === 200, 'archive returns 200');
    assert(archiveRes.body.status === 'archived', 'status is archived');

    const afterArchive = await GET(server, `/plans/${plan2.body.id}`);
    assert(afterArchive.body.status === 'archived', 'plan is archived in DB');

    const del404 = await DELETE(server, '/plans/nonexistent');
    assert(del404.status === 404, 'archive nonexistent returns 404');

    // ─── POST /plans/:id/tasks ────────────────────────
    console.log('\n[POST /plans/:id/tasks]');
    broadcasts.length = 0;
    const addTask = await POST(server, `/plans/${planId}/tasks`, {
      title: 'Task 3',
      description: 'Added later',
      type: 'layer2',
      action: 'crawl',
    });
    assert(addTask.status === 200, 'add task returns 200');
    assert(addTask.body.title === 'Task 3', 'task title matches');
    assert(addTask.body.orderIndex === 2, 'auto orderIndex = max+1');
    assert(broadcasts.some(b => b.type === 'mc:task_status'), 'task_status broadcast sent');

    const addNoTitle = await POST(server, `/plans/${planId}/tasks`, { description: 'no title' });
    assert(addNoTitle.status === 400, 'missing task title returns 400');

    const addTo404 = await POST(server, '/plans/nonexistent/tasks', { title: 'X' });
    assert(addTo404.status === 404, 'add task to nonexistent plan returns 404');

    // ─── PATCH /tasks/:id ─────────────────────────────
    console.log('\n[PATCH /tasks/:id]');
    const taskId = create1.body.tasks[0].id;
    broadcasts.length = 0;
    const patchTask = await PATCH(server, `/tasks/${taskId}`, {
      status: 'running',
      assignedTo: 'Worker-1',
      startedAt: new Date().toISOString(),
    });
    assert(patchTask.status === 200, 'patch task returns 200');
    assert(patchTask.body.status === 'running', 'task status updated');
    assert(patchTask.body.assignedTo === 'Worker-1', 'assignedTo set');
    assert(broadcasts.some(b => b.type === 'mc:task_status'), 'task_status broadcast on patch');

    const patchTask404 = await PATCH(server, '/tasks/nonexistent', { status: 'done' });
    assert(patchTask404.status === 404, 'patch nonexistent task returns 404');

    // ─── POST /plans/:id/execute ──────────────────────
    console.log('\n[POST /plans/:id/execute]');
    // Create a fresh plan with pending tasks for execution
    const execPlan = await POST(server, '/plans', {
      title: 'Exec Plan',
      tasks: [
        { title: 'Exec T1', action: 'echo', params: { msg: 'a' } },
        { title: 'Exec T2', action: 'echo', params: { msg: 'b' } },
      ],
    });
    broadcasts.length = 0;
    const execRes = await POST(server, `/plans/${execPlan.body.id}/execute`);
    assert(execRes.status === 200, 'execute returns 200');
    assert(execRes.body.status === 'active', 'plan becomes active');
    assert(execRes.body.submitted === 2, '2 tasks submitted');
    assert(execRes.body.errors.length === 0, 'no errors');

    // Execute again — no pending tasks
    const execAgain = await POST(server, `/plans/${execPlan.body.id}/execute`);
    assert(execAgain.status === 400, 'no pending tasks returns 400');

    const exec404 = await POST(server, '/plans/nonexistent/execute');
    assert(exec404.status === 404, 'execute nonexistent returns 404');

    // ─── Execute single task with ?taskId ─────────────
    console.log('\n[POST /plans/:id/execute?taskId=...]');
    const singleExecPlan = await POST(server, '/plans', {
      title: 'Single Exec Plan',
      tasks: [
        { title: 'SE T1', action: 'echo', params: { msg: 'a' } },
        { title: 'SE T2', action: 'echo', params: { msg: 'b' } },
        { title: 'SE T3', action: 'echo', params: { msg: 'c' } },
      ],
    });
    const seTasks = singleExecPlan.body.tasks;
    const seT2Id = seTasks[1].id;

    // Execute only task 2
    broadcasts.length = 0;
    const singleRes = await POST(server, `/plans/${singleExecPlan.body.id}/execute?taskId=${seT2Id}`);
    assert(singleRes.status === 200, 'single task execute returns 200');
    assert(singleRes.body.submitted === 1, 'only 1 task submitted');
    assert(singleRes.body.errors.length === 0, 'no errors');

    // Task 1 and 3 should still be pending
    const seDetail = await GET(server, `/plans/${singleExecPlan.body.id}`);
    const seT1 = seDetail.body.tasks.find(t => t.title === 'SE T1');
    const seT3 = seDetail.body.tasks.find(t => t.title === 'SE T3');
    assert(seT1.status === 'pending', 'task 1 still pending after single execute');
    assert(seT3.status === 'pending', 'task 3 still pending after single execute');

    // Execute with nonexistent taskId
    const seNotFound = await POST(server, `/plans/${singleExecPlan.body.id}/execute?taskId=nonexistent`);
    assert(seNotFound.status === 404, 'nonexistent taskId returns 404');

    // Execute with taskId that is not pending (already queued from above)
    const seNotPending = await POST(server, `/plans/${singleExecPlan.body.id}/execute?taskId=${seT2Id}`);
    assert(seNotPending.status === 400, 'non-pending taskId returns 400');
    assert(seNotPending.body.error.includes('not pending'), 'error mentions not pending');

    // ─── Execute with partial failure ─────────────────
    console.log('\n[Execute — partial failure]');
    const failPlan = await POST(server, '/plans', {
      title: 'Fail Plan',
      tasks: [
        { title: 'Good Task', action: 'echo', params: { msg: 'ok' } },
        { title: 'Bad Task', action: 'fail', params: {} },
      ],
    });
    // Override submitTask to fail on second call
    let callNum = 0;
    const origSubmit = taskExecutor.submitTask;
    taskExecutor.submitTask = async (opts) => {
      callNum++;
      if (callNum === 2) throw new Error('Worker unavailable');
      return origSubmit(opts);
    };
    callNum = 0;
    const partialRes = await POST(server, `/plans/${failPlan.body.id}/execute`);
    assert(partialRes.body.status === 'active', 'partial failure → still active');
    assert(partialRes.body.errors.length === 1, '1 error reported');
    assert(partialRes.body.submitted === 1, '1 task submitted');
    taskExecutor.submitTask = origSubmit; // restore

    // All fail
    const allFailPlan = await POST(server, '/plans', {
      title: 'All Fail Plan',
      tasks: [{ title: 'T1', action: 'x' }],
    });
    taskExecutor.submitTask = async () => { throw new Error('nope'); };
    const allFailRes = await POST(server, `/plans/${allFailPlan.body.id}/execute`);
    assert(allFailRes.body.status === 'failed', 'all fail → plan failed');
    assert(allFailRes.body.submitted === 0, '0 submitted');
    taskExecutor.submitTask = origSubmit; // restore

    // ─── POST /plans/analyze ──────────────────────────
    console.log('\n[POST /plans/analyze]');
    broadcasts.length = 0;
    const analyze1 = await POST(server, '/plans/analyze', {
      requirement: '幫我建一個 TODO app，要有 CRUD 功能',
      source: 'dashboard',
    });
    assert(analyze1.status === 200, 'analyze returns 200');
    assert(analyze1.body.id.startsWith('plan-'), 'analyze creates plan with id');
    assert(analyze1.body.status === 'planning', 'plan status is planning');
    assert(analyze1.body.title.includes('TODO'), 'title derived from requirement');
    assert(broadcasts.some(b => b.type === 'mc:plan_created'), 'plan_created broadcast on analyze');
    const analyzePlanId = analyze1.body.id;

    // Check analysis meta-task was created
    const analyzePlanDetail = await GET(server, `/plans/${analyzePlanId}`);
    const analyzeMetaTask = (analyzePlanDetail.body.tasks || []).find(t => t.action === 'plan-analyze');
    assert(analyzeMetaTask !== undefined, 'analysis meta-task created');
    assert(analyzeMetaTask.orderIndex === -1, 'meta-task orderIndex is -1');
    assert(analyzeMetaTask.status === 'running', 'meta-task status is running');

    // Missing requirement
    const analyzeNoReq = await POST(server, '/plans/analyze', { source: 'test' });
    assert(analyzeNoReq.status === 400, 'missing requirement returns 400');

    const analyzeEmpty = await POST(server, '/plans/analyze', { requirement: '   ' });
    assert(analyzeEmpty.status === 400, 'empty requirement returns 400');

    // Fallback when no Worker available
    taskExecutor.submitTask = async () => { throw new Error('No worker'); };
    broadcasts.length = 0;
    const analyzeFallback = await POST(server, '/plans/analyze', {
      requirement: '測試 fallback',
    });
    assert(analyzeFallback.status === 200, 'fallback returns 200');
    assert(analyzeFallback.body.status === 'pending', 'fallback plan status is pending');
    assert(analyzeFallback.body.strategy && analyzeFallback.body.strategy.includes('⚠️'), 'fallback strategy has warning');
    taskExecutor.submitTask = origSubmit; // restore

    // ─── PATCH /plans/:id/analysis ────────────────────
    console.log('\n[PATCH /plans/:id/analysis]');
    broadcasts.length = 0;
    const analysisRes = await PATCH(server, `/plans/${analyzePlanId}/analysis`, {
      strategy: '先建 DB，再寫 API，最後做前端',
      tasks: [
        { title: '建立 DB schema', description: '用 SQLite 建表' },
        { title: '寫 REST API', description: 'CRUD endpoints', type: 'layer3' },
        { title: '做前端 UI', description: 'HTML + CSS + JS' },
      ],
    });
    assert(analysisRes.status === 200, 'analysis returns 200');
    assert(analysisRes.body.strategy === '先建 DB，再寫 API，最後做前端', 'strategy set');
    assert(analysisRes.body.status === 'pending', 'plan status changed to pending');

    // Check tasks created (excluding meta-task)
    const realAnalysisTasks = (analysisRes.body.tasks || []).filter(t => t.action !== 'plan-analyze');
    assert(realAnalysisTasks.length === 3, '3 real tasks created');
    assert(realAnalysisTasks[0].title === '建立 DB schema', 'task 1 title correct');
    assert(realAnalysisTasks[0].orderIndex === 0, 'task 1 orderIndex is 0');
    assert(realAnalysisTasks[2].orderIndex === 2, 'task 3 orderIndex is 2');

    // Check analysis meta-task marked done
    const doneMetaTask = (analysisRes.body.tasks || []).find(t => t.action === 'plan-analyze');
    assert(doneMetaTask && doneMetaTask.status === 'done', 'analysis meta-task marked done');

    assert(broadcasts.some(b => b.type === 'mc:plan_updated'), 'plan_updated broadcast on analysis');

    // Analysis on nonexistent plan
    const analysis404 = await PATCH(server, '/plans/nonexistent/analysis', {
      strategy: 'test', tasks: [],
    });
    assert(analysis404.status === 404, 'analysis on nonexistent plan returns 404');

    // Analysis with empty tasks array (just strategy update)
    const stratOnlyPlan = await POST(server, '/plans/analyze', { requirement: '只更新策略' });
    const stratOnly = await PATCH(server, `/plans/${stratOnlyPlan.body.id}/analysis`, {
      strategy: '只有策略，沒有 tasks',
      tasks: [],
    });
    assert(stratOnly.status === 200, 'strategy-only analysis returns 200');
    assert(stratOnly.body.strategy === '只有策略，沒有 tasks', 'strategy-only: strategy set');
    assert(stratOnly.body.status === 'pending', 'strategy-only: status is pending');

    // ─── GET /templates ─────────────────────────────────
    console.log('\n[GET /templates]');
    const tplRes = await GET(server, '/templates');
    assert(tplRes.status === 200, 'templates returns 200');
    assert(Array.isArray(tplRes.body), 'templates is array');
    assert(tplRes.body.length === 6, 'has 6 templates');
    assert(tplRes.body.find(t => t.key === 'spec-writing'), 'includes spec-writing');
    assert(tplRes.body.find(t => t.key === 'research'), 'includes research');
    assert(tplRes.body.every(t => t.key && t.name && t.description), 'all have key, name, description');

    // ─── POST /plans/:id/tasks with template ────────────
    console.log('\n[POST /plans/:id/tasks with template]');
    const tplPlan = await POST(server, '/plans', { title: 'Template test plan' });
    const tplPlanId = tplPlan.body.id;

    // Add spec-writing task
    const specTask = await POST(server, `/plans/${tplPlanId}/tasks`, {
      title: '撰寫 API 規格',
      description: '設計 REST API 的完整規格文件',
      template: 'spec-writing',
    });
    assert(specTask.status === 200, 'spec-writing task created');
    assert(specTask.body.type === 'layer3', 'spec task type is layer3');
    assert(specTask.body.action === 'worker-dispatch', 'spec task action is worker-dispatch');
    const specParams = JSON.parse(specTask.body.params);
    assert(specParams.template === 'spec-writing', 'spec task params has template');
    assert(specParams.description === '設計 REST API 的完整規格文件', 'spec task params has description');

    // Add research task
    const researchTask = await POST(server, `/plans/${tplPlanId}/tasks`, {
      title: '調查 SQLite WAL mode',
      template: 'research',
    });
    assert(researchTask.status === 200, 'research task created');
    assert(researchTask.body.type === 'layer3', 'research task type is layer3');
    const researchParams = JSON.parse(researchTask.body.params);
    assert(researchParams.template === 'research', 'research task params has template');

    // Add task without template (should still work as before)
    const plainTask = await POST(server, `/plans/${tplPlanId}/tasks`, {
      title: '手動任務',
    });
    assert(plainTask.status === 200, 'plain task created');
    assert(!plainTask.body.params || plainTask.body.params === '{}' || plainTask.body.params === null || plainTask.body.params === undefined, 'plain task has no template params');

    // Invalid template
    const badTpl = await POST(server, `/plans/${tplPlanId}/tasks`, {
      title: 'Bad template',
      template: 'nonexistent-template',
    });
    assert(badTpl.status === 400, 'invalid template returns 400');
    assert(badTpl.body.error.includes('Unknown template'), 'error mentions unknown template');

    // Template with custom action (action should override default)
    const customAction = await POST(server, `/plans/${tplPlanId}/tasks`, {
      title: 'Custom action task',
      template: 'bug-fix',
      action: 'custom-handler',
      type: 'layer2',
    });
    assert(customAction.status === 200, 'custom action task created');
    assert(customAction.body.action === 'custom-handler', 'custom action overrides default');
    assert(customAction.body.type === 'layer2', 'custom type overrides default');

    // ─── Projects CRUD ──────────────────────────────────
    console.log('\n[GET /projects]');
    const projList = await GET(server, '/projects');
    assert(projList.status === 200, 'list projects returns 200');
    assert(Array.isArray(projList.body), 'projects is array');
    assert(projList.body.length >= 1, 'has at least default project');
    assert(projList.body.find(p => p.id === 'default'), 'default project exists');
    const defProj = projList.body.find(p => p.id === 'default');
    assert(typeof defProj.planCount === 'number', 'default project has planCount');

    console.log('\n[POST /projects]');
    const newProj = await POST(server, '/projects', { id: 'side-project', name: 'Side Project', description: 'A side project' });
    assert(newProj.status === 200, 'create project returns 200');
    assert(newProj.body.id === 'side-project', 'project id correct');
    assert(newProj.body.name === 'Side Project', 'project name correct');

    const dupProj = await POST(server, '/projects', { id: 'side-project', name: 'Dup' });
    assert(dupProj.status === 409, 'duplicate project returns 409');

    const badId = await POST(server, '/projects', { id: 'Bad ID!', name: 'Bad' });
    assert(badId.status === 400, 'invalid id returns 400');

    const noFields = await POST(server, '/projects', { id: 'test' });
    assert(noFields.status === 400, 'missing name returns 400');

    console.log('\n[PATCH /projects/:id]');
    const patchProj = await PATCH(server, '/projects/side-project', { name: 'Updated Side' });
    assert(patchProj.status === 200, 'patch project returns 200');
    assert(patchProj.body.name === 'Updated Side', 'project name updated');

    const patchNotFound = await PATCH(server, '/projects/nonexistent', { name: 'X' });
    assert(patchNotFound.status === 404, 'patch nonexistent project returns 404');

    console.log('\n[DELETE /projects/:id]');
    const delDefault = await DELETE(server, '/projects/default');
    assert(delDefault.status === 400, 'cannot delete default project');

    // Create a plan in side-project to test delete protection
    await POST(server, '/plans', { title: 'Side plan', projectId: 'side-project' });
    const delWithPlans = await DELETE(server, '/projects/side-project');
    assert(delWithPlans.status === 409, 'cannot delete project with active plans');

    // Archive the plan, then delete should work
    const sidePlans = await GET(server, '/plans?projectId=side-project');
    if (sidePlans.body.length > 0) {
      await DELETE(server, '/plans/' + sidePlans.body[0].id); // archive
    }
    const delEmpty = await DELETE(server, '/projects/side-project');
    assert(delEmpty.status === 200, 'delete empty project returns 200');
    assert(delEmpty.body.success === true, 'delete returns success');

    const delNotFound = await DELETE(server, '/projects/nonexistent');
    assert(delNotFound.status === 404, 'delete nonexistent project returns 404');

    // ─── Plans with projectId filter ────────────────────
    console.log('\n[Plans with projectId filter]');
    // Create a new project and plan in it
    await POST(server, '/projects', { id: 'proj-b', name: 'Project B' });
    await POST(server, '/plans', { title: 'Plan in B', projectId: 'proj-b' });
    const filteredPlans = await GET(server, '/plans?projectId=proj-b');
    assert(filteredPlans.status === 200, 'filter by projectId returns 200');
    assert(filteredPlans.body.length === 1, 'only 1 plan in proj-b');
    assert(filteredPlans.body[0].projectId === 'proj-b', 'plan belongs to proj-b');

  } finally {
    server.close();
    db.close();
  }

  // ─── Summary ────────────────────────────────────────
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
