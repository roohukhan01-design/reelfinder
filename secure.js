// Sensitive data (API keys, Telegram session) goes into the Android Keystore-backed secure store.
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

export const secure = {
  async get(key) { try { return await SecureStorage.get(key); } catch { return null; } },
  async set(key, value) { await SecureStorage.set(key, String(value)); },
  async remove(key) { try { await SecureStorage.remove(key); } catch { /* ignore */ } }
};

// Normal settings (theme, bot name, search history) are not secret.
export const prefs = {
  get(key, fallback = '') { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
  getJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
};
