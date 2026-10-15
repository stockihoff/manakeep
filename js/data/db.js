// Tiny IndexedDB wrapper. Everything the app keeps lives in this browser.
const DB_NAME = 'manakeep';
const VERSION = 1;
const STORES = {
  cards: 'oracle_id',     // normalised Scryfall card records
  prints: 'id',           // scryfall printing id -> { id, oracle_id, set, cn }
  collection: 'key',      // owned card entries
  decks: 'id',            // decks
  meta: 'k',              // misc key/value
};

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The database is open in another tab with an older version. Close other Manakeep tabs and reload.'));
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  }));
}

const req2p = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export const getAll = (store) => tx(store, 'readonly', (s) => req2p(s.getAll()));
export const get = (store, key) => tx(store, 'readonly', (s) => req2p(s.get(key)));
export const put = (store, value) => tx(store, 'readwrite', (s) => { s.put(value); });
export const del = (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); });
export const clear = (store) => tx(store, 'readwrite', (s) => { s.clear(); });
export const putMany = (store, values) => tx(store, 'readwrite', (s) => { for (const v of values) s.put(v); });
export const replaceAll = (store, values) => tx(store, 'readwrite', (s) => { s.clear(); for (const v of values) s.put(v); });

export async function getMeta(k, fallback = null) {
  const row = await get('meta', k);
  return row ? row.v : fallback;
}
export const setMeta = (k, v) => put('meta', { k, v });

export async function wipeAll() {
  for (const s of Object.keys(STORES)) await clear(s);
}
