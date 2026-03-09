/**
 * JournalManager - 管理 Journal 記錄
 * 
 * 負責 journal 記錄的 CRUD 操作，支援按類別查詢。
 * 
 * **Implements: Requirements 2.1, 2.2, 2.3**
 */

const fs = require('fs');
const path = require('path');
const { parseJsonlFile, formatJsonlRecord } = require('./jsonl-parser');
const { getTodayDate, getNowISO } = require('../utils/timezone');

const VALID_CATEGORIES = ['event', 'thought', 'lesson', 'todo'];

class JournalManager {
  /**
   * @param {string} journalDir - Directory to store journal files
   */
  constructor(journalDir = 'memory/journals') {
    this.journalDir = journalDir;
    this.ensureDir();
  }

  ensureDir() {
    if (!fs.existsSync(this.journalDir)) {
      fs.mkdirSync(this.journalDir, { recursive: true });
    }
  }

  /**
   * Get the journal file path for a specific date
   * @param {string} [date] - ISO date string (YYYY-MM-DD), defaults to today
   */
  getJournalFile(date) {
    const targetDate = date || getTodayDate();
    return path.join(this.journalDir, `${targetDate}.jsonl`);
  }

  validateCategory(category) {
    if (!VALID_CATEGORIES.includes(category)) {
      throw new Error(`Invalid category: ${category}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }
  }

  generateId() {
    return `j_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Create a new journal entry
   */
  create(category, content, metadata = {}) {
    this.validateCategory(category);

    // 驗證 content
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('Content cannot be empty');
    }
    if (content.length > 10000) {
      throw new Error(`Content too long: ${content.length} chars (max 10000)`);
    }

    const entry = {
      type: 'journal',
      id: this.generateId(),
      category,
      content,
      metadata,
      timestamp: getNowISO()
    };

    if (category === 'todo') {
      entry.status = 'pending';
    }

    // Remove empty metadata
    if (Object.keys(entry.metadata).length === 0) {
      delete entry.metadata;
    }

    const filePath = this.getJournalFile();
    const line = formatJsonlRecord(entry);
    fs.appendFileSync(filePath, line, 'utf8');

    return entry;
  }

  /**
   * Read all journal entries for a specific date
   */
  readAll(date) {
    const filePath = this.getJournalFile(date);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    return parseJsonlFile(filePath).filter(r => r.type === 'journal');
  }

  /**
   * Read journal entries by category
   */
  readByCategory(category, date) {
    this.validateCategory(category);
    return this.readAll(date).filter(entry => entry.category === category);
  }

  /**
   * Read a specific journal entry by ID
   */
  readById(id, date) {
    const all = this.readAll(date).filter(entry => entry.id === id);
    return all.length > 0 ? all[all.length - 1] : null;
  }

  /**
   * Update a journal entry (append-only: creates a new version)
   */
  update(id, updates, date) {
    const existing = this.readById(id, date);
    if (!existing) {
      return null;
    }

    if (updates.category) {
      this.validateCategory(updates.category);
    }

    const now = getNowISO();
    const updatedEntry = {
      ...existing,
      ...updates,
      id: existing.id,
      type: 'journal',
      timestamp: now,
      updatedAt: now,
      previousTimestamp: existing.timestamp
    };

    const filePath = this.getJournalFile(date);
    const line = formatJsonlRecord(updatedEntry);
    fs.appendFileSync(filePath, line, 'utf8');

    return updatedEntry;
  }

  /**
   * Mark a todo as complete
   */
  completeTodo(id, date) {
    const existing = this.readById(id, date);
    if (!existing || existing.category !== 'todo') {
      return null;
    }
    return this.update(id, { status: 'completed', completedAt: getNowISO() }, date);
  }

  /**
   * Get the latest version of each journal entry
   */
  getLatestVersions(date) {
    const all = this.readAll(date);
    const latestById = new Map();

    for (const entry of all) {
      // Append-only: later entries are always newer, so just overwrite
      latestById.set(entry.id, entry);
    }

    return Array.from(latestById.values());
  }

  /**
   * Get pending todos
   */
  getPendingTodos(date) {
      if (date) {
        // Single date mode (original behavior)
        return this.getLatestVersions(date)
          .filter(entry => entry.category === 'todo' && entry.status === 'pending');
      }

      // Scan all journal files for pending todos
      const allPending = [];
      try {
        const files = fs.readdirSync(this.journalDir)
          .filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
          .sort();
        for (const file of files) {
          const fileDate = file.replace('.jsonl', '');
          const pending = this.getLatestVersions(fileDate)
            .filter(entry => entry.category === 'todo' && entry.status === 'pending')
            .map(entry => ({ ...entry, _date: fileDate }));
          allPending.push(...pending);
        }
      } catch (err) {
        // fallback to today only
        return this.getLatestVersions()
          .filter(entry => entry.category === 'todo' && entry.status === 'pending');
      }
      return allPending;
    }



  /**
   * Search journal entries by content
   */
  search(query, date) {
    const lowerQuery = query.toLowerCase();
    return this.getLatestVersions(date)
      .filter(entry => entry.content.toLowerCase().includes(lowerQuery));
  }

  /**
   * Get journal statistics for a date
   */
  getStats(date) {
    const entries = this.getLatestVersions(date);
    const stats = {
      total: entries.length,
      byCategory: {}
    };

    for (const category of VALID_CATEGORIES) {
      stats.byCategory[category] = entries.filter(e => e.category === category).length;
    }

    const todos = entries.filter(e => e.category === 'todo');
    stats.todos = {
      total: todos.length,
      pending: todos.filter(t => t.status === 'pending').length,
      completed: todos.filter(t => t.status === 'completed').length
    };

    return stats;
  }
}

module.exports = { JournalManager, VALID_CATEGORIES };
