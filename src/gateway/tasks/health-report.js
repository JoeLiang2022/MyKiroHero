/**
 * health-report.js — Layer 1 Handler: System health report
 *
 * Collects status from Gateway, WhatsApp, Workers, Tasks, Memory Engine
 * and returns a formatted text report. Zero-token, no AI needed.
 *
 * Params: (none required)
 */

const fs = require('fs');
const path = require('path');

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function readPortFile(projectDir, filename) {
  const filePath = path.join(projectDir, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8').trim();
}

const STATUS_EMOJI = {
  completed: '✅',
  success: '✅',
  failed: '❌',
  running: '🔄',
  queued: '⏳',
  cancelled: '🚫',
  reviewing: '👀',
};

function taskEmoji(status) {
  return STATUS_EMOJI[status] || '❓';
}

module.exports = {
  name: 'health-report',
  description: 'System health report',
  type: 'layer1',

  execute: async (params, context) => {
    const projectDir = (context && context.projectDir) || process.cwd();
    const sections = [];

    // --- Gateway ---
    let gwPort;
    try {
      gwPort = readPortFile(projectDir, '.gateway-port');
      if (!gwPort) throw new Error('.gateway-port not found');
      const health = await fetchJson(`http://127.0.0.1:${gwPort}/api/health`);
      sections.push(`📡 Gateway: online (port ${gwPort})`);

      // WhatsApp status from health response
      const waStatus = health.whatsapp || health.wa || null;
      if (waStatus) {
        sections.push(`💬 WhatsApp: ${typeof waStatus === 'object' ? (waStatus.status || JSON.stringify(waStatus)) : waStatus}`);
      } else {
        sections.push('💬 WhatsApp: unknown (not in health response)');
      }

    } catch (err) {
      sections.push(`📡 Gateway: offline — ${err.message}`);
      sections.push('💬 WhatsApp: unknown (gateway offline)');
    }

    // --- Workers ---
    if (gwPort) {
      try {
        const workers = await fetchJson(`http://127.0.0.1:${gwPort}/api/workers`);
        const list = Array.isArray(workers) ? workers : (workers.workers || []);
        const counts = { idle: 0, busy: 0, offline: 0 };
        for (const w of list) {
          const s = (w.status || 'offline').toLowerCase();
          if (s === 'idle') counts.idle++;
          else if (s === 'busy') counts.busy++;
          else counts.offline++;
        }
        sections.push(`🤖 Workers: ${list.length} total (${counts.idle} idle, ${counts.busy} busy, ${counts.offline} offline)`);
      } catch (err) {
        sections.push(`🤖 Workers: unavailable — ${err.message}`);
      }
    }

    // --- Recent Tasks ---
    if (gwPort) {
      try {
        const tasksRes = await fetchJson(`http://127.0.0.1:${gwPort}/api/tasks?limit=10`);
        const tasks = Array.isArray(tasksRes) ? tasksRes : (tasksRes.tasks || []);
        const recent = tasks.slice(0, 5);
        if (recent.length === 0) {
          sections.push('📋 Recent Tasks: none');
        } else {
          const lines = recent.map(t =>
            `  ${taskEmoji(t.status)} ${t.id || t.taskId || '?'} — ${t.action || t.type || '?'} (${t.status || '?'})`
          );
          sections.push(`📋 Recent Tasks:\n${lines.join('\n')}`);
        }
      } catch (err) {
        sections.push(`📋 Recent Tasks: unavailable — ${err.message}`);
      }
    }

    // --- Memory Engine ---
    try {
      const memPort = readPortFile(projectDir, '.memory-engine-port');
      if (!memPort) throw new Error('.memory-engine-port not found');
      const memHealth = await fetchJson(`http://127.0.0.1:${memPort}/health`);
      sections.push(`🧠 Memory Engine: online (port ${memPort}) — ${memHealth.status || 'ok'}`);
    } catch (err) {
      sections.push(`🧠 Memory Engine: offline — ${err.message}`);
    }

    const reportText = `=== System Health Report ===\n\n${sections.join('\n')}\n\n=== End ===`;

    return {
      success: true,
      message: reportText,
    };
  },
};
