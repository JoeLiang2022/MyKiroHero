/**
 * JSONL Parser - 容錯解析 JSONL 檔案
 * 
 * Requirements: 1.6, 9.3
 * - 跳過格式錯誤的行
 * - 回傳有效記錄陣列，不拋出錯誤
 */

const fs = require('fs');

/**
 * 解析 JSONL 檔案，跳過格式錯誤的行
 * 
 * @param {string} filePath - JSONL 檔案路徑
 * @returns {Array} 有效記錄陣列
 */
function parseJsonlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseJsonlContent(content);
  } catch (err) {
    console.warn(`[JSONL Parser] 讀取檔案失敗: ${err.message}`);
    return [];
  }
}

/**
 * 解析 JSONL 內容字串，跳過格式錯誤的行
 * 
 * @param {string} content - JSONL 內容
 * @returns {Array} 有效記錄陣列
 */
function parseJsonlContent(content) {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const lines = content.split('\n');
  const records = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // 跳過空行
    if (!line) {
      continue;
    }

    try {
      const record = JSON.parse(line);
      records.push(record);
    } catch (err) {
      // 跳過格式錯誤的行，記錄警告
      console.warn(`[JSONL Parser] 第 ${i + 1} 行格式錯誤，已跳過: ${line.substring(0, 50)}...`);
    }
  }

  return records;
}

/**
 * 格式化記錄為 JSONL 行
 * 
 * @param {object} record - 記錄物件
 * @returns {string} JSON 字串（含換行）
 */
function formatJsonlRecord(record) {
  return JSON.stringify(record) + '\n';
}

/**
 * 格式化多筆記錄為 JSONL 內容
 * 
 * @param {Array} records - 記錄陣列
 * @returns {string} JSONL 內容（每行一筆記錄）
 */
function formatJsonlContent(records) {
  if (!Array.isArray(records)) {
    return '';
  }
  // formatJsonlRecord already appends '\n', so just concatenate (no join separator)
  return records.map(r => formatJsonlRecord(r)).join('');
}

module.exports = {
  parseJsonlFile,
  parseJsonlContent,
  formatJsonlRecord,
  formatJsonlContent
};
