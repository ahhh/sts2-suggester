/**
 * Persistence.
 *
 * localStorage — preferences and the live run (small, synchronous, survives reload).
 * IndexedDB    — the API response cache (hundreds of KB, too big for localStorage).
 *
 * Nothing here ever leaves the browser.
 */

const LS_RUN = 'sts2advisor.run.v1';
const LS_PREFS = 'sts2advisor.prefs.v1';
const DB_NAME = 'sts2advisor';
const DB_STORE = 'apicache';
const DB_VERSION = 1;

/* ---------------------------------------------------------------- run state */

export function saveRun(runState) {
  try {
    localStorage.setItem(LS_RUN, JSON.stringify(runState));
    return true;
  } catch (e) {
    console.warn('saveRun failed', e);
    return false;
  }
}

export function loadRun() {
  try {
    const raw = localStorage.getItem(LS_RUN);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearRun() {
  try { localStorage.removeItem(LS_RUN); } catch { /* ignore */ }
}

export function savePrefs(prefs) {
  try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch { /* ignore */ }
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- api cache db */

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(DB_STORE, mode);
    const req = fn(t.objectStore(DB_STORE));
    t.onerror = () => reject(t.error);
    if (req) req.onsuccess = () => resolve(req.result);
    else t.oncomplete = () => resolve();
  }));
}

/** @returns {Promise<{fetchedAt:number, data:any}|null>} */
export async function cacheGet(key) {
  try {
    const rec = await tx('readonly', (s) => s.get(key));
    return rec || null;
  } catch {
    return null;
  }
}

export async function cachePut(key, data) {
  try {
    await tx('readwrite', (s) => s.put({ key, fetchedAt: Date.now(), data }));
  } catch { /* cache is best-effort */ }
}

export async function cacheClear() {
  try { await tx('readwrite', (s) => s.clear()); } catch { /* ignore */ }
}

/** Wipes every trace of the app from this browser (plan §50). */
export async function clearAllLocalData() {
  clearRun();
  try { localStorage.removeItem(LS_PREFS); } catch { /* ignore */ }
  await cacheClear();
}
