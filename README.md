# MyKiroHero 🤪

**讓 Kiro AI 成為你的 WhatsApp 助手**

透過 WhatsApp 與 Kiro IDE 的 AI 對話，完全自動化、不需要額外 AI API key。

## ✨ 功能

- 📱 **WhatsApp 整合** - 收發 WhatsApp 訊息
- 🖼️ **媒體傳送** - 支援圖片、影片、文件傳送
- 🤖 **Kiro AI 回覆** - 使用 Kiro 內建的 AI 處理對話
- 🔄 **完全自動化** - 訊息自動轉發，不需人工介入
- 💓 **Heartbeat 排程** - 定時任務自動執行（記憶同步、提醒等）
- 💪 **RDP 友善** - 斷線後仍可運作，不需要 GUI 權限

## 架構

```
WhatsApp 訊息
    ↓
Gateway (Node.js, port 3000)
    ↓
REST API (vscode-rest-control extension, port 55139)
    ↓
Kiro IDE Chat
    ↓
叫小賀回覆
    ↓
Gateway API → WhatsApp
```

## 🚀 快速安裝（推薦）

在 PowerShell 執行一行指令：

```powershell
irm https://raw.githubusercontent.com/NorlWu-TW/MyKiroHero/main/install.ps1 | iex
```

這會自動：
- 檢查 Node.js 和 Git
- 下載 MyKiroHero
- 安裝 Node.js 依賴
- 安裝 vscode-rest-control extension
- 設定 AI 人格檔案（可選擇使用範本或從 GitHub 還原）
- 建立環境設定檔

## 📦 手動安裝

### 1. Clone 專案

```powershell
git clone https://github.com/NorlWu-TW/MyKiroHero.git
cd MyKiroHero
```

### 2. 安裝 vscode-rest-control extension

```powershell
kiro --install-extension vscode-rest-control-0.0.18.vsix
```

或從 GitHub 自行編譯：https://github.com/dpar39/vscode-rest-control

### 3. 安裝 Node.js 依賴

```powershell
npm install
```

### 4. 設定環境變數（可選）

複製 `.env.example` 為 `.env` 並設定：
- `KIRO_REST_PORT` - REST Control extension 的 port（預設自動偵測）
- `TELEGRAM_BOT_TOKEN` - Telegram bot token（可選）

## ▶️ 啟動

```powershell
node src/gateway/index.js
```

首次啟動會顯示 WhatsApp QR code，用手機掃描登入。

等待看到 `[WhatsApp] 已連線，開始監聯訊息` 即可。

## 訊息格式

- **WhatsApp 進來:** `[WhatsApp] 使用者名稱: 訊息內容 (chatId: xxx@c.us)`
- **回覆自動加前綴:** `*[叫小賀]* 🤪 回覆內容`

## 💓 Heartbeat 排程

在 `.kiro/steering/HEARTBEAT.md` 設定定時任務：

```markdown
## 排程 (schedules)
```
04:00 記憶同步
09:00 早安提醒
```
```

Gateway 會自動讀取並在指定時間觸發任務。每小時自動重新載入，不需重啟。

## 📡 API

### 發送文字回覆

```
POST http://localhost:3000/api/reply
Content-Type: application/json

{
  "platform": "whatsapp",
  "chatId": "886953870991@c.us",
  "message": "你的回覆"
}
```

### 發送媒體檔案

```
POST http://localhost:3000/api/reply/media
Content-Type: application/json

{
  "platform": "whatsapp",
  "chatId": "886953870991@c.us",
  "filePath": "C:/path/to/image.png",
  "caption": "圖片說明（可選）"
}
```

### 健康檢查

```
GET http://localhost:3000/api/health
```

## 📁 檔案結構

```
MyKiroHero/
├── src/
│   ├── gateway/
│   │   ├── index.js              # 主程式入口
│   │   ├── server.js             # Gateway server（含 Heartbeat）
│   │   ├── config.js             # 設定檔
│   │   ├── whatsapp-adapter.js   # WhatsApp 連線
│   │   ├── telegram-adapter.js   # Telegram 連線（可選）
│   │   └── handlers/
│   │       └── kiro-cli-handler.js  # REST API handler
│   └── whatsapp/
│       └── client.js             # WhatsApp client
├── .env.example                  # 環境變數範例
├── install.ps1                   # 一鍵安裝腳本
├── package.json                  # Node.js 依賴
├── SETUP.md                      # 詳細設定指南
└── README.md                     # 本文件
```

## 系統需求

- Windows 10/11
- Node.js 18+
- Kiro IDE
- vscode-rest-control extension

## 技術細節

- **REST API Command:** `kiroAgent.sendMainUserInput`
- **Gateway Port:** 3000
- **REST Control Port:** 55139（可透過 `$env:REMOTE_CONTROL_PORT` 取得）

詳細設定請參考 [SETUP.md](./SETUP.md)

## ⚙️ 設定

編輯 `src/gateway/config.js` 自訂：

```javascript
module.exports = {
    aiPrefix: '*[叫小賀]* 🤪',     // AI 回覆前綴
    kiroRestPort: 55139,           // REST Control port
    serverPort: 3000,              // Gateway port
    message: {
        maxLength: 1500,           // 訊息分段長度
        splitDelay: 500            // 分段延遲（ms）
    },
    heartbeatPath: '...'           // HEARTBEAT.md 路徑
};
```

## 📜 授權

MIT License

## 👥 作者

- **叫小賀** (Jiao Xiao He) 🤪 - AI 助手
- **NorlWu** - 人類夥伴

---
*Built with ❤️ in Taiwan, 2026-02-04*
