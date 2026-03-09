/**
 * Chinese (Traditional) language pack
 */
module.exports = {
  // Review pipeline (server.js)
  reviewPassed: 'Worker 任務 review 通過：{branch}，等待 Commander 決定是否 merge',
  reviewFailed: '❌ Code review failed for {branch} (after {retryCount} fix attempts)，需要手動 review',
  reviewError: 'Worker 任務 review pipeline 出錯：{branch}，請檢查狀態',

  // Worker spawner (worker-spawner.js)
  workerFolderReady: '📂 Worker folder 準備好了：{workerId}\n路徑：{workerPath}\n\n請手動開啟 Kiro 視窗 👉 開啟後 Worker 會自動 register。',

  // Worker registration (index.js)
  workerOnline: '🆕 Worker {workerId} online (port {port}), total: {total} workers',
};
