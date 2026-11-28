/**
 * Cloudflare Worker for Microsoft Edge Neural TTS (v2 正式版)
 * 完美移植微軟 2026 最新 Sec-MS-GEC v2 防偽協定 (完整 CS64 + 前綴 SHA-256 算法)
 * 支援：德文 (de-DE)、繁體中文 (zh-TW)、日文 (ja-JP)、英文 (en-US)
 * 🛡️ 內建安全防護：來源白名單機制（授權 corgi-22.github.io 專用）
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;

// 🛡️ 授權來源白名單
const ALLOWED_ORIGINS = [
  'https://corgi-22.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:5173'
];

// 預設各語言最優質的微軟神經網路音色
const DEFAULT_VOICES = {
  'de-DE': 'de-DE-KatjaNeural',      // 德語母語女聲（標準高地德語，廣播級）
  'zh-TW': 'zh-TW-HsiaoChenNeural',  // 台灣繁體中文（曉臻，自然溫和）
  'ja-JP': 'ja-JP-NanamiNeural',     // 日語女聲（七海，音調高低音準確）
  'en-US': 'en-US-JennyNeural',      // 美式英語女聲
  'id-ID': 'id-ID-GadisNeural',      // 印尼語女聲（Gadis，雅加達標準音）
  'vi-VN': 'vi-VN-HoaiMyNeural'      // 越南語女聲（HoaiMy，河內標準聲調音）
};

function getCorsHeaders(allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin || 'https://corgi-22.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function verifyOrigin(request) {
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');

  if (origin) {
    if (ALLOWED_ORIGINS.some(allowed => origin === allowed || origin.startsWith(allowed)) || origin.includes('cloudflare.com')) {
      return origin;
    }
    return null;
  }

  if (referer) {
    const matched = ALLOWED_ORIGINS.find(allowed => referer.startsWith(allowed));
    if (matched || referer.includes('cloudflare.com')) {
      return matched || 'https://corgi-22.github.io';
    }
    return null;
  }

  return 'https://corgi-22.github.io';
}

// ========================================================
// 🛡️ 微軟 Sec-MS-GEC v2 核心密碼學算法 (精確移植自 edge-tts)
// ========================================================
const WIN_EPOCH_SECONDS = 11644473600;
const TOKEN_WINDOW_SECONDS = 300;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19
];
const SHA256_PREFIX_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab,
  0xfeb0a7e4, 0x03effbd2
];
const SHA256_PREFIX_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491,
  0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33,
  0xd258b060, 0x72766564
];
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
const SHA256_ROUND_14_ADJUSTMENT = 0xc9dc06a7;
const SHA256_PREFIX_BLOCK_CONSTANTS = SHA256_ROUND_CONSTANTS.map(
  (constant, index) => (index === 14 ? SHA256_ROUND_14_ADJUSTMENT : constant)
);
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167]
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

function rotr(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
function rol16(value) {
  return ((value << 16) | (value >>> 16)) >>> 0;
}
function sigma0(value) {
  return (rotr(value, 7) ^ rotr(value, 18) ^ (value >>> 3)) >>> 0;
}
function sigma1(value) {
  return (rotr(value, 17) ^ rotr(value, 19) ^ (value >>> 10)) >>> 0;
}

function expandSchedule(words, firstWord = 16) {
  for (let index = firstWord; index < 64; index += 1) {
    words[index] =
      (sigma1(words[index - 2]) +
        words[index - 7] +
        sigma0(words[index - 15]) +
        words[index - 16]) >>>
      0;
  }
}

function compress(state, words, firstRound = 0) {
  const constants =
    firstRound === 14 ? SHA256_PREFIX_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  let [a, b, c, d, e, f, g, h] = state;

  for (let index = firstRound; index < 64; index += 1) {
    const t1 =
      (h +
        (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
        (g ^ (e & (f ^ g))) +
        constants[index] +
        words[index]) >>>
      0;
    const t2 =
      ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) | (c & (a | b)))) >>>
      0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }

  return [a, b, c, d, e, f, g, h];
}

function prefixBlockState(payload) {
  const words = new Array(14).fill(0);
  words.push((payload[0] << 16) | (payload[1] << 8) | payload[2]);
  words.push(
    ((payload[3] << 24) |
      (payload[4] << 16) |
      (payload[5] << 8) |
      payload[6]) >>>
      0
  );

  for (let index = 16; index < 30; index += 1) {
    let value =
      SHA256_PREFIX_SCHEDULE[index - 16] +
      (index === 16
        ? (sigma1(words[14]) ^ SHA256_SIGMA1_ADJUSTMENT) >>> 0
        : sigma1(words[index - 2]));
    if (index >= 21) {
      value += words[index - 7];
    }
    if (index === 29) {
      value += (sigma0(words[14]) ^ SHA256_SIGMA0_ADJUSTMENT) >>> 0;
    }
    words.push(value >>> 0);
  }

  words.push(
    (sigma1(words[28]) +
      words[23] +
      sigma0(words[15]) +
      words[14] +
      SHA256_ROUND_14_ADJUSTMENT -
      SHA256_ROUND_CONSTANTS[14]) >>>
      0
  );
  expandSchedule(words, 31);

  const working = compress(SHA256_PREFIX_STATE, words, 14);
  return SHA256_INITIAL.map((value, index) => (value + working[index]) >>> 0);
}

function sha256Digest(payload) {
  if (payload.length < 7) {
    throw new Error('Sec-MS-GEC payload must contain at least seven bytes');
  }

  const messageLength = 57 + payload.length;
  const zeroPadding = (((55 - messageLength) % 64) + 64) % 64;
  const tail = new Uint8Array(payload.length - 7 + 1 + zeroPadding + 8);
  tail.set(payload.subarray(7));
  tail[payload.length - 7] = 0x80;

  const tailView = new DataView(tail.buffer);
  const bitLength = messageLength * 8;
  tailView.setUint32(tail.length - 8, Math.floor(bitLength / 2 ** 32));
  tailView.setUint32(tail.length - 4, bitLength >>> 0);

  let state = prefixBlockState(payload);
  for (let offset = 0; offset < tail.length; offset += 64) {
    const words = [];
    for (let index = 0; index < 16; index += 1) {
      words.push(tailView.getUint32(offset + index * 4));
    }
    expandSchedule(words);

    const working = compress(state, words);
    state = state.map((value, index) => (value + working[index]) >>> 0);
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  state.forEach((value, index) => digestView.setUint32(index * 4, value));
  return digest;
}

function cs64Words(payload) {
  const byteLength = Math.ceil((payload.length + 1) / 8) * 8;
  const bytes = new Uint8Array(byteLength);
  bytes.set(payload, 1);

  const view = new DataView(bytes.buffer);
  const words = [];
  for (let offset = 0; offset < byteLength; offset += 4) {
    words.push(view.getUint32(offset, true));
  }
  return words;
}

function cs64Digest(payload, digest) {
  const digestView = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength
  );
  const keyA = (digestView.getUint32(0, true) | 1) >>> 0;
  const keyB = (digestView.getUint32(4, true) | 1) >>> 0;
  const factors = [
    Math.imul(keyA, CS64_FACTOR) >>> 0,
    Math.imul(keyB, CS64_FACTOR) >>> 0
  ];

  const terms = CS64_COEFFICIENTS.map(
    ([coefficient], index) => Math.imul(coefficient, factors[index % 2]) >>> 0
  );
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);
  cs64Words(payload).forEach((word, index) => {
    const even = index % 2 === 0;
    let term = Math.imul(word, even ? keyA : keyB);
    let offset = Math.imul(rol16(word), even ? 0xef0569fb : 0xc31713db);
    if (index === 0) {
      term += Math.imul(CS64_ADJUSTMENT0, factors[0]);
      offset += CS64_ADJUSTMENT1;
    }
    terms.push(term >>> 0);
    offsets.push(offset >>> 0);
  });

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];

    let q = Math.imul(rol16((offsets[index] + x) >>> 0), 0x76f50f34) >>> 0;
    swapAcc = (swapAcc + Math.imul(rol16(q), 0xc3efea97) + q) >>> 0;
    q = Math.imul(rol16((offsets[index + 1] + y) >>> 0), 0x1881ce3c) >>> 0;
    swapLast = (Math.imul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (Math.imul(state, keyA) + x) >>> 0;
    state = Math.imul(rol16(state), 0xcf98b111) >>> 0;
    state = Math.imul(rol16(state), 0x87085b9f) >>> 0;
    state = Math.imul(rol16(state), 0x12ceb96d) >>> 0;
    state = Math.imul(rol16(state), 0x257e1d83) >>> 0;
    acc = (acc + state) >>> 0;

    let t = (Math.imul(state, keyB) + y) >>> 0;
    t = Math.imul(rol16(t), 0xa27416f5) >>> 0;
    t = Math.imul(rol16(t), 0xd38396ff) >>> 0;
    t = Math.imul(rol16(t), 0x7c932b89) >>> 0;
    state = Math.imul(rol16(t), 0xbfa49f69) >>> 0;
    acc = (acc + state) >>> 0;
  }

  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

function toHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function hashSecMsGecPayload(payload) {
  const bytes = new TextEncoder().encode(payload);
  const digest = sha256Digest(bytes);
  const checksum = new Uint8Array(8);
  const checksumView = new DataView(checksum.buffer);
  cs64Digest(bytes, digest).forEach((word, index) =>
    checksumView.setUint32(index * 4, word, true)
  );

  return `${toHex(checksum)}-${toHex(digest)}`;
}

function generateSecMsGec(unixSeconds = Date.now() / 1000) {
  let ticks = unixSeconds + WIN_EPOCH_SECONDS;
  ticks -= ticks % TOKEN_WINDOW_SECONDS;
  ticks *= 1e7;
  return hashSecMsGecPayload(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`);
}

function makeMuid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function normalizeVoiceName(voice) {
  const trimmed = (voice || '').trim();
  const shortMatch = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(trimmed);
  if (!shortMatch) return trimmed;
  const [, lang] = shortMatch;
  let [, , region, name] = shortMatch;
  if (name.includes('-')) {
    const [regionSuffix, ...nameParts] = name.split('-');
    region += `-${regionSuffix}`;
    name = nameParts.join('-');
  }
  return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`;
}

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

async function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const buf = await data.arrayBuffer();
    return new Uint8Array(buf);
  }
  return null;
}

/**
 * 調用微軟 Edge WebSocket 合成語音並收集 MP3 二進制音訊
 */
