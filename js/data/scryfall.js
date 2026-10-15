// Scryfall API client. Scryfall asks for ~10 requests/second max; we stay well under it.
import { normalizeCard } from '../engine/cardinfo.js';

const API = 'https://api.scryfall.com';
const DELAY = 110;
let last = 0;

async function throttle() {
  const wait = last + DELAY - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

async function request(path, init = {}, attempt = 0) {
  await throttle();
  let res;
  try {
    res = await fetch(API + path, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch (e) {
    throw new Error(`Couldn't reach Scryfall (${e.message}). Check your connection.`);
  }
  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    return request(path, init, attempt + 1);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
  return res.json();
}

/** Identifier Scryfall's /cards/collection understands, best first. */
export function identifierFor(entry) {
  if (entry.scryfallId && /^[0-9a-f-]{36}$/i.test(entry.scryfallId)) return { id: entry.scryfallId };
  if (entry.set && entry.cn) return { set: entry.set, collector_number: entry.cn };
  if (entry.set) return { name: frontName(entry.name), set: entry.set };
  return { name: frontName(entry.name) };
}
export const frontName = (n) => (n || '').split(' // ')[0].trim();

/**
 * Fetch many cards. identifiers: Scryfall identifier objects.
 * Returns { cards: [scryfall card], notFound: [identifier] }.
 */
export async function fetchCollection(identifiers, onProgress = () => {}) {
  const cards = [];
  const notFound = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    const chunk = identifiers.slice(i, i + 75);
    const json = await request('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: chunk }) });
    if (json) { cards.push(...(json.data || [])); notFound.push(...(json.not_found || [])); }
    onProgress(Math.min(identifiers.length, i + 75), identifiers.length);
  }
  return { cards, notFound };
}

/** Name autocomplete (max 20 results). */
export async function autocomplete(q) {
  if (!q || q.length < 2) return [];
  const json = await request(`/cards/autocomplete?q=${encodeURIComponent(q)}`);
  return json?.data || [];
}

/** Image URL for a specific printing id (Scryfall redirects to the image). */
export const printImage = (id, version = 'normal', face = 'front') =>
  `${API}/cards/${id}?format=image&version=${version}${face === 'back' ? '&face=back' : ''}`;

/** Resolve entries (from parsers) to normalised cards, printing map, and the misses. */
export async function resolveEntries(entries, { knownPrints, knownCardsByName, onProgress } = {}) {
  const resolved = new Map(); // entry index -> { oracle_id, printId }
  const need = [];
  entries.forEach((e, i) => {
    const p = e.scryfallId && knownPrints?.get(e.scryfallId);
    if (p) { resolved.set(i, { oracle_id: p.oracle_id, printId: p.id }); return; }
    if (!e.set && !e.scryfallId && knownCardsByName) {
      const c = knownCardsByName.get(e.name.toLowerCase()) || knownCardsByName.get(frontName(e.name).toLowerCase());
      if (c) { resolved.set(i, { oracle_id: c.oracle_id, printId: c.id }); return; }
    }
    need.push(i);
  });
  // Deduplicate identifiers
  const idKey = (id) => JSON.stringify(id);
  const uniq = new Map();
  for (const i of need) { const id = identifierFor(entries[i]); uniq.set(idKey(id), id); }
  let fetched = { cards: [], notFound: [] };
  if (uniq.size) fetched = await fetchCollection([...uniq.values()], onProgress);
  // Retry misses by plain name
  if (fetched.notFound.length) {
    const retry = new Map();
    for (const nf of fetched.notFound) {
      const e = need.map((i) => entries[i]).find((x) => idKey(identifierFor(x)) === idKey(nf));
      if (e) retry.set(frontName(e.name).toLowerCase(), { name: frontName(e.name) });
    }
    if (retry.size) {
      const again = await fetchCollection([...retry.values()]);
      fetched.cards.push(...again.cards);
    }
  }
  const byPrint = new Map(), bySetCn = new Map(), byName = new Map();
  for (const sc of fetched.cards) {
    byPrint.set(sc.id, sc);
    bySetCn.set(`${sc.set}|${sc.collector_number}`.toLowerCase(), sc);
    byName.set(sc.name.toLowerCase(), sc);
    if (sc.card_faces?.[0]?.name) byName.set(sc.card_faces[0].name.toLowerCase(), sc);
  }
  const misses = [];
  for (const i of need) {
    const e = entries[i];
    const sc = (e.scryfallId && byPrint.get(e.scryfallId))
      || (e.set && e.cn && bySetCn.get(`${e.set}|${e.cn}`.toLowerCase()))
      || byName.get(e.name.toLowerCase()) || byName.get(frontName(e.name).toLowerCase());
    if (sc) resolved.set(i, { oracle_id: sc.oracle_id || sc.card_faces?.[0]?.oracle_id, printId: sc.id });
    else misses.push(e);
  }
  const cards = fetched.cards.map(normalizeCard);
  const prints = fetched.cards.map((sc) => ({ id: sc.id, oracle_id: sc.oracle_id || sc.card_faces?.[0]?.oracle_id, set: sc.set, cn: sc.collector_number }));
  return { resolved, cards, prints, misses };
}
