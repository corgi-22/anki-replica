/**
 * app.js - 主應用程式控制核心
 * 協調整合：IndexedDB 資料庫、SM-2 間隔重複、手勢物理拖曳、語音發音與 iOS 視圖路由
 */

import { db } from './db.js';
import { scheduleCard, isCardDue, Rating } from './srs.js';
import { attachCardGestures } from './gestures.js';
import { speakText, triggerHaptic } from './tts.js';

class AnkiApp {
  constructor() {
    this.currentView = 'decks';
    this.activeDeck = null;
    this.studyQueue = [];
    this.currentCardIndex = 0;
    this.isFlipped = false;
    this.sessionFinished = false;
  }

  async init() {
    await db.init();
    this.bindEvents();
    this.loadTheme();
    this.renderDecksView();
  }

  // --- 視圖路由切換 ---
  switchView(viewName, deck = null) {
    this.currentView = viewName;
    if (deck) this.activeDeck = deck;

    // 更新導航欄狀態
    document.querySelectorAll('.tab-item').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === viewName);
    });

    const contentArea = document.getElementById('app-main');
    contentArea.scrollTop = 0;

    switch (viewName) {
      case 'decks':
        this.renderDecksView();
        break;
      case 'study':
        this.startStudySession(this.activeDeck);
        break;
      case 'add':
        this.renderAddCardView();
        break;
      case 'settings':
        this.renderSettingsView();
        break;
    }
  }

  // --- 1. 牌組總覽視圖 (Decks View) ---
  async renderDecksView() {
    const decks = await db.getAllDecks();
    const allCards = await db.getAllCards();

    // 統計每個牌組待複習張數
    const deckStats = decks.map(deck => {
      const cards = allCards.filter(c => c.deckId === deck.id);
      const dueCards = cards.filter(c => isCardDue(c));
      return { ...deck, total: cards.length, due: dueCards.length };
    });

    const totalDue = deckStats.reduce((sum, d) => sum + d.due, 0);

    const main = document.getElementById('app-main');
    main.innerHTML = `
      <div style="padding-top: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px;">
          <div>
            <div style="font-size: 13px; font-weight: 600; color: var(--accent-blue);">ANKI REPLICA</div>
            <h1 class="ios-large-title">我的牌組</h1>
          </div>
          <button id="btn-create-deck" class="btn-pill" style="padding: 8px 14px; font-size: 13px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            新牌組
          </button>
        </div>

        <div style="background: linear-gradient(135deg, var(--accent-blue), #5856D6); padding: 18px 20px; border-radius: 20px; color: #fff; margin-bottom: 24px; box-shadow: 0 8px 20px rgba(0,122,255,0.25);">
          <div style="font-size: 13px; opacity: 0.85;">今日複習目標</div>
          <div style="font-size: 32px; font-weight: 800; margin: 4px 0;">${totalDue} <span style="font-size: 16px; font-weight: 500;">張卡片待複習</span></div>
          <div style="font-size: 12px; opacity: 0.9;">遵循艾賓浩斯遺忘曲線，每天 10 分鐘形成長期記憶</div>
        </div>

        <div class="ios-group-title">牌組列表 (${deckStats.length})</div>
        <div class="ios-group-card">
          ${deckStats.length === 0 ? `
            <div style="padding: 32px 16px; text-align: center; color: var(--label-secondary);">
              尚無牌組，點擊右上角新增一個吧！
            </div>
          ` : deckStats.map(d => `
            <div class="ios-cell deck-item-row" data-id="${d.id}">
              <div style="display: flex; align-items: center; gap: 14px;">
                <div style="width: 12px; height: 12px; border-radius: 50%; background-color: ${d.color || '#007AFF'}; flex-shrink: 0;"></div>
                <div>
                  <div style="font-weight: 600; font-size: 16px;">${this.escapeHtml(d.title)}</div>
                  <div style="font-size: 12px; color: var(--label-secondary); margin-top: 2px;">
                    共 ${d.total} 張卡片 ${d.description ? `· ${this.escapeHtml(d.description)}` : ''}
                  </div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 10px;">
                ${d.due > 0 ? `
                  <span style="background-color: var(--color-again); color: #fff; font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 10px;">
                    ${d.due}
                  </span>
                ` : `
                  <span style="background-color: var(--card-elevated); color: var(--label-secondary); font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 10px;">
                    已完成
                  </span>
                `}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--label-tertiary)"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // 點擊牌組進入複習
    document.querySelectorAll('.deck-item-row').forEach(row => {
      row.addEventListener('click', () => {
        const deckId = Number(row.dataset.id);
        const deck = decks.find(d => d.id === deckId);
        triggerHaptic(15);
        this.switchView('study', deck);
      });
    });

    // 點擊新增牌組
    document.getElementById('btn-create-deck')?.addEventListener('click', () => {
      this.promptAddDeck();
    });
  }

  async promptAddDeck() {
    const title = prompt('請輸入新牌組名稱 (例如: 多益高頻詞彙 / 日檢N2):');
    if (!title || !title.trim()) return;

    const desc = prompt('請輸入牌組備註/說明 (可略過):') || '';
    await db.addDeck({ title: title.trim(), description: desc.trim(), color: '#007AFF' });
    triggerHaptic(20);
    this.renderDecksView();
  }

  // --- 2. 卡片複習視圖 (Study View) ---
  async startStudySession(deck) {
    if (!deck) {
      this.renderDecksView();
      return;
    }

    const cards = await db.getCardsByDeck(deck.id);
    // 篩選出今天需要複習的卡片，若全部完成，也可以讓使用者自由瀏覽
    const dueCards = cards.filter(c => isCardDue(c));
    this.studyQueue = dueCards.length > 0 ? dueCards : cards;
    this.currentCardIndex = 0;
    this.sessionFinished = this.studyQueue.length === 0;

    this.renderStudyCard();
  }

  renderStudyCard() {
    const main = document.getElementById('app-main');

    if (this.sessionFinished || this.studyQueue.length === 0) {
      main.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 70vh; text-align: center;">
          <div style="width: 80px; height: 80px; border-radius: 50%; background-color: rgba(52, 199, 89, 0.15); display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-good)" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <h2 style="font-size: 24px; font-weight: 700; margin-bottom: 8px;">🎉 太棒了！今日已達標</h2>
          <p style="color: var(--label-secondary); font-size: 15px; max-width: 280px; margin-bottom: 28px;">
            牌組「${this.escapeHtml(this.activeDeck.title)}」今日的所有複習卡片皆已完成！
          </p>
          <button id="btn-back-decks" class="btn-pill" style="min-width: 180px;">
            返回牌組列表
          </button>
        </div>
      `;
      document.getElementById('btn-back-decks')?.addEventListener('click', () => {
        triggerHaptic(15);
        this.switchView('decks');
      });
      return;
    }

    const card = this.studyQueue[this.currentCardIndex];
    const total = this.studyQueue.length;
    const progress = Math.round(((this.currentCardIndex) / total) * 100);

    this.isFlipped = false;

    main.innerHTML = `
      <div>
        <!-- 頂部進度資訊 -->
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--label-secondary); margin-bottom: 6px;">
          <div style="font-weight: 600; color: var(--label-primary);">${this.escapeHtml(this.activeDeck.title)}</div>
          <div>進度: ${this.currentCardIndex + 1} / ${total}</div>
        </div>
        <div class="progress-container">
          <div class="progress-bar-fill" style="width: ${progress}%;"></div>
        </div>

        <!-- 3D 卡片結構 -->
        <div class="card-scene">
          <div class="card-flipper" id="study-flipper">
            <!-- 卡片正面 (題目) -->
            <div class="card-face front">
              <div class="badge-stamp badge-again">重來 AGAIN</div>
              <div class="badge-stamp badge-good">良好 GOOD</div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--accent-blue); letter-spacing: 0.5px;">QUESTION (正面)</span>
                <button id="btn-speak-front" style="background: none; border: none; cursor: pointer; color: var(--accent-blue); padding: 4px;">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                </button>
              </div>

              <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 10px;">
                <div style="font-size: 30px; font-weight: 700; line-height: 1.35; white-space: pre-wrap;">${this.formatRuby(card.front)}</div>
                ${card.hint ? `<div style="margin-top: 14px; font-size: 13px; color: var(--label-secondary);">💡 提示：${this.escapeHtml(card.hint)}</div>` : ''}
              </div>

              <div style="text-align: center; font-size: 12px; color: var(--label-tertiary);">
                👆 輕觸卡片翻面 · 左右滑動快速評分
              </div>
            </div>

            <!-- 卡片背面 (答案與詳解) -->
            <div class="card-face back">
              <div class="badge-stamp badge-again">重來 AGAIN</div>
              <div class="badge-stamp badge-good">良好 GOOD</div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--color-good); letter-spacing: 0.5px;">ANSWER (解答)</span>
                <button id="btn-speak-back" style="background: none; border: none; cursor: pointer; color: var(--accent-blue); padding: 4px;">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                </button>
              </div>

              <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 10px;">
                <div style="font-size: 26px; font-weight: 700; color: var(--color-good); line-height: 1.3; white-space: pre-wrap;">${this.escapeHtml(card.back)}</div>
                ${card.hint ? `<div style="margin-top: 14px; font-size: 13px; color: var(--label-secondary); background: var(--card-elevated); padding: 8px 14px; border-radius: 12px;">${this.escapeHtml(card.hint)}</div>` : ''}
              </div>

              <div style="display: flex; justify-content: space-around; font-size: 11px; color: var(--label-secondary); border-top: 0.5px solid var(--separator); padding-top: 10px;">
                <span>間隔: ${card.interval || 0}天</span>
                <span>連續次數: ${card.repetitions || 0}</span>
                <span>難度係數: ${card.easeFactor || 2.5}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部評分拇指熱區 -->
        <div style="margin-top: 16px;">
          <div class="rating-bar" id="rating-controls">
            <button class="btn-rating btn-again" data-rating="${Rating.AGAIN}">
              <span>重來</span>
              <span class="sub-label">&lt; 1天</span>
            </button>
            <button class="btn-rating btn-hard" data-rating="${Rating.HARD}">
              <span>困難</span>
              <span class="sub-label">${Math.max(1, Math.round((card.interval || 1) * 1.2))}天</span>
            </button>
            <button class="btn-rating btn-good" data-rating="${Rating.GOOD}">
              <span>良好</span>
              <span class="sub-label">${card.repetitions === 0 ? 1 : Math.round((card.interval || 1) * (card.easeFactor || 2.5))}天</span>
            </button>
            <button class="btn-rating btn-easy" data-rating="${Rating.EASY}">
              <span>簡單</span>
              <span class="sub-label">${Math.round((card.interval || 2) * (card.easeFactor || 2.5) * 1.3)}天</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const flipper = document.getElementById('study-flipper');

    // 綁定手勢與點擊翻面
    attachCardGestures(flipper, {
      onFlip: () => {
        this.isFlipped = !this.isFlipped;
        flipper.classList.toggle('is-flipped', this.isFlipped);
      },
      onSwipeLeft: () => this.handleRateCard(Rating.AGAIN),
      onSwipeRight: () => this.handleRateCard(Rating.GOOD)
    });

    // 朗讀按鈕
    document.getElementById('btn-speak-front')?.addEventListener('click', (e) => {
      e.stopPropagation();
      speakText(card.front);
    });
    document.getElementById('btn-speak-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      speakText(card.back);
    });

    // 評分按鈕群
    document.querySelectorAll('.btn-rating').forEach(btn => {
      btn.addEventListener('click', () => {
        const rating = Number(btn.dataset.rating);
        this.handleRateCard(rating);
      });
    });
  }

  async handleRateCard(rating) {
    triggerHaptic(20);
    const card = this.studyQueue[this.currentCardIndex];
    const updatedCard = scheduleCard(card, rating);

    // 持久化到 IndexedDB
    await db.updateCard(updatedCard);

    // 若評為重來 (Again)，將該卡片在稍後重新推入今日複習隊列末端 (模擬 Anki Learning Step)
    if (rating === Rating.AGAIN) {
      this.studyQueue.push(updatedCard);
    }

    this.currentCardIndex++;
    if (this.currentCardIndex >= this.studyQueue.length) {
      this.sessionFinished = true;
    }

    this.renderStudyCard();
  }

  // --- 3. 新增卡片視圖 (Add Card View) ---
  async renderAddCardView() {
    const decks = await db.getAllDecks();
    const main = document.getElementById('app-main');

    main.innerHTML = `
      <div style="padding-top: 8px;">
        <h1 class="ios-large-title">新增卡片</h1>
        <p style="color: var(--label-secondary); font-size: 14px; margin-bottom: 20px;">
          支援德語冠詞自動變色 (der 藍 / die 紅 / das 綠)、複數形或日語假名，如: der Apfel [die Äpfel]
        </p>

        <form id="form-add-card" style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label class="ios-group-title" style="margin-left: 4px;">選擇所屬牌組</label>
            <select id="card-deck-id" class="ios-input" style="appearance: none; -webkit-appearance: none; background-image: url('data:image/svg+xml;utf8,<svg fill=\\'gray\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' width=\\'24\\' xmlns=\\'http://www.w3.org/2000/svg\\'><path d=\\'M7 10l5 5 5-5z\\'/></svg>'); background-repeat: no-repeat; background-position-x: 96%; background-position-y: 50%;">
              ${decks.map(d => `<option value="${d.id}" ${this.activeDeck && this.activeDeck.id === d.id ? 'selected' : ''}>${this.escapeHtml(d.title)}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="ios-group-title" style="margin-left: 4px;">正面 (題目 / 單字)</label>
            <textarea id="card-front" class="ios-input" rows="3" placeholder="例如: der Apfel\n[die Äpfel] 或 食べる\n[たべる]" required></textarea>
          </div>

          <div>
            <label class="ios-group-title" style="margin-left: 4px;">背面 (解答 / 中文釋義)</label>
            <textarea id="card-back" class="ios-input" rows="3" placeholder="例如: 蘋果 (陽性名詞) 或 吃 (動詞)" required></textarea>
          </div>

          <div>
            <label class="ios-group-title" style="margin-left: 4px;">補充例句 / 備註 (選填)</label>
            <input id="card-hint" class="ios-input" placeholder="例如: Der Apfel ist rot." />
          </div>

          <div style="margin-top: 12px; display: flex; gap: 10px;">
            <button type="submit" class="btn-pill" style="flex: 1; height: 50px;">
              儲存卡片
            </button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('form-add-card')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const deckId = Number(document.getElementById('card-deck-id').value);
      const front = document.getElementById('card-front').value.trim();
      const back = document.getElementById('card-back').value.trim();
      const hint = document.getElementById('card-hint').value.trim();

      if (!front || !back) return;

      await db.addCard({
        deckId,
        front,
        back,
        hint,
        interval: 0,
        repetitions: 0,
        easeFactor: 2.5,
        nextReview: new Date().toISOString().split('T')[0]
      });

      triggerHaptic(20);
      alert('✅ 卡片已成功儲存！');
      document.getElementById('card-front').value = '';
      document.getElementById('card-back').value = '';
      document.getElementById('card-hint').value = '';
    });
  }

  // --- 4. 設定與本地 JSON 資料備份視圖 (Settings View) ---
  async renderSettingsView() {
    const decks = await db.getAllDecks();
    const cards = await db.getAllCards();
    const audioCacheCount = await db.getAudioCacheCount();
    const savedWorkerUrl = localStorage.getItem('tts-worker-url') || '';
    const savedEngine = localStorage.getItem('tts-engine') || 'edge';

    const main = document.getElementById('app-main');

    main.innerHTML = `
      <div style="padding-top: 8px;">
        <h1 class="ios-large-title">設定與語音</h1>
        <p style="color: var(--label-secondary); font-size: 14px; margin-bottom: 20px;">
          個人化系統偏好、資料備份與微軟廣播級高品質神經網路語音設定。
        </p>

        <!-- 高品質語音引擎區塊 (方案 1: Cloudflare Edge TTS) -->
        <div class="ios-group-title">🎙️ 高品質語音發音 (微軟 Edge Neural)</div>
        <div class="ios-group-card">
          <div class="ios-cell">
            <div>
              <div style="font-weight: 600;">發音引擎</div>
              <div style="font-size: 12px; color: var(--label-secondary);">微軟母語神經網路 (德語Katja/繁中曉臻/日語七海)</div>
            </div>
            <select id="tts-engine-select" class="ios-input" style="width: auto; padding: 6px 12px; font-size: 13px;">
              <option value="edge" ${savedEngine === 'edge' ? 'selected' : ''}>微軟神經網路 (推薦)</option>
              <option value="native" ${savedEngine === 'native' ? 'selected' : ''}>原生 WebSpeech</option>
            </select>
          </div>

          <div style="padding: 14px 16px; border-bottom: 0.5px solid var(--separator);">
            <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px;">Cloudflare Worker 代理網址</div>
            <input id="input-worker-url" class="ios-input" placeholder="例如: https://my-anki-tts.workers.dev" value="${this.escapeHtml(savedWorkerUrl)}" style="font-size: 14px; padding: 10px;" />
            <div style="font-size: 11px; color: var(--label-secondary); margin-top: 6px; line-height: 1.4;">
              💡 參閱專案目錄下的 <code>cloudflare-worker/README.md</code>，只需 1 分鐘免費貼上部署。未設定時會自動使用原生發音備援。
            </div>
          </div>

          <!-- 語音測試按鈕 -->
          <div style="padding: 12px 16px; border-bottom: 0.5px solid var(--separator); background: var(--card-elevated);">
            <div style="font-size: 12px; font-weight: 600; color: var(--label-secondary); margin-bottom: 8px;">即時測試發音效果：</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button id="btn-test-de" class="btn-pill btn-secondary" style="padding: 6px 12px; font-size: 12px;">🇩🇪 測試德語</button>
              <button id="btn-test-zh" class="btn-pill btn-secondary" style="padding: 6px 12px; font-size: 12px;">🇹🇼 測試繁中</button>
              <button id="btn-test-ja" class="btn-pill btn-secondary" style="padding: 6px 12px; font-size: 12px;">🇯🇵 測試日語</button>
            </div>
          </div>

          <div class="ios-cell">
            <div>
              <div style="font-weight: 600;">離線音訊快取</div>
              <div style="font-size: 12px; color: var(--label-secondary);">已聽過的單字永久快取於本機，離線 0 流量秒播</div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span id="cache-count-label" style="font-weight: 600; color: var(--accent-blue);">${audioCacheCount} 個</span>
              <button id="btn-clear-audio-cache" style="background: none; border: none; color: var(--color-again); font-size: 12px; cursor: pointer; padding: 4px;">清空</button>
            </div>
          </div>
        </div>

        <div class="ios-group-title">儲存狀態與統計</div>
        <div class="ios-group-card">
          <div class="ios-cell">
            <span>總牌組數量</span>
            <span style="font-weight: 600; color: var(--accent-blue);">${decks.length} 個</span>
          </div>
          <div class="ios-cell">
            <span>總卡片數量</span>
            <span style="font-weight: 600; color: var(--accent-blue);">${cards.length} 張</span>
          </div>
          <div class="ios-cell">
            <span>本機資料庫</span>
            <span style="color: var(--color-good); font-weight: 600;">IndexedDB 正常運作</span>
          </div>
        </div>

        <div class="ios-group-title">本地 JSON 資料備份 (重要)</div>
        <div class="ios-group-card">
          <div class="ios-cell" id="btn-export-json">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(0,122,255,0.15); display: flex; align-items: center; justify-content: center; color: var(--accent-blue);">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </div>
              <div>
                <div style="font-weight: 600;">匯出 JSON 備份檔</div>
                <div style="font-size: 12px; color: var(--label-secondary);">將所有牌組與學習進度打包下載至手機/電腦</div>
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--label-tertiary)"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>

          <div class="ios-cell" id="btn-import-json-trigger">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(52,199,89,0.15); display: flex; align-items: center; justify-content: center; color: var(--color-good);">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              </div>
              <div>
                <div style="font-weight: 600;">匯入 JSON 備份檔</div>
                <div style="font-size: 12px; color: var(--label-secondary);">讀取備份檔案，恢復牌組與複習狀態</div>
              </div>
            </div>
            <input type="file" id="input-import-file" accept=".json" style="display: none;" />
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--label-tertiary)"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
        </div>

        <div class="ios-group-title">外觀與系統</div>
        <div class="ios-group-card">
          <div class="ios-cell">
            <span>外觀主題</span>
            <select id="theme-selector" class="ios-input" style="width: auto; padding: 6px 12px; font-size: 14px;">
              <option value="system">跟隨系統</option>
              <option value="light">淺色模式 (Light)</option>
              <option value="dark">純黑極簡 (Dark / OLED)</option>
            </select>
          </div>
          <div class="ios-cell" id="btn-reset-db" style="color: var(--color-again);">
            <span>重設並清空所有資料</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </div>
        </div>
      </div>
    `;

    // 語音設定監聽
    const workerUrlInput = document.getElementById('input-worker-url');
    workerUrlInput?.addEventListener('input', (e) => {
      localStorage.setItem('tts-worker-url', e.target.value.trim());
    });

    const engineSelect = document.getElementById('tts-engine-select');
    engineSelect?.addEventListener('change', (e) => {
      localStorage.setItem('tts-engine', e.target.value);
    });

    // 語音測試按鈕
    document.getElementById('btn-test-de')?.addEventListener('click', () => {
      speakText('Guten Tag! Wie geht es Ihnen heute?', 'de-DE');
    });
    document.getElementById('btn-test-zh')?.addEventListener('click', () => {
      speakText('你好！歡迎使用間隔重複記憶閃卡。', 'zh-TW');
    });
    document.getElementById('btn-test-ja')?.addEventListener('click', () => {
      speakText('こんにちは！今日も楽しく勉強しましょう。', 'ja-JP');
    });

    // 清空語音快取
    document.getElementById('btn-clear-audio-cache')?.addEventListener('click', async () => {
      if (confirm('確定要清空已快取的本機音訊嗎？')) {
        await db.clearAudioCache();
        document.getElementById('cache-count-label').textContent = '0 個';
        alert('語音快取已清空。');
      }
    });

    // 匯出 JSON
    document.getElementById('btn-export-json')?.addEventListener('click', async () => {
      triggerHaptic(15);
      const jsonStr = await db.exportJSON();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.href = url;
      a.download = `anki_backup_${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // 匯入 JSON
    const fileInput = document.getElementById('input-import-file');
    document.getElementById('btn-import-json-trigger')?.addEventListener('click', () => {
      triggerHaptic(15);
      fileInput.click();
    });

    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const text = event.target.result;
        const replace = confirm('選擇匯入方式：\n[確定]：清空現有資料並完全還原\n[取消]：保留現有牌組，進行合併匯入');
        const mode = replace ? 'replace' : 'merge';
        const res = await db.importJSON(text, mode);
        if (res.success) {
          alert(`🎉 匯入成功！已匯入 ${res.decksCount} 個牌組，${res.cardsCount} 張卡片。`);
          this.renderSettingsView();
        } else {
          alert(`❌ 匯入失敗: ${res.error}`);
        }
      };
      reader.readAsText(file);
    });

    // 主題選擇
    const themeSelector = document.getElementById('theme-selector');
    const savedTheme = localStorage.getItem('app-theme') || 'system';
    themeSelector.value = savedTheme;
    themeSelector.addEventListener('change', (e) => {
      this.setTheme(e.target.value);
    });

    // 清空資料庫
    document.getElementById('btn-reset-db')?.addEventListener('click', async () => {
      if (confirm('⚠️ 警告：確定要清空所有牌組與卡片資料嗎？此動作無法復原！')) {
        await db.clearAll();
        alert('資料庫已清空。');
        this.renderSettingsView();
      }
    });
  }

  // --- 工具輔助 ---
  setTheme(theme) {
    localStorage.setItem('app-theme', theme);
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  loadTheme() {
    const theme = localStorage.getItem('app-theme') || 'system';
    this.setTheme(theme);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  formatRuby(text) {
    if (!text) return '';
    let escaped = this.escapeHtml(text);

    // 德語冠詞顏色視覺增強 (der = 陽性藍, die = 陰性紅, das = 中性綠)
    escaped = escaped
      .replace(/^der\b/i, '<span style="color:#007AFF; font-weight:800;">der</span>')
      .replace(/^die\b/i, '<span style="color:#FF3B30; font-weight:800;">die</span>')
      .replace(/^das\b/i, '<span style="color:#34C759; font-weight:800;">das</span>');

    // 將 [中括號內容] (日語假名 或 德語複數形) 轉為優雅的標籤/補充樣式
    return escaped.replace(/\[(.*?)\]/g, '<span style="display:block; font-size:16px; color:var(--accent-blue); font-weight:500; margin-top:4px;">$1</span>');
  }

  bindEvents() {
    document.querySelectorAll('.tab-item').forEach(tab => {
      tab.addEventListener('click', () => {
        triggerHaptic(15);
        this.switchView(tab.dataset.view);
      });
    });
  }
}

// 啟動 App
window.addEventListener('DOMContentLoaded', () => {
  const app = new AnkiApp();
  app.init();
});
