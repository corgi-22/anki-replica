/**
 * gdrive.js - Google Drive 專屬 AppData 隱私雙向同步模組
 * 特點：
 * 1. 採用 Google 官方最新 Google Identity Services (GIS) Token 授權架構
 * 2. 存放於使用者的專屬應用程式資料夾 (drive.appdata)，絕不碰觸使用者其他個人檔案
 * 3. 0 伺服器費用，資料完全歸屬使用者個人 Google 雲端空間
 */

import { db } from './db.js';

export const GOOGLE_CLIENT_ID = '880702546985-i1rn7tnj1905o924h9svb8vdsq9muca9.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata email profile';
const BACKUP_FILENAME = 'anki_cloud_backup.json';

class GDriveSync {
  constructor() {
    this.tokenClient = null;
    this.accessToken = sessionStorage.getItem('gdrive_access_token') || null;
    this.tokenExpiry = Number(sessionStorage.getItem('gdrive_token_expiry') || 0);
    this.user = JSON.parse(localStorage.getItem('gdrive_user') || 'null');
    this.isInitialized = false;
  }

  /**
   * 初始化 Google GIS Token Client
   */
  async init() {
    if (this.isInitialized && this.tokenClient) return true;

    return new Promise((resolve) => {
      let attempts = 0;
      const checkSdk = () => {
        attempts++;
        if (window.google?.accounts?.oauth2) {
          try {
            this.tokenClient = window.google.accounts.oauth2.initTokenClient({
              client_id: GOOGLE_CLIENT_ID,
              scope: SCOPES,
              callback: () => {} // 動態綁定
            });
            this.isInitialized = true;
            resolve(true);
          } catch (err) {
            console.error('Google Token Client init error:', err);
            resolve(false);
          }
        } else if (attempts < 50) {
          setTimeout(checkSdk, 100);
        } else {
          console.warn('Google Identity Services SDK 載入超時');
          resolve(false);
        }
      };
      checkSdk();
    });
  }

  isLoggedIn() {
    return !!(this.accessToken && Date.now() < this.tokenExpiry && this.user);
  }

  getUser() {
    return this.user;
  }

  getLastSyncTime() {
    const timeStr = localStorage.getItem('gdrive_last_sync_time');
    if (!timeStr) return null;
    try {
      const date = new Date(timeStr);
      return date.toLocaleString('zh-TW', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return timeStr;
    }
  }

  /**
   * 登入 Google 帳號 (彈出授權視窗)
   */
  async signIn() {
    await this.init();
    if (!this.tokenClient) {
      throw new Error('Google SDK 尚未載入，請檢查網路連線或稍後再試。');
    }

    return new Promise((resolve, reject) => {
      this.tokenClient.callback = async (resp) => {
        if (resp.error) {
          console.error('Google Auth 回傳錯誤:', resp);
          reject(new Error(resp.error_description || resp.error));
          return;
        }

        this.accessToken = resp.access_token;
        // 有效期預設通常為 3600 秒 (1小時)
        const expiresIn = Number(resp.expires_in) || 3600;
        this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;

        sessionStorage.setItem('gdrive_access_token', this.accessToken);
        sessionStorage.setItem('gdrive_token_expiry', this.tokenExpiry);

        // 取得使用者個人基本資料 (姓名、Email、頭像)
        try {
          const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${this.accessToken}` }
          });
          if (userRes.ok) {
            this.user = await userRes.json();
            localStorage.setItem('gdrive_user', JSON.stringify(this.user));
          } else {
            this.user = { email: '已登入 Google 帳號', name: 'Google 使用者' };
            localStorage.setItem('gdrive_user', JSON.stringify(this.user));
          }
        } catch (e) {
          console.warn('獲取使用者資訊失敗:', e);
          this.user = { email: '已登入 Google 帳號', name: 'Google 使用者' };
          localStorage.setItem('gdrive_user', JSON.stringify(this.user));
        }

        resolve(this.user);
      };

      // 呼叫 Google 彈出登入視窗
      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /**
   * 登出 Google 帳號
   */
  signOut() {
    if (this.accessToken && window.google?.accounts?.oauth2) {
      try {
        window.google.accounts.oauth2.revoke(this.accessToken, () => {});
      } catch (_) {}
    }
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.user = null;
    sessionStorage.removeItem('gdrive_access_token');
    sessionStorage.removeItem('gdrive_token_expiry');
    localStorage.removeItem('gdrive_user');
  }

  /**
   * 確保取得有效的 Access Token (過期則要求重新授權)
   */
  async ensureValidToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }
    // Token 已過期或未登入，重新觸發登入
    await this.signIn();
    return this.accessToken;
  }

  /**
   * 搜尋 AppData 資料夾中是否已存在備份檔案
   */
  async findBackupFile() {
    const token = await this.ensureValidToken();
    const q = encodeURIComponent(`name='${BACKUP_FILENAME}' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,size)`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error(`查詢雲端檔案失敗: HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
  }

  /**
   * 上傳/同步本地資料庫至 Google Drive AppData
   */
  async uploadBackup() {
    const token = await this.ensureValidToken();
    const jsonStr = await db.exportJSON();
    const existingFile = await this.findBackupFile();

    const metadata = {
      name: BACKUP_FILENAME,
      mimeType: 'application/json'
    };

    if (!existingFile) {
      metadata.parents = ['appDataFolder'];
    }

    // Google Drive Multipart 格式
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      jsonStr +
      closeDelimiter;

    let uploadUrl;
    let method;

    if (existingFile) {
      uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`;
      method = 'PATCH';
    } else {
      uploadUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
      method = 'POST';
    }

    const res = await fetch(uploadUrl, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`上傳至 Google Drive 失敗: HTTP ${res.status} (${errText})`);
    }

    const result = await res.json();
    const now = new Date().toISOString();
    localStorage.setItem('gdrive_last_sync_time', now);
    return { success: true, fileId: result.id, syncTime: now };
  }

  /**
   * 從 Google Drive AppData 下載備份並還原至本機 IndexedDB
   */
  async downloadBackup(mode = 'replace') {
    const token = await this.ensureValidToken();
    const existingFile = await this.findBackupFile();

    if (!existingFile) {
      throw new Error('雲端硬碟尚未找到任何備份檔案，請先從本機上傳備份。');
    }

    const url = `https://www.googleapis.com/drive/v3/files/${existingFile.id}?alt=media`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error(`下載雲端備份失敗: HTTP ${res.status}`);
    }

    const jsonStr = await res.text();
    const importResult = await db.importJSON(jsonStr, mode);

    if (importResult.success) {
      const now = new Date().toISOString();
      localStorage.setItem('gdrive_last_sync_time', now);
      return {
        success: true,
        decksCount: importResult.decksCount,
        cardsCount: importResult.cardsCount,
        modifiedTime: existingFile.modifiedTime
      };
    } else {
      throw new Error(`解析雲端資料失敗: ${importResult.error}`);
    }
  }
}

export const gdrive = new GDriveSync();
