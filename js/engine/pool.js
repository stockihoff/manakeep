// Collection aggregation and card allocation across decks. Pure module.
import { isBasic } from './cardinfo.js';

/** Owned copies per oracle_id from collection entries. */
export function ownedCounts(collection) {
  const owned = new Map();
  for (const e of collection) {
    if (!e.oracle_id) continue;
    owned.set(e.oracle_id, (owned.get(e.oracle_id) || 0) + e.qty);
  }
  return owned;
}

/** Copies of each card committed to decks that count against the collection. */
export function allocatedCounts(decks, { excludeDeckId = null } = {}) {
  const alloc = new Map();
  for (const d of decks) {
    if (d.id === excludeDeckId || d.status !== 'built') continue;
    for (const e of d.cards) {
      if (e.board === 'maybe') continue;
      alloc.set(e.oracle_id, (alloc.get(e.oracle_id) || 0) + e.qty);
    }
  }
  return alloc;
}

/** Which decks use each card: oracle_id -> [{deckId, name, qty, status}] */
export function deckUsage(decks) {
  const use = new Map();
  for (const d of decks) {
    for (const e of d.cards) {
      if (e.board === 'maybe') continue;
      if (!use.has(e.oracle_id)) use.set(e.oracle_id, []);
      use.get(e.oracle_id).push({ deckId: d.id, name: d.name, qty: e.qty, status: d.status });
    }
  }
  return use;
}

/**
 * Availability map: oracle_id -> copies free to use in a new deck.
 * Basic lands are unlimited when `unlimitedBasics` is on.
 */
export function availability({ collection, decks, cardsById, excludeDeckId = null, unlimitedBasics = true }) {
  const owned = ownedCounts(collection);
  const alloc = allocatedCounts(decks, { excludeDeckId });
  const avail = new Map();
  for (const [oid, n] of owned) {
    const c = cardsById.get(oid);
    if (c && unlimitedBasics && isBasic(c)) { avail.set(oid, Infinity); continue; }
    const free = n - (alloc.get(oid) || 0);
    if (free > 0) avail.set(oid, free);
  }
  if (unlimitedBasics) {
    for (const c of cardsById.values()) if (isBasic(c)) avail.set(c.oracle_id, Infinity);
  }
  return avail;
}

/** Cards where built decks need more copies than are owned. */
export function conflicts({ collection, decks, cardsById, unlimitedBasics = true }) {
  const owned = ownedCounts(collection);
  const alloc = allocatedCounts(decks);
  const usage = deckUsage(decks);
  const out = [];
  for (const [oid, need] of alloc) {
    const c = cardsById.get(oid);
    if (c && unlimitedBasics && isBasic(c)) continue;
    const have = owned.get(oid) || 0;
    if (need > have) {
      out.push({ oracle_id: oid, name: c ? c.name : oid, need, have, decks: (usage.get(oid) || []).filter((u) => u.status === 'built') });
    }
  }
  return out.sort((a, b) => (b.need - b.have) - (a.need - a.have) || a.name.localeCompare(b.name));
}

/** Per-deck ownership status for each entry: 'ok' | 'short' (shared/over-allocated) | 'missing' (not owned). */
export function deckOwnership(deck, { collection, decks, cardsById, unlimitedBasics = true }) {
  const owned = ownedCounts(collection);
  const allocOthers = allocatedCounts(decks, { excludeDeckId: deck.id });
  const status = new Map();
  for (const e of deck.cards) {
    if (e.board === 'maybe') continue;
    const c = cardsById.get(e.oracle_id);
    if (c && unlimitedBasics && isBasic(c)) { status.set(e.oracle_id, 'ok'); continue; }
    const have = owned.get(e.oracle_id) || 0;
    if (have === 0) status.set(e.oracle_id, 'missing');
    else if (have - (allocOthers.get(e.oracle_id) || 0) < e.qty) status.set(e.oracle_id, 'short');
    else status.set(e.oracle_id, 'ok');
  }
  return status;
}
