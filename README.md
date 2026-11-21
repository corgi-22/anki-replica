# 📱 Anki Mobile Web - 輕量化行動版間隔重複閃卡

這是一個專為手機體驗量身打造、符合 **Apple Native (iOS HIG)** 質感設計的 Web-Anki 副本。專案設計宗旨為 **「零伺服器成本、可離線運行、極致手機手勢操作、本地安全儲存」**。

---

## 🌟 核心特點

1. **無需安裝 App，加到手機桌面即用（PWA）**：
   - 解決官方 Anki iOS App 售價高昂（25 美金）與介面複雜繁瑣的痛點。
   - 支援加入 iPhone「主畫面」或 Android「應用程式」，啟動時全螢幕無瀏覽器網址列干擾。
2. **符合 Apple Native 視覺與操作（iOS HIG）**：
   - 沉浸式毛玻璃導航列與分組設定（Inset Grouped Lists）。
   - 支援 **深淺色模式自動切換**（含 OLED 真正純黑 Dark Mode）。
   - **3D 卡片翻轉**：輕觸卡片順暢 3D 翻轉查看解答。
   - **Tinder 式滑動手勢**：左滑標記「重來」、右滑標記「良好」。
   - **拇指熱區按鈕**：底部 54px 高度的大按鈕（重來、困難、良好、簡單），單手好握好按。
   - **觸覺震動回饋**：點擊與滑動觸發微震動（Haptic Feedback）。
   - **內建真人發音（TTS）**：日語、英語自動識別朗讀，背單字免下載音檔。
3. **解決 GitHub Pages 資料儲存問題**：
   - **本機持久化**：採用瀏覽器原生 `IndexedDB`，支援離線儲存數萬張卡片。
   - **一鍵 JSON 匯出與還原**：一鍵將牌組與學習進度打包下載為 `.json` 備份，換手機或跨瀏覽器一秒無損還原。
4. **零依賴、零建置步驟（Zero-Build）**：
   - 純標準現代 Web 技術（Vanilla ES6 Modules + CSS3 + HTML5）。
   - 不需安裝 Node.js，不需 npm build，推上 GitHub Pages 立即上線。

---

## 🔍 GitHub 現成開源借鑒（避免重造輪子）

在架構設計上，本專案借鑒了 GitHub 上的成熟開源社群實踐：

* **間隔重複排程核心（SRS）**：
  * 參考 [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 與 [thangngoc89/supermemo](https://github.com/thangngoc89/supermemo)。
  * 提取並簡化標準 **SM-2 演算法**，保留遺忘曲線核心參數（`interval`、`repetitions`、`easeFactor`），去除讓新手困惑的艱澀參數。
* **PWA 與離線架構**：
  * 參考 [h16nning/skola](https://github.com/h16nning/skola) 的 Local-First 離線架構理念，完全由客戶端 IndexedDB 承載。
* **觸控手勢與物理位移**：
  * 實作平滑位移角度計算與滑動回彈（Elastic Drag Physics），確保觸控滑動不與頁面滾動衝突。

---

## 📁 專案檔案結構

```
anki replica/
├── index.html              # 主頁面 (包含四大視圖：牌組、複習、新增、設定)
├── manifest.json           # PWA 設定 (桌面捷徑、全螢幕設定)
├── sw.js                   # Service Worker (全站靜態資源離線快取)
├── css/
│   └── app.css             # Apple Native iOS HIG 樣式 (毛玻璃、深淺色、3D 翻轉)
├── js/
│   ├── app.js              # 應用程式主控制器、視圖路由與渲染
│   ├── db.js               # 原生 IndexedDB 封裝 (CRUD、種子資料、JSON 匯入匯出)
│   ├── srs.js              # SM-2 間隔重複演算法 (算複習天數與難度係數)
│   ├── gestures.js         # 手勢滑動與拖曳物理判定 (左滑重來、右滑良好)
│   └── tts.js              # Web Speech API 語音發音與觸覺震動 (Haptics)
└── icons/                  # PWA 應用圖示 (SVG)
```

---

## 🚀 本地預覽測試

本專案無需安裝任何 Node.js 套件，直接使用 Python 內建 HTTP 伺服器即可啟動：

```bash
# 在此目錄下執行
python -m http.server 8000
```

接著在瀏覽器打開：`http://localhost:8000` 即可預覽。

---

## 🌐 部署至 GitHub Pages（超簡單 2 步驟）

1. **建立 GitHub Repository**：
   ```bash
   git init
   git add .
   git commit -m "feat: initial anki mobile replica"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/<你的倉庫名稱>.git
   git push -u origin main
   ```
2. **開啟 GitHub Pages**：
   * 進入該 GitHub 倉庫的 **Settings** -> **Pages**。
   * 在 **Build and deployment** 下方的 **Source** 選擇 `Deploy from a branch`。
   * Branch 選擇 `main` / `/(root)`，點擊 **Save**。
   * 約 1 分鐘後，即可透過 `https://<你的帳號>.github.io/<你的倉庫名稱>/` 打開並加入手機主畫面！
