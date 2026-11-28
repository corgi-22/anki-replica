/**
 * app.js - 主應用程式控制核心
 * 協調整合：IndexedDB 資料庫、SM-2 間隔重複、手勢物理拖曳、語音發音與 iOS 視圖路由
 * 完整支援：牌組管理、卡片瀏覽與即時編輯修改/刪除、廣播級微軟 Edge TTS
 */

import { db } from './db.js';
import { scheduleCard, isCardDue, Rating, MAX_INTERVAL } from './srs.js';
import { attachCardGestures } from './gestures.js';
import { speakText, triggerHaptic, detectLanguage, getEffectiveDeckLanguage } from './tts.js';
import { gdrive } from './gdrive.js';

class AnkiApp {
  constructor() {
    this.currentView = 'decks';
    this.activeDeck = null;
    this.effectiveLang = 'auto';
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

  // --- Google 雲端硬碟自動同步機制 ---
  triggerAutoSync() {
    if (!gdrive.isLoggedIn()) return;
    const isAutoSync = localStorage.getItem('gdrive_auto_sync') !== 'false';
    if (!isAutoSync) return;

    clearTimeout(this._autoSyncTimer);
    this._autoSyncTimer = setTimeout(async () => {
      try {
        await gdrive.syncTwoWay();
        console.log('☁️ [Google Drive] 自動同步完成');
      } catch (e) {
        console.warn('☁️ [Google Drive] 自動同步失敗:', e);
      }
    }, 2500);
  }

  // --- 視圖路由切換 ---
  switchView(viewName, payload = null) {
    this.currentView = viewName;
    if (viewName === 'study' && payload) this.activeDeck = payload;
    if (viewName === 'deck-detail' && payload) this.activeDeck = payload;

    // 更新導航欄狀態 (若在牌組詳細或複習中，保持「牌組」高亮)
    const activeTabName = (viewName === 'deck-detail' || viewName === 'study') ? 'decks' : viewName;
    document.querySelectorAll('.tab-item').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === activeTabName);
    });

    const contentArea = document.getElementById('app-main');
    contentArea.scrollTop = 0;

    switch (viewName) {
      case 'decks':
        this.renderDecksView();
        break;
      case 'deck-detail':
        this.renderDeckDetailView(payload || this.activeDeck);
        break;
      case 'study':
        this.startStudySession(this.activeDeck);
        break;
      case 'add':
        this.renderCardEditor(null, 'decks');
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
      return { ...deck, total: cards.length, due: dueCards.length, cards };
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
          <div style="font-size: 12px; opacity: 0.9;">每天複習 10 分鐘形成長期記憶</div>
        </div>

        <div class="ios-group-title">牌組列表 (共 ${deckStats.length} 個)</div>
        <div class="ios-group-card">
          ${deckStats.length === 0 ? `
            <div style="padding: 32px 16px; text-align: center; color: var(--label-secondary);">
              尚無牌組，點擊右上角新增吧！
            </div>
          ` : deckStats.map(d => `
            <div class="ios-cell deck-item-row" data-id="${d.id}">
              <div style="display: flex; align-items: center; gap: 14px;">
                <div style="width: 12px; height: 12px; border-radius: 50%; background-color: ${d.color || '#007AFF'}; flex-shrink: 0;"></div>
                <div>
                  <div style="font-weight: 600; font-size: 16px;">${this.escapeHtml(d.title)}</div>
                  <div style="font-size: 12px; color: var(--label-secondary); margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span>共 ${d.total} 張卡片</span>
                    <span class="badge-lang-tag">${this.getDeckLangLabel(d, d.cards)}</span>
                    ${d.description ? `<span>· ${this.escapeHtml(d.description)}</span>` : ''}
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

    // 點擊牌組進入牌組詳細頁（可查看所有卡片、編輯卡片、開始複習）
    document.querySelectorAll('.deck-item-row').forEach(row => {
      row.addEventListener('click', () => {
        const deckId = Number(row.dataset.id);
        const deck = decks.find(d => d.id === deckId);
        triggerHaptic(15);
        this.renderDeckDetailView(deck);
      });
    });

    // 點擊新增牌組
    document.getElementById('btn-create-deck')?.addEventListener('click', () => {
      this.openDeckModal();
    });
  }

  getDeckLangLabel(deck, cards = []) {
    const lang = deck?.lang || 'auto';
    if (lang === 'de-DE') return '🇩🇪 德語';
    if (lang === 'ja-JP') return '🇯🇵 日語';
    if (lang === 'en-US') return '🇺🇸 英語';
    if (lang === 'id-ID') return '🇮🇩 印尼語';
    if (lang === 'vi-VN') return '🇻🇳 越南語';

    const inferred = getEffectiveDeckLanguage(deck, cards);
    if (inferred === 'de-DE') return '🇩🇪 德語 (自動)';
    if (inferred === 'ja-JP') return '🇯🇵 日語 (自動)';
    if (inferred === 'vi-VN') return '🇻🇳 越南語 (自動)';
    return '🌐 自動偵測';
  }

  getLangDisplay(langCode) {
    const map = {
      'de-DE': '🇩🇪 德語',
      'ja-JP': '🇯🇵 日語',
      'en-US': '🇺🇸 英語',
      'id-ID': '🇮🇩 印尼語',
      'vi-VN': '🇻🇳 越南語',
      'auto': '🌐 自動'
    };
    return map[langCode] || '🌐 自動';
  }

  openDeckModal(deck = null) {
    const isEdit = !!deck;
    const currentLang = deck?.lang || 'auto';

    document.getElementById('deck-modal-container')?.remove();

    const modalContainer = document.createElement('div');
    modalContainer.id = 'deck-modal-container';
    modalContainer.innerHTML = `
      <div class="ios-modal-backdrop" id="deck-modal-backdrop">
        <div class="ios-modal-dialog">
          <div class="ios-modal-header">
            <button type="button" class="ios-modal-btn" id="btn-modal-cancel">取消</button>
            <div class="ios-modal-title">${isEdit ? '編輯牌組' : '建立新牌組'}</div>
            <button type="button" class="ios-modal-btn ios-modal-btn-primary" id="btn-modal-save">儲存</button>
          </div>
          <div class="ios-modal-body">
            <div style="margin-bottom: 16px;">
              <label class="ios-group-title" style="margin: 0 0 6px 4px; display: block;">牌組名稱</label>
              <input id="modal-deck-title" class="ios-input" placeholder="例如: 德語 A1 單字庫 / 多益核心" value="${isEdit ? this.escapeHtml(deck.title) : ''}" required autofocus />
            </div>

            <div style="margin-bottom: 16px;">
              <label class="ios-group-title" style="margin: 0 0 6px 4px; display: block;">學習語言 (發音語系)</label>
              <div class="lang-selector-group">
                <label class="lang-option-pill">
                  <input type="radio" name="modal-deck-lang" value="auto" ${currentLang === 'auto' ? 'checked' : ''} />
                  <span class="pill-label">🌐 自動偵測</span>
                </label>
                <label class="lang-option-pill">
                  <input type="radio" name="modal-deck-lang" value="de-DE" ${currentLang === 'de-DE' ? 'checked' : ''} />
                  <span class="pill-label">🇩🇪 德語 (de-DE)</span>
                </label>
                <label class="lang-option-pill">
                  <input type="radio" name="modal-deck-lang" value="ja-JP" ${currentLang === 'ja-JP' ? 'checked' : ''} />
                  <span class="pill-label">🇯🇵 日語 (ja-JP)</span>
                </label>
                <label class="lang-option-pill">
                  <input type="radio" name="modal-deck-lang" value="en-US" ${currentLang === 'en-US' ? 'checked' : ''} />
                  <span class="pill-label">🇺🇸 英語 (en-US)</span>
                </label>
                <label class="lang-option-pill">
                  <input type="radio" name="modal-deck-lang" value="id-ID" ${currentLang === 'id-ID' ? 'checked' : ''} />
                  <span class="pill-label">🇮🇩 印尼語 (id-ID)</span>
                </label>
                <label class="lang-option-pill">
                  <input type="radio" name="modal-deck-lang" value="vi-VN" ${currentLang === 'vi-VN' ? 'checked' : ''} />
                  <span class="pill-label">🇻🇳 越南語 (vi-VN)</span>
                </label>
              </div>
            </div>

            <div style="margin-bottom: 8px;">
              <label class="ios-group-title" style="margin: 0 0 6px 4px; display: block;">說明 / 備註 (選填)</label>
              <input id="modal-deck-desc" class="ios-input" placeholder="例如: 考試單字、日常語法" value="${isEdit && deck.description ? this.escapeHtml(deck.description) : ''}" />
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modalContainer);

    const closeModal = () => {
      triggerHaptic(10);
      modalContainer.remove();
    };

    document.getElementById('btn-modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('deck-modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'deck-modal-backdrop') closeModal();
    });

    document.getElementById('btn-modal-save')?.addEventListener('click', async () => {
      const title = document.getElementById('modal-deck-title').value.trim();
      const desc = document.getElementById('modal-deck-desc').value.trim();
      const selectedLangRadio = document.querySelector('input[name="modal-deck-lang"]:checked');
      const lang = selectedLangRadio ? selectedLangRadio.value : 'auto';

      if (!title) {
        alert('請填寫牌組名稱！');
        document.getElementById('modal-deck-title').focus();
        return;
      }

      triggerHaptic(20);
      if (isEdit) {
        const updated = {
          ...deck,
          title,
          description: desc,
          lang
        };
        await db.updateDeck(updated);
        this.activeDeck = updated;
        closeModal();
        this.triggerAutoSync();
        if (this.currentView === 'deck-detail') {
          this.renderDeckDetailView(updated);
        } else {
          this.renderDecksView();
        }
      } else {
        await db.addDeck({
          title,
          description: desc,
          color: '#007AFF',
          lang
        });
        closeModal();
        this.triggerAutoSync();
        this.renderDecksView();
      }
    });
  }

  // --- 2. 牌組詳細頁 (Deck Detail & Card Manager) ---
  async renderDeckDetailView(deck) {
    if (!deck) {
      this.renderDecksView();
      return;
    }
    this.activeDeck = deck;
    const cards = await db.getCardsByDeck(deck.id);
    const dueCards = cards.filter(c => isCardDue(c));
    const main = document.getElementById('app-main');

    main.innerHTML = `
      <div style="padding-top: 8px;">
        <!-- 頂部返回導航 -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <button id="btn-back-to-decks" style="background: none; border: none; color: var(--accent-blue); font-size: 16px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 4px 0;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
            我的牌組
          </button>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button id="btn-edit-deck" style="background: none; border: none; color: var(--accent-blue); font-size: 14px; font-weight: 500; cursor: pointer; padding: 4px 6px;">
              編輯牌組
            </button>
            <button id="btn-delete-deck" style="background: none; border: none; color: var(--color-again); font-size: 14px; cursor: pointer; padding: 4px 6px;">
              刪除牌組
            </button>
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap;">
            <h1 class="ios-large-title" style="margin-bottom: 0;">${this.escapeHtml(deck.title)}</h1>
            <span class="badge-lang-tag" style="font-size: 12px; padding: 3px 10px; border-radius: 10px;">
              ${this.getDeckLangLabel(deck, cards)}
            </span>
          </div>
          ${deck.description ? `<p style="color: var(--label-secondary); font-size: 14px; margin-top: 4px;">${this.escapeHtml(deck.description)}</p>` : ''}
        </div>

        <!-- 動作按鈕群 -->
        <div style="display: flex; gap: 10px; margin-bottom: 24px;">
          <button id="btn-start-study-now" class="btn-pill" style="flex: 1; height: 50px; font-size: 16px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            開始複習 (${dueCards.length})
          </button>
          <button id="btn-add-card-to-deck" class="btn-pill btn-secondary" style="height: 50px; padding: 0 16px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            新增卡片
          </button>
        </div>

        <div class="ios-group-title">牌組所有卡片 (${cards.length} 張 · 點擊編輯卡片)</div>
        <div class="ios-group-card">
          ${cards.length === 0 ? `
            <div style="padding: 32px 16px; text-align: center; color: var(--label-secondary);">
              此牌組尚無卡片，點擊上方「新增卡片」開始製作吧！
            </div>
          ` : cards.map(c => `
            <div class="ios-cell card-item-row" data-id="${c.id}">
              <div style="flex: 1; min-width: 0; padding-right: 12px;">
                <div style="font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${this.escapeHtml(c.front.replace(/\[.*?\]/g, '').split('\n')[0])}
                </div>
                <div style="font-size: 13px; color: var(--label-secondary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${this.escapeHtml(c.back)}
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <span style="font-size: 11px; color: var(--label-secondary); background: var(--card-elevated); padding: 2px 8px; border-radius: 8px; font-weight: 500;">
                  ${c.interval ? `${c.interval}天` : '新卡'}
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--label-tertiary)"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.getElementById('btn-back-to-decks')?.addEventListener('click', () => {
      triggerHaptic(10);
      this.switchView('decks');
    });

    document.getElementById('btn-start-study-now')?.addEventListener('click', () => {
      triggerHaptic(15);
      this.switchView('study', deck);
    });

    document.getElementById('btn-add-card-to-deck')?.addEventListener('click', () => {
      triggerHaptic(15);
      this.renderCardEditor(null, 'deck-detail', { deck });
    });

    document.getElementById('btn-edit-deck')?.addEventListener('click', () => {
      triggerHaptic(15);
      this.openDeckModal(deck);
    });

    document.getElementById('btn-delete-deck')?.addEventListener('click', async () => {
      if (confirm(`確定要刪除「${deck.title}」及其所有卡片嗎？此動作無法復原！`)) {
        await db.deleteDeck(deck.id);
        triggerHaptic(20);
        this.triggerAutoSync();
        alert('牌組已刪除。');
        this.switchView('decks');
      }
    });

    // 點擊卡片列表開啟編輯
    document.querySelectorAll('.card-item-row').forEach(row => {
      row.addEventListener('click', () => {
        const cardId = Number(row.dataset.id);
        const card = cards.find(c => c.id === cardId);
        triggerHaptic(15);
        this.renderCardEditor(card, 'deck-detail', { deck });
      });
    });
  }

  // --- 3. 卡片複習視圖 (Study View) ---
  async startStudySession(deck) {
    if (!deck) {
      this.renderDecksView();
      return;
    }

    const cards = await db.getCardsByDeck(deck.id);
    const dueCards = cards.filter(c => isCardDue(c));
    this.studyQueue = dueCards.length > 0 ? dueCards : cards;
    this.currentCardIndex = 0;
    this.sessionFinished = this.studyQueue.length === 0;

    // 計算整副牌組推斷/設定之有效學習語言
    this.effectiveLang = getEffectiveDeckLanguage(deck, cards);

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
          <button id="btn-exit-study" style="background: none; border: none; color: var(--accent-blue); font-size: 13px; font-weight: 600; cursor: pointer; padding: 2px 0;">
            ← ${this.escapeHtml(this.activeDeck.title)}
          </button>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge-lang-tag" style="font-size: 11px;">${this.getLangDisplay(this.effectiveLang)}</span>
            <div>進度: ${this.currentCardIndex + 1} / ${total}</div>
          </div>
        </div>
        <div class="progress-container">
          <div class="progress-bar-fill" style="width: ${progress}%;"></div>
        </div>

        <!-- 3D 卡片結構 -->
        <div class="card-scene">
          <div class="card-drag-wrapper" id="study-drag-wrapper">
            <div class="card-flipper" id="study-flipper">
              <!-- 卡片正面 (題目) -->
              <div class="card-face front">
                <div class="badge-stamp badge-again" aria-label="重來">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </div>
                <div class="badge-stamp badge-good" aria-label="良好">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--accent-blue); letter-spacing: 0.5px;">QUESTION (正面)</span>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <button id="btn-edit-card" style="background: none; border: none; cursor: pointer; color: var(--label-secondary); padding: 6px;" title="編輯卡片">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button id="btn-speak-front" style="background: none; border: none; cursor: pointer; color: var(--accent-blue); padding: 6px;" title="語音發音">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                    </button>
                  </div>
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
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--color-good); letter-spacing: 0.5px;">ANSWER (解答)</span>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <button id="btn-edit-card-back" style="background: none; border: none; cursor: pointer; color: var(--label-secondary); padding: 6px;" title="編輯卡片">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button id="btn-speak-back" style="background: none; border: none; cursor: pointer; color: var(--accent-blue); padding: 6px;" title="語音發音">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                    </button>
                  </div>
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
              <span class="sub-label">${Math.min(MAX_INTERVAL, Math.max(1, Math.round((card.interval || 1) * 1.2)))}天</span>
            </button>
            <button class="btn-rating btn-good" data-rating="${Rating.GOOD}">
              <span>良好</span>
              <span class="sub-label">${Math.min(MAX_INTERVAL, card.repetitions === 0 ? 1 : Math.round((card.interval || 1) * (card.easeFactor || 2.5)))}天</span>
            </button>
            <button class="btn-rating btn-easy" data-rating="${Rating.EASY}">
              <span>簡單</span>
              <span class="sub-label">${Math.min(MAX_INTERVAL, Math.round((card.interval || 2) * (card.easeFactor || 2.5) * 1.3))}天</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const flipper = document.getElementById('study-flipper');
    const dragWrapper = document.getElementById('study-drag-wrapper');

    const toggleFlip = () => {
      this.isFlipped = !this.isFlipped;
      flipper.classList.toggle('is-flipped', this.isFlipped);
      triggerHaptic(15);
    };

    // 點擊卡片任何地方（除按鈕外）精準觸發 3D 翻面
    flipper.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      toggleFlip();
    });

    // 綁定手勢：拖曳外層 wrapper，左右滑動評分
    attachCardGestures(dragWrapper, {
      onSwipeLeft: () => this.handleRateCard(Rating.AGAIN),
      onSwipeRight: () => this.handleRateCard(Rating.GOOD)
    });

    // 離開複習返回牌組詳細頁
    document.getElementById('btn-exit-study')?.addEventListener('click', () => {
      triggerHaptic(10);
      this.renderDeckDetailView(this.activeDeck);
    });

    // 即時編輯目前這張卡片
    const openEditorForThisCard = (e) => {
      e.stopPropagation();
      triggerHaptic(15);
      this.renderCardEditor(card, 'study', { deck: this.activeDeck });
    };
    document.getElementById('btn-edit-card')?.addEventListener('click', openEditorForThisCard);
    document.getElementById('btn-edit-card-back')?.addEventListener('click', openEditorForThisCard);

    // 朗讀按鈕
    document.getElementById('btn-speak-front')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetLang = (this.effectiveLang && this.effectiveLang !== 'auto') ? this.effectiveLang : undefined;
      speakText(card.front, targetLang);
    });
    document.getElementById('btn-speak-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      // 卡片背面 100% 獨立依內容判斷 (背面若是英文就用英文發音、中文就用中文、日文就用日文，不受正面牌組語言綁定)
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
    this.triggerAutoSync();

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

  // --- 4. 卡片編輯/新增視圖 (Card Editor View) ---
  async renderCardEditor(card = null, returnView = 'decks', context = {}) {
    const isEditing = !!card;
    const decks = await db.getAllDecks();
    const selectedDeckId = card ? card.deckId : (context.deck ? context.deck.id : (this.activeDeck ? this.activeDeck.id : (decks[0]?.id || 1)));

    const main = document.getElementById('app-main');

    main.innerHTML = `
      <div style="padding-top: 8px;">
        <!-- 頂部導航 -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <button id="btn-cancel-edit" style="background: none; border: none; color: var(--accent-blue); font-size: 16px; font-weight: 500; cursor: pointer; padding: 4px 0;">
            ${isEditing ? '取消' : '返回'}
          </button>
          <div style="font-size: 17px; font-weight: 600;">${isEditing ? '編輯卡片' : '新增卡片'}</div>
          <div style="width: 40px;"></div>
        </div>

        <p style="color: var(--label-secondary); font-size: 14px; margin-bottom: 20px;">
          支援德語冠詞自動變色 (der 藍 / die 紅 / das 綠)、複數形，如: der Apfel [die Äpfel]
        </p>

        <form id="form-card-editor" style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label class="ios-group-title" style="margin-left: 4px;">選擇所屬牌組</label>
            <select id="card-deck-id" class="ios-input" style="appearance: none; -webkit-appearance: none; background-image: url('data:image/svg+xml;utf8,<svg fill=\\'gray\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' width=\\'24\\' xmlns=\\'http://www.w3.org/2000/svg\\'><path d=\\'M7 10l5 5 5-5z\\'/></svg>'); background-repeat: no-repeat; background-position-x: 96%; background-position-y: 50%;">
              ${decks.map(d => `<option value="${d.id}" ${d.id === selectedDeckId ? 'selected' : ''}>${this.escapeHtml(d.title)}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="ios-group-title" style="margin-left: 4px;">正面 (題目 / 單字)</label>
            <textarea id="card-front" class="ios-input" rows="3" placeholder="例如: der Apfel\n[die Äpfel] 或 食べる\n[たべる]" required>${card ? this.escapeHtml(card.front) : ''}</textarea>
          </div>

          <div>
            <label class="ios-group-title" style="margin-left: 4px;">背面 (解答 / 中文釋義)</label>
            <textarea id="card-back" class="ios-input" rows="3" placeholder="例如: 蘋果 (陽性名詞) 或 吃 (動詞)" required>${card ? this.escapeHtml(card.back) : ''}</textarea>
          </div>

          <div>
            <label class="ios-group-title" style="margin-left: 4px;">補充例句 / 備註 (選填)</label>
            <input id="card-hint" class="ios-input" placeholder="例如: Der Apfel ist rot." value="${card && card.hint ? this.escapeHtml(card.hint) : ''}" />
          </div>

          <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 10px;">
            <button type="submit" class="btn-pill" style="height: 50px;">
              ${isEditing ? '儲存修改' : '新增卡片'}
            </button>
            ${isEditing ? `
              <button type="button" id="btn-delete-card" class="btn-pill btn-secondary" style="height: 50px; color: var(--color-again);">
                刪除此卡片
              </button>
            ` : ''}
          </div>
        </form>
      </div>
    `;

    // 取消按鈕
    document.getElementById('btn-cancel-edit')?.addEventListener('click', () => {
      triggerHaptic(10);
      this.returnToPreviousView(returnView, context);
    });

    // 刪除卡片
    if (isEditing) {
      document.getElementById('btn-delete-card')?.addEventListener('click', async () => {
        if (confirm('確定要刪除這張卡片嗎？此動作無法復原。')) {
          await db.deleteCard(card.id);
          triggerHaptic(20);

          // 若在複習模式下，將該卡片從複習隊列移除
          if (returnView === 'study') {
            this.studyQueue = this.studyQueue.filter(c => c.id !== card.id);
            if (this.currentCardIndex >= this.studyQueue.length) {
              this.currentCardIndex = Math.max(0, this.studyQueue.length - 1);
            }
          }
          this.triggerAutoSync();
          alert('卡片已刪除。');
          this.returnToPreviousView(returnView, context);
        }
      });
    }

    // 表單提交
    document.getElementById('form-card-editor')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const deckId = Number(document.getElementById('card-deck-id').value);
      const front = document.getElementById('card-front').value.trim();
      const back = document.getElementById('card-back').value.trim();
      const hint = document.getElementById('card-hint').value.trim();

      if (!front || !back) return;

      if (isEditing) {
        const updatedCard = {
          ...card,
          deckId,
          front,
          back,
          hint
        };
        await db.updateCard(updatedCard);

        // 若在複習隊列中，同步更新當前隊列卡片物件
        if (returnView === 'study') {
          const idx = this.studyQueue.findIndex(c => c.id === card.id);
          if (idx !== -1) {
            this.studyQueue[idx] = updatedCard;
          }
        }

        triggerHaptic(20);
        this.triggerAutoSync();
        alert('✅ 卡片修改已儲存！');
        this.returnToPreviousView(returnView, context);
      } else {
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
        this.triggerAutoSync();
        alert('✅ 卡片已成功新增！');
        document.getElementById('card-front').value = '';
        document.getElementById('card-back').value = '';
        document.getElementById('card-hint').value = '';

        if (returnView !== 'decks') {
          this.returnToPreviousView(returnView, context);
        }
      }
    });
  }

  returnToPreviousView(returnView, context = {}) {
    if (returnView === 'study') {
      this.renderStudyCard();
    } else if (returnView === 'deck-detail' && context.deck) {
      this.renderDeckDetailView(context.deck);
    } else {
      this.switchView('decks');
    }
  }

  // --- 5. 設定與本地 JSON 資料備份視圖 (Settings View) ---
  async renderSettingsView() {
    const decks = await db.getAllDecks();
    const cards = await db.getAllCards();
    const audioCacheCount = await db.getAudioCacheCount();
    const savedWorkerUrl = localStorage.getItem('tts-worker-url') || '';
    const savedEngine = localStorage.getItem('tts-engine') || 'edge';

    const isGDriveLoggedIn = gdrive.isLoggedIn();
    const gdriveUser = gdrive.getUser();
    const lastSyncTimeStr = gdrive.getLastSyncTime();
    const isAutoSync = localStorage.getItem('gdrive_auto_sync') !== 'false';

    const main = document.getElementById('app-main');

    main.innerHTML = `
      <div style="padding-top: 8px;">
        <h1 class="ios-large-title">設定與語音</h1>
        <p style="color: var(--label-secondary); font-size: 14px; margin-bottom: 20px;">
          個人化系統偏好、資料備份與語音設定。
        </p>

        <!-- Google 雲端硬碟同步區塊 -->
        <div class="ios-group-title">☁️ Google 雲端硬碟同步</div>
        <div class="ios-group-card">
          ${!isGDriveLoggedIn ? `
            <div style="padding: 18px 16px;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
                <svg width="24" height="24" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/></svg>
                <div style="font-weight: 600; font-size: 16px;">連結 Google 帳號備份</div>
              </div>
              <p style="font-size: 13px; color: var(--label-secondary); margin-bottom: 14px; line-height: 1.45;">
                登入Google帳戶以將資料同步至個人雲端硬碟
              </p>
              <button id="btn-gdrive-login" class="btn-pill" style="width: 100%; height: 48px; background-color: #4285F4; font-size: 15px; font-weight: 600; color: #fff;">
                使用 Google 帳號登入
              </button>
            </div>
          ` : `
            <div class="ios-cell">
              <div style="display: flex; align-items: center; gap: 12px;">
                ${gdriveUser?.picture ? `<img src="${this.escapeHtml(gdriveUser.picture)}" style="width: 36px; height: 36px; border-radius: 50%;" />` : `<div style="width: 36px; height: 36px; border-radius: 50%; background: #4285F4; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700;">G</div>`}
                <div>
                  <div style="font-weight: 600; font-size: 15px;">${this.escapeHtml(gdriveUser?.name || 'Google 使用者')}</div>
                  <div style="font-size: 12px; color: var(--label-secondary);">${this.escapeHtml(gdriveUser?.email || '')}</div>
                </div>
              </div>
              <button id="btn-gdrive-logout" style="background: none; border: none; color: var(--color-again); font-size: 13px; font-weight: 500; cursor: pointer; padding: 4px 6px;">登出</button>
            </div>

            <div class="ios-cell">
              <div>
                <div style="font-weight: 600;">上次雲端同步</div>
                <div style="font-size: 12px; color: var(--label-secondary); margin-top: 2px;">${lastSyncTimeStr ? `最後更新：${lastSyncTimeStr}` : '尚未備份至雲端'}</div>
              </div>
              <span style="font-size: 12px; color: var(--color-good); font-weight: 600;">● 已連線</span>
            </div>

            <div style="padding: 14px 16px; border-bottom: 0.5px solid var(--separator);">
              <button id="btn-gdrive-sync" class="btn-pill" style="width: 100%; height: 48px; font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                立即同步
              </button>
            </div>

            <div class="ios-cell">
              <div>
                <div style="font-weight: 600;">自動同步</div>
                <div style="font-size: 12px; color: var(--label-secondary); margin-top: 2px;">新增卡片或複習完成後自動同步</div>
              </div>
              <label class="ios-switch">
                <input type="checkbox" id="toggle-gdrive-autosync" ${isAutoSync ? 'checked' : ''} />
                <span class="ios-switch-slider"></span>
              </label>
            </div>
          `}
        </div>

        <!-- 高品質語音引擎區塊 (方案 1: Cloudflare Edge TTS) -->
        <div class="ios-group-title">🎙️ 語音設定</div>
        <div class="ios-group-card">
          <div class="ios-cell">
            <div>
              <div style="font-weight: 600;">發音引擎</div>
              <div style="font-size: 12px; color: var(--label-secondary);">微軟母語神經網路 (德/中/日/英/印尼/越南)</div>
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
              💡 參閱專案目錄下的 <code>cloudflare-worker/README.md</code>。未設定時會自動使用原生發音備援。
            </div>
          </div>

          <!-- 語音測試按鈕 -->
          <div style="padding: 12px 16px; border-bottom: 0.5px solid var(--separator); background: var(--card-elevated);">
            <div style="font-size: 12px; font-weight: 600; color: var(--label-secondary); margin-bottom: 8px;">即時測試發音效果：</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button id="btn-test-de" class="btn-pill btn-secondary" style="padding: 6px 12px; font-size: 12px;">🇩🇪 測試德語</button>
              <button id="btn-test-zh" class="btn-pill btn-secondary" style="padding: 6px 12px; font-size: 12px;">🇹🇼 測試繁中</button>
              <button id="btn-test-ja" class="btn-pill btn-secondary" style="padding: 6px 12px; font-size: 12px;">🇯🇵 測試日語</button>
              <button id="btn-test-id" class="btn-pill btn-secondary" style="padding: 6px 12px; font-size: 12px;">🇮🇩 測試印尼語</button>
              <button id="btn-test-vi" class="btn-pill btn-secondary" style="padding: 6px 12px; font-size: 12px;">🇻🇳 測試越南語</button>
            </div>
          </div>

          <div class="ios-cell">
            <div>
              <div style="font-weight: 600;">離線音訊快取</div>
              <div style="font-size: 12px; color: var(--label-secondary);">已聽過的單字將快取於本機</div>
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
                <div style="font-size: 12px; color: var(--label-secondary);">將所有牌組與學習進度下載至裝置</div>
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

    // Google Drive 登入
    document.getElementById('btn-gdrive-login')?.addEventListener('click', async () => {
      triggerHaptic(15);
      const btn = document.getElementById('btn-gdrive-login');
      btn.textContent = '正在啟動 Google 授權視窗...';
      btn.disabled = true;
      try {
        await gdrive.signIn();
        triggerHaptic(20);
        btn.textContent = '登入成功，正在執行同步...';
        try {
          const syncRes = await gdrive.syncTwoWay();
          alert(`🎉 Google 帳號登入成功！已完成同步（共 ${syncRes.decksCount} 個牌組，${syncRes.cardsCount} 張卡片）。`);
        } catch (syncErr) {
          console.warn('首次同步警告:', syncErr);
          alert('🎉 Google 帳號登入成功！已連結專屬雲端硬碟空間。');
        }
        this.renderSettingsView();
      } catch (err) {
        console.error('Google 登入失敗:', err);
        alert(`❌ 登入失敗或已取消: ${err.message}`);
        this.renderSettingsView();
      }
    });

    // Google Drive 登出
    document.getElementById('btn-gdrive-logout')?.addEventListener('click', () => {
      if (confirm('確定要登出 Google 帳號嗎？（本機資料依然會完整保留）')) {
        triggerHaptic(15);
        gdrive.signOut();
        this.renderSettingsView();
      }
    });

    // 立即同步
    document.getElementById('btn-gdrive-sync')?.addEventListener('click', async () => {
      triggerHaptic(15);
      const btn = document.getElementById('btn-gdrive-sync');
      const originalHtml = btn.innerHTML;
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="spin"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
        正在同步中...
      `;
      btn.disabled = true;
      try {
        const res = await gdrive.syncTwoWay();
        triggerHaptic(20);
        alert(`🎉 同步成功！雲端與本機已完全一致（共 ${res.decksCount} 個牌組，${res.cardsCount} 張卡片）。`);
        this.renderSettingsView();
      } catch (err) {
        console.error('同步失敗:', err);
        alert(`❌ 同步失敗: ${err.message}`);
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }
    });

    // 自動同步開關
    document.getElementById('toggle-gdrive-autosync')?.addEventListener('change', (e) => {
      localStorage.setItem('gdrive_auto_sync', e.target.checked ? 'true' : 'false');
      triggerHaptic(10);
    });

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
    document.getElementById('btn-test-id')?.addEventListener('click', () => {
      speakText('Halo! Selamat pagi, apa kabar?', 'id-ID');
    });
    document.getElementById('btn-test-vi')?.addEventListener('click', () => {
      speakText('Xin chào! Rất vui được gặp bạn.', 'vi-VN');
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
