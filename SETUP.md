# MyKiroHero 詳細設定指南

## 系統架構

```
WhatsApp 訊息 → Gateway (Node.js) → REST API → Kiro chat → 叫小賀回覆 → API → WhatsApp
```

## 前置需求

### 1. vscode-rest-control extension

這是關鍵元件，讓外部程式可以透過 HTTP REST API 控制 Kiro。

**安裝方式：**
```powershell
kiro --install-extension vscode-rest-control-0.0.18.vsix
```

**確認安裝成功：**
- Kiro 左下角狀態列顯示 "RC Port: 55139"
- 終端機有 `$env:REMOTE_CONTROL_PORT` 環境變數

### 2. Node.js

需要 Node.js 18 或更新版本。

```powershell
node --version  # 應該顯示 v18.x.x 或更高
```

### 3. WhatsApp 帳號

首次執行會顯示 QR code，需要用手機 WhatsApp 掃描登入。

## 安裝步驟

### Step 1: 安裝依賴

```powershell
cd MyKiroHero
npm install
```

### Step 2: 設定環境變數（可選）

```powershell
copy .env.example .env
```

編輯 `.env` 檔案：
```
KIRO_REST_PORT=55139
TELEGRAM_BOT_TOKEN=your_token_here  # 可選
```

### Step 3: 啟動 Gateway

```powershell
node src/gateway/index.js
```

### Step 4: 掃描 QR code

首次執行會在終端機顯示 QR code，用手機 WhatsApp 掃描。

### Step 5: 確認連線

看到以下訊息表示成功：
```
[WhatsApp] 已連線，開始監聽訊息
[Gateway] whatsapp client registered
```

## REST API 技術細節

### 送訊息到 Kiro chat

```
GET http://127.0.0.1:55139/?command=kiroAgent.sendMainUserInput&args=["訊息內容"]
```

### Gateway API

**發送回覆：**
```powershell
$body = @{
    platform = "whatsapp"
    chatId = "886953870991@c.us"
    message = "你的回覆"
} | ConvertTo-Json

$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod -Uri "http://localhost:3000/api/reply" -Method POST -ContentType "application/json; charset=utf-8" -Body $bytes
```

**健康檢查：**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health"
```

## 訊息格式

### 進來的訊息
```
[WhatsApp] 使用者名稱: 訊息內容 (chatId: 886953870991@c.us)
```

### 回覆格式
回覆會自動加上前綴：`*[叫小賀]* 🤪`

## 故障排除

### REST API 連不上

1. 確認 Kiro 左下角有顯示 "RC Port: 55139"
2. 確認 vscode-rest-control extension 已安裝
3. 嘗試重新載入 Kiro 視窗（Ctrl+Shift+P → Reload Window）

### WhatsApp 斷線

1. 檢查 `.wwebjs_auth/` 資料夾是否存在
2. 刪除 `.wwebjs_auth/` 重新掃描 QR code

### 訊息沒送到 Kiro

1. 檢查 Gateway log 是否有 `[KiroREST] ✓ 已送到 Kiro chat`
2. 確認 port 55139 沒被其他程式佔用
3. 檢查 `$env:REMOTE_CONTROL_PORT` 是否正確

### 中文亂碼

確保使用 UTF-8 編碼：
```powershell
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
```

## 打包注意事項

如果要打包成安裝檔，需要包含：

1. **必要檔案：**
   - `src/` 資料夾
   - `package.json`
   - `package-lock.json`
   - `.env.example`

2. **不要包含：**
   - `node_modules/` - 安裝時會自動下載
   - `.wwebjs_auth/` - 使用者自己的登入資訊
   - `.wwebjs_cache/` - 快取檔案

3. **額外需要：**
   - `vscode-rest-control-0.0.18.vsix` - extension 安裝檔

---
最後更新：2026-02-04
