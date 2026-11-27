# 📱 Anki Replica - 輕量化行動版間隔重複記憶閃卡

這是一個專為行動裝置量身打造、符合 **Apple Native (iOS HIG)** 質感設計的 Local-First 間隔重複記憶（Anki）應用程式。專案宗旨為 **「零伺服器成本、可完全離線運行、極致手勢操作、個人隱私雲端同步、絕對不遺失單字」**。

---

## 🌟 核心特色

### 1. ☁️ Google 雲端硬碟個人專屬雙向同步（絕不遺失單字）
* **個人隱私沙盒（Google Drive AppData）**：
  * 採用 Google 官方最新 **Google Identity Services (GIS)** OAuth 2.0 授權。
  * 備份存放於使用者專屬的 `drive.appdata` 資料夾，**完全不碰觸使用者雲端硬碟中的其他個人檔案**。
  * 0 伺服器後端架構，無個資外洩風險，使用者對自身資料擁有 100% 絕對所有權。
* **雙向增量智慧合併（CRDT / Last-Write-Wins with Tombstones）**：
  * **無損平滑遷移**：自動為所有卡片與牌組指派全域唯一 UUID 與修改時間戳記，原有進度與單字 100% 完整保留。
  * **雙向智慧融合**：在多台裝置（手機、平板、電腦）同步時，雲端有本機沒有會自動補齊、本機有雲端沒有會自動補上，兩端皆有則以最新複習或編輯進度（`updatedAt`）為準。
  * **防復活墓碑機制（Tombstone）**：只有使用者主動點擊刪除才會蓋上刪除標記，避免已刪除卡片被舊記錄復活，未刪除單字絕不無故丟失。
* **一鍵同步與自動同步**：
  * 登入 Google 帳號立即對齊雲端進度。
  * 具備「立即同步」按鈕，並支援新增或複習單字後的背景「自動同步」。

---

### 2. 📱 行動原生級視覺與手勢體驗（iOS HIG）
* **免安裝原生 App，加入主畫面即用（PWA）**：
  * 告別官方 iOS App 繁複介面與 25 美金售價門檻，支援 Safari「加入主畫面」或 Android「新增至應用程式」，全螢幕獨立運行。
* **3D 卡片翻轉與防誤觸機制**：
  * 輕觸卡片順暢進行 3D 翻面查看答案與解析；點擊卡片內部的按鈕（如發音、編輯）時具備防誤翻機制。
* **Tinder 式滑動手勢（物理回彈）**：
  * 支援平滑拖曳手勢：正面卡片左滑標記「重來」、右滑標記「良好」（背面保持簡潔無指示標籤，純粹專注背誦）。
* **底部拇指熱區按鈕**：
  * 底部 54px 大尺寸圓角按鈕（重來、困難、良好、簡單），單手握持即刻輕鬆評分。
* **觸覺震動回饋（Haptic Feedback）**：
  * 輕觸翻面、按鈕點擊與滑動完成皆帶有細緻微震動。
* **純黑深色模式（OLED Dark Mode）**：
  * 支援隨系統自動切換、淺色模式（Light）與深色純黑模式（Dark）。

---

### 3. 🧠 記憶排程核心（SM-2 演算法 + 180 天天花板）
* 採用標準 **SuperMemo 2 (SM-2)** 間隔重複演算法（難易係數 `easeFactor`、間隔天數 `interval`、連續成功次數 `repetitions`）。
* **180 天（半年）最大複習間隔限制**：
  * 修正傳統演算法間隔無上限指數膨脹問題，設定最大間隔天花板為 180 天，確保即便精通的單字也能在半年內定期喚醒，符合人類長期外語記憶工學。

---

### 4. 🎙️ 廣播級神經網路語音（Edge TTS + Cloudflare Worker）
* **高品質母語發音**：
  * 德語：`de-DE-KatjaNeural`（純正母語發音、咬字清晰）
  * 繁體中文：`zh-TW-HsiaoChenNeural`（台灣標準曉臻國語）
  * 日語：`ja-JP-NanamiNeural`（七海音色，高低音音調 Pitch Accent 優異）
  * 英語：標準美語神經網路發音
* **牌組語言設定與智慧推斷**：
  * 支援設定牌組偏好語言（自動推斷 `auto`、德語 `de-DE`、日語 `ja-JP`、英語 `en-US`）。
  * 正面與背面卡片語音獨立評估朗讀內容。
* **德語性別色彩標記與日語假名標籤**：
  * 德語三大冠詞自動上色：`der` (陽性藍)、`die` (陰性紅)、`das` (中性綠)。
  * `[中括號內容]` 自動轉為精美標籤樣式，完美適配日語讀音假名或德語複數變化。
