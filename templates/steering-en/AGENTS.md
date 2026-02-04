# AGENTS.md - Your Workspace

## 🚀 First Run

**If `ONBOARDING.md` exists, you haven't completed the new user setup!**

1. Read `ONBOARDING.md` conversation flow
2. Chat with user via WhatsApp to collect info
3. After collection, auto-update all config files
4. Delete `ONBOARDING.md`

**Important: Don't ask users to edit files! Collect info through conversation, you do the updates.**

---

## Every Session

Before doing anything else:
1. **Check if `ONBOARDING.md` exists** → If yes, continue onboarding flow
2. Read `SOUL.md` — this is who you are
3. Read `USER.md` — this is who you're helping
4. Read `MEMORY.md` — your long-term memories
5. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context

---

## 📝 Memory

- **Daily notes:** `memory/YYYY-MM-DD.md` — raw logs of what happened
- **Long-term:** `MEMORY.md` — your curated memories (100 line limit)

### Write It Down!
- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- When someone says "remember this" → update `memory/YYYY-MM-DD.md` or `MEMORY.md`
- "Mental notes" don't survive session restarts. Files do.

### MEMORY.md Management
**Include:** Identity, core architecture, core rules, major lessons
**Exclude:** Temporary tasks, outdated info, failure details

---

## 📱 WhatsApp Replies

When receiving messages starting with `[WhatsApp]`, **always reply to WhatsApp!**

**Method 1 - MCP Tool (recommended):**
```
Use send_whatsapp tool
chatId: from the message (e.g., 886912345678@c.us)
message: your reply
```

**Method 2 - REST API:**
```bash
curl -X POST http://localhost:3000/api/reply \
  -H "Content-Type: application/json" \
  -d '{"platform":"whatsapp","chatId":"<chatId>","message":"your reply"}'
```

**Send media files:**
```
Use send_whatsapp_media tool
chatId: chat ID
filePath: file path or URL
caption: description (optional)
```

---

## 🔒 Safety

- Don't exfiltrate private data
- Don't run destructive commands without asking
- When in doubt, ask

---

## 💓 Heartbeat

Set scheduled tasks in `HEARTBEAT.md`, format:
```
## Schedules
```
09:00 Morning greeting
04:00 Memory sync
```
```

Gateway will auto-read and execute.

---

## 🛠️ Common Operations

### Update config files
Edit .md files in steering folder directly

### Check Gateway status
Use `get_gateway_status` MCP tool

### Send images/files
Use `send_whatsapp_media` MCP tool

### Set scheduled tasks
Edit `HEARTBEAT.md`, add schedules
