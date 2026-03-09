/**
 * Tests for alias-registry.js — backward-compatible tool name resolution.
 */

const { resolveAlias, ALIASES } = require('../src/alias-registry');

describe('Alias Registry', () => {
  describe('resolveAlias', () => {
    test('returns unchanged name/args for non-aliased tools', () => {
      const result = resolveAlias('get_gateway_status', {});
      expect(result.name).toBe('get_gateway_status');
      expect(result.args).toEqual({});
    });

    test('resolves dispatch_task → task with action=dispatch and action→taskAction remap', () => {
      const result = resolveAlias('dispatch_task', {
        type: 'layer3',
        action: 'worker-dispatch',
        params: { description: 'test' },
      });
      expect(result.name).toBe('task');
      expect(result.args.action).toBe('dispatch');
      expect(result.args.taskAction).toBe('worker-dispatch');
      expect(result.args.type).toBe('layer3');
      expect(result.args.params).toEqual({ description: 'test' });
    });

    test('resolves check_task → task with action=check', () => {
      const result = resolveAlias('check_task', { taskId: 'task-123' });
      expect(result.name).toBe('task');
      expect(result.args.action).toBe('check');
      expect(result.args.taskId).toBe('task-123');
    });

    test('resolves cancel_task → task with action=cancel', () => {
      const result = resolveAlias('cancel_task', { taskId: 'task-456' });
      expect(result.name).toBe('task');
      expect(result.args.action).toBe('cancel');
      expect(result.args.taskId).toBe('task-456');
    });

    test('resolves git_remote_ops → git with action=remote', () => {
      const result = resolveAlias('git_remote_ops', {
        operation: 'pull',
        repoPath: '/repo',
        branch: 'main',
      });
      expect(result.name).toBe('git');
      expect(result.args.action).toBe('remote');
      expect(result.args.operation).toBe('pull');
      expect(result.args.repoPath).toBe('/repo');
    });

    test('resolves request_push_lock → git with action=lock', () => {
      const result = resolveAlias('request_push_lock', { repoPath: '/repo' });
      expect(result.name).toBe('git');
      expect(result.args.action).toBe('lock');
      expect(result.args.repoPath).toBe('/repo');
    });

    test('resolves release_push_lock → git with action=unlock', () => {
      const result = resolveAlias('release_push_lock', { repoPath: '/repo' });
      expect(result.name).toBe('git');
      expect(result.args.action).toBe('unlock');
      expect(result.args.repoPath).toBe('/repo');
    });

    // ─── Wave 1A: Issue Tracker aliases ───
    test('resolves create_issue → issue with action=create', () => {
      const result = resolveAlias('create_issue', { title: 'Bug', description: 'broken' });
      expect(result.name).toBe('issue');
      expect(result.args.action).toBe('create');
      expect(result.args.title).toBe('Bug');
    });

    test('resolves list_issues → issue with action=list', () => {
      const result = resolveAlias('list_issues', { status: 'open' });
      expect(result.name).toBe('issue');
      expect(result.args.action).toBe('list');
      expect(result.args.status).toBe('open');
    });

    test('resolves issue_stats → issue with action=stats', () => {
      const result = resolveAlias('issue_stats', {});
      expect(result.name).toBe('issue');
      expect(result.args.action).toBe('stats');
    });

    // ─── Wave 1A: Mission Control aliases ───
    test('resolves create_plan → mc with action=create-plan', () => {
      const result = resolveAlias('create_plan', { title: 'Plan A' });
      expect(result.name).toBe('mc');
      expect(result.args.action).toBe('create-plan');
      expect(result.args.title).toBe('Plan A');
    });

    test('resolves execute_plan → mc with action=execute', () => {
      const result = resolveAlias('execute_plan', { planId: 'plan-123' });
      expect(result.name).toBe('mc');
      expect(result.args.action).toBe('execute');
      expect(result.args.planId).toBe('plan-123');
    });

    test('dispatch_task paramRemap does not lose other params', () => {
      const result = resolveAlias('dispatch_task', {
        type: 'layer2',
        action: 'tts',
        params: { text: 'hello' },
        notify: 'silent',
        timeout: 60,
      });
      expect(result.args).toEqual({
        action: 'dispatch',
        type: 'layer2',
        taskAction: 'tts',
        params: { text: 'hello' },
        notify: 'silent',
        timeout: 60,
      });
    });
  });

  describe('ALIASES structure', () => {
    test('all aliases have target and inject with action', () => {
      for (const [oldName, alias] of Object.entries(ALIASES)) {
        expect(alias).toHaveProperty('target');
        expect(alias).toHaveProperty('inject');
        expect(alias.inject).toHaveProperty('action');
        expect(typeof alias.target).toBe('string');
        expect(typeof alias.inject.action).toBe('string');
      }
    });

    test('dispatch_task has remap for action→taskAction', () => {
      expect(ALIASES.dispatch_task.remap).toEqual({ action: 'taskAction' });
    });

    test('Wave 1A Issue aliases map to issue target', () => {
      const issueAliases = ['create_issue', 'list_issues', 'update_issue', 'close_issue', 'issue_stats'];
      for (const name of issueAliases) {
        expect(ALIASES[name].target).toBe('issue');
      }
    });

    test('Wave 1A MC aliases map to mc target', () => {
      const mcAliases = ['create_plan', 'get_plan_status', 'update_mc_task', 'set_plan_analysis', 'execute_plan'];
      for (const name of mcAliases) {
        expect(ALIASES[name].target).toBe('mc');
      }
    });

    // ─── Wave 2: Structure tests ───
    test('Wave 2 Worker aliases map to worker target', () => {
      const workerAliases = ['worker_ops', 'reset_worker'];
      for (const name of workerAliases) {
        expect(ALIASES[name].target).toBe('worker');
      }
    });

    test('Wave 2 WhatsApp aliases map to whatsapp target', () => {
      const waAliases = ['send_whatsapp', 'send_whatsapp_media'];
      for (const name of waAliases) {
        expect(ALIASES[name].target).toBe('whatsapp');
      }
    });

    test('Wave 2 AI aliases map to ai target', () => {
      const aiAliases = ['ai_usage', 'ai_status'];
      for (const name of aiAliases) {
        expect(ALIASES[name].target).toBe('ai');
      }
    });

    test('Wave 2 Knowledge alias maps to knowledge target', () => {
      expect(ALIASES.save_knowledge.target).toBe('knowledge');
      expect(ALIASES.save_knowledge.inject.action).toBe('save');
    });

    test('Wave 2 Session aliases map to session target', () => {
      const sessionAliases = ['get_session_history', 'get_pending_sessions', 'summarize_session'];
      for (const name of sessionAliases) {
        expect(ALIASES[name].target).toBe('session');
      }
    });
  });

  // ─── Wave 2: resolveAlias behavior tests ───
  describe('Wave 2 resolveAlias', () => {
    test('resolves send_whatsapp → whatsapp with action=send', () => {
      const result = resolveAlias('send_whatsapp', { chatId: '123@c.us', message: 'hi' });
      expect(result.name).toBe('whatsapp');
      expect(result.args.action).toBe('send');
      expect(result.args.chatId).toBe('123@c.us');
      expect(result.args.message).toBe('hi');
    });

    test('resolves send_whatsapp_media → whatsapp with action=send-media', () => {
      const result = resolveAlias('send_whatsapp_media', { chatId: '123@c.us', filePath: '/tmp/a.ogg' });
      expect(result.name).toBe('whatsapp');
      expect(result.args.action).toBe('send-media');
      expect(result.args.filePath).toBe('/tmp/a.ogg');
    });

    test('resolves worker_ops → worker with action=ops', () => {
      const result = resolveAlias('worker_ops', { workerId: 'worker-1', command: 'git-pull' });
      expect(result.name).toBe('worker');
      expect(result.args.action).toBe('ops');
      expect(result.args.workerId).toBe('worker-1');
    });

    test('resolves reset_worker → worker with action=reset', () => {
      const result = resolveAlias('reset_worker', { workerId: 'worker-2' });
      expect(result.name).toBe('worker');
      expect(result.args.action).toBe('reset');
      expect(result.args.workerId).toBe('worker-2');
    });

    test('resolves ai_usage → ai with action=usage', () => {
      const result = resolveAlias('ai_usage', {});
      expect(result.name).toBe('ai');
      expect(result.args.action).toBe('usage');
    });

    test('resolves ai_status → ai with action=status', () => {
      const result = resolveAlias('ai_status', { provider: 'reset' });
      expect(result.name).toBe('ai');
      expect(result.args.action).toBe('status');
      expect(result.args.provider).toBe('reset');
    });

    test('resolves save_knowledge → knowledge with action=save', () => {
      const result = resolveAlias('save_knowledge', { id: 'test', title: 'Test', tags: ['a'], summary: 's', content: 'c' });
      expect(result.name).toBe('knowledge');
      expect(result.args.action).toBe('save');
      expect(result.args.id).toBe('test');
    });

    test('resolves get_session_history → session with action=history', () => {
      const result = resolveAlias('get_session_history', { sessionId: '20260219-001' });
      expect(result.name).toBe('session');
      expect(result.args.action).toBe('history');
      expect(result.args.sessionId).toBe('20260219-001');
    });

    test('resolves get_pending_sessions → session with action=pending', () => {
      const result = resolveAlias('get_pending_sessions', { date: '2026-02-19' });
      expect(result.name).toBe('session');
      expect(result.args.action).toBe('pending');
    });

    test('resolves summarize_session → session with action=summarize', () => {
      const result = resolveAlias('summarize_session', { sessionId: '20260219-001', summary: 'test' });
      expect(result.name).toBe('session');
      expect(result.args.action).toBe('summarize');
      expect(result.args.summary).toBe('test');
    });
  });
});
