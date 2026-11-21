/**
 * Cloudflare Worker for Microsoft Edge Neural TTS
 * 支援 OpenAI 相容 API (/v1/audio/speech) 與標準 GET/POST /tts
 * 完美支援：德文 (de-DE)、繁體中文 (zh-TW)、日文 (ja-JP)、英文 (en-US)
 */

const WIN_EPOCH = 11644473600n;
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

// 預設各語言最優質的微軟神經網路音色
const DEFAULT_VOICES = {
  'de-DE': 'de-DE-KatjaNeural',      // 德語母語女聲（標準高地德語，廣播級）
  'zh-TW': 'zh-TW-HsiaoChenNeural',  // 台灣繁體中文（曉臻，自然溫和）
  'ja-JP': 'ja-JP-NanamiNeural',     // 日語女聲（七海，音調高低音準確）
  'en-US': 'en-US-JennyNeural'       // 美式英語女聲
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

/**
 * 計算微軟 Edge 朗讀協議所需的 Sec-MS-GEC 防偽金鑰 (v2 時間窗口算法)
 */
async function generateSecMsGec() {
  const unixSeconds = BigInt(Math.floor(Date.now() / 1000));
  let ticks = unixSeconds + WIN_EPOCH;
  ticks -= ticks % 300n; // 5分鐘時間窗口整除對齊
  ticks *= 10000000n;
  const strToHash = ticks.toString() + TRUSTED_CLIENT_TOKEN;

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(strToHash));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * 自動偵測文字語言
 */
function detectLang(text) {
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja-JP';
  if (/[äöüßÄÖÜ]/.test(text) || /\b(der|die|das|und|nicht|ist|sind|guten|morgen|danke|bitte)\b/i.test(text)) return 'de-DE';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh-TW';
  return 'en-US';
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

/**
 * 調用微軟 Edge WebSocket 合成語音並收集 MP3 二進制音訊
 */
async function synthesizeSpeech(text, voice) {
  const requestId = crypto.randomUUID().replace(/-/g, '');
  const secMsGec = await generateSecMsGec();

  const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-131.0.2903.86&ConnectionId=${requestId}`;

  const resp = await fetch(wsUrl, {
    headers: {
      'Upgrade': 'websocket',
      'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86'
    }
  });

  const ws = resp.webSocket;
  if (!ws) {
    throw new Error('無法與微軟 Edge 語音伺服器建立 WebSocket 連線');
  }

  ws.accept();

  return new Promise((resolve, reject) => {
    const audioChunks = [];
    const timeout = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(new Error('語音合成超時 (15秒)'));
    }, 15000);

    // 1. 發送音訊輸出格式設定
    const configMessage =
      `Content-Type:application/json; charset=utf-8\r\n` +
      `Path:speech.config\r\n\r\n` +
      `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;

    ws.send(configMessage);

    // 2. 發送 SSML 語音合成文字
    const lang = voice.split('-').slice(0, 2).join('-');
    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
      `<voice name='${voice}'>${escapeXml(text)}</voice>` +
      `</speak>`;

    const ssmlMessage =
      `X-RequestId:${requestId}\r\n` +
      `Content-Type:application/ssml+xml\r\n` +
      `Path:ssml\r\n\r\n` +
      `${ssml}\r\n`;

    ws.send(ssmlMessage);

    ws.addEventListener('message', (event) => {
      const data = event.data;

      if (typeof data === 'string') {
        // 文字消息判定合成結束
        if (data.includes('Path:turn.end')) {
          clearTimeout(timeout);
          try { ws.close(); } catch (_) {}

          // 合併所有 MP3 音訊二進位區塊
          const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of audioChunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          resolve(merged);
        }
      } else if (data instanceof ArrayBuffer) {
        // 二進位音訊封包解析
        // 前 2 位元組表示標頭長度 (Big-Endian)
        const view = new DataView(data);
        if (data.byteLength > 2) {
          const headerLength = view.getUint16(0);
          // 真正的 MP3 音訊本體緊接在標頭之後
          const audioBodyOffset = 2 + headerLength;
          if (data.byteLength > audioBodyOffset) {
            const chunk = new Uint8Array(data.slice(audioBodyOffset));
            audioChunks.push(chunk);
          }
        }
      }
    });

    ws.addEventListener('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket 傳輸錯誤: ${err.message || '未知錯誤'}`));
    });

    ws.addEventListener('close', () => {
      clearTimeout(timeout);
      if (audioChunks.length > 0) {
        const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of audioChunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        resolve(merged);
      }
    });
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 健康檢查端點
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'Microsoft Edge Neural TTS Worker',
        supportedLangs: ['de-DE', 'zh-TW', 'ja-JP', 'en-US'],
        usage: {
          get: '/tts?text=Guten+Tag&voice=de-DE-KatjaNeural',
          post: '/tts (Body: {"text": "...", "voice": "..."})',
          openai: '/v1/audio/speech (Body: {"input": "...", "voice": "..."})'
        }
      }, null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
      });
    }

    try {
      let text = '';
      let voice = '';

      if (request.method === 'GET' && url.pathname === '/tts') {
        text = url.searchParams.get('text') || '';
        voice = url.searchParams.get('voice') || '';
      } else if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        text = body.text || body.input || '';
        voice = body.voice || '';
      }

      if (!text || !text.trim()) {
        return new Response(JSON.stringify({ error: '請提供 text 或 input 參數' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }

      // 如果未明確指定音色，自動依文字語言匹配最佳音色
      if (!voice) {
        const detected = detectLang(text);
        voice = DEFAULT_VOICES[detected] || DEFAULT_VOICES['en-US'];
      }

      const mp3Buffer = await synthesizeSpeech(text.trim(), voice);

      return new Response(mp3Buffer, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
          ...CORS_HEADERS
        }
      });
    } catch (err) {
      console.error('TTS error:', err);
      return new Response(JSON.stringify({ error: err.message || '語音合成失敗' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }
  }
};
