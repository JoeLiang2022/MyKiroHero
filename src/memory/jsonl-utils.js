/**
 * JSONL Utilities
 * 
 * 提供 JSONL 檔案的解析和格式化功能。
 * 
 * 特點：
 * - 容錯解析：跳過格式錯誤的行，不拋出錯誤
 * - Round-trip 一致性：parse → format → parse 產生等價物件
 */

const fs = require('fs');

/**
 * 解析 JSONL 檔案
 * 
 * 讀取 JSONL 檔案並解析每一行為 JSON 物件。
 * 格式錯誤的行會被跳過，不會拋出錯誤。
 * 
 * @param {string} filePath - JSONL 檔案路徑
 * @returns {Array<object>} 有效記錄陣列
 * 
 * Requirements: 1.6, 9.3
 */
function parseJsonlFile(filePath) {
    // 檔案不存在時回傳空陣列
    if (!fs.existsSync(filePath)) {
        return [];
    }

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return parseJsonlContent(content);
    } catch (err) {
        // 讀取錯誤時回傳空陣列，不拋出錯誤
        console.warn(`[JSONL] 讀取檔案失敗: ${err.message}`);
        return [];
    }
}

/**
 * 解析 JSONL 內容字串
 * 
 * 將 JSONL 格式的字串解析為物件陣列。
 * 格式錯誤的行會被跳過。
 * 
 * @param {string} content - JSONL 格式的字串
 * @returns {Array<object>} 有效記錄陣列
 */
function parseJsonlContent(content) {
    if (!content || typeof content !== 'string') {
        return [];
    }

    const lines = content.split('\n');
    const records = [];

    for (const line of lines) {
        const trimmed = line.trim();
        
        // 跳過空行
        if (!trimmed) {
            continue;
        }

        try {
            const record = JSON.parse(trimmed);
            // 只接受物件類型的記錄
            if (record && typeof record === 'object' && !Array.isArray(record)) {
                records.push(record);
            }
        } catch (err) {
            // 跳過格式錯誤的行，不拋出錯誤
            // 這是設計上的容錯處理
        }
    }

    return records;
}

/**
 * 格式化單筆記錄為 JSONL 格式
 * 
 * 將物件序列化為 JSON 字串（單行，無縮排）。
 * 確保輸出為有效的 JSON Lines 格式。
 * 
 * @param {object} record - 要格式化的記錄
 * @returns {string} JSON 字串（不含換行符）
 * 
 * Requirements: 1.7
 */
function formatJsonlRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('Record must be a non-null object');
    }

    // JSON.stringify 預設就是單行輸出
    return JSON.stringify(record);
}

/**
 * 格式化多筆記錄為 JSONL 格式
 * 
 * @param {Array<object>} records - 記錄陣列
 * @returns {string} JSONL 格式字串（每行一筆記錄）
 */
function formatJsonlRecords(records) {
    if (!Array.isArray(records)) {
        throw new Error('Records must be an array');
    }

    return records
        .filter(r => r && typeof r === 'object' && !Array.isArray(r))
        .map(r => formatJsonlRecord(r))
        .join('\n');
}

/**
 * 驗證記錄是否包含必要的基本欄位
 * 
 * @param {object} record - 要驗證的記錄
 * @returns {boolean} 是否有效
 */
function isValidBaseRecord(record) {
    if (!record || typeof record !== 'object') {
        return false;
    }

    // 檢查必要欄位
    if (!record.ts || typeof record.ts !== 'string') {
        return false;
    }

    if (!record.sessionId || typeof record.sessionId !== 'string') {
        return false;
    }

    // 驗證 ts 是有效的 ISO timestamp
    try {
        const date = new Date(record.ts);
        if (isNaN(date.getTime())) {
            return false;
        }
    } catch (err) {
        return false;
    }

    // 驗證 sessionId 格式 (YYYYMMDD-NNN)
    if (!/^\d{8}-\d{3}$/.test(record.sessionId)) {
        return false;
    }

    return true;
}

/**
 * 過濾並回傳有效的基本記錄
 * 
 * @param {Array<object>} records - 記錄陣列
 * @returns {Array<object>} 有效記錄陣列
 */
function filterValidRecords(records) {
    if (!Array.isArray(records)) {
        return [];
    }

    return records.filter(isValidBaseRecord);
}

module.exports = {
    parseJsonlFile,
    parseJsonlContent,
    formatJsonlRecord,
    formatJsonlRecords,
    isValidBaseRecord,
    filterValidRecords
};
