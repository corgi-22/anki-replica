/**
 * tts.js - Web Speech API 語音朗讀與觸覺震動 (Haptics)
 * 支援多國語言自動偵測：德文 (de-DE)、日文 (ja-JP)、英文 (en-US)、中文 (zh-TW)
 */

export function triggerHaptic(duration = 15) {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(duration);
    } catch (e) {
      // 忽略部分不支援或禁用的環境
    }
  }
}

/**
 * 自動判斷字串語言（德文、日文、英文、中文）
 */
export function detectLanguage(text) {
  // 1. 日文：包含平假名或片假名
  const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
  if (hasJapanese) return 'ja-JP';

  // 2. 中文：純中文字符（漢字且無日文假名）
  const hasChinese = /[\u4E00-\u9FFF]/.test(text);
  // 若含有德文字符或拉丁字母為主的句子，即便備註有中文字，正面題目若為德文仍應優先發音德文
  const hasGermanSpecialChars = /[äöüßÄÖÜ]/.test(text);
  const hasGermanArticles = /\b(der|die|das|dem|den|des|ein|eine|einen|einem|einer|eines|und|nicht|ist|sind|guten|morgen|tag|abend|danke|bitte|hallo|tschüss)\b/i.test(text);

  if (hasGermanSpecialChars || hasGermanArticles) {
    return 'de-DE';
  }

  // 3. 純中文
  if (hasChinese && !/[a-zA-Z]/.test(text)) {
    return 'zh-TW';
  }

  // 4. 預設拉丁字母：判斷英文
  return 'en-US';
}

/**
 * 朗讀文字
 * @param {string} text 要朗讀的文字
 * @param {string} [lang] 指定語言代碼 (可選，如 'de-DE', 'ja-JP', 'en-US')
 */
export function speakText(text, lang) {
  if (!('speechSynthesis' in window)) {
    console.warn('此瀏覽器不支援 Web Speech API');
    return;
  }

  // 清除前一次未播完的語音
  window.speechSynthesis.cancel();

  // 清洗文字（去掉中括號內的備註標音如 [die Äpfel]，避免朗讀重疊）
  const cleanText = text.replace(/\[.*?\]/g, '').trim();
  if (!cleanText) return;

  const targetLang = lang || detectLanguage(cleanText);
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = targetLang;
  utterance.rate = 0.9; // 略慢一點，更清晰適合語言學習
  utterance.pitch = 1.0;

  // 嘗試選取最匹配的語音庫 (若系統有德語/日語原生真人語音包)
  const voices = window.speechSynthesis.getVoices();
  const matchedVoice = voices.find(v => v.lang.startsWith(targetLang.slice(0, 2)));
  if (matchedVoice) {
    utterance.voice = matchedVoice;
  }

  window.speechSynthesis.speak(utterance);
  triggerHaptic(10);
}

