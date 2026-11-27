/**
 * db.js - 原生 IndexedDB 封裝模組
 * 零依賴、純非同步，支援大容量本機儲存、UUID 雙向增量同步與智慧合併 (CRDT / Last-Write-Wins)
 */

const DB_NAME = 'AppleAnkiLocalDB';
const DB_VERSION = 2;

/**
 * 跨環境全相容 UUID v4 產生器
 */
export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch (_) {}
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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

        // 設定與同步狀態表 (儲存 tombstones、使用者偏好)
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // 高品質語音音訊快取表 (MP3 Blobs)
        if (!db.objectStoreNames.contains('audioCache')) {
          db.createObjectStore('audioCache', { keyPath: 'key' });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        await this.checkSeedData();
        await this.ensureUuids();
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 平滑無損遷移：確保本機所有現存牌組與卡片皆具備全域唯一 UUID 與更新時間戳記
   * 絕不清空、不重置、不遺失任何已存在單字與複習進度
   */
  async ensureUuids() {
    if (!this.db) return;

    const decks = await this.getAllDecks();
    const idToDeckUuid = new Map();
    const now = new Date().toISOString();

    for (const deck of decks) {
      let changed = false;
      if (!deck.uuid) {
        deck.uuid = generateUUID();
        changed = true;
      }
      if (!deck.updatedAt) {
        deck.updatedAt = deck.createdAt || now;
        changed = true;
      }
      if (changed) {
        await this.rawPutDeck(deck);
      }
      idToDeckUuid.set(deck.id, deck.uuid);
    }

    const cards = await this.getAllCards();
    for (const card of cards) {
      let changed = false;
      if (!card.uuid) {
        card.uuid = generateUUID();
        changed = true;
      }
      if (!card.deckUuid && idToDeckUuid.has(card.deckId)) {
        card.deckUuid = idToDeckUuid.get(card.deckId);
        changed = true;
      }
      if (!card.updatedAt) {
        card.updatedAt = card.lastReviewed ? `${card.lastReviewed}T00:00:00.000Z` : (card.createdAt || now);
        changed = true;
      }
      if (changed) {
        await this.rawPutCard(card);
      }
    }
  }

  async checkSeedData() {
    const decks = await this.getAllDecks();
    if (decks.length === 0) {
      console.log('🌱 資料庫為空，自動載入範例牌組 (德語與日語)...');

      // 1. 德語基礎高頻單字牌組 (A1 必背)
      const germanDeckId = await this.addDeck({
        title: '德語基礎高頻單字 (A1 範例)',
        description: '自動色彩標記性別 (der藍/die紅/das綠)、支援德語發音與複數',
        color: '#FF9500',
        lang: 'de-DE'
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
        color: '#007AFF',
        lang: 'ja-JP'
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

  async getDeck(deckId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('decks', 'readonly');
      const store = tx.objectStore('decks');
      const req = store.get(Number(deckId));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async addDeck(deckData) {
    await this.init();
    const now = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('decks', 'readwrite');
      const store = tx.objectStore('decks');
      const req = store.add({
        uuid: deckData.uuid || generateUUID(),
        lang: 'auto',
        ...deckData,
        createdAt: deckData.createdAt || now,
        updatedAt: deckData.updatedAt || now
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async updateDeck(deckData) {
    await this.init();
    const now = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('decks', 'readwrite');
      const store = tx.objectStore('decks');
      const req = store.put({
        uuid: deckData.uuid || generateUUID(),
        ...deckData,
        updatedAt: now
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async rawPutDeck(deckData) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('decks', 'readwrite');
      const store = tx.objectStore('decks');
      const req = store.put(deckData);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteDeck(deckId) {
    await this.init();
    const deck = await this.getDeck(deckId);
    const cards = await this.getCardsByDeck(deckId);

    // 寫入墓碑 (Tombstones)，確保同步至其他裝置時能正確同步刪除動作
    if (deck?.uuid) {
      await this.recordTombstone('decks', deck.uuid);
    }
    for (const card of cards) {
      if (card.uuid) {
        await this.recordTombstone('cards', card.uuid);
      }
    }

    return this.rawDeleteDeck(deckId);
  }

  async rawDeleteDeck(deckId) {
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

  async getCard(cardId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cards', 'readonly');
      const store = tx.objectStore('cards');
      const req = store.get(Number(cardId));
      req.onsuccess = () => resolve(req.result || null);
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
    const now = new Date().toISOString();
    let deckUuid = cardData.deckUuid;
    if (!deckUuid && cardData.deckId) {
      const deck = await this.getDeck(cardData.deckId);
      if (deck?.uuid) deckUuid = deck.uuid;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      const req = store.add({
        uuid: cardData.uuid || generateUUID(),
        deckUuid: deckUuid || '',
        ...cardData,
        createdAt: cardData.createdAt || now,
        updatedAt: cardData.updatedAt || now
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async updateCard(card) {
    await this.init();
    const now = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      const req = store.put({
        uuid: card.uuid || generateUUID(),
        ...card,
        updatedAt: card.updatedAt || now
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async rawPutCard(cardData) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      const req = store.put(cardData);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteCard(cardId) {
    await this.init();
    const card = await this.getCard(cardId);
    if (card?.uuid) {
      await this.recordTombstone('cards', card.uuid);
    }
    return this.rawDeleteCard(cardId);
  }

  async rawDeleteCard(cardId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      const req = store.delete(Number(cardId));
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Tombstones (刪除墓碑) 追蹤機制 ---
  async getTombstones() {
    await this.init();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get('sync_tombstones');
        req.onsuccess = () => {
          const val = req.result?.value;
          resolve({
            decks: val?.decks || {},
            cards: val?.cards || {}
          });
        };
        req.onerror = () => resolve({ decks: {}, cards: {} });
      } catch (_) {
        resolve({ decks: {}, cards: {} });
      }
    });
  }

  async saveTombstones(tombstones) {
    await this.init();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const req = store.put({
          key: 'sync_tombstones',
          value: {
            decks: tombstones.decks || {},
            cards: tombstones.cards || {}
          }
        });
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async recordTombstone(type, uuid) {
    if (!uuid) return;
    const tombstones = await this.getTombstones();
    if (!tombstones[type]) tombstones[type] = {};
    tombstones[type][uuid] = new Date().toISOString();
    await this.saveTombstones(tombstones);
  }

  // --- 高品質語音快取操作 ---
  async getAudio(key) {
    await this.init();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('audioCache', 'readonly');
        const store = tx.objectStore('audioCache');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async saveAudio(key, blob) {
    await this.init();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('audioCache', 'readwrite');
        const store = tx.objectStore('audioCache');
        const req = store.put({ key, blob, createdAt: Date.now() });
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async getAudioCacheCount() {
    await this.init();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('audioCache', 'readonly');
        const store = tx.objectStore('audioCache');
        const req = store.count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      } catch (e) {
        resolve(0);
      }
    });
  }

  async clearAudioCache() {
    await this.init();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('audioCache', 'readwrite');
        const store = tx.objectStore('audioCache');
        store.clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  // --- 雙向智慧同步資料匯出與 Last-Write-Wins 合併 (Zero-Data-Loss CRDT) ---
  async exportSyncData() {
    await this.ensureUuids();
    const decks = await this.getAllDecks();
    const cards = await this.getAllCards();
    const tombstones = await this.getTombstones();

    return {
      app: 'AppleAnkiReplica',
      version: 3,
      exportedAt: new Date().toISOString(),
      decks,
      cards,
      tombstones
    };
  }

  /**
   * 雙向增量智慧合併演算法 (Two-Way Incremental Merge with Tombstones)
   * 規則：
   * 1. 聯集兩端的刪除墓碑，確保已被刪除的卡片不會被舊備份復活
   * 2. 牌組與卡片以 UUID 為唯一識別元；若有衝突，以 updatedAt 最新者獲勝 (Last-Write-Wins)
   * 3. 雲端有的本機沒有 -> 寫入本機
   * 4. 本機有的雲端沒有 -> 保留本機並納入輸出，絕不抹除
   * 5. 兩端皆有的最新進度 -> 智慧更新本機
   * 6. 回傳最終合併後完整資料集，供直接回寫至雲端，達成雙向 100% 一致性
   */
  async mergeSyncData(cloudPayload) {
    if (!cloudPayload || typeof cloudPayload !== 'object') {
      throw new Error('雲端同步資料格式錯誤');
    }

    await this.ensureUuids();

    const localDecks = await this.getAllDecks();
    const localCards = await this.getAllCards();
    const localTombstones = await this.getTombstones();

    // 1. 合併墓碑記錄
    const mergedTombstones = {
      decks: { ...(localTombstones.decks || {}) },
      cards: { ...(localTombstones.cards || {}) }
    };
    const cloudDeckTombs = cloudPayload.tombstones?.decks || {};
    for (const [uuid, time] of Object.entries(cloudDeckTombs)) {
      if (!mergedTombstones.decks[uuid] || time > mergedTombstones.decks[uuid]) {
        mergedTombstones.decks[uuid] = time;
      }
    }
    const cloudCardTombs = cloudPayload.tombstones?.cards || {};
    for (const [uuid, time] of Object.entries(cloudCardTombs)) {
      if (!mergedTombstones.cards[uuid] || time > mergedTombstones.cards[uuid]) {
        mergedTombstones.cards[uuid] = time;
      }
    }

    // 2. 處理牌組合併
    const localDeckByUuid = new Map(localDecks.map(d => [d.uuid, d]));
    const localDeckByTitle = new Map(localDecks.map(d => [d.title, d]));
    const rawCloudDecks = Array.isArray(cloudPayload.decks) ? cloudPayload.decks : [];

    // 相容性處理：若雲端牌組缺少 UUID，嘗試用標題媒合或分配 UUID
    const cloudDecks = rawCloudDecks.map(cd => {
      let uuid = cd.uuid;
      if (!uuid) {
        if (localDeckByTitle.has(cd.title)) {
          uuid = localDeckByTitle.get(cd.title).uuid;
        } else {
          uuid = generateUUID();
        }
      }
      return {
        ...cd,
        uuid,
        updatedAt: cd.updatedAt || cd.createdAt || new Date(0).toISOString()
      };
    });

    const cloudDeckByUuid = new Map(cloudDecks.map(d => [d.uuid, d]));
    const allDeckUuids = new Set([...localDeckByUuid.keys(), ...cloudDeckByUuid.keys()]);

    for (const deckUuid of allDeckUuids) {
      const delTime = mergedTombstones.decks[deckUuid];
      const localD = localDeckByUuid.get(deckUuid);
      const cloudD = cloudDeckByUuid.get(deckUuid);

      if (delTime) {
        const localTime = localD ? (localD.updatedAt || localD.createdAt || '') : '';
        const cloudTime = cloudD ? (cloudD.updatedAt || cloudD.createdAt || '') : '';
        if (delTime >= localTime && delTime >= cloudTime) {
          // 已在其中一端刪除，且無更新的修改
          if (localD) {
            await this.rawDeleteDeck(localD.id);
          }
          continue;
        }
      }

      // 未被刪除的牌組
      if (localD && cloudD) {
        const localTime = new Date(localD.updatedAt || localD.createdAt || 0).getTime();
        const cloudTime = new Date(cloudD.updatedAt || cloudD.createdAt || 0).getTime();
        if (cloudTime > localTime) {
          // 雲端進度較新，更新本機設定，但保留本機既有流水號 id
          await this.rawPutDeck({
            ...localD,
            ...cloudD,
            id: localD.id
          });
        }
      } else if (!localD && cloudD) {
        // 雲端有，本機沒有 -> 寫入本機
        const toAdd = { ...cloudD };
        delete toAdd.id;
        await this.addDeck(toAdd);
      }
      // 本機有，雲端沒有 -> 保留本機，稍後會透過 exportSyncData 回傳並上傳至雲端
    }

    // 重新取得本機最新牌組對照表 (供卡片 deckUuid 映射本地 deckId)
    const freshDecks = await this.getAllDecks();
    const deckUuidToLocalId = new Map(freshDecks.map(d => [d.uuid, d.id]));

    // 3. 處理卡片合併
    const localCardByUuid = new Map(localCards.map(c => [c.uuid, c]));
    const rawCloudCards = Array.isArray(cloudPayload.cards) ? cloudPayload.cards : [];

    // 相容性處理：若雲端卡片缺少 UUID 或 deckUuid
    const cloudCards = rawCloudCards.map(cc => {
      let uuid = cc.uuid;
      if (!uuid) {
        uuid = generateUUID();
      }
      return {
        ...cc,
        uuid,
        updatedAt: cc.updatedAt || (cc.lastReviewed ? `${cc.lastReviewed}T00:00:00.000Z` : (cc.createdAt || new Date(0).toISOString()))
      };
    });

    const cloudCardByUuid = new Map(cloudCards.map(c => [c.uuid, c]));
    const allCardUuids = new Set([...localCardByUuid.keys(), ...cloudCardByUuid.keys()]);

    for (const cardUuid of allCardUuids) {
      const delTime = mergedTombstones.cards[cardUuid];
      const localC = localCardByUuid.get(cardUuid);
      const cloudC = cloudCardByUuid.get(cardUuid);
      const targetDeckUuid = localC?.deckUuid || cloudC?.deckUuid;

      // 檢查所屬牌組是否已被刪除
      const isParentDeckDeleted = !targetDeckUuid || !deckUuidToLocalId.has(targetDeckUuid) || mergedTombstones.decks[targetDeckUuid];

      if (delTime || isParentDeckDeleted) {
        const localTime = localC ? (localC.updatedAt || localC.lastReviewed || '') : '';
        const cloudTime = cloudC ? (cloudC.updatedAt || cloudC.lastReviewed || '') : '';
        if (isParentDeckDeleted || (delTime >= localTime && delTime >= cloudTime)) {
          if (localC) {
            await this.rawDeleteCard(localC.id);
          }
          continue;
        }
      }

      // 卡片處於正常有效狀態
      if (localC && cloudC) {
        const localTime = new Date(localC.updatedAt || localC.lastReviewed || 0).getTime();
        const cloudTime = new Date(cloudC.updatedAt || cloudC.lastReviewed || 0).getTime();
        if (cloudTime > localTime) {
          // 雲端進度較新 (例如在其他裝置複習過或修改過題目/答案)
          const targetLocalDeckId = deckUuidToLocalId.get(cloudC.deckUuid) || localC.deckId;
          await this.rawPutCard({
            ...localC,
            ...cloudC,
            id: localC.id,
            deckId: targetLocalDeckId
          });
        }
      } else if (!localC && cloudC) {
        // 雲端有，本機沒有 -> 寫入本機
        const targetLocalDeckId = deckUuidToLocalId.get(cloudC.deckUuid);
        if (targetLocalDeckId) {
          const toAdd = {
            ...cloudC,
            deckId: targetLocalDeckId
          };
          delete toAdd.id;
          await this.addCard(toAdd);
        }
      }
      // 本機有，雲端沒有 -> 保留本機，稍後自動整合並同步至雲端
    }

    // 4. 儲存最新合併後的墓碑記錄
    await this.saveTombstones(mergedTombstones);

    // 5. 產出 100% 整合後的完整資料集
    return await this.exportSyncData();
  }

  // --- 本地 JSON 匯出與匯入功能 (單純檔案離線備份) ---
  async exportJSON() {
    return JSON.stringify(await this.exportSyncData(), null, 2);
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

      if (mode === 'merge' && data.version >= 3) {
        // 支援智慧增量合併
        const merged = await this.mergeSyncData(data);
        return {
          success: true,
          decksCount: merged.decks.length,
          cardsCount: merged.cards.length
        };
      }

      // 傳統匯入牌組與卡片（重新映射 ID 避免衝突）
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
      const tx = this.db.transaction(['decks', 'cards', 'settings'], 'readwrite');
      tx.objectStore('decks').clear();
      tx.objectStore('cards').clear();
      tx.objectStore('settings').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const db = new Database();
