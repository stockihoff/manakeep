// App state, persistence and actions. Components subscribe via useStore().
import { useState, useEffect } from './vendor/preact-htm.js';
import * as db from './data/db.js';
import { resolveEntries, fetchCollection, frontName } from './data/scryfall.js';
import { parseCollection, parseDecklist, formatDecklist } from './engine/parsers.js';
import * as fs from './data/folder.js';
import { availability, deckUsage, ownedCounts, allocatedCounts } from './engine/pool.js';
import { isBasic, canBeCommander, normalizeCard } from './engine/cardinfo.js';

const KEY_STORAGE = 'manakeep.apiKey';
const safeLS = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } },
};

export const state = {
  ready: false,
  error: null,
  cards: new Map(),      // oracle_id -> card
  prints: new Map(),     // printing id -> { id, oracle_id, set, cn }
  collection: [],        // entries
  decks: [],
  settings: { unlimitedBasics: true, model: '', apiKey: '', currency: 'usd' },
  toasts: [],
  openCardId: null,
  // Save folder: status none | connected | saving | saved | error | reconnect | unsupported
  folder: { status: 'none', name: '', error: '', savedAt: 0, choice: null },
  version: 0,
};

const listeners = new Set();
export function emit() { state.version++; memo.clear(); listeners.forEach((f) => f()); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function useStore() {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  return state;
}

// ---------- derived data (memoised per state version) ----------
const memo = new Map();
const cached = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };

export const cardsByName = () => cached('byName', () => {
  const m = new Map();
  for (const c of state.cards.values()) {
    m.set(c.name.toLowerCase(), c);
    if (c.front_name) m.set(c.front_name.toLowerCase(), c);
  }
  return m;
});
export const getAvailability = (excludeDeckId = null) => cached(`avail:${excludeDeckId}`, () =>
  availability({ collection: state.collection, decks: state.decks, cardsById: state.cards, excludeDeckId, unlimitedBasics: state.settings.unlimitedBasics }));
export const getUsage = () => cached('usage', () => deckUsage(state.decks));
export const getOwned = () => cached('owned', () => ownedCounts(state.collection));
export const getAllocated = () => cached('alloc', () => allocatedCounts(state.decks));

// ---------- toasts ----------
let toastId = 0;
export function toast(msg, kind = 'info', ms = 4000) {
  const id = ++toastId;
  state.toasts = [...state.toasts, { id, msg, kind }].slice(-3);
  emit();
  if (ms) setTimeout(() => dismissToast(id), ms);
}
export function dismissToast(id) { state.toasts = state.toasts.filter((t) => t.id !== id); emit(); }
export function openCard(oid) { state.openCardId = oid; emit(); }

// ---------- init ----------
export async function init() {
  try {
    const [cards, prints, collection, decks, settings] = await Promise.all([
      db.getAll('cards'), db.getAll('prints'), db.getAll('collection'), db.getAll('decks'), db.getMeta('settings', {}),
    ]);
    state.cards = new Map(cards.map((c) => [c.oracle_id, c]));
    state.prints = new Map(prints.map((p) => [p.id, p]));
    state.collection = collection;
    state.decks = decks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    state.settings = { ...state.settings, ...settings, apiKey: safeLS.get(KEY_STORAGE) };
    state.ready = true;
    emit();
    ensureBasics().catch(() => {});
    initFolder().catch((e) => console.warn('folder', e));
  } catch (e) {
    state.error = e.message || String(e);
    emit();
  }
}

const BASICS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];
async function ensureBasics() {
  const byName = cardsByName();
  const missing = BASICS.filter((n) => !byName.has(n.toLowerCase()));
  if (!missing.length) return;
  const { cards } = await fetchCollection(missing.map((name) => ({ name })));
  await storeCards(cards.map((sc) => sc), []);
  emit();
}

async function storeCards(scryfallOrNormalised, prints) {
  const norm = scryfallOrNormalised.map((c) => (c.legal ? c : normalizeCard(c)));
  for (const c of norm) state.cards.set(c.oracle_id, c);
  for (const p of prints) state.prints.set(p.id, p);
  if (norm.length) await db.putMany('cards', norm);
  if (prints.length) await db.putMany('prints', prints);
  if (norm.length || prints.length) markDirty({ cards: true });
}