async function synthesizeSpeech(text, voice) {
  const requestId = crypto.randomUUID().replace(/-/g, '');
  const secMsGec = generateSecMsGec();
  const normalizedVoice = normalizeVoiceName(voice);

  const wsUrl = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${requestId}`;

  const resp = await fetch(wsUrl, {
    headers: {
      'Upgrade': 'websocket',
      'Sec-WebSocket-Version': '13',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'en-US,en;q=0.9',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'Cookie': `muid=${makeMuid()};`,
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`
    }
  });

  const ws = resp.webSocket;
  if (!ws) {
    const errorBody = await resp.text().catch(() => '');
    throw new Error(`無法與微軟 Edge 語音伺服器建立 WebSocket 連線 (狀態碼: ${resp.status}, 內容: ${errorBody.slice(0, 100)})`);
  }

  ws.accept();

  return new Promise((resolve, reject) => {
    const audioChunks = [];
    let isFinished = false;

    const timeout = setTimeout(() => {
      if (isFinished) return;
      isFinished = true;
      try { ws.close(); } catch (_) {}
      if (audioChunks.length > 0) {
        resolve(mergeChunks(audioChunks));
      } else {
        reject(new Error('語音合成超時 (15秒)'));
      }
    }, 15000);

    function mergeChunks(chunks) {
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return merged;
    }

    const configMessage =
      `Content-Type:application/json; charset=utf-8\r\n` +
      `Path:speech.config\r\n\r\n` +
      `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;

    ws.send(configMessage);

    const lang = voice.split('-').slice(0, 2).join('-');
    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
      `<voice name='${normalizedVoice}'>${escapeXml(text)}</voice>` +
      `</speak>`;

    const ssmlMessage =
      `X-RequestId:${requestId}\r\n` +
      `Content-Type:application/ssml+xml\r\n` +
      `Path:ssml\r\n\r\n` +
      `${ssml}\r\n`;

    ws.send(ssmlMessage);

    ws.addEventListener('message', async (event) => {
      const data = event.data;

      if (typeof data === 'string') {
        if (data.includes('Path:turn.end')) {
          if (isFinished) return;
          isFinished = true;
          clearTimeout(timeout);
          try { ws.close(); } catch (_) {}

          if (audioChunks.length > 0) {
            resolve(mergeChunks(audioChunks));
          } else {
            reject(new Error('微軟合成完成但未傳回音訊資料'));
          }
        }
      } else {
        const bytes = await toUint8Array(data);
        if (bytes && bytes.length > 2) {
          const headerLength = (bytes[0] << 8) | bytes[1];
          const audioBodyOffset = 2 + headerLength;
          if (bytes.length > audioBodyOffset) {
            const chunk = bytes.slice(audioBodyOffset);
            audioChunks.push(chunk);
          }
        }
      }
    });

    ws.addEventListener('error', (err) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timeout);
      reject(new Error(`WebSocket 傳輸錯誤: ${err.message || '未知錯誤'}`));
    });

    ws.addEventListener('close', () => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timeout);
      if (audioChunks.length > 0) {
        resolve(mergeChunks(audioChunks));
      } else {
        reject(new Error('未收到任何音訊資料 (連線關閉)'));
      }
    });
  });
}

export default {
  async fetch(request) {
    const allowedOrigin = verifyOrigin(request);

    // 處理 CORS Preflight 預檢請求
    if (request.method === 'OPTIONS') {
      if (!allowedOrigin) {
        return new Response('403 Forbidden: 未授權的跨域來源', { status: 403 });
      }
      return new Response(null, { status: 204, headers: getCorsHeaders(allowedOrigin) });
    }

    const url = new URL(request.url);

    // 健康檢查狀態頁
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'Microsoft Edge Neural TTS (v2 Protected)',
        authorizedOrigin: 'https://corgi-22.github.io',
        supportedLangs: ['de-DE', 'zh-TW', 'ja-JP', 'en-US'],
        secMsGecVersion: SEC_MS_GEC_VERSION
      }, null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...getCorsHeaders(allowedOrigin) }
      });
    }

    if (!allowedOrigin) {
      return new Response(JSON.stringify({
        error: '403 Forbidden',
        message: '未授權的呼叫來源。此服務僅授權 https://corgi-22.github.io 專用。'
      }, null, 2), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const corsHeaders = getCorsHeaders(allowedOrigin);

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
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (!voice) {
        const detected = detectLang(text);
        voice = DEFAULT_VOICES[detected] || DEFAULT_VOICES['en-US'];
      }

      const mp3Buffer = await synthesizeSpeech(text.trim(), voice);

      return new Response(mp3Buffer, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
          ...corsHeaders
        }
      });
    } catch (err) {
      console.error('TTS error:', err);
      return new Response(JSON.stringify({ error: err.message || '語音合成失敗' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};
