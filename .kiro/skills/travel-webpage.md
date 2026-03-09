# Skill: 旅遊行程網頁製作 & 部署

## 概述
製作精美的旅遊行程網頁（單一 HTML 檔），部署到 GitHub Pages 免費託管。

## 設計規範

### HTML 結構
- 單一 HTML 檔案，所有 CSS/JS 內嵌（不依賴外部框架）
- 深色主題（背景 `#0f0f1a`，文字 `#e0e0e0`）
- 每天一個可收合的 section（點擊日期標題展開/收合）
- 每天用不同漸層色區分（藍/綠/紫/橙/紅）
- Mobile-first 響應式設計

### 內容結構（每天）
```
Day Header（可收合）
├── 時間點 + 景點/活動名稱
├── 詳細描述區塊（.ds class）
│   ├── 歷史背景 / 特色介紹
│   ├── 必看重點（用 emoji + span.hi 標記）
│   ├── 必吃推薦（用 span.mi 標記，含價格 span.pr）
│   └── 實用小提醒
├── 圖片區塊（.sw > img.si）
│   └── 圖片說明（.cap）
├── 交通資訊（.tr class）
│   └── 圖示 + 路線 + 時間 + 費用
└── 小提醒（.tip class）
```

### CSS Class 速查
| Class | 用途 |
|-------|------|
| `.day .d1~.d5` | 每天的容器 + 色彩 |
| `.dh` | Day header（可點擊收合） |
| `.dc` | Day content（收合目標） |
| `.i` | 單一行程項目 |
| `.t` | 時間標籤 |
| `.p` | 地點/活動名稱 |
| `.d` | 簡短說明 |
| `.ds` | 詳細描述區塊 |
| `.hi` | 景點亮點（藍色） |
| `.mi` | 美食推薦（橙色） |
| `.pr` | 價格（金色） |
| `.tr` | 交通資訊列 |
| `.tip` | 提醒/注意事項 |
| `.si` | 景點圖片（寬 100%，高 180px，cover） |
| `.sw` | 圖片包裝器（含 caption） |
| `.cap` | 圖片說明文字 |

### 圖片規則 ⚠️ 重要
1. **只用 Wikimedia Commons** 的 CC 授權圖片
2. **用完整 URL**，不要用 `/thumb/` 路徑（容易壞）
   - ✅ `https://upload.wikimedia.org/wikipedia/commons/6/61/Motsunabe.jpg`
   - ❌ `https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Motsunabe.jpg/800px-Motsunabe.jpg`
3. 圖片用 `<a>` 包裹連結到 Wikimedia 原始頁面
4. 加上 `loading="lazy"` 延遲載入
5. 每張圖都要有 `alt` 文字和 `.cap` 說明（含授權標示）

### 額外區塊
- **預算概估**（`.budget`）— 交通費用表格
- **住宿建議**（`.hotel`）— 推薦飯店列表
- **Footer** — 製作者署名 + 圖片來源聲明

## 部署到 GitHub Pages

### 前置條件
- GitHub 帳號 + Fine-grained Personal Access Token（需 Contents 和 Pages 權限）
- Token 存在環境變數 `GH_TOKEN`

### 部署腳本：`scripts/deploy-api.js`
使用 GitHub Contents API 部署，流程：
1. 讀取 `public/` 下的 HTML 檔案
2. Base64 編碼
3. GET 現有檔案取得 sha（更新用）
4. PUT 上傳到 repo 的 `index.html`
5. 輸出 GitHub Pages URL

### 部署指令
```powershell
$env:GH_TOKEN="<token>"; node scripts/deploy-api.js
```

### 部署注意事項 ⚠️
1. **更新檔案必須帶 sha** — 先 GET 取得現有 sha，PUT 時帶上
2. **用新 terminal 執行** — `controlPwshProcess` reuse terminal 會顯示舊 output，導致誤判部署成功
3. **部署後驗證** — 用新 terminal 檢查 GitHub API 回傳的 file size 是否與本地一致
4. **GitHub Pages 快取** — 部署後 1-2 分鐘才生效，告知使用者用無痕模式或強制重新整理
5. **中文內容** — 不要用 PowerShell 寫檔（會加 BOM），用 Node.js 的 `fs.writeFileSync`

## 製作流程 Checklist

1. [ ] 確認旅遊資訊（日期、人數、航班、目的地）
2. [ ] 規劃每日行程（景點、餐廳、交通）
3. [ ] 用 web search 查詢每個景點的詳細資訊和價格
4. [ ] 在 Wikimedia Commons 找每個景點的 CC 授權圖片
5. [ ] 驗證每張圖片 URL 可正常載入
6. [ ] 撰寫 HTML（用上述 CSS class 結構）
7. [ ] 本地檢查 HTML 無語法錯誤
8. [ ] 部署到 GitHub Pages
9. [ ] 用新 terminal 驗證部署成功（file size 一致）
10. [ ] 發送連結給使用者

## 已知坑
- Wikimedia `/thumb/` URL 對直式照片可能失效 → 用完整原圖 URL
- `fsAppend` 每次限 50 行，大 HTML 要分多次 append
- GitHub Contents API 更新檔案不帶 sha 會 409 Conflict
- controlPwshProcess reuse terminal 顯示舊 output → 一定要開新 terminal 驗證
