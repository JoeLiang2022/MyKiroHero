/**
 * Tests for pdf-to-md.js — Layer 1 Handler
 */

const path = require('path');
const fs = require('fs');

// Mock pdf-parse
const mockPdfParse = jest.fn();
jest.mock('pdf-parse', () => mockPdfParse);

// Mock config
jest.mock('../config', () => {
  const p = require('path');
  return {
    taskOutputDir: p.join(__dirname, '../../../temp/tasks-test-pdf'),
  };
});

// Mock timezone util
jest.mock('../../utils/timezone', () => ({
  getTodayDate: () => '2026-01-15',
}));

const pdfToMd = require('./pdf-to-md');

describe('pdf-to-md handler', () => {
  const testOutputDir = path.join(__dirname, '../../../temp/tasks-test-pdf/2026-01-15');
  const fakePdfPath = path.join(__dirname, '../../../temp/tasks-test-pdf/fake.pdf');

  beforeAll(() => {
    // Create a fake PDF file so fs.existsSync passes
    const dir = path.dirname(fakePdfPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fakePdfPath, 'fake-pdf-content');
  });

  afterAll(() => {
    const baseDir = path.join(__dirname, '../../../temp/tasks-test-pdf');
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('exports correct handler format', () => {
    expect(pdfToMd.name).toBe('pdf-to-md');
    expect(pdfToMd.type).toBe('layer1');
    expect(pdfToMd.description).toBeTruthy();
    expect(typeof pdfToMd.execute).toBe('function');
  });

  test('throws on missing filePath param', async () => {
    await expect(pdfToMd.execute({})).rejects.toThrow('Missing required param: filePath');
  });

  test('throws on non-existent file', async () => {
    await expect(pdfToMd.execute({ filePath: '/no/such/file.pdf' }))
      .rejects.toThrow('File not found: /no/such/file.pdf');
  });

  test('parses PDF and saves markdown', async () => {
    mockPdfParse.mockResolvedValueOnce({
      numpages: 3,
      text: 'Page 1 content\n\nPage 2 content\n\nPage 3 content',
    });

    const result = await pdfToMd.execute({ filePath: fakePdfPath });

    expect(result.success).toBe(true);
    expect(result.outputPath).toContain('pdf_fake_');
    expect(result.outputPath).toMatch(/\.md$/);
    expect(result.message).toContain('fake.pdf');
    expect(result.message).toContain('3 pages');

    // Verify file content
    expect(fs.existsSync(result.outputPath)).toBe(true);
    const content = fs.readFileSync(result.outputPath, 'utf-8');
    expect(content).toContain('# fake');
    expect(content).toContain(`> Source: ${fakePdfPath}`);
    expect(content).toContain('> Pages: 3');
    expect(content).toContain('Page 1 content');
    expect(content).toContain('Page 3 content');
  });

  test('creates output directory if not exists', async () => {
    // Clean output dir first
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }

    mockPdfParse.mockResolvedValueOnce({
      numpages: 1,
      text: 'Test content',
    });

    const result = await pdfToMd.execute({ filePath: fakePdfPath });
    expect(result.success).toBe(true);
    expect(fs.existsSync(testOutputDir)).toBe(true);
  });

  test('sanitizes filename from PDF name', async () => {
    // Create a file with special chars in name
    const specialPath = path.join(path.dirname(fakePdfPath), 'my report (2026).pdf');
    fs.writeFileSync(specialPath, 'fake');

    mockPdfParse.mockResolvedValueOnce({
      numpages: 1,
      text: 'Content',
    });

    const result = await pdfToMd.execute({ filePath: specialPath });
    // Filename should have special chars replaced
    const basename = path.basename(result.outputPath);
    expect(basename).toMatch(/^pdf_my_report__2026_/);
    expect(basename).not.toMatch(/[()]/);
  });

  test('result format matches { success, outputPath, message }', async () => {
    mockPdfParse.mockResolvedValueOnce({
      numpages: 2,
      text: 'Format test',
    });

    const result = await pdfToMd.execute({ filePath: fakePdfPath });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('outputPath');
    expect(result).toHaveProperty('message');
    expect(typeof result.outputPath).toBe('string');
    expect(typeof result.message).toBe('string');
  });
});
