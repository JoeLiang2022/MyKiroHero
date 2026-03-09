/**
 * Tests for Plugin Handler 載入器 (tasks/index.js)
 */

const path = require('path');
const fs = require('fs');

// We need to test the loader in isolation, so we'll create temp handler files
// and verify the loader picks them up correctly.

describe('Plugin Handler Loader', () => {
  const tasksDir = path.join(__dirname);
  const testHandlerPath = path.join(tasksDir, '_test-handler.js');
  const badHandlerPath = path.join(tasksDir, '_test-bad-handler.js');
  const noExecHandlerPath = path.join(tasksDir, '_test-no-exec.js');

  beforeAll(() => {
    // Create a valid test handler
    fs.writeFileSync(testHandlerPath, `
      module.exports = {
        name: 'test-action',
        description: 'Test handler for unit tests',
        type: 'layer1',
        execute: async (params) => {
          return { success: true, outputPath: '/tmp/test.md', message: 'test done' };
        }
      };
    `);

    // Create a handler missing execute (should be skipped)
    fs.writeFileSync(noExecHandlerPath, `
      module.exports = {
        name: 'no-exec',
        description: 'Missing execute function'
      };
    `);

    // Create a handler that throws on require (should be skipped gracefully)
    fs.writeFileSync(badHandlerPath, `
      throw new Error('Intentional load error');
    `);
  });

  afterAll(() => {
    // Clean up test files
    for (const f of [testHandlerPath, badHandlerPath, noExecHandlerPath]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  test('loads valid handlers with name + execute', () => {
    // Clear require cache so loader re-scans
    delete require.cache[require.resolve('./index')];
    // Also clear cached test handlers
    for (const key of Object.keys(require.cache)) {
      if (key.includes('_test-')) delete require.cache[key];
    }

    const handlers = require('./index');

    const testHandler = handlers.find(h => h.name === 'test-action');
    expect(testHandler).toBeDefined();
    expect(testHandler.description).toBe('Test handler for unit tests');
    expect(testHandler.type).toBe('layer1');
    expect(typeof testHandler.execute).toBe('function');
  });

  test('skips handlers without execute function', () => {
    delete require.cache[require.resolve('./index')];
    for (const key of Object.keys(require.cache)) {
      if (key.includes('_test-')) delete require.cache[key];
    }

    const handlers = require('./index');
    const noExec = handlers.find(h => h.name === 'no-exec');
    expect(noExec).toBeUndefined();
  });

  test('skips files that throw on require (graceful error handling)', () => {
    delete require.cache[require.resolve('./index')];
    for (const key of Object.keys(require.cache)) {
      if (key.includes('_test-')) delete require.cache[key];
    }

    // Should not throw — bad handler is caught internally
    expect(() => require('./index')).not.toThrow();
  });

  test('handler execute returns correct format { success, outputPath, message }', async () => {
    delete require.cache[require.resolve('./index')];
    for (const key of Object.keys(require.cache)) {
      if (key.includes('_test-')) delete require.cache[key];
    }

    const handlers = require('./index');
    const testHandler = handlers.find(h => h.name === 'test-action');
    const result = await testHandler.execute({});

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('outputPath');
    expect(result).toHaveProperty('message');
    expect(typeof result.outputPath).toBe('string');
    expect(typeof result.message).toBe('string');
  });

  test('does not include index.js itself', () => {
    delete require.cache[require.resolve('./index')];
    for (const key of Object.keys(require.cache)) {
      if (key.includes('_test-')) delete require.cache[key];
    }

    const handlers = require('./index');
    const selfRef = handlers.find(h => h.name === 'index');
    expect(selfRef).toBeUndefined();
  });
});