* **IndexedDB 離線語音快取**：
  * 只要播放過一次的單字語音，自動儲存在本機 IndexedDB 快取中，下次複習 0 流量秒播。
  * 斷網或未設定 Worker 時自動降級切換至瀏覽器原生 Web Speech API，保證學習不中斷。

---

### 5. 💾 零依賴、純前端、本地優先（Local-First）
* **雙層資料保障**：除了 Google 雲端 AppData 同步外，同時支援一鍵匯出/匯入標準 `.json` 離線備份檔案。
* **零建置步驟（Zero-Build）**：純原生 ES6 Modules + CSS3 + HTML5，無須安裝 Node.js，無須任何打包編譯工具，開箱即用。

---

## 📁 專案檔案結構

```
anki replica/
├── index.html                  # 應用程式主介面 (包含牌組、複習、新增、設定四大視圖)
├── manifest.json               # PWA 設定 (桌面捷徑、全螢幕顯示設定)
├── sw.js                       # Service Worker (全站靜態資源與離線快取控制)
├── css/
│   └── app.css                 # Apple Native iOS HIG 樣式 (毛玻璃、深淺色、3D 翻轉)
├── js/
│   ├── app.js                  # 核心控制器 (視圖路由、事件監聽、自動同步排程)
│   ├── db.js                   # 原生 IndexedDB 封裝 (UUID 遷移、CRUD、雙向增量合併)
│   ├── gdrive.js               # Google Drive AppData 隱私雙向同步模組 (GIS 授權)
│   ├── srs.js                  # SM-2 間隔重複排程演算法 (含 180 天天花板設定)
│   ├── gestures.js             # 觸控手勢判定與拖曳物理位移計算 (左滑重來、右滑良好)
│   └── tts.js                  # 語音發音排程、語言推斷與觸覺震動 (Haptics)
├── cloudflare-worker/
│   ├── worker.js               # 免費 Cloudflare Worker 代理腳本 (Edge TTS 轉 HTTP API)
│   └── README.md               # 1 分鐘免費部署微軟語音 Worker 教學
└── icons/                      # PWA 高解析度向量圖示 (SVG)
```

---

## 🚀 本地開發與預覽

本專案為純靜態現代 Web 專案，無需安裝任何套件，使用 Python 內建 HTTP 伺服器即可啟動：

```bash
# 在專案根目錄下執行
python -m http.server 8000
```

接著在瀏覽器打開：`http://localhost:8000` 即可進行測試與預覽。

---

## ☁️ Google 雲端硬碟同步設定（若自行 Fork）

若你自己 Fork 此專案並部署至自己的網域，需在 Google Cloud Console 設定自己的 Client ID：

1. 前往 [Google Cloud Console](https://console.cloud.google.com/) 建立專案。
2. 啟用 **Google Drive API**。
3. 在 **OAuth 同意畫面** 設定應用程式名稱，並在範圍中加入 `https://www.googleapis.com/auth/drive.appdata`。
4. 建立憑證 ➔ **OAuth 2.0 用戶端 ID** ➔ 選擇「網頁應用程式」。
5. 在「已授權的 JavaScript 來源」填入你的 GitHub Pages 網址（例如：`https://<你的帳號>.github.io`）。
6. 將產生的 Client ID 替換至 `js/gdrive.js` 中的 `GOOGLE_CLIENT_ID` 常數。

---

## ⚡ Cloudflare Worker 高品質語音（可選）

若欲啟用廣播級微軟 Edge Neural 語音：
1. 參考 [cloudflare-worker/README.md](file:///d:/danny/mobile_app_project/anki%20replica/cloudflare-worker/README.md) 的 1 分鐘免費部署指引。
2. 在 Cloudflare 免費建立 Worker 並貼入 `worker.js`。
3. 將產生的 Worker 網址填入 App「設定」頁面中的「Cloudflare Worker 代理網址」即可。
*(若不設定，系統亦會自動使用裝置原生語音正常發音)*

---

## 🌐 部署至 GitHub Pages

1. **推動程式碼至 GitHub 儲存庫**：
   ```bash
   git add .
   git commit -m "feat: complete anki replica"
   git push origin main
   ```
2. **啟用 GitHub Pages**：
   * 進入該 Repository 的 **Settings** -> **Pages**。
   * 在 **Build and deployment** 下方的 **Source** 選擇 `Deploy from a branch`。
   * Branch 選擇 `main` / `/(root)`，點擊 **Save**。
   * 約 1 分鐘後即可透過 `https://<你的帳號>.github.io/<儲存庫名稱>/` 開啟，並點擊手機瀏覽器的「分享」➔「加入主畫面」使用！
