/**
 * MCP Tool Alias Registry
 *
 * Maps old tool names to new consolidated tool names.
 * During the transition period, old names are silently resolved
 * to new names via this registry, ensuring backward compatibility.
 *
 * Special cases:
 * - dispatch_task: "action" field conflicts with the new unified "action" field,
 *   so it's remapped to "taskAction"
 *
 * Aliases are added per wave as tools are migrated:
 * - Wave 1A: Issue Tracker 5→1, Mission Control 5→1
 * - Wave 1B: Task 3→1, Git 3→1
 * - Wave 2: Worker, WhatsApp, AI, Knowledge, Session (pending)
 *
 * @module alias-registry
 */

const ALIASES = {
    // ─── Wave 1A: Issue Tracker 5→1 ───
    'create_issue': { target: 'issue', inject: { action: 'create' } },
    'list_issues':  { target: 'issue', inject: { action: 'list' } },
    'update_issue': { target: 'issue', inject: { action: 'update' } },
    'close_issue':  { target: 'issue', inject: { action: 'close' } },
    'issue_stats':  { target: 'issue', inject: { action: 'stats' } },

    // ─── Wave 1A: Mission Control 5→1 ───
    'create_plan':      { target: 'mc', inject: { action: 'create-plan' } },
    'get_plan_status':  { target: 'mc', inject: { action: 'plan-status' } },
    'update_mc_task':   { target: 'mc', inject: { action: 'update-task' } },
    'set_plan_analysis':{ target: 'mc', inject: { action: 'set-analysis' } },
    'execute_plan':     { target: 'mc', inject: { action: 'execute' } },

    // ─── Wave 1B: Task 3→1 (report_task_result stays independent) ───
    'dispatch_task': { target: 'task', inject: { action: 'dispatch' }, remap: { action: 'taskAction' } },
    'check_task':    { target: 'task', inject: { action: 'check' } },
    'cancel_task':   { target: 'task', inject: { action: 'cancel' } },

    // ─── Wave 1B: Git 3→1 ───
    'git_remote_ops':    { target: 'git', inject: { action: 'remote' } },
    'request_push_lock': { target: 'git', inject: { action: 'lock' } },
    'release_push_lock': { target: 'git', inject: { action: 'unlock' } },

    // ─── Wave 2: Worker 2→1 ───
    'worker_ops':   { target: 'worker', inject: { action: 'ops' } },
    'reset_worker': { target: 'worker', inject: { action: 'reset' } },

    // ─── Wave 2: WhatsApp 2→1 ───
    'send_whatsapp':      { target: 'whatsapp', inject: { action: 'send' } },
    'send_whatsapp_media':{ target: 'whatsapp', inject: { action: 'send-media' } },

    // ─── Wave 2: AI 2→1 ───
    'ai_usage':  { target: 'ai', inject: { action: 'usage' } },
    'ai_status': { target: 'ai', inject: { action: 'status' } },

    // ─── Wave 2: Knowledge 2→1 ───
    'save_knowledge': { target: 'knowledge', inject: { action: 'save' } },

    // ─── Wave 2: Session 3→1 ───
    'get_session_history':  { target: 'session', inject: { action: 'history' } },
    'get_pending_sessions': { target: 'session', inject: { action: 'pending' } },
    'summarize_session':    { target: 'session', inject: { action: 'summarize' } },
};

/**
 * Resolve an alias to its target tool name and merged arguments.
 * If the name is not an alias, returns it unchanged.
 *
 * @param {string} name - Tool name (possibly an alias)
 * @param {object} args - Original arguments
 * @returns {{ name: string, args: object }} Resolved name and args
 */
function resolveAlias(name, args) {
    const alias = ALIASES[name];
    if (!alias) return { name, args };

    const resolvedArgs = { ...alias.inject };

    // Apply field remapping (e.g. dispatch_task's "action" → "taskAction")
    if (alias.remap) {
        for (const [oldKey, newKey] of Object.entries(alias.remap)) {
            if (oldKey in args) {
                resolvedArgs[newKey] = args[oldKey];
                // Copy remaining args excluding the remapped key
                for (const [k, v] of Object.entries(args)) {
                    if (k !== oldKey) resolvedArgs[k] = v;
                }
                console.error(`[MCP] Alias resolved: ${name} → ${alias.target}({ action: "${alias.inject.action}" })`);
                return { name: alias.target, args: resolvedArgs };
            }
        }
    }

    // No remap needed — merge inject + original args
    console.error(`[MCP] Alias resolved: ${name} → ${alias.target}({ action: "${alias.inject.action}" })`);
    return {
        name: alias.target,
        args: { ...resolvedArgs, ...args },
    };
}

module.exports = { ALIASES, resolveAlias };
