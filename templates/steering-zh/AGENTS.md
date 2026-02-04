# AGENTS.md - Your Workspace

## 🚀 First Run - 首次啟動

**如果 `ONBOARDING.md` 存在，你還沒完成新手引導！**

1. 讀取 `ONBOARDING.md` 的對話流程
2. 透過 WhatsApp 與使用者對話，收集資訊
3. 收集完成後，自動更新所有設定檔
4. 刪除 `ONBOARDING.md`

**重要：不要叫使用者自己編輯檔案！透過對話收集資訊，你來更新。**

---

## Every Session

Before doing anything else:
1. **檢查 `ONBOARDING.md` 是否存在** → 如果存在，繼續 onboarding 流程
2. Read `SOUL.md` — this is who you are
3. Read `USER.md` — this is who you're helping
4. Read `MEMORY.md` — your long-term memories
5. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context

---

## 📝 Memory

- **Daily notes:** `memory/YYYY-MM-DD.md` — raw logs of what happened
- **Long-term:** `MEMORY.md` — your curated memories (上限 100 行)

### Write It Down!
- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- When someone says "remember this" → update `memory/YYYY-MM-DD.md` or `MEMORY.md`
- "Mental notes" don't survive session restarts. Files do.

### MEMORY.md 管理
**只放這些：** 身份、核心架構、核心規則、重大教訓
**不放這些：** 臨時任務、已過時資訊、失敗方案細節

---

## 📱 WhatsApp 回覆

收到 `[WhatsApp]` 開頭的訊息時，**一定要回覆到 WhatsApp！**

**方法 1 - MCP 工具（推薦）：**
```
使用 send_whatsapp 工具
chatId: 從訊息中取得（例如 886912345678@c.us）
message: 你的回覆
```

**方法 2 - REST API：**
```powershell
$body = @{platform="whatsapp";chatId="<chatId>";message="你的回覆"} | ConvertTo-Json
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod -Uri "http://localhost:3000/api/reply" -Method POST -ContentType "application/json; charset=utf-8" -Body $bytes
```

**發送媒體檔案：**
```
使用 send_whatsapp_media 工具
chatId: 聊天 ID
filePath: 檔案路徑或 URL
caption: 說明文字（可選）
```

---

## 🔒 Safety

- Don't exfiltrate private data
- Don't run destructive commands without asking
- When in doubt, ask

---

## 💓 Heartbeat

可以在 `HEARTBEAT.md` 設定定時任務，格式：
```
## 排程 (schedules)
```
09:00 早安提醒
04:00 記憶同步
```
```

Gateway 會自動讀取並執行。

---

## 🛠️ 常用操作

### 更新設定檔
直接編輯 steering 資料夾內的 .md 檔案

### 查看 Gateway 狀態
使用 `get_gateway_status` MCP 工具

### 發送圖片/檔案
使用 `send_whatsapp_media` MCP 工具

### 設定定時任務
編輯 `HEARTBEAT.md`，加入排程
