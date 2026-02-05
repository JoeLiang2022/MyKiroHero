# MyKiroHero 🤖

[![Version](https://img.shields.io/github/v/tag/NorlWu-TW/MyKiroHero?label=version)](https://github.com/NorlWu-TW/MyKiroHero/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 🌐 [English](README.md) | [繁體中文](README-zh.md)

**讓 Kiro AI 成為你的 WhatsApp 助手**

透過 WhatsApp 與 Kiro IDE 的 AI 對話，完全自動化、不需要額外 AI API key。

## ✨ 功能

- 📱 **WhatsApp 整合** - 收發 WhatsApp 訊息
- 🖼️ **媒體傳送** - 支援圖片、影片、文件傳送
- 🤖 **Kiro AI 回覆** - 使用 Kiro 內建的 AI 處理對話
- 🔄 **完全自動化** - 訊息自動轉發，不需人工介入
- 💓 **Heartbeat 排程** - 定時任務自動執行（記憶同步、提醒等）
- 🎭 **自訂 AI 人格** - 透過對話設定 AI 的名字、風格、個性
- 💪 **RDP 友善** - 斷線後仍可運作，不需要 GUI 權限
- 🌐 **多語系** - 支援繁體中文與英文

## 🚀 快速開始

### 1. 安裝

```bash
git clone https://github.com/NorlWu-TW/MyKiroHero.git
cd MyKiroHero
node install.js
```

安裝程式會詢問你選擇語言。

### 2. 啟動 Gateway

```bash
node src/gateway/index.js
```

### 3. 掃描 QR Code

首次啟動會顯示 WhatsApp QR code，用手機掃描登入。

### 4. 開始對話！

AI 會主動透過 WhatsApp 跟你打招呼，引導你完成設定：
- 你的名字和稱呼
- AI 的名字和 emoji
- AI 的風格（專業/活潑/簡潔/搞笑）

**不需要手動編輯任何檔案，跟 AI 聊天就能完成設定！**

## 🏗️ 架構

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

```bash
git clone https://github.com/NorlWu-TW/MyKiroHero.git
cd MyKiroHero
```

### 2. 安裝 vscode-rest-control extension

```bash
kiro --install-extension vscode-rest-control-0.0.18.vsix
```

### 3. 安裝 Node.js 依賴

```bash
npm install
```

### 4. 複製環境設定

```bash
cp .env.example .env
```

</details>

## 💓 Heartbeat 排程

在 `.kiro/steering/HEARTBEAT.md` 設定定時任務：

```markdown
## 排程 (schedules)
09:00 早安提醒
04:00 記憶同步
```

Gateway 會自動讀取並在指定時間觸發任務。

## 🔧 MCP Tools

MCP server 提供以下工具給 Kiro：

| 工具 | 說明 |
|------|------|
| `send_whatsapp` | 發送 WhatsApp 文字訊息 |
| `send_whatsapp_media` | 發送媒體檔案（圖片、影片等） |
| `get_gateway_status` | 檢查 Gateway 狀態 |
| `list_skills` | 列出可用的 Agent Skills |
| `load_skill` | 載入指定 skill 的內容 |
| `get_weather` | 查詢天氣（透過 wttr.in） |
| `restart_gateway` | 重啟 Gateway（需要 PM2） |

### 天氣查詢範例

```
get_weather({ location: "Taipei" })
get_weather({ location: "三重" })
get_weather({ location: "Tokyo" })
```

## 📡 API

| 端點 | 方法 | 說明 |
|------|------|------|
| `/api/reply` | POST | 發送文字訊息 |
| `/api/reply/media` | POST | 發送媒體檔案 |
| `/api/health` | GET | 健康檢查 |

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
│   ├── steering-en/       # 英文範本
│   └── steering-zh/       # 繁中範本
├── .env.example           # 環境變數範例
├── install.js             # 跨平台安裝腳本
└── README.md              # 英文說明
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