// ---------- settings ----------
export async function updateSettings(patch) {
  const next = { ...state.settings, ...patch };
  if ('apiKey' in patch) safeLS.set(KEY_STORAGE, patch.apiKey.trim());
  state.settings = next;
  const { apiKey, ...persist } = next;
  await db.setMeta('settings', persist);
  markDirty();
  emit();
}

// ---------- collection ----------
const entryKey = (printId, e) => [printId, e.foil || '', (e.condition || '').toLowerCase(), (e.language || '').toLowerCase()].join('|');

/**
 * Import a collection export. mode: 'replace' (a full fresh export) or 'add' (extra cards).
 * Returns a report { source, rows, cards, unique, misses, errors }.
 */
export async function importCollection(text, { mode = 'replace', onProgress = () => {} } = {}) {
  const parsed = parseCollection(text);
  if (!parsed.entries.length) return { source: parsed.source, rows: 0, cards: 0, unique: 0, misses: [], errors: parsed.errors.length ? parsed.errors : ['No cards found in that file.'] };
  const res = await resolveEntries(parsed.entries, { knownPrints: state.prints, knownCardsByName: cardsByName(), onProgress });
  await storeCards(res.cards, res.prints);
  const next = new Map(mode === 'replace' ? [] : state.collection.map((e) => [e.key, { ...e }]));
  let cards = 0;
  const unique = new Set();
  parsed.entries.forEach((e, i) => {
    const r = res.resolved.get(i);
    if (!r) return;
    const key = entryKey(r.printId, e);
    const c = state.cards.get(r.oracle_id);
    const existing = next.get(key);
    if (existing) existing.qty += e.qty;
    else next.set(key, { key, oracle_id: r.oracle_id, print_id: r.printId, name: c?.name || e.name, set: e.set || c?.set || '', cn: e.cn || '', foil: e.foil || '', condition: e.condition || '', language: e.language || '', qty: e.qty });
    cards += e.qty;
    unique.add(r.oracle_id);
  });
  state.collection = [...next.values()];
  await db.replaceAll('collection', state.collection);
  await db.setMeta('lastImport', { at: Date.now(), source: parsed.source, mode });
  markDirty();
  emit();
  return { source: parsed.source, rows: parsed.entries.length, cards, unique: unique.size, misses: res.misses, errors: parsed.errors };
}

/** Add copies of a card (by exact name) to the collection. */
export async function addToCollection(name, qty = 1) {
  let c = cardsByName().get(name.toLowerCase());
  if (!c) {
    const res = await resolveEntries([{ name, qty }], {});
    await storeCards(res.cards, res.prints);
    const r = res.resolved.get(0);
    c = r && state.cards.get(r.oracle_id);
  }
  if (!c) throw new Error(`Couldn't find "${name}" on Scryfall.`);
  const key = entryKey(c.id, {});
  const ex = state.collection.find((e) => e.key === key);
  if (ex) ex.qty += qty;
  else state.collection.push({ key, oracle_id: c.oracle_id, print_id: c.id, name: c.name, set: c.set, cn: c.collector_number, foil: '', condition: '', language: '', qty });
  await db.replaceAll('collection', state.collection);
  markDirty();
  emit();
  return c;
}

/** Change total owned copies of a card (across printings). Removes from the most recent entries first. */
export async function setOwnedQty(oracleId, qty) {
  const entries = state.collection.filter((e) => e.oracle_id === oracleId);
  let current = entries.reduce((a, e) => a + e.qty, 0);
  if (qty > current) {
    if (entries.length) entries[0].qty += qty - current;
    else {
      const c = state.cards.get(oracleId);
      if (!c) return;
      state.collection.push({ key: entryKey(c.id, {}), oracle_id: oracleId, print_id: c.id, name: c.name, set: c.set, cn: c.collector_number, foil: '', condition: '', language: '', qty });
    }
  } else {
    for (const e of [...entries].reverse()) {
      if (current <= qty) break;
      const take = Math.min(e.qty, current - qty);
      e.qty -= take; current -= take;
    }
    state.collection = state.collection.filter((e) => e.qty > 0);
  }
  await db.replaceAll('collection', state.collection);
  markDirty();
  emit();
}

