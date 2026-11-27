/**
 * SRS (Spaced Repetition System) - SM-2 演算法模組
 * 參考開源標準: open-spaced-repetition/ts-fsrs 與 supermemo-2
 */

export const Rating = {
  AGAIN: 1, // 重來
  HARD: 2,  // 困難
  GOOD: 3,  // 良好
  EASY: 4   // 簡單
};

export const MAX_INTERVAL = 180; // 最大間隔天數天花板：180 天 (半年)

/**
 * 取得當前日期的 YYYY-MM-DD 字串
 */
export function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 增加指定天數並回傳 YYYY-MM-DD
 */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 計算複習後的卡片新狀態
 * @param {Object} card 卡片物件
 * @param {number} rating 評分 (1: Again, 2: Hard, 3: Good, 4: Easy)
 * @returns {Object} 更新後的間隔與複習日期
 */
export function scheduleCard(card, rating) {
  let interval = card.interval || 0;
  let repetitions = card.repetitions || 0;
  let easeFactor = card.easeFactor || 2.5;
  const today = getTodayDateString();

  if (rating === Rating.AGAIN) {
    // 忘記：重設複習次數，明天再次複習（在當日 session 會重新推入隊列）
    repetitions = 0;
    interval = 1;
    // 扣除難易係數
    easeFactor = Math.max(1.3, easeFactor - 0.2);
  } else {
    // 根據回饋計算新的 easeFactor (SM-2 標準公式)
    // EF' = EF + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
    // 將 1~4 對應到 grade 2~5
    const grade = rating + 1; // 2: Hard, 3: Good, 4: Easy -> 3, 4, 5
    easeFactor = easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
    easeFactor = Math.max(1.3, Math.min(3.0, easeFactor));

    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = rating === Rating.HARD ? 3 : 6;
    } else {
      if (rating === Rating.HARD) {
        interval = Math.max(1, Math.round(interval * 1.2));
      } else if (rating === Rating.GOOD) {
        interval = Math.round(interval * easeFactor);
      } else if (rating === Rating.EASY) {
        interval = Math.round(interval * easeFactor * 1.3);
      }
    }
    // 限制最大間隔天數天花板 (最多 180 天 / 半年)
    interval = Math.min(MAX_INTERVAL, interval);
    repetitions++;
  }

  const nextReview = addDays(today, interval);

  return {
    ...card,
    interval,
    repetitions,
    easeFactor: Number(easeFactor.toFixed(2)),
    nextReview,
    lastReviewed: today,
    updatedAt: new Date().toISOString(),
    lapses: rating === Rating.AGAIN ? (card.lapses || 0) + 1 : (card.lapses || 0)
  };
}

/**
 * 判斷卡片今日是否需要複習
 */
export function isCardDue(card) {
  if (!card.nextReview) return true;
  const today = getTodayDateString();
  return card.nextReview <= today;
}
