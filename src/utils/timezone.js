/**
 * Timezone utilities
 * 
 * 用 WhatsApp server timestamp 校正本機時間
 */

// Time offset (毫秒): serverTime - localTime
let timeOffset = 0;
let timeSynced = false;

/**
 * 設定時間偏移量
 * @param {number} serverTimestamp - WhatsApp server 的 Unix timestamp（秒）
 */
function setTimeOffset(serverTimestamp) {
  if (typeof serverTimestamp !== 'number' || !isFinite(serverTimestamp) || serverTimestamp <= 0) {
    console.warn(`[TimeSync] Invalid serverTimestamp: ${serverTimestamp}, ignoring`);
    return;
  }
  const serverMs = serverTimestamp * 1000;
  const localMs = Date.now();
  timeOffset = serverMs - localMs;
  timeSynced = true;
  console.log(`[TimeSync] offset = ${timeOffset}ms (${(timeOffset / 1000).toFixed(1)}s)`);
}

/**
 * 檢查是否已同步時間
 */
function isTimeSynced() {
  return timeSynced;
}

/**
 * 取得校正後的當前時間
 */
function getNow() {
  return new Date(Date.now() + timeOffset);
}

/**
 * 取得今天日期 (YYYY-MM-DD)，使用本地時區
 */
function getTodayDate() {
  const now = getNow();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 取得今天日期 (YYYYMMDD)
 */
function getTodayDateCompact() {
  return getTodayDate().replace(/-/g, '');
}

/**
 * 取得當前時間 ISO 格式
 */
function getNowISO() {
  return getNow().toISOString();
}

module.exports = {
  setTimeOffset,
  isTimeSynced,
  getNow,
  getTodayDate,
  getTodayDateCompact,
  getNowISO
};
