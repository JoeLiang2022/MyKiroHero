/**
 * AI Usage Tracker
 * 記錄外部 AI API 使用量，每日統計，超限拒絕
 */

const fs = require('fs');
const path = require('path');
const { getNow, getTodayDate } = require('../utils/timezone');

const DATA_FILE = path.join(__dirname, '../../data/ai-usage.json');
const RETENTION_DAYS = 30;

class UsageTracker {
  constructor() {
    this._data = this._load();
  }

  /** 記錄一次 API 呼叫 */
  record(provider, model, metadata = {}) {
    const today = this._today();
    if (!this._data[today]) this._data[today] = {};
    if (!this._data[today][provider]) {
      this._data[today][provider] = { calls: 0, estimatedCost: 0 };
    }

    const entry = this._data[today][provider];
    entry.calls += 1;
    entry.estimatedCost += metadata.estimatedCost || 0;

    // Periodic cleanup: run once per day on first record
    if (!this._lastCleanupDate || this._lastCleanupDate !== today) {
      this._lastCleanupDate = today;
      this.cleanup();
    }

    this._save();
    return entry;
  }

  /** 查詢當日使用量 */
  getToday(provider) {
    const today = this._today();
    const dayData = this._data[today] || {};
    if (provider) return dayData[provider] || { calls: 0, estimatedCost: 0 };

    // 全部 provider 彙總
    let totalCalls = 0;
    let totalCost = 0;
    const byProvider = {};
    for (const [pid, stats] of Object.entries(dayData)) {
      totalCalls += stats.calls;
      totalCost += stats.estimatedCost;
      byProvider[pid] = { ...stats };
    }
    return { totalCalls, totalCost: Math.round(totalCost * 100) / 100, byProvider };
  }

  /** 檢查是否在每日上限內 */
  isWithinLimit(callLimit, costLimit) {
    const { totalCalls, totalCost } = this.getToday();
    if (callLimit > 0 && totalCalls >= callLimit) {
      return { allowed: false, reason: 'call_limit', current: totalCalls, limit: callLimit };
    }
    if (costLimit > 0 && totalCost >= costLimit) {
      return { allowed: false, reason: 'cost_limit', current: totalCost, limit: costLimit };
    }
    return { allowed: true };
  }

  /** 清理過期資料 */
  cleanup() {
    const cutoff = getNow();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const year = cutoff.getFullYear();
    const month = String(cutoff.getMonth() + 1).padStart(2, '0');
    const day = String(cutoff.getDate()).padStart(2, '0');
    const cutoffStr = `${year}-${month}-${day}`;

    let removed = 0;
    for (const date of Object.keys(this._data)) {
      if (date < cutoffStr) {
        delete this._data[date];
        removed++;
      }
    }
    if (removed > 0) this._save();
    return removed;
  }

  // ─── 內部 ───

  _today() {
    return getTodayDate();
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      }
    } catch { /* corrupt file, start fresh */ }
    return {};
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(this._data, null, 2));
    } catch (e) {
      console.error('[UsageTracker] Save failed:', e.message);
    }
  }
}

module.exports = UsageTracker;
