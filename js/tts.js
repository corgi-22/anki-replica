/**
 * tts.js - 高品質語音引擎模組 (支援微軟 Edge Neural TTS 與本地原生備援)
 * 整合：
 * 1. 方案 1：微軟神經網路語音 (Cloudflare Worker 代理 + IndexedDB 永久音訊離線快取)
 * 2. 方案 2：原生 Web Speech API 自動備援 (若離線或未設定 Worker 網址)
 */

import { db } from './db.js';

export function triggerHaptic(duration = 15) {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(duration);
    } catch (e) {
      // 忽略不支援環境
    }
  }
}

// 預設各語言最優質微軟神經網路音色
export const EDGE_VOICES = {
  'de-DE': 'de-DE-KatjaNeural',      // 德語母語女聲 (廣播級)
  'zh-TW': 'zh-TW-HsiaoChenNeural',  // 台灣繁中 (曉臻，自然柔和)
  'ja-JP': 'ja-JP-NanamiNeural',     // 日語女聲 (七海，音調高低音準確)
  'en-US': 'en-US-JennyNeural'       // 美式英語
};

/**
 * 自動判斷字串語言（德文、日文、繁中、英文）
 */
export function detectLanguage(text) {
  // 1. 日文：包含平假名或片假名
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja-JP';

  // 2. 德文：專有變音字符 (ä, ö, ü, ß) 或常見冠詞詞彙
  const hasGermanSpecialChars = /[äöüßÄÖÜ]/.test(text);
  const hasGermanArticles = /\b(der|die|das|dem|den|des|ein|eine|einen|einem|einer|eines|und|nicht|ist|sind|guten|morgen|tag|abend|danke|bitte|hallo|tschüss)\b/i.test(text);
  if (hasGermanSpecialChars || hasGermanArticles) {
    return 'de-DE';
  }

  // 3. 純繁體/通用中文 (漢字且無英文)
  if (/[\u4E00-\u9FFF]/.test(text) && !/[a-zA-Z]/.test(text)) {
    return 'zh-TW';
  }

  // 4. 拉丁字母預設：英文
  return 'en-US';
}

let currentAudio = null;

/**
 * 原生瀏覽器 Web Speech API 發音（備援機制）
 */
function speakNative(cleanText, targetLang) {
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = targetLang;
  utterance.rate = 0.9;
  utterance.pitch = 1.0;

  // 優先選取高品質/自然音色
  const voices = window.speechSynthesis.getVoices();
  const matchedVoice = voices.find(v =>
    v.lang.startsWith(targetLang.slice(0, 2)) &&
    (v.name.includes('Siri') || v.name.includes('Enhanced') || v.name.includes('Natural') || v.name.includes('Google'))
  ) || voices.find(v => v.lang.startsWith(targetLang.slice(0, 2)));

  if (matchedVoice) {
    utterance.voice = matchedVoice;
  }

  window.speechSynthesis.speak(utterance);
}

/**
 * 核心朗讀入口（支援 Cloudflare Edge TTS + 本地 IndexedDB 音訊快取）
 * @param {string} text 要朗讀的文字
 * @param {string} [lang] 指定語言代碼 (選填)
 */
export async function speakText(text, lang) {
  triggerHaptic(10);

  // 清洗文字（去掉中括號內的假名或複數標記，例如 [たべる]、[die Äpfel]）
  const cleanText = text.replace(/\[.*?\]/g, '').trim();
  if (!cleanText) return;

  const targetLang = lang || detectLanguage(cleanText);
  const workerUrl = (localStorage.getItem('tts-worker-url') || '').trim().replace(/\/+$/, '');
  const isEdgeEnabled = localStorage.getItem('tts-engine') !== 'native';

  // 停止前一個正在播放的音訊
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  // 若使用者已設定 Cloudflare Worker 且未關閉 Edge TTS
  if (isEdgeEnabled && workerUrl) {
    const voice = EDGE_VOICES[targetLang] || EDGE_VOICES['en-US'];
    const cacheKey = `${voice}:${cleanText}`;

    try {
      // 1. 檢查 IndexedDB 本地快取 (0 毫秒、完全離線可用)
      const cachedBlob = await db.getAudio(cacheKey);
      if (cachedBlob) {
        const audioUrl = URL.createObjectURL(cachedBlob);
        currentAudio = new Audio(audioUrl);
        currentAudio.play();
        return;
      }

      // 2. 本地無快取，向 Cloudflare Worker 請求微軟神經網路語音
      const fetchUrl = `${workerUrl}/tts?text=${encodeURIComponent(cleanText)}&voice=${encodeURIComponent(voice)}`;
      const response = await fetch(fetchUrl);

      if (!response.ok) {
        throw new Error(`Worker HTTP ${response.status}`);
      }

      const audioBlob = await response.blob();

      // 3. 永久儲存至 IndexedDB 快取
      await db.saveAudio(cacheKey, audioBlob);

      // 4. 立即播放
      const audioUrl = URL.createObjectURL(audioBlob);
      currentAudio = new Audio(audioUrl);
      currentAudio.play();
      return;
    } catch (err) {
      console.warn('⚠️ Edge TTS 遠端請求失敗或斷網，自動降級切換至原生語音:', err.message);
      // 降級切換為原生 Web Speech API
      speakNative(cleanText, targetLang);
      return;
    }
  }

  // 預設或未配置 Worker 時使用原生 Web Speech API
  speakNative(cleanText, targetLang);
}
