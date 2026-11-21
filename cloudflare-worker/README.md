# ⚡ Cloudflare Worker 微軟神經網路 TTS 部署教學 (只需 1 分鐘)

這是一個免費的代理腳本，能將微軟 Edge 的高品質神經網路語音（德語 Katja、繁中曉臻、日語七海）轉為標準 HTTP API，供你的 Anki Web App 使用。

Cloudflare 提供 **每天 100,000 次免費請求**，個人背單字完全免費且綽綽有餘！

---

## 🚀 部署步驟（免安裝任何軟體，瀏覽器操作即可）

### 步驟 1：登入 Cloudflare
1. 前往 [Cloudflare 官網 (dash.cloudflare.com)](https://dash.cloudflare.com/) 登入或免費註冊帳號。

### 步驟 2：建立 Worker
1. 在左側選單點擊 **Workers & Pages（Workers 和 Pages）**。
2. 點擊 **Create application（建立應用程式）** ➡️ 點擊 **Create Worker（建立 Worker）**。
3. 給你的 Worker 取個名稱（例如：`my-anki-tts`），點擊右下角的 **Deploy（部署）**。

### 步驟 3：貼上程式碼
1. 部署完成後，點擊頁面上的 **Edit code（編輯代碼）** 按鈕。
2. 將左側編輯器中的預設程式碼全部清空。
3. 將本專案中的 `cloudflare-worker/worker.js` 內容**全部複製，貼上至編輯器中**。
4. 點擊右上角橘色的 **Save and deploy（儲存並部署）**。

### 步驟 4：取得你的專屬網址
1. 回到 Worker 總覽頁面，複製你的 Worker 專屬網址，格式類似：
   ```
   https://my-anki-tts.<你的使用者名稱>.workers.dev
   ```

### 步驟 5：貼入 Anki 設定頁
1. 打開你的 Anki Web App，進入 **「設定」** 頁籤。
2. 找到 **「高品質神經網路語音 (Edge TTS)」** 區塊。
3. 將 Worker 網址貼入輸入框，點擊「測試發音」。
4. 聽到廣播級的自然發音，代表設定成功！

---

## 💡 特性亮點
* **離線快取（IndexedDB）**：只要卡片播放過一次，音訊就會自動儲存在手機本地資料庫中，下次複習完全不需要消耗任何網路流量，離線也能播放！
* **斷網自動備援**：如果出門在地下道完全沒網路，系統會自動切換為手機原生的發音引擎，保證學習流程不中斷。
