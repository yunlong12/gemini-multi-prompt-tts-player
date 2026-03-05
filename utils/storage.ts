import { GroundingUrl } from "../types";

export interface PersistedItem {
  id: string;
  prompt: string;
  answer: string | null;
  groundingLinks: GroundingUrl[];
  audioBase64?: string;
  ttsModel?: string;
  error?: string;
  status: string;
  timestamp: number;
}

export interface PersistedState {
  items: PersistedItem[];
  recentPrompts: string[];
  updatedAt: number;
}

const DB_NAME = 'GeminiAudioSummarizerDB';
const STORE_NAME = 'appState';
const STATE_KEY = 'current_state';

const getDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const savePersistedState = async (state: PersistedState): Promise<void> => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(state, STATE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const loadPersistedState = async (): Promise<PersistedState | null> => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(STATE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const clearPersistedState = async (): Promise<void> => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(STATE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const exportPersistedState = async (): Promise<PersistedState | null> => {
  return loadPersistedState();
};

export const importPersistedState = async (state: PersistedState): Promise<void> => {
  await savePersistedState(state);
};
