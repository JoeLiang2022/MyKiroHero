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
│   │   ├── config.js             # 設定檔（環境變數配置）
│   │   ├── whatsapp-adapter.js   # WhatsApp 連線
│   │   ├── telegram-adapter.js   # Telegram 連線（可選）
│   │   └── handlers/
│   │       ├── index.js          # Handler Factory
│   │       ├── base-handler.js   # 抽象基類
│   │       └── kiro-handler.js   # Kiro IDE handler
│   ├── mcp-server.js             # MCP Server（標準協議）
│   └── whatsapp/
│       └── client.js             # WhatsApp 獨立 client
├── templates/
│   └── steering/                 # AI 人格範本
├── .env.example                  # 環境變數範例
├── install.ps1                   # 一鍵安裝腳本
├── package.json                  # Node.js 依賴
├── SETUP.md                      # 詳細設定指南
└── README.md                     # 本文件
```

## 🏗️ 分層架構

```
🌐 通用層（任何 AI 工具都能用）：
├── Gateway Server (server.js)
├── REST API (/api/reply, /api/health)
├── WhatsApp/Telegram adapters
├── MCP Server（標準協議）
└── Handler 抽象層 (base-handler.js)

🔷 Kiro 專屬層（未來可替換）：
├── .kiro/steering/ (人格檔案)
├── .kiro/settings/mcp.json
├── kiro-handler.js
├── vscode-rest-control extension
└── .vscode/tasks.json (自動啟動)
```

未來支援 Cursor/Windsurf 只需新增對應的 handler！

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

所有設定都透過環境變數配置，編輯 `.env` 檔案：

```bash
# 🌐 通用設定
AI_PREFIX=*[叫小賀]* 🤪      # AI 回覆前綴
GATEWAY_PORT=3000            # Gateway port
MESSAGE_MAX_LENGTH=1500      # 訊息分段長度
HEARTBEAT_PATH=./HEARTBEAT.md

# 🔷 IDE 專屬設定
IDE_TYPE=kiro                # IDE 類型 (kiro/cursor/windsurf)
IDE_REST_PORT=55139          # REST Control port
STEERING_PATH=./.kiro/steering
```

詳細說明請參考 `.env.example`。

## 📜 授權

MIT License

## 👥 作者

- **叫小賀** (Jiao Xiao He) 🤪 - AI 助手
- **NorlWu** - 人類夥伴

---
*Built with ❤️ in Taiwan, 2026-02-04*
