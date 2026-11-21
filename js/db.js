/**
 * db.js - 原生 IndexedDB 封裝模組
 * 零依賴、純非同步，支援大容量本機儲存與一鍵 JSON 匯入/匯出備份
 */

const DB_NAME = 'AppleAnkiLocalDB';
const DB_VERSION = 1;

class Database {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 牌組表
        if (!db.objectStoreNames.contains('decks')) {
          const deckStore = db.createObjectStore('decks', { keyPath: 'id', autoIncrement: true });
          deckStore.createIndex('title', 'title', { unique: false });
        }

        // 卡片表
        if (!db.objectStoreNames.contains('cards')) {
          const cardStore = db.createObjectStore('cards', { keyPath: 'id', autoIncrement: true });
          cardStore.createIndex('deckId', 'deckId', { unique: false });
          cardStore.createIndex('nextReview', 'nextReview', { unique: false });
        }

        // 設定表
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        await this.checkSeedData();
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async checkSeedData() {
    const decks = await this.getAllDecks();
    if (decks.length === 0) {
      console.log('🌱 資料庫為空，自動載入範例牌組 (德語與日語)...');

      // 1. 德語基礎高頻單字牌組 (A1 必背)
      const germanDeckId = await this.addDeck({
        title: '德語基礎高頻單字 (A1 範例)',
        description: '自動色彩標記性別 (der藍/die紅/das綠)、支援德語發音與複數',
        color: '#FF9500'
      });

      const germanCards = [
        { front: 'der Apfel\n[die Äpfel]', back: '蘋果 (陽性名詞)', hint: 'Der Apfel ist rot und süß. (蘋果又紅又甜)' },
        { front: 'die Straße\n[die Straßen]', back: '街道、馬路 (陰性名詞)', hint: 'Ich wohne in dieser Straße. (我住在這條街上)' },
        { front: 'das Haus\n[die Häuser]', back: '房子、房屋 (中性名詞)', hint: 'Das Haus ist sehr groß. (這棟房子很大)' },
        { front: 'Guten Morgen', back: '早安 (問候語)', hint: 'Guten Morgen! Wie geht es Ihnen?' },
        { front: 'Danke schön', back: '非常感謝、多謝', hint: 'Vielen Dank für Ihre Hilfe!' },
        { front: 'sprechen\n[spricht / sprach]', back: '說話、講 (動詞)', hint: 'Ich spreche ein bisschen Deutsch. (我會說一點德文)' }
      ];

      for (const item of germanCards) {
        await this.addCard({
          deckId: germanDeckId,
          front: item.front,
          back: item.back,
          hint: item.hint,
          interval: 0,
          repetitions: 0,
          easeFactor: 2.5,
          nextReview: new Date().toISOString().split('T')[0]
        });
      }

      // 2. 日語實用單字牌組
      const jpDeckId = await this.addDeck({
        title: '日語實用單字 (N5~N4 範例)',
        description: '涵蓋日常生活常用單字與假名，支援發音與手勢',
        color: '#007AFF'
      });

      const jpCards = [
        { front: '食べる\n[たべる]', back: '吃 (動詞)', hint: '朝ごはんを食べる (吃早餐)' },
        { front: '飲む\n[のむ]', back: '喝 (動詞)', hint: '水を飲む (喝水)' },
        { front: '行く\n[いく]', back: '去 (動詞)', hint: '学校へ行く (去學校)' },
        { front: 'ありがとう', back: '謝謝 (感動/感謝)', hint: '日常最常用的客氣問候' },
        { front: '美味しい\n[おいしい]', back: '美味的、好吃的 (形容詞)', hint: 'このラーメンはとても美味しい' },
        { front: '猫\n[ねこ]', back: '貓 (名詞)', hint: '可愛い猫 (可愛的貓)' }
      ];

      for (const item of jpCards) {
        await this.addCard({
          deckId: jpDeckId,
          front: item.front,
          back: item.back,
          hint: item.hint,
          interval: 0,
          repetitions: 0,
          easeFactor: 2.5,
          nextReview: new Date().toISOString().split('T')[0]
        });
      }
    }
  }

  // --- Decks 操作 ---
  async getAllDecks() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('decks', 'readonly');
      const store = tx.objectStore('decks');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async addDeck(deckData) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('decks', 'readwrite');
      const store = tx.objectStore('decks');
      const req = store.add({
        ...deckData,
        createdAt: new Date().toISOString()
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteDeck(deckId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['decks', 'cards'], 'readwrite');
      const deckStore = tx.objectStore('decks');
      const cardStore = tx.objectStore('cards');

      deckStore.delete(Number(deckId));

      const cardIndex = cardStore.index('deckId');
      const cardReq = cardIndex.getAllKeys(Number(deckId));
      cardReq.onsuccess = () => {
        const keys = cardReq.result;
        keys.forEach(k => cardStore.delete(k));
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Cards 操作 ---
  async getCardsByDeck(deckId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cards', 'readonly');
      const store = tx.objectStore('cards');
      const index = store.index('deckId');
      const req = index.getAll(Number(deckId));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllCards() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cards', 'readonly');
      const store = tx.objectStore('cards');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async addCard(cardData) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      const req = store.add({
        ...cardData,
        createdAt: new Date().toISOString()
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async updateCard(card) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      const req = store.put(card);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteCard(cardId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      const req = store.delete(Number(cardId));
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- JSON 匯出與匯入功能 (解決靜態網站無伺服器儲存) ---
  async exportJSON() {
    const decks = await this.getAllDecks();
    const cards = await this.getAllCards();
    const backupData = {
      app: 'AppleAnkiReplica',
      version: 1,
      exportedAt: new Date().toISOString(),
      decks,
      cards
    };
    return JSON.stringify(backupData, null, 2);
  }

  async importJSON(jsonText, mode = 'merge') {
    try {
      const data = JSON.parse(jsonText);
      if (!data.decks || !data.cards) {
        throw new Error('無效的 JSON 檔案格式：缺少 decks 或 cards 欄位');
      }

      await this.init();

      if (mode === 'replace') {
        // 清空既有資料
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction(['decks', 'cards'], 'readwrite');
          tx.objectStore('decks').clear();
          tx.objectStore('cards').clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }

      // 匯入牌組與卡片（重新映射 ID 避免衝突）
      const idMap = new Map();

      for (const deck of data.decks) {
        const oldId = deck.id;
        const newDeck = { ...deck };
        delete newDeck.id;
        const newId = await this.addDeck(newDeck);
        idMap.set(oldId, newId);
      }

      for (const card of data.cards) {
        const newCard = { ...card };
        delete newCard.id;
        // 映射至新的牌組 ID
        if (idMap.has(card.deckId)) {
          newCard.deckId = idMap.get(card.deckId);
        }
        await this.addCard(newCard);
      }

      return {
        success: true,
        decksCount: data.decks.length,
        cardsCount: data.cards.length
      };
    } catch (err) {
      console.error('Import failed:', err);
      return { success: false, error: err.message };
    }
  }

  async clearAll() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['decks', 'cards'], 'readwrite');
      tx.objectStore('decks').clear();
      tx.objectStore('cards').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const db = new Database();
