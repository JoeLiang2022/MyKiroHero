# MyKiroHero 🤪

**叫小賀的 WhatsApp 自動回覆系統**

讓 Kiro IDE 的 AI 助手「叫小賀」可以透過 WhatsApp 與你對話，完全自動化、不需要額外 AI API key。

## 功能

- 📱 **WhatsApp 整合** - 收發 WhatsApp 訊息
- 🤖 **Kiro AI 回覆** - 使用 Kiro 內建的 AI 處理對話
- 🔄 **完全自動化** - 訊息自動轉發，不需人工介入
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

## 安裝

### 1. 安裝 vscode-rest-control extension

```powershell
kiro --install-extension vscode-rest-control-0.0.18.vsix
```

或從 GitHub 自行編譯：https://github.com/dpar39/vscode-rest-control

### 2. 安裝 Node.js 依賴

```powershell
cd MyKiroHero
npm install
```

### 3. 設定環境變數（可選）

複製 `.env.example` 為 `.env` 並設定：
- `KIRO_REST_PORT` - REST Control extension 的 port（預設自動偵測）
- `TELEGRAM_BOT_TOKEN` - Telegram bot token（可選）

## 啟動

```powershell
cd MyKiroHero
node src/gateway/index.js
```

首次啟動會顯示 WhatsApp QR code，用手機掃描登入。

等待看到 `[WhatsApp] 已連線，開始監聽訊息` 即可。

## 訊息格式

- **WhatsApp 進來:** `[WhatsApp] 使用者名稱: 訊息內容 (chatId: xxx@c.us)`
- **回覆自動加前綴:** `*[叫小賀]* 🤪 回覆內容`

## API

### 發送回覆

```
POST http://localhost:3000/api/reply
Content-Type: application/json

{
  "platform": "whatsapp",
  "chatId": "886953870991@c.us",
  "message": "你的回覆"
}
```

### 健康檢查

```
GET http://localhost:3000/api/health
```

## 檔案結構

```
MyKiroHero/
├── src/
│   ├── gateway/
│   │   ├── index.js              # 主程式入口
│   │   ├── server.js             # Gateway server
│   │   ├── whatsapp-adapter.js   # WhatsApp 連線
│   │   ├── telegram-adapter.js   # Telegram 連線（可選）
│   │   └── handlers/
│   │       └── kiro-cli-handler.js  # REST API handler
│   └── whatsapp/
│       └── client.js             # WhatsApp client
├── .env.example                  # 環境變數範例
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

## 授權

MIT License

## 作者

- **叫小賀** (Jiao Xiao He) 🤪 - AI 助手
- **NorlWu** - 人類夥伴

---
*Built with ❤️ in Taiwan, 2026-02-04*
