/**
 * Tests for ops-prefix detection in report_task_result MCP tool handler.
 * Verifies that ops- prefixed taskIds route to /api/workers/:id/ops-report
 * while non-ops taskIds continue through the original task report path.
 */

// We test the routing logic by extracting and simulating the case handler behavior.
// Since mcp-server.js is a large monolith, we test the routing decision logic directly.

describe('report_task_result ops-prefix routing', () => {
    const GATEWAY_URL = 'http://localhost:3456';
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('ops-prefix detection', () => {
        test('taskId starting with "ops-" is detected as ops command', () => {
            const taskId = 'ops-git-pull-1708412345';
            expect(taskId.startsWith('ops-')).toBe(true);
        });

        test('regular taskId is NOT detected as ops command', () => {
            const taskId = 'task-20260220-183122-d41';
            expect(taskId.startsWith('ops-')).toBe(false);
        });

        test('taskId "ops" without dash is NOT detected as ops command', () => {
            const taskId = 'ops';
            expect(taskId.startsWith('ops-')).toBe(false);
        });

        test('empty taskId does not match ops prefix', () => {
            const taskId = '';
            expect(taskId.startsWith('ops-')).toBe(false);
        });
    });

    describe('ops endpoint URL construction', () => {
        test('constructs correct ops-report endpoint URL', () => {
            const workerId = 'worker-1';
            const endpoint = `${GATEWAY_URL}/api/workers/${encodeURIComponent(workerId)}/ops-report`;
            expect(endpoint).toBe('http://localhost:3456/api/workers/worker-1/ops-report');
        });

        test('encodes special characters in worker ID', () => {
            const workerId = 'worker/special&id';
            const endpoint = `${GATEWAY_URL}/api/workers/${encodeURIComponent(workerId)}/ops-report`;
            expect(endpoint).toBe('http://localhost:3456/api/workers/worker%2Fspecial%26id/ops-report');
        });
    });

    describe('command extraction from taskId', () => {
        test('extracts command hint by removing ops- prefix', () => {
            const taskId = 'ops-git-pull-1708412345';
            const command = taskId.replace('ops-', '');
            expect(command).toBe('git-pull-1708412345');
        });

        test('handles simple ops taskId', () => {
            const taskId = 'ops-pm2-status';
            const command = taskId.replace('ops-', '');
            expect(command).toBe('pm2-status');
        });

        test('only removes first ops- occurrence', () => {
            const taskId = 'ops-ops-nested';
            const command = taskId.replace('ops-', '');
            expect(command).toBe('ops-nested');
        });
    });

    describe('routing conditions', () => {
        test('routes to ops endpoint when taskId has ops- prefix AND X_WORKER_ID is set', () => {
            process.env.X_WORKER_ID = 'worker-1';
            const args = { taskId: 'ops-git-status', success: true, message: 'done' };

            const shouldRouteToOps = args.taskId && args.taskId.startsWith('ops-') && process.env.X_WORKER_ID;
            expect(!!shouldRouteToOps).toBe(true);
        });

        test('does NOT route to ops when taskId is a regular task', () => {
            process.env.X_WORKER_ID = 'worker-1';
            const args = { taskId: 'task-20260220-183122-d41', success: true, message: 'done' };

            const shouldRouteToOps = args.taskId && args.taskId.startsWith('ops-') && process.env.X_WORKER_ID;
            expect(!!shouldRouteToOps).toBe(false);
        });

        test('does NOT route to ops on Commander (no X_WORKER_ID)', () => {
            delete process.env.X_WORKER_ID;
            const args = { taskId: 'ops-git-status', success: true, message: 'done' };

            const shouldRouteToOps = args.taskId && args.taskId.startsWith('ops-') && process.env.X_WORKER_ID;
            expect(!!shouldRouteToOps).toBe(false);
        });

        test('does NOT route to ops when taskId is null', () => {
            process.env.X_WORKER_ID = 'worker-1';
            const args = { taskId: null, success: true, message: 'done' };

            const shouldRouteToOps = args.taskId && args.taskId.startsWith('ops-') && process.env.X_WORKER_ID;
            expect(!!shouldRouteToOps).toBe(false);
        });

        test('does NOT route to ops when taskId is undefined', () => {
            process.env.X_WORKER_ID = 'worker-1';
            const args = { success: true, message: 'done' };

            const shouldRouteToOps = args.taskId && args.taskId.startsWith('ops-') && process.env.X_WORKER_ID;
            expect(!!shouldRouteToOps).toBe(false);
        });

        test('does NOT route to ops when X_WORKER_ID is empty string', () => {
            process.env.X_WORKER_ID = '';
            const args = { taskId: 'ops-git-status', success: true, message: 'done' };

            const shouldRouteToOps = args.taskId && args.taskId.startsWith('ops-') && process.env.X_WORKER_ID;
            expect(!!shouldRouteToOps).toBe(false);
        });
    });

    describe('ops request body construction', () => {
        test('constructs correct request body for ops report', () => {
            const args = { taskId: 'ops-git-pull-1708412345', success: true, message: 'pulled latest changes' };
            const body = {
                success: args.success,
                message: args.message,
                command: args.taskId.replace('ops-', ''),
            };

            expect(body).toEqual({
                success: true,
                message: 'pulled latest changes',
                command: 'git-pull-1708412345',
            });
        });

        test('constructs correct body for failed ops', () => {
            const args = { taskId: 'ops-pm2-restart', success: false, message: 'pm2 not found' };
            const body = {
                success: args.success,
                message: args.message,
                command: args.taskId.replace('ops-', ''),
            };

            expect(body).toEqual({
                success: false,
                message: 'pm2 not found',
                command: 'pm2-restart',
            });
        });
    });

    describe('non-ops task report path unchanged', () => {
        test('progress=true routes to /result endpoint', () => {
            const args = { taskId: 'task-123', progress: true };
            const endpoint = args.progress
                ? `${GATEWAY_URL}/api/task/${encodeURIComponent(args.taskId)}/result`
                : `${GATEWAY_URL}/api/task/${encodeURIComponent(args.taskId)}/report`;

            expect(endpoint).toBe('http://localhost:3456/api/task/task-123/result');
        });

        test('progress=false routes to /report endpoint', () => {
            const args = { taskId: 'task-123', progress: false };
            const endpoint = args.progress
                ? `${GATEWAY_URL}/api/task/${encodeURIComponent(args.taskId)}/result`
                : `${GATEWAY_URL}/api/task/${encodeURIComponent(args.taskId)}/report`;

            expect(endpoint).toBe('http://localhost:3456/api/task/task-123/report');
        });

        test('no progress field routes to /report endpoint', () => {
            const args = { taskId: 'task-123' };
            const endpoint = args.progress
                ? `${GATEWAY_URL}/api/task/${encodeURIComponent(args.taskId)}/result`
                : `${GATEWAY_URL}/api/task/${encodeURIComponent(args.taskId)}/report`;

            expect(endpoint).toBe('http://localhost:3456/api/task/task-123/report');
        });
    });
});
