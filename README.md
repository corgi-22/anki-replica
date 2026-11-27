# Anki Replica

Anki Replica 是一個基於 Web 技術實現的行動端間隔重複記憶閃卡（PWA），遵循 iOS HIG 設計風格。具備離線運行、手勢操作、Google Drive AppData 雙向增量同步與語音朗讀功能。

---

## 功能特點

### 1. Google 雲端硬碟雙向同步
* **儲存位置**：使用 Google Drive 專屬應用程式資料夾 (`drive.appdata`)，僅存取應用程式本身產生的備份檔案，不存取使用者其他雲端硬碟檔案。
* **授權機制**：使用 Google Identity Services (GIS) Token Client 授權。
* **雙向增量合併（Last-Write-Wins 與 Tombstones）**：
  * **UUID 識別**：所有牌組與卡片皆具備全域唯一識別碼（UUID）與修改時間戳記（`updatedAt`）。
  * **增量合併**：同步時聯集兩端資料，衝突時以修改時間戳記較新者為準。
  * **刪除墓碑（Tombstones）**：記錄手動刪除動作與時間戳記，避免已刪除項目在跨裝置同步時復原。
* **同步操作**：
  * 登入後可點擊「立即同步」進行手動同步。
  * 提供「自動同步」開關，開啟後於新增卡片或複習完成後自動於背景同步。

---

### 2. 介面與操作
* **PWA 支援**：支援離線快取（Service Worker）與「加入主畫面」，可在行動裝置上全螢幕運行。
* **卡片翻轉**：點擊卡片切換正反面，點擊卡片內部按鈕（發音、編輯）時不觸發翻面。
* **滑動手勢**：正面卡片支援左滑標記「重來」、右滑標記「良好」。
* **底部評分按鈕**：提供重來、困難、良好、簡單四個評分按鈕。
* **震動回饋**：支援 Web Vibration API 觸覺回饋。
* **主題模式**：支援跟隨系統、淺色模式（Light）與深色模式（Dark）。

---

### 3. 排程演算法（SRS）
* **SM-2 演算法**：基於 SuperMemo 2 計算間隔天數（`interval`）、重複次數（`repetitions`）與難易係數（`easeFactor`）。
* **最大間隔上限**：單次排程最大間隔天數上限設定為 180 天。

---

### 4. 語音朗讀（TTS）
* **語音引擎**：
  * 微軟 Edge TTS（透過 Cloudflare Worker 代理）。
  * 原生 Web Speech API（離線或未設定 Worker 時自動降級備援）。
* **語言支援**：
  * 支援德語 (`de-DE`)、繁體中文 (`zh-TW`)、日語 (`ja-JP`)、英語 (`en-US`)。
  * 支援牌組指定語言或由系統自動推斷。
  * 正面與背面卡片獨立推斷發音語言。
* **格式解析**：
  * 德語冠詞色彩標記：`der`（藍）、`die`（紅）、`das`（綠）。
  * 中括號格式：`[文字]` 解析為獨立註記標籤（適用日語假名或德語複數形）。
* **本機快取**：已請求過的音訊檔案快取於 IndexedDB，離線時可直接播放。

---

### 5. 本地儲存與備份
* **IndexedDB 本地儲存**：牌組、卡片、設定與音訊快取儲存於瀏覽器原生 IndexedDB。
* **JSON 匯入匯出**：支援將全部牌組與卡片資料匯出為本機 JSON 檔案，或自 JSON 檔案匯入還原。
* **架構**：原生 HTML5、CSS3、ES6 Modules，無建置打包步驟。

---

## 專案結構

```
anki replica/
├── index.html                  # 主頁面結構
├── manifest.json               # PWA 設定檔
├── sw.js                       # Service Worker 快取設定
├── css/
│   └── app.css                 # 樣式定義
├── js/
│   ├── app.js                  # 視圖控制器與事件處理
│   ├── db.js                   # IndexedDB 操作、UUID 處理與增量合併邏輯
│   ├── gdrive.js               # Google Drive AppData 同步模組
│   ├── srs.js                  # SM-2 排程演算法實作
│   ├── gestures.js             # 觸控滑動手勢處理
│   └── tts.js                  # 語音播放與語言推斷邏輯
├── cloudflare-worker/
│   ├── worker.js               # Cloudflare Worker 代理腳本 (Edge TTS 轉 HTTP API)
│   └── README.md               # Worker 部署說明
└── icons/                      # PWA 圖示
```

---

## 本地執行

使用任何靜態 HTTP 伺服器啟動即可：

```bash
python -m http.server 8000
```

在瀏覽器造訪 `http://localhost:8000`。

---

## Google 雲端同步設定（自行部屬時）

若需自行部屬並啟用 Google Drive 同步功能：

1. 前往 [Google Cloud Console](https://console.cloud.google.com/) 建立專案。
2. 啟用 **Google Drive API**。
3. 設定 **OAuth 同意畫面**，授權範圍加入 `https://www.googleapis.com/auth/drive.appdata`。
4. 建立憑證 ➔ **OAuth 2.0 用戶端 ID** ➔ 類型選擇「網頁應用程式」。
5. 在「已授權的 JavaScript 來源」填入部署網址（例如：`https://<使用者名稱>.github.io`）。
6. 將 Client ID 填入 `js/gdrive.js` 中的 `GOOGLE_CLIENT_ID`。

---

## Cloudflare Worker 語音代理設定（可選）

若需使用微軟 Edge TTS 語音：

1. 依照 `cloudflare-worker/README.md` 說明部署 `worker.js` 至 Cloudflare Worker。
2. 在 App 設定頁面的「Cloudflare Worker 代理網址」輸入 Worker 網址。
3. 未設定時系統將自動使用瀏覽器原生 Web Speech API。

---

## GitHub Pages 部署

1. 將專案推至 GitHub 儲存庫：
   ```bash
   git add .
   git commit -m "feat: initial commit"
   git push origin main
   ```
2. 進入 Repository ➔ **Settings** ➔ **Pages**。
3. **Source** 選擇 `Deploy from a branch`，Branch 選擇 `main` / `/(root)` 後點擊 **Save**。
