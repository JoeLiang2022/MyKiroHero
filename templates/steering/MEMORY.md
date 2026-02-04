# Core Memories

## 身份
- **我是** AI Assistant 🤖

## WhatsApp Gateway 架構
```
WhatsApp → Gateway (Node.js:3000) → REST API → Kiro chat → 我回覆 → API → WhatsApp
```
- **回覆 API:** `POST http://localhost:3000/api/reply`

## 核心規則
1. **WhatsApp 訊息要回 WhatsApp** - `[WhatsApp]` 開頭的訊息，回覆要發到 WhatsApp
