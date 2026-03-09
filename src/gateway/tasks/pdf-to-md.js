/**
 * pdf-to-md.js — Layer 1 Handler: PDF 轉 markdown
 * 
 * 使用 pdf-parse 解析 PDF，轉換為 markdown 格式。
 * 
 * Params:
 *   filePath (required) — PDF 檔案路徑
 * 
 * Implements: Requirements 5.3 (pdf-to-md handler)
 */

const fs = require('fs');
const path = require('path');
const { getTodayDate } = require('../../utils/timezone');

module.exports = {
  name: 'pdf-to-md',
  description: 'PDF 轉 markdown（pdf-parse）',
  type: 'layer1',

  execute: async (params) => {
    const { filePath } = params;
    if (!filePath) throw new Error('Missing required param: filePath');
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    // Lazy require — only load when actually used
    const pdfParse = require('pdf-parse');

    // Read and parse PDF
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);

    // Convert to markdown (basic formatting)
    const pdfName = path.basename(filePath, '.pdf');
    let markdown = `# ${pdfName}\n\n`;
    markdown += `> Source: ${filePath}\n`;
    markdown += `> Pages: ${data.numpages}\n\n`;
    markdown += '---\n\n';
    markdown += data.text;

    // Save to output dir
    const config = require('../config');
    const outputDir = path.join(config.taskOutputDir, getTodayDate());
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `pdf_${pdfName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.md`;
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, markdown, 'utf-8');

    return {
      success: true,
      outputPath,
      message: `Converted ${pdfName}.pdf (${data.numpages} pages, ${Math.round(markdown.length / 1024)}KB)`,
    };
  },
};
