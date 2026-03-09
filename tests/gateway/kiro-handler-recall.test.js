/**
 * KiroHandler auto-recall context injection tests
 * 
 * Tests auto-recall context injection into system prompt on new sessions.
 */
const http = require('http');
const path = require('path');

// Mock dependencies — use paths relative to kiro-handler.js's require() calls
// kiro-handler.js is at src/gateway/handlers/ and requires:
//   ../../skills/skill-loader → src/skills/skill-loader
//   ./base-handler → src/gateway/handlers/base-handler
//   ./message-classifier → src/gateway/handlers/message-classifier
//   ./dispatch-controller → src/gateway/handlers/dispatch-controller

jest.mock('../../src/gateway/handlers/base-handler', () => {
    return class BaseHandler {
        constructor(config) { this.config = config || {}; }
    };
});

jest.mock('../../src/skills/skill-loader', () => {
    return class SkillLoader {
        constructor() { this.skills = new Map(); }
        scan() {}
    };
});

jest.mock('../../src/gateway/handlers/message-classifier', () => ({
    classifyMessage: () => ({ score: 0.9, isComplete: true }),
    isSpecialMessage: () => false
}));

jest.mock('../../src/gateway/handlers/dispatch-controller', () => ({
    DispatchController: class {
        constructor(cfg, cb) {
            this._onDispatch = cb;
            this.lastDispatchPromise = null;
        }
        handleMessage(chatId, msg, classification) {
            this.lastDispatchPromise = this._onDispatch(chatId, msg.text || '', [{ text: msg.text || '', message: msg, timestamp: Date.now() }]);
        }
        cleanupAll() {}
    }
}));

beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

const KiroHandler = require('../../src/gateway/handlers/kiro-handler');

function createHandler(overrides = {}) {
    const config = {
        aiPrefix: '🤖',
        fragment: { collectTimeout: 3000, maxMessages: 3, maxWait: 7000, scoreThreshold: 0.6 },
        ...overrides
    };
    const handler = new KiroHandler(config);
    handler.sendToChat = jest.fn().mockResolvedValue('ok');
    // Fix SkillLoader mock — add searchSkills
    if (handler.skillLoader) {
        handler.skillLoader.searchSkills = jest.fn().mockReturnValue([]);
    }
    return handler;
}

/** Wait for the dispatch controller's async callback to complete */
async function waitForDispatch(handler) {
    if (handler.dispatchController && handler.dispatchController.lastDispatchPromise) {
        await handler.dispatchController.lastDispatchPromise;
    }
}

function createMessage(text, overrides = {}) {
    return {
        fromMe: true,
        chatId: 'test-chat@c.us',
        text,
        platform: 'whatsapp',
        sender: 'TestUser',
        ...overrides
    };
}

