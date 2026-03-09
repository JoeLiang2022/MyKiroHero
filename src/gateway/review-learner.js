'use strict';

const fs = require('fs');
const path = require('path');
const { getTodayDate } = require('../utils/timezone');

const DEFAULT_ENTRIES_DIR = path.join(__dirname, '../../skills/memory/entries');
const DEFAULT_INDEX_PATH = path.join(__dirname, '../../skills/memory/index.json');
const MAX_LESSONS_PER_REVIEW = 3;

/**
 * Extract actionable lessons from code review feedback.
 * @param {string} reviewMessage - The review feedback text
 * @param {string} branch - The branch that was reviewed
 * @returns {Array<{title: string, summary: string, content: string}>}
 */
function extractLessons(reviewMessage, branch) {
  if (!reviewMessage) return [];

  const lessons = [];
  const lines = reviewMessage.split('\n');
  let currentIssue = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[•\-\*]\s+\*?\*?(.+)/);
    if (bulletMatch) {
      if (currentIssue && currentIssue.body.length > 0) {
        lessons.push(currentIssue);
      }
      const issueText = bulletMatch[1].replace(/\*\*/g, '').trim();
      const colonIdx = issueText.indexOf(':');
      const title = colonIdx > 0 && colonIdx < 80
        ? issueText.substring(0, colonIdx).trim()
        : issueText.substring(0, 80).trim();
      currentIssue = { title, summary: issueText.substring(0, 120), body: issueText };
    } else if (currentIssue && trimmed) {
      currentIssue.body += '\n' + trimmed;
    }
  }

  if (currentIssue && currentIssue.body.length > 0) {
    lessons.push(currentIssue);
  }

  return lessons.slice(0, MAX_LESSONS_PER_REVIEW).map(l => ({
    title: l.title,
    summary: l.summary,
    content: l.body,
  }));
}

/**
 * Save extracted lessons to the knowledge base as markdown entries.
 * Deduplicates by checking existing entry titles.
 * @param {string} taskId - The task that triggered the review
 * @param {string} branch - The branch that was reviewed
 * @param {Array<{title: string, summary: string, content: string}>} lessons
 * @param {object} [opts] - Optional overrides for testing
 * @param {string} [opts.entriesDir] - Override entries directory
 * @param {string} [opts.indexPath] - Override index.json path
 * @returns {number} Number of lessons saved
 */
function saveLessons(taskId, branch, lessons, opts = {}) {
  if (!lessons || lessons.length === 0) return 0;

  const entriesDir = opts.entriesDir || DEFAULT_ENTRIES_DIR;
  const indexPath = opts.indexPath || DEFAULT_INDEX_PATH;

  if (!fs.existsSync(entriesDir)) {
    fs.mkdirSync(entriesDir, { recursive: true });
  }

  // Load existing titles for dedup
  const existingTitles = new Set();
  try {
    if (fs.existsSync(indexPath)) {
      const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      // Support both formats: { entries: [...] } and flat array [...]
      const entries = Array.isArray(raw) ? raw : (raw.entries || []);
      for (const entry of entries) {
        if (entry.title) existingTitles.add(entry.title.toLowerCase());
      }
    }
  } catch (err) {
    console.error(`[ReviewLearner] Failed to read index for dedup: ${err.message}`);
  }

  const today = getTodayDate();
  let savedCount = 0;

  for (const lesson of lessons) {
    const normalizedTitle = `Review Lesson: ${lesson.title}`.toLowerCase();
    if (existingTitles.has(normalizedTitle)) {
      console.error(`[ReviewLearner] Skipping duplicate lesson: ${lesson.title}`);
      continue;
    }

    const timestamp = Date.now();
    const id = `review-lesson-${timestamp}-${savedCount}`;
    const tags = ['review-lesson', 'auto-generated', 'worker-feedback'];

    const content = `---
title: "Review Lesson: ${lesson.title.replace(/"/g, '\\"')}"
tags: [${tags.join(', ')}]
created: ${today}
updated: ${today}
---

${lesson.content}

---
Source: review of branch ${branch}, task ${taskId}
`;

    try {
      const filePath = path.join(entriesDir, `${id}.md`);
      fs.writeFileSync(filePath, content, 'utf-8');
      existingTitles.add(normalizedTitle);
      savedCount++;
      console.error(`[ReviewLearner] Saved lesson: ${id} — ${lesson.title}`);
    } catch (err) {
      console.error(`[ReviewLearner] Failed to save lesson ${id}: ${err.message}`);
    }
  }

  if (savedCount > 0) {
    _updateIndex(entriesDir, indexPath);
  }

  return savedCount;
}

/**
 * Rebuild index.json from entries directory.
 * @param {string} [entriesDir]
 * @param {string} [indexPath]
 */
function _updateIndex(entriesDir = DEFAULT_ENTRIES_DIR, indexPath = DEFAULT_INDEX_PATH) {
  try {
    if (!fs.existsSync(entriesDir)) return;
    const files = fs.readdirSync(entriesDir).filter(f => f.endsWith('.md'));
    const entries = [];

    for (const file of files) {
      const filePath = path.join(entriesDir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const id = file.replace(/\.md$/, '');
      const titleMatch = fm.match(/title:\s*"?([^"\n]+)"?/);
      const tagsMatch = fm.match(/tags:\s*\[([^\]]*)\]/);
      const summaryMatch = fm.match(/summary:\s*"?([^"\n]+)"?/);
      const title = titleMatch ? titleMatch[1].trim() : id;
      const tags = tagsMatch
        ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
        : [];
      const summary = summaryMatch ? summaryMatch[1].trim() : '';

      entries.push({ id, title, tags, summary });
    }

    // Write in { version, entries } format to match mcp-server.js expectations
    const index = { version: '1.0.0', entries };
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[ReviewLearner] Failed to update index: ${err.message}`);
  }
}

module.exports = { extractLessons, saveLessons };
