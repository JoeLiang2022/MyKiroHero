/**
 * crawl.js — Layer 1 Handler: 爬網頁轉 markdown
 * 
 * 使用 fetch + cheerio 爬取網頁，turndown 轉 markdown。
 * 
 * Params:
 *   url (required) — 目標 URL
 *   selector (optional) — CSS selector 過濾特定區塊
 * 
 * Implements: Requirements 5.3 (crawl handler)
 */

const fs = require('fs');
const path = require('path');
const { getTodayDate } = require('../../utils/timezone');

module.exports = {
  name: 'crawl',
  description: '爬網頁轉 markdown（fetch + cheerio + turndown）',
  type: 'layer1',

  execute: async (params) => {
    const { url, selector } = params;
    if (!url) throw new Error('Missing required param: url');

    // Lazy require — only load when actually used
    const cheerio = require('cheerio');
    const TurndownService = require('turndown');

    // Fetch the page (30s timeout)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }
    const html = await response.text();

    // Parse with cheerio
    const $ = cheerio.load(html);

    // Remove script, style, nav, footer, header tags for cleaner output
    $('script, style, nav, footer, header, noscript, iframe').remove();

    // Apply selector if provided
    let content;
    if (selector) {
      content = $(selector).html();
      if (!content) {
        throw new Error(`Selector "${selector}" matched no elements`);
      }
    } else {
      // Try article/main first, fallback to body
      content = $('article').html() || $('main').html() || $('body').html() || html;
    }

    // Convert to markdown
    const turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
    const markdown = turndown.turndown(content);

    // Save to output dir
    const config = require('../config');
    const outputDir = path.join(config.taskOutputDir, getTodayDate());
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate filename from URL
    const urlObj = new URL(url);
    const safeName = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `crawl_${safeName}_${Date.now()}.md`;
    const outputPath = path.join(outputDir, filename);

    // Add source URL as header
    const fullContent = `# ${urlObj.hostname}${urlObj.pathname}\n\n> Source: ${url}\n\n${markdown}`;
    fs.writeFileSync(outputPath, fullContent, 'utf-8');

    return {
      success: true,
      outputPath,
      message: `Crawled ${url}, saved ${Math.round(fullContent.length / 1024)}KB markdown`,
    };
  },
};
