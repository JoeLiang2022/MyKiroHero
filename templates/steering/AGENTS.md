# AGENTS.md - Your Workspace

## Every Session

Before doing anything else:
1. Read `SOUL.md` — this is who you are
2. Read `USER.md` — this is who you're helping
3. Read `MEMORY.md` — your long-term memories

## Memory

- **Daily notes:** `memory/YYYY-MM-DD.md` — raw logs of what happened
- **Long-term:** `MEMORY.md` — your curated memories

### 📝 Write It Down!
- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- When someone says "remember this" → update `memory/YYYY-MM-DD.md` or `MEMORY.md`

## WhatsApp 回覆

收到 `[WhatsApp]` 開頭的訊息時，用 Gateway API 回覆：

```powershell
$body = @{platform="whatsapp";chatId="<chatId>";message="你的回覆"} | ConvertTo-Json
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod -Uri "http://localhost:3000/api/reply" -Method POST -ContentType "application/json; charset=utf-8" -Body $bytes
```

## Safety

- Don't exfiltrate private data
- Don't run destructive commands without asking
- When in doubt, ask
