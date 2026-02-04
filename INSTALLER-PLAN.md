# MyKiroHero 安裝檔規劃

## 目標
讓使用者可以一鍵安裝 MyKiroHero，不需要手動設定。

---

## 安裝流程

### Step 1: 歡迎畫面
- 顯示 MyKiroHero 介紹
- 確認使用者同意條款

### Step 2: 檢查依賴
- [ ] Node.js 是否已安裝？
  - 沒有 → 提示下載或內建安裝
- [ ] Kiro 是否已安裝？
  - 沒有 → 提示下載

### Step 3: 選擇安裝位置
- 預設：`%LOCALAPPDATA%\MyKiroHero`
- 使用者可自訂

### Step 4: 設定精靈
- AI 名稱（預設：AI Assistant）
- AI Emoji（預設：🤪）
- Kiro workspace 路徑
- 是否開機自動啟動？

### Step 5: 安裝
- 複製檔案到安裝目錄
- 執行 `npm install`
- 產生 config.js（根據使用者設定）
- 建立 Startup 腳本（如果選擇自動啟動）

### Step 6: 完成
- 顯示 QR Code 掃描說明
- 啟動 Gateway

---

## 檔案結構調整

### 目前結構
```
MyKiroHero/
├── src/gateway/
│   ├── config.js      ← 設定寫死
│   ├── server.js
│   ├── index.js
│   └── handlers/
├── package.json
└── ...
```

### 建議結構
```
MyKiroHero/
├── src/gateway/
│   ├── server.js
│   ├── index.js
│   └── handlers/
├── config/
│   ├── config.default.js   ← 預設設定（範本）
│   └── config.js           ← 使用者設定（安裝時產生）
├── scripts/
│   ├── install.js          ← 安裝腳本
│   ├── setup.js            ← 設定精靈
│   └── startup.js          ← 產生 Startup 腳本
├── package.json
└── ...
```

---

## config.js 改進

### 目前
```javascript
module.exports = {
    aiPrefix: '*[AI Assistant]* 🤖',  // 寫死
    kiroRestPort: 55139,
    // ...
};
```

### 建議
```javascript
const path = require('path');
const fs = require('fs');

// 預設設定
const defaults = {
    aiName: 'AI Assistant',
    aiEmoji: '🤖',
    kiroRestPort: process.env.KIRO_REST_PORT || 55139,
    serverPort: process.env.GATEWAY_PORT || 3000,
    message: {
        maxLength: 1500,
        splitDelay: 500
    },
    errorNotification: true
};

// 讀取使用者設定（如果存在）
const userConfigPath = path.join(__dirname, 'config.user.json');
let userConfig = {};
if (fs.existsSync(userConfigPath)) {
    userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
}

// 合併設定
const config = { ...defaults, ...userConfig };

// 產生 aiPrefix
config.aiPrefix = `*[${config.aiName}]* ${config.aiEmoji}`;

module.exports = config;
```

---

## 打包方式選項

### 選項 A: Inno Setup（推薦）
- 優點：成熟、免費、Windows 原生體驗
- 缺點：需要學習 Inno Setup 腳本

### 選項 B: electron-builder
- 優點：跨平台、可做 GUI 設定介面
- 缺點：打包檔案較大

### 選項 C: pkg + 自製安裝腳本
- 優點：簡單、Node.js 打包成單一 .exe
- 缺點：沒有漂亮的安裝介面

### 建議
先用 **選項 C**（pkg）做 MVP，之後再考慮 Inno Setup。

---

## 下一步
1. [ ] 重構 config.js 支援使用者設定
2. [ ] 建立 setup.js 設定精靈（CLI）
3. [ ] 建立 startup.js 產生 Startup 腳本
4. [ ] 測試 pkg 打包
5. [ ] 寫安裝說明文件

---

*建立日期：2026-02-04*