export async function clearCollection() {
  state.collection = [];
  await db.clear('collection');
  markDirty();
  emit();
}

// ---------- decks ----------
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newDeck(partial = {}) {
  const now = Date.now();
  return { id: uid(), name: 'New deck', format: 'commander', status: 'draft', cards: [], notes: '', source: 'manual', tags: [], createdAt: now, updatedAt: now, ...partial };
}

export async function saveDeck(deck) {
  const d = { ...deck, cards: mergeEntries(deck.cards), updatedAt: Date.now() };
  if (!d.id) d.id = uid();
  if (!d.createdAt) d.createdAt = d.updatedAt;
  const i = state.decks.findIndex((x) => x.id === d.id);
  if (i >= 0) state.decks[i] = d; else state.decks.unshift(d);
  state.decks = [...state.decks].sort((a, b) => b.updatedAt - a.updatedAt);
  await db.put('decks', d);
  markDirty();
  emit();
  return d;
}

function mergeEntries(cards) {
  const m = new Map();
  for (const e of cards) {
    if (!e.oracle_id || e.qty <= 0) continue;
    const k = `${e.oracle_id}|${e.board}`;
    if (m.has(k)) m.get(k).qty += e.qty; else m.set(k, { ...e });
  }
  return [...m.values()];
}

export async function deleteDeck(id) {
  state.decks = state.decks.filter((d) => d.id !== id);
  await db.del('decks', id);
  markDirty();
  emit();
}

export async function duplicateDeck(id) {
  const d = state.decks.find((x) => x.id === id);
  if (!d) return null;
  return saveDeck({ ...structuredClone(d), id: uid(), name: `${d.name} (copy)`, status: 'draft', createdAt: Date.now() });
}

/**
 * Parse a pasted decklist and resolve card names. Returns { cards, misses, commanderGuess }.
 * Each card: { oracle_id, qty, board }.
 */
export async function resolveDecklist(text, { onProgress } = {}) {
  const parsed = parseDecklist(text);
  const flat = parsed.sections.flatMap((s) => s.cards.map((c) => ({ ...c, board: s.board === 'companion' ? 'side' : s.board })));
  if (!flat.length) return { cards: [], misses: [], errors: parsed.errors.length ? parsed.errors : ['No cards found.'] };
  const res = await resolveEntries(flat, { knownPrints: state.prints, knownCardsByName: cardsByName(), onProgress });
  await storeCards(res.cards, res.prints);
  const cards = [];
  flat.forEach((e, i) => {
    const r = res.resolved.get(i);
    if (r) cards.push({ oracle_id: r.oracle_id, qty: e.qty, board: e.board === 'implicit' ? 'main' : e.board });
  });
  emit();
  return { cards: mergeEntries(cards), misses: res.misses.map((m) => m.name), errors: parsed.errors };
}

/** Guess a commander for a 100-card list with no commander section. */
export function guessCommander(cards) {
  const legends = cards.filter((e) => e.qty === 1 && canBeCommander(state.cards.get(e.oracle_id) || { type_line: '', oracle_text: '' }));
  return legends.length === 1 ? legends[0].oracle_id : null;
}

// ---------- maintenance ----------
export async function refreshCardData(onProgress = () => {}) {
  const ids = [...state.cards.values()].map((c) => ({ id: c.id }));
  const { cards } = await fetchCollection(ids, onProgress);
  await storeCards(cards, []);
  await db.setMeta('cardsRefreshed', Date.now());
  emit();
  return cards.length;
}

export async function exportBackup() {
  return {
    app: 'manakeep', version: 1, exportedAt: new Date().toISOString(),
    settings: { ...state.settings, apiKey: undefined },
    collection: state.collection, decks: state.decks,
    cards: [...state.cards.values()], prints: [...state.prints.values()],
  };
}

export async function importBackup(obj) {
  if (!obj || obj.app !== 'manakeep') throw new Error("That file isn't a Manakeep backup.");
  await db.replaceAll('cards', obj.cards || []);
  await db.replaceAll('prints', obj.prints || []);
  await db.replaceAll('collection', obj.collection || []);
  await db.replaceAll('decks', obj.decks || []);
  if (obj.settings) { const { apiKey, ...s } = obj.settings; await db.setMeta('settings', { ...state.settings, ...s, apiKey: undefined }); }
  await reloadFromDB();
  markDirty({ cards: true });
}

