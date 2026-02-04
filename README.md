# MyKiroHero 🤖

**Turn Kiro AI into your WhatsApp assistant / 讓 Kiro AI 成為你的 WhatsApp 助手**

Chat with Kiro IDE's AI through WhatsApp - fully automated, no extra AI API key needed.

透過 WhatsApp 與 Kiro IDE 的 AI 對話，完全自動化、不需要額外 AI API key。

## ✨ Features / 功能

- 📱 **WhatsApp Integration** - Send & receive WhatsApp messages
- 🖼️ **Media Support** - Images, videos, documents
- 🤖 **Kiro AI Replies** - Uses Kiro's built-in AI
- 🔄 **Fully Automated** - Auto-forward messages, no manual intervention
- 💓 **Heartbeat Schedules** - Automated tasks (memory sync, reminders)
- 🎭 **Custom AI Personality** - Set AI name, style, personality through chat
- 💪 **RDP Friendly** - Works after disconnect, no GUI needed
- 🌐 **Multi-language** - English & Traditional Chinese support

## 🚀 Quick Start / 快速開始

### 1. Install / 安裝

**Cross-platform (Recommended) / 跨平台（推薦）：**
```bash
git clone https://github.com/NorlWu-TW/MyKiroHero.git
cd MyKiroHero
node install.js
```

The installer will ask you to choose a language (English or 繁體中文).

安裝程式會詢問你選擇語言（English 或 繁體中文）。

**Windows PowerShell:**
```powershell
irm https://raw.githubusercontent.com/NorlWu-TW/MyKiroHero/main/install.ps1 | iex
```

### 2. Start Gateway / 啟動 Gateway

```bash
node src/gateway/index.js
```

### 3. Scan QR Code / 掃描 QR Code

First launch shows WhatsApp QR code - scan with your phone.

首次啟動會顯示 WhatsApp QR code，用手機掃描登入。

### 4. Start Chatting! / 開始對話！

The AI will greet you via WhatsApp and guide you through setup:
- Your name and nickname
- AI's name and emoji
- AI's style (professional/chatty/concise/funny)

AI 會主動透過 WhatsApp 跟你打招呼，引導你完成設定：
- 你的名字和稱呼
- AI 的名字和 emoji
- AI 的風格（專業/活潑/簡潔/搞笑）

**No manual file editing needed - just chat with the AI!**

**不需要手動編輯任何檔案，跟 AI 聊天就能完成設定！**

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
AI 助手回覆
    ↓
Gateway API → WhatsApp
```

## 📦 手動安裝

<details>
<summary>點擊展開</summary>

### 1. Clone 專案

```powershell
git clone https://github.com/NorlWu-TW/MyKiroHero.git
cd MyKiroHero
```

### 2. 安裝 vscode-rest-control extension

```powershell
kiro --install-extension vscode-rest-control-0.0.18.vsix
```

### 3. 安裝 Node.js 依賴

```powershell
npm install
```

### 4. 複製環境設定

```powershell
copy .env.example .env
```

</details>

## 💓 Heartbeat 排程

在 `.kiro/steering/HEARTBEAT.md` 設定定時任務：

```markdown
## 排程 (schedules)
```
09:00 早安提醒
04:00 記憶同步
```
```

Gateway 會自動讀取並在指定時間觸發任務。

## 📡 API

| 端點 | 方法 | 說明 |
|------|------|------|
| `/api/reply` | POST | 發送文字訊息 |
| `/api/reply/media` | POST | 發送媒體檔案 |
| `/api/health` | GET | 健康檢查 |
| `/api/messages` | GET | 取得待處理訊息 |

### 發送訊息範例

```json
POST http://localhost:3000/api/reply
{
  "chatId": "886912345678@c.us",
  "message": "你好！"
}
```

## 🏗️ 分層架構

```
🌐 通用層（任何 AI 工具都能用）：
├── Gateway Server
├── REST API
├── WhatsApp/Telegram adapters
├── MCP Server
└── Handler 抽象層

🔷 Kiro 專屬層（未來可替換）：
├── .kiro/steering/ (人格檔案)
├── .kiro/settings/mcp.json
├── kiro-handler.js
├── vscode-rest-control extension
└── .vscode/tasks.json
```

未來支援 Cursor/Windsurf 只需新增對應的 handler！

## 📁 檔案結構

```
MyKiroHero/
├── src/
│   ├── gateway/           # Gateway 核心
│   │   ├── index.js       # 主程式入口
│   │   ├── server.js      # Gateway server
│   │   ├── config.js      # 設定檔
│   │   └── handlers/      # IDE handlers
│   └── mcp-server.js      # MCP Server
├── templates/
│   └── steering/          # AI 人格範本
│       ├── ONBOARDING.md  # 新手引導流程
│       ├── SOUL.md        # AI 人格
│       ├── MEMORY.md      # AI 記憶
│       └── ...
├── .env.example           # 環境變數範例
├── install.ps1            # 一鍵安裝腳本
└── README.md              # 本文件
```

## ⚙️ 環境變數

編輯 `.env` 檔案：

```bash
# AI 回覆前綴（onboarding 完成後會自動更新）
AI_PREFIX=*[AI Assistant]* 🤖

# Gateway port
GATEWAY_PORT=3000

# IDE REST API port
IDE_REST_PORT=55139
```

## 系統需求

- Windows 10/11、macOS、或 Linux
- Node.js 18+
- Git
- Kiro IDE
- vscode-rest-control extension

## 📜 授權

MIT License

---

*Built with ❤️ in Taiwan*