describe('KiroHandler auto-recall', () => {
    let handler;
    let mockServer;

    beforeEach(() => {
        handler = createHandler();
    });

    afterEach((done) => {
        if (mockServer) {
            mockServer.close(() => done());
            mockServer = null;
        } else {
            done();
        }
    });

    function startMockEngine(responseBody, statusCode = 200, delay = 0) {
        return new Promise((resolve) => {
            mockServer = http.createServer((req, res) => {
                if (req.url === '/recall/auto' && req.method === 'GET') {
                    setTimeout(() => {
                        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(responseBody));
                    }, delay);
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });
            mockServer.listen(0, '127.0.0.1', () => {
                resolve(mockServer.address().port);
            });
        });
    }

    it('should inject auto-recall context on new session', async () => {
        const port = await startMockEngine({
            context: '[Auto-recall] Last session: debugging memory engine',
            tokenEstimate: 15,
            sources: ['20260220-001']
        });
        handler._getMemoryEngineUrl = () => `http://127.0.0.1:${port}`;

        await handler.handle(createMessage('Hello'), {});
        await waitForDispatch(handler);

        expect(handler.sendToChat).toHaveBeenCalledTimes(1);
        const sent = handler.sendToChat.mock.calls[0][0];
        expect(sent).toContain('[System Context - Auto Recall]');
        expect(sent).toContain('Last session: debugging memory engine');
        expect(sent).toContain('---');
        expect(sent).toContain('[WhatsApp] TestUser: Hello');
    });

    it('should not inject when auto-recall returns empty context', async () => {
        const port = await startMockEngine({ context: '', tokenEstimate: 0, sources: [] });
        handler._getMemoryEngineUrl = () => `http://127.0.0.1:${port}`;

        await handler.handle(createMessage('Hello'), {});
        await waitForDispatch(handler);

        expect(handler.sendToChat).toHaveBeenCalledTimes(1);
        const sent = handler.sendToChat.mock.calls[0][0];
        expect(sent).not.toContain('[System Context - Auto Recall]');
        expect(sent).toContain('[WhatsApp] TestUser: Hello');
    });

    it('should skip auto-recall when not a new session', async () => {
        const port = await startMockEngine({
            context: '[Auto-recall] should not appear',
            tokenEstimate: 10,
            sources: ['20260220-001']
        });
        handler._getMemoryEngineUrl = () => `http://127.0.0.1:${port}`;

        await handler.handle(createMessage('First'), {});
        await waitForDispatch(handler);
        handler.sendToChat.mockClear();

        await handler.handle(createMessage('Second'), {});
        await waitForDispatch(handler);

        expect(handler.sendToChat).toHaveBeenCalledTimes(1);
        const sent = handler.sendToChat.mock.calls[0][0];
        expect(sent).not.toContain('[System Context - Auto Recall]');
    });

    it('should skip auto-recall when AUTO_RECALL_ENABLED=false', async () => {
        const port = await startMockEngine({
            context: '[Auto-recall] should not appear',
            tokenEstimate: 10,
            sources: ['20260220-001']
        });
        handler._getMemoryEngineUrl = () => `http://127.0.0.1:${port}`;

        const original = process.env.AUTO_RECALL_ENABLED;
        process.env.AUTO_RECALL_ENABLED = 'false';

        try {
            await handler.handle(createMessage('Hello'), {});
            await waitForDispatch(handler);
            expect(handler.sendToChat).toHaveBeenCalledTimes(1);
            const sent = handler.sendToChat.mock.calls[0][0];
            expect(sent).not.toContain('[System Context - Auto Recall]');
        } finally {
            if (original === undefined) delete process.env.AUTO_RECALL_ENABLED;
            else process.env.AUTO_RECALL_ENABLED = original;
        }
    });

    it('should proceed without context when fetch times out', async () => {
        const port = await startMockEngine(
            { context: 'should not appear', tokenEstimate: 5, sources: [] },
            200,
            5000
        );
        handler._getMemoryEngineUrl = () => `http://127.0.0.1:${port}`;

        await handler.handle(createMessage('Hello'), {});
        await waitForDispatch(handler);

        expect(handler.sendToChat).toHaveBeenCalledTimes(1);
        const sent = handler.sendToChat.mock.calls[0][0];
        expect(sent).not.toContain('[System Context - Auto Recall]');
        expect(sent).toContain('[WhatsApp] TestUser: Hello');
    }, 10000);

    it('should proceed without context when Memory Engine is down', async () => {
        handler._getMemoryEngineUrl = () => 'http://127.0.0.1:19999';

        await handler.handle(createMessage('Hello'), {});
        await waitForDispatch(handler);

        expect(handler.sendToChat).toHaveBeenCalledTimes(1);
        const sent = handler.sendToChat.mock.calls[0][0];
        expect(sent).not.toContain('[System Context - Auto Recall]');
        expect(sent).toContain('[WhatsApp] TestUser: Hello');
    });

    it('should skip when memory engine port file is missing', async () => {
        handler._getMemoryEngineUrl = () => null;
        await handler.handle(createMessage('Hello'), {});
        await waitForDispatch(handler);

        expect(handler.sendToChat).toHaveBeenCalledTimes(1);
        const sent = handler.sendToChat.mock.calls[0][0];
        expect(sent).not.toContain('[System Context - Auto Recall]');
    });

    it('should not inject auto-recall for heartbeat messages', async () => {
        const port = await startMockEngine({
            context: '[Auto-recall] should not appear',
            tokenEstimate: 10,
            sources: ['20260220-001']
        });
        handler._getMemoryEngineUrl = () => `http://127.0.0.1:${port}`;

        const msg = { platform: 'system', type: 'heartbeat', task: 'test-heartbeat' };
        await handler.handle(msg, {});
        await waitForDispatch(handler);

        if (handler.sendToChat.mock.calls.length > 0) {
            const sent = handler.sendToChat.mock.calls[0][0];
            expect(sent).not.toContain('[System Context - Auto Recall]');
        }
    });
});