async function reloadFromDB() {
  const [cards, prints, collection, decks, settings] = await Promise.all([
    db.getAll('cards'), db.getAll('prints'), db.getAll('collection'), db.getAll('decks'), db.getMeta('settings', {}),
  ]);
  state.cards = new Map(cards.map((c) => [c.oracle_id, c]));
  state.prints = new Map(prints.map((p) => [p.id, p]));
  state.collection = collection;
  state.decks = decks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  state.settings = { ...state.settings, ...settings, apiKey: safeLS.get(KEY_STORAGE) };
  emit();
}

export async function wipeEverything() {
  // Disconnect the save folder first so its files are left untouched.
  folderDir = null; cardsDirty = false; clearTimeout(saveTimer);
  await db.wipeAll();
  state.cards = new Map(); state.prints = new Map(); state.collection = []; state.decks = [];
  setFolder({ status: fs.FS_OK ? 'none' : 'unsupported', name: '', error: '', choice: null });
}

// ---------- save folder (like Quillkeep) ----------
let folderDir = null;      // connected FileSystemDirectoryHandle
let pendingDir = null;     // remembered handle waiting for permission
let saveTimer = null;
let saving = false, saveAgain = false;
let cardsDirty = false;
let lastDeckFiles = [];

function setFolder(patch) { state.folder = { ...state.folder, ...patch }; emit(); }

function markDirty({ cards = false } = {}) {
  if (cards) cardsDirty = true;
  db.setMeta('localSavedAt', Date.now()).catch(() => {});
  if (folderDir) { clearTimeout(saveTimer); saveTimer = setTimeout(saveToFolder, 800); }
}

async function initFolder() {
  if (!fs.FS_OK) { setFolder({ status: 'unsupported' }); return; }
  const dir = await db.getMeta('folderHandle', null);
  if (!dir) return;
  if ((await fs.permission(dir)) === 'granted') await attach(dir, 'auto');
  else { pendingDir = dir; setFolder({ status: 'reconnect', name: dir.name }); }
}

/** Pick a folder to save into. If it already holds Manakeep data, asks what to do (state.folder.choice). */
export async function connectFolder() {
  let dir;
  try { dir = await fs.pickFolder(); } catch (e) { if (e.name !== 'AbortError') toast(`Couldn't open that folder: ${e.message}`, 'error'); return; }
  const existing = await fs.readJSON(dir, '.manakeep/state.json').catch(() => null);
  const localHasData = state.collection.length || state.decks.length;
  if (existing && localHasData) {
    setFolder({ choice: { dir, name: dir.name, savedAt: existing.savedAt, decks: existing.decks?.length || 0, cards: (existing.collection || []).reduce((a, e) => a + e.qty, 0) } });
    return;
  }
  await attach(dir, existing ? 'open' : 'save');
}

/** Resolve the "folder already has data" question. which: 'open' (use folder) | 'save' (overwrite folder) | null (cancel) */
export async function resolveFolderChoice(which) {
  const c = state.folder.choice;
  setFolder({ choice: null });
  if (c && which) await attach(c.dir, which);
}

export async function reconnectFolder() {
  const dir = pendingDir || folderDir;
  if (!dir) return connectFolder();
  if ((await fs.permission(dir, true)) !== 'granted') { toast('Permission not granted', 'warn'); return; }
  pendingDir = null;
  await attach(dir, 'auto');
}

export async function disconnectFolder() {
  folderDir = null; pendingDir = null; clearTimeout(saveTimer);
  await db.setMeta('folderHandle', null);
  setFolder({ status: 'none', name: '', error: '' });
  toast('Stopped saving to the folder. Your files there are untouched.');
}

