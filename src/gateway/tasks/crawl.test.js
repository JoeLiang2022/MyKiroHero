/**
 * Tests for crawl.js — Layer 1 Handler
 */

const path = require('path');
const fs = require('fs');

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock config — use __dirname (allowed in jest.mock factory)
jest.mock('../config', () => {
  const p = require('path');
  return {
    taskOutputDir: p.join(__dirname, '../../../temp/tasks-test-crawl'),
  };
});

// Mock timezone util
jest.mock('../../utils/timezone', () => ({
  getTodayDate: () => '2026-01-15',
}));

const crawl = require('./crawl');

describe('crawl handler', () => {
  const testOutputDir = path.join(__dirname, '../../../temp/tasks-test-crawl/2026-01-15');

  afterAll(() => {
    // Clean up test output
    const baseDir = path.join(__dirname, '../../../temp/tasks-test-crawl');
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('exports correct handler format', () => {
    expect(crawl.name).toBe('crawl');
    expect(crawl.type).toBe('layer1');
    expect(crawl.description).toBeTruthy();
    expect(typeof crawl.execute).toBe('function');
  });

  test('throws on missing url param', async () => {
    await expect(crawl.execute({})).rejects.toThrow('Missing required param: url');
    await expect(crawl.execute({ selector: '.main' })).rejects.toThrow('Missing required param: url');
  });

  test('throws on fetch failure (non-ok response)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(crawl.execute({ url: 'https://example.com/missing' }))
      .rejects.toThrow('Fetch failed: 404 Not Found');
  });

  test('crawls page and converts to markdown', async () => {
    const html = `
      <html>
        <head><title>Test</title></head>
        <body>
          <script>var x = 1;</script>
          <style>.foo { color: red; }</style>
          <h1>Hello World</h1>
          <p>This is a <strong>test</strong> page.</p>
        </body>
      </html>
    `;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => html,
    });

    const result = await crawl.execute({ url: 'https://example.com/page' });

    expect(result.success).toBe(true);
    expect(result.outputPath).toContain('crawl_example_com_');
    expect(result.outputPath).toMatch(/\.md$/);
    expect(result.message).toContain('Crawled https://example.com/page');

    // Verify file was written
    expect(fs.existsSync(result.outputPath)).toBe(true);
    const content = fs.readFileSync(result.outputPath, 'utf-8');
    expect(content).toContain('# example.com/page');
    expect(content).toContain('> Source: https://example.com/page');
    expect(content).toContain('Hello World');
    expect(content).toContain('**test**');
    // Script/style should be removed
    expect(content).not.toContain('var x = 1');
    expect(content).not.toContain('color: red');
  });

  test('uses CSS selector when provided', async () => {
    const html = `
      <html><body>
        <div class="sidebar">Sidebar stuff</div>
        <article class="content">
          <h2>Article Title</h2>
          <p>Article body text.</p>
        </article>
      </body></html>
    `;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => html,
    });

    const result = await crawl.execute({
      url: 'https://example.com/article',
      selector: 'article.content',
    });

    expect(result.success).toBe(true);
    const content = fs.readFileSync(result.outputPath, 'utf-8');
    expect(content).toContain('Article Title');
    expect(content).toContain('Article body text');
    // Sidebar should NOT be in output since we filtered by selector
    expect(content).not.toContain('Sidebar stuff');
  });

  test('throws when selector matches nothing', async () => {
    const html = '<html><body><p>Hello</p></body></html>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => html,
    });

    await expect(crawl.execute({
      url: 'https://example.com',
      selector: '.nonexistent',
    })).rejects.toThrow('Selector ".nonexistent" matched no elements');
  });

  test('prefers article/main over body when no selector', async () => {
    const html = `
      <html><body>
        <nav>Navigation</nav>
        <main>
          <h1>Main Content</h1>
          <p>Important stuff here.</p>
        </main>
        <footer>Footer</footer>
      </body></html>
    `;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => html,
    });

    const result = await crawl.execute({ url: 'https://example.com/main' });
    const content = fs.readFileSync(result.outputPath, 'utf-8');
    expect(content).toContain('Main Content');
    expect(content).toContain('Important stuff here');
  });

  test('creates output directory if not exists', async () => {
    // Clean first
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }

    const html = '<html><body><p>Test</p></body></html>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => html,
    });

    const result = await crawl.execute({ url: 'https://newsite.com/test' });
    expect(result.success).toBe(true);
    expect(fs.existsSync(testOutputDir)).toBe(true);
  });

  test('result format matches { success, outputPath, message }', async () => {
    const html = '<html><body><p>Format test</p></body></html>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => html,
    });

    const result = await crawl.execute({ url: 'https://example.com/fmt' });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('outputPath');
    expect(result).toHaveProperty('message');
    expect(typeof result.outputPath).toBe('string');
    expect(typeof result.message).toBe('string');
  });
});
