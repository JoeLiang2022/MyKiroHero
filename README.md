# MyKiroHero 🤖

> 🌐 [English](README.md) | [繁體中文](README-zh.md)

**Turn Kiro AI into your WhatsApp assistant**

Chat with Kiro IDE's AI through WhatsApp - fully automated, no extra AI API key needed.

## ✨ Features

- 📱 **WhatsApp Integration** - Send & receive WhatsApp messages
- 🖼️ **Media Support** - Images, videos, documents
- 🤖 **Kiro AI Replies** - Uses Kiro's built-in AI
- 🔄 **Fully Automated** - Auto-forward messages, no manual intervention
- 💓 **Heartbeat Schedules** - Automated tasks (memory sync, reminders)
- 🎭 **Custom AI Personality** - Set AI name, style, personality through chat
- 💪 **RDP Friendly** - Works after disconnect, no GUI needed
- 🌐 **Multi-language** - English & Traditional Chinese support

## 🚀 Quick Start

### 1. Install

```bash
git clone https://github.com/NorlWu-TW/MyKiroHero.git
cd MyKiroHero
node install.js
```

The installer will ask you to choose a language.

### 2. Start Gateway

```bash
node src/gateway/index.js
```

### 3. Scan QR Code

First launch shows WhatsApp QR code - scan with your phone.

### 4. Start Chatting!

The AI will greet you via WhatsApp and guide you through setup:
- Your name and nickname
- AI's name and emoji
- AI's style (professional/chatty/concise/funny)

**No manual file editing needed - just chat with the AI!**

## 🏗️ Architecture

```
WhatsApp Message
    ↓
Gateway (Node.js, port 3000)
    ↓
REST API (vscode-rest-control extension, port 55139)
    ↓
Kiro IDE Chat
    ↓
AI Reply
    ↓
Gateway API → WhatsApp
```

## 📦 Manual Installation

<details>
<summary>Click to expand</summary>

### 1. Clone the project

```bash
git clone https://github.com/NorlWu-TW/MyKiroHero.git
cd MyKiroHero
```

### 2. Install vscode-rest-control extension

```bash
kiro --install-extension vscode-rest-control-0.0.18.vsix
```

### 3. Install Node.js dependencies

```bash
npm install
```

### 4. Copy environment config

```bash
cp .env.example .env
```

</details>

## 💓 Heartbeat Schedules

Set scheduled tasks in `.kiro/steering/HEARTBEAT.md`:

```markdown
## Schedules
09:00 Morning greeting
04:00 Memory sync
```

Gateway auto-reads and triggers tasks at specified times.

## 📡 API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reply` | POST | Send text message |
| `/api/reply/media` | POST | Send media file |
| `/api/health` | GET | Health check |
| `/api/messages` | GET | Get pending messages |

### Send Message Example

```json
POST http://localhost:3000/api/reply
{
  "chatId": "886912345678@c.us",
  "message": "Hello!"
}
```

## 🏗️ Layered Architecture

```
🌐 Universal Layer (works with any AI tool):
├── Gateway Server
├── REST API
├── WhatsApp/Telegram adapters
├── MCP Server
└── Handler abstraction

🔷 Kiro-specific Layer (replaceable):
├── .kiro/steering/ (personality files)
├── .kiro/settings/mcp.json
├── kiro-handler.js
├── vscode-rest-control extension
└── .vscode/tasks.json
```

Future support for Cursor/Windsurf just needs a new handler!

## 📁 File Structure

```
MyKiroHero/
├── src/
│   ├── gateway/           # Gateway core
│   │   ├── index.js       # Entry point
│   │   ├── server.js      # Gateway server
│   │   ├── config.js      # Configuration
│   │   └── handlers/      # IDE handlers
│   └── mcp-server.js      # MCP Server
├── templates/
│   ├── steering-en/       # English templates
│   └── steering-zh/       # Chinese templates
├── .env.example           # Environment example
├── install.js             # Cross-platform installer
└── README.md              # This file
```

## ⚙️ Environment Variables

Edit `.env` file:

```bash
# AI reply prefix (auto-updated after onboarding)
AI_PREFIX=*[AI Assistant]* 🤖

# Gateway port
GATEWAY_PORT=3000

# IDE REST API port
IDE_REST_PORT=55139
```

## System Requirements

- Windows 10/11, macOS, or Linux
- Node.js 18+
- Git
- Kiro IDE
- vscode-rest-control extension

## 📜 License

MIT License

---

*Built with ❤️ in Taiwan*
