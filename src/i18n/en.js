/**
 * English language pack
 */
module.exports = {
  // Review pipeline (server.js)
  reviewPassed: 'Worker task review passed: {branch}, awaiting Commander merge decision',
  reviewFailed: '❌ Code review failed for {branch} (after {retryCount} fix attempts), manual review needed',
  reviewError: 'Worker task review pipeline error: {branch}, please check status',

  // Worker spawner (worker-spawner.js)
  workerFolderReady: '📂 Worker folder ready: {workerId}\nPath: {workerPath}\n\nPlease open a Kiro window manually 👉 Worker will auto-register once opened.',

  // Worker registration (index.js)
  workerOnline: '🆕 Worker {workerId} online (port {port}), total: {total} workers',
};
