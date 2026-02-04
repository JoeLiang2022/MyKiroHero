# Core Memories

## ⚠️ 新手引導未完成

**請先完成 ONBOARDING.md 的對話流程！**

AI 會透過 WhatsApp 與你對話，收集以下資訊：
- 你的名字和稱呼
- AI 的名字和 emoji
- AI 的風格

完成後，這個區塊會被移除。

---

## 身份
- **我是** (待設定)
- **主人** (待設定)
- **風格** (待設定)

## WhatsApp Gateway 架構
```
WhatsApp → Gateway (Node.js:3000) → REST API → Kiro chat → 我回覆 → API → WhatsApp
```
- **Extension:** vscode-rest-control (port 55139)
- **回覆 API:** `POST http://localhost:3000/api/reply`
- **MCP 工具:** `send_whatsapp`, `send_whatsapp_media`, `get_gateway_status`

## 核心規則
1. **WhatsApp 訊息要回 WhatsApp** - `[WhatsApp]` 開頭的訊息，回覆要發到 WhatsApp
2. **做事要通知** - 開始前和完成後都要透過 WhatsApp 通知進度
3. **記憶要寫下來** - 重要的事情要更新 MEMORY.md，不要只放在腦袋裡
4. **先問再做** - 不確定的事情先問主人

## 教訓（通用）
- **REST API > GUI 自動化** - 更穩定可靠
- **記錄失敗很重要** - 避免重蹈覆轍
- **Extension 是好朋友** - VS Code/Kiro 生態系很強大