async function attach(dir, mode) {
  folderDir = dir;
  await db.setMeta('folderHandle', dir);
  setFolder({ status: 'connected', name: dir.name, error: '' });
  try {
    if (mode === 'auto') {
      const remote = await fs.readJSON(dir, '.manakeep/state.json');
      const localAt = await db.getMeta('localSavedAt', 0);
      if (remote && (remote.savedAt || 0) > localAt) mode = 'open';
      else if (!remote || localAt > (remote.savedAt || 0)) mode = 'save';
      else { lastDeckFiles = remote.deckFiles || []; setFolder({ status: 'saved', savedAt: remote.savedAt }); return; }
    }
    if (mode === 'open') await loadFromFolder(dir);
    else { cardsDirty = true; await saveToFolder(); }
  } catch (e) {
    console.warn(e);
    setFolder({ status: 'error', error: e.message || e.name });
  }
}

async function loadFromFolder(dir) {
  const data = await fs.readJSON(dir, '.manakeep/state.json');
  if (!data) return;
  const cards = (await fs.readJSON(dir, '.manakeep/cards.json')) || [];
  await db.replaceAll('collection', data.collection || []);
  await db.replaceAll('decks', data.decks || []);
  if (data.prints) await db.replaceAll('prints', data.prints);
  if (cards.length) await db.putMany('cards', cards);
  if (data.settings) await db.setMeta('settings', { ...data.settings, apiKey: undefined });
  await db.setMeta('localSavedAt', data.savedAt || Date.now());
  lastDeckFiles = data.deckFiles || [];
  await reloadFromDB();
  setFolder({ status: 'saved', savedAt: data.savedAt });
  toast(`Loaded your collection and ${data.decks?.length || 0} decks from “${dir.name}”`, 'good');
  // Fill in any card data the folder didn't have
  const missing = [...new Set([...(data.collection || []).map((e) => e.oracle_id), ...(data.decks || []).flatMap((d) => d.cards.map((e) => e.oracle_id))])].filter((id) => !state.cards.has(id));
  if (missing.length) {
    const ids = (data.collection || []).filter((e) => missing.includes(e.oracle_id) && e.print_id).map((e) => ({ id: e.print_id }));
    if (ids.length) fetchCollection(ids).then(({ cards: sc }) => storeCards(sc, []).then(emit)).catch(() => {});
  }
}

function collectionCsv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = ['"Count","Name","Edition","Collector Number","Foil","Condition","Language"'];
  for (const e of [...state.collection].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push([e.qty, e.name, e.set, e.cn, e.foil, e.condition, e.language].map(q).join(','));
  }
  return rows.join('\n');
}

async function saveToFolder() {
  if (!folderDir) return;
  if (saving) { saveAgain = true; return; }
  saving = true;
  setFolder({ status: 'saving' });
  try {
    const savedAt = Date.now();
    // Decklists as readable text files
    const names = new Set();
    const deckFiles = [];
    for (const d of state.decks) {
      let base = fs.safeName(d.name), name = base, n = 2;
      while (names.has(name.toLowerCase())) name = `${base} (${n++})`;
      names.add(name.toLowerCase());
      const path = `Decks/${name}.txt`;
      deckFiles.push(path);
      await fs.writeText(folderDir, path, formatDecklist(d, state.cards, { withSets: false }) + '\n');
    }
    for (const old of lastDeckFiles) if (!deckFiles.includes(old)) await fs.removeFile(folderDir, old);
    lastDeckFiles = deckFiles;
    await fs.writeText(folderDir, 'Collection.csv', collectionCsv());
    if (cardsDirty) { await fs.writeText(folderDir, '.manakeep/cards.json', JSON.stringify([...state.cards.values()])); cardsDirty = false; }
    const { apiKey, ...settings } = state.settings;
    await fs.writeText(folderDir, '.manakeep/state.json', JSON.stringify({
      app: 'manakeep', version: 1, savedAt, settings, collection: state.collection, decks: state.decks, prints: [...state.prints.values()], deckFiles,
    }));
    await db.setMeta('localSavedAt', savedAt);
    setFolder({ status: 'saved', savedAt, error: '' });
  } catch (e) {
    console.warn(e);
    const perm = folderDir ? await fs.permission(folderDir).catch(() => 'prompt') : 'prompt';
    if (perm !== 'granted') { pendingDir = folderDir; folderDir = null; setFolder({ status: 'reconnect', error: '' }); }
    else setFolder({ status: 'error', error: e.message || e.name });
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; saveToFolder(); }
  }
}

export function saveNow() { if (folderDir) { clearTimeout(saveTimer); return saveToFolder(); } }

export { isBasic, frontName };
