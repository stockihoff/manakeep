// Parsers for collection exports (ManaBox CSV, Moxfield CSV, generic CSV, plain text)
// and decklists (Moxfield / MTGO / Arena text exports). Pure module.

/** RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes, CRLF and BOM. */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

const HEADER_ALIASES = {
  name: ['name', 'card name', 'card', 'cardname'],
  qty: ['quantity', 'count', 'qty', 'amount', 'have'],
  set: ['set code', 'edition', 'set', 'edition code', 'setcode'],
  setName: ['set name', 'edition name'],
  cn: ['collector number', 'card number', 'number', 'collector #', 'cn'],
  foil: ['foil', 'printing', 'finish'],
  scryfallId: ['scryfall id', 'scryfall_id', 'scryfallid'],
  condition: ['condition'],
  language: ['language', 'lang'],
  price: ['purchase price', 'price'],
  binder: ['binder name', 'binder', 'list name'],
  binderType: ['binder type'],
};

/** Work out which source a CSV header row came from. */
export function detectCsvSource(header) {
  const h = header.map((x) => x.trim().toLowerCase());
  if (h.includes('scryfall id') && h.includes('set code') && h.includes('quantity')) return 'manabox';
  if (h.includes('tradelist count') || (h.includes('count') && h.includes('edition'))) return 'moxfield';
  return 'csv';
}

function mapHeader(header) {
  const h = header.map((x) => x.trim().toLowerCase());
  const idx = {};
  for (const [key, names] of Object.entries(HEADER_ALIASES)) {
    const i = h.findIndex((col) => names.includes(col));
    if (i >= 0) idx[key] = i;
  }
  return idx;
}

/**
 * Parse a collection export. Returns { source, entries, errors }.
 * entry = { name, qty, set, cn, foil, scryfallId, condition, language, price }
 */
export function parseCollection(text) {
  const trimmed = text.trim();
  if (!trimmed) return { source: 'empty', entries: [], errors: ['The file is empty.'] };
  const firstLine = trimmed.split(/\r?\n/)[0];
  const looksCsv = firstLine.includes(',') && /name/i.test(firstLine);
  if (!looksCsv) {
    const deck = parseDecklist(trimmed);
    const entries = deck.sections.flatMap((s) => s.cards).map((c) => ({ ...c, foil: c.foil || '' }));
    return { source: 'text', entries: mergeDupes(entries), errors: deck.errors };
  }
  const rows = parseCSV(trimmed);
  const header = rows.shift();
  const source = detectCsvSource(header);
  const idx = mapHeader(header);
  const errors = [];
  if (idx.name == null) return { source, entries: [], errors: ['Could not find a "Name" column in the CSV header.'] };
  const entries = [];
  rows.forEach((r, n) => {
    const get = (k) => (idx[k] != null ? (r[idx[k]] ?? '').trim() : '');
    const name = get('name');
    if (!name) return;
    // ManaBox exports can include wishlists; skip those.
    if (/wish/i.test(get('binderType'))) return;
    let qty = parseInt(get('qty') || '1', 10);
    if (!Number.isFinite(qty) || qty < 0) { errors.push(`Row ${n + 2}: bad quantity for ${name}`); qty = 1; }
    if (qty === 0) return;
    const foilRaw = get('foil').toLowerCase();
    entries.push({
      name: cleanName(name),
      qty,
      set: get('set').toLowerCase(),
      cn: get('cn'),
      foil: foilRaw === 'etched' ? 'etched' : (foilRaw && foilRaw !== 'normal' && foilRaw !== 'false' && foilRaw !== 'no' && foilRaw !== 'nonfoil' ? 'foil' : ''),
      scryfallId: get('scryfallId'),
      condition: get('condition'),
      language: get('language'),
      price: get('price'),
    });
  });
  return { source, entries: mergeDupes(entries), errors };
}

function mergeDupes(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = [e.scryfallId || '', e.name.toLowerCase(), e.set || '', e.cn || '', e.foil || '', e.condition || '', e.language || ''].join('|');
    if (map.has(key)) map.get(key).qty += e.qty;
    else map.set(key, { ...e });
  }
  return [...map.values()];
}

export function cleanName(n) {
  return n.replace(/\s+/g, ' ').replace(/\s*\/\/?\s*/g, (m) => (m.includes('//') ? ' // ' : m)).trim();
}

const SECTION_HEADERS = [
  [/^(commanders?|command zone)\b/i, 'commander'],
  [/^(deck|main|mainboard|main deck|maindeck)\b/i, 'main'],
  [/^(sideboard|side)\b/i, 'side'],
  [/^(maybeboard|maybe|considering)\b/i, 'maybe'],
  [/^companion\b/i, 'companion'],
  [/^(tokens?|attractions|stickers|about)\b/i, 'ignore'],
];

/**
 * Parse a decklist. Understands:
 *  - "1 Sol Ring", "1x Sol Ring", "Sol Ring"
 *  - Moxfield: "1 Sol Ring (CMM) 464 *F*"
 *  - Arena / MTGO style section headers, "SIDEBOARD:", "// Commander"
 * Returns { sections: [{ board, cards: [{qty,name,set,cn,foil}] }], errors }.
 */
export function parseDecklist(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const sections = [];
  let current = { board: 'main', cards: [], explicit: false };
  const errors = [];
  let lastWasBlank = false;
  const pushCurrent = () => { if (current.cards.length) sections.push(current); };

  for (let raw of lines) {
    let line = raw.trim();
    if (!line) { lastWasBlank = true; continue; }
    line = line.replace(/^\/\/\s*/, '').replace(/:$/, '').trim();
    const header = SECTION_HEADERS.find(([rx]) => rx.test(line) && !/^\d/.test(line) && line.split(/\s+/).length <= 3);
    if (header) {
      pushCurrent();
      current = { board: header[1], cards: [], explicit: true };
      lastWasBlank = false;
      continue;
    }
    if (lastWasBlank && current.cards.length && !current.explicit) {
      // Blank-line separated block without header (MTGO/Moxfield style): new implicit section.
      pushCurrent();
      current = { board: 'implicit', cards: [], explicit: false };
    }
    lastWasBlank = false;
    const card = parseCardLine(line);
    if (card) current.cards.push(card);
    else errors.push(`Couldn't read: "${raw.trim()}"`);
  }
  pushCurrent();

  // Resolve implicit sections: the first is main; a trailing short block (1-2 cards) after a big main
  // is the commander (MTGO export); otherwise sideboard.
  let mainSeen = false;
  sections.forEach((s, i) => {
    if (s.board !== 'implicit' && s.board !== 'main') return;
    if (s.board === 'main' && s.explicit) { mainSeen = true; return; }
    if (!mainSeen) { s.board = 'main'; mainSeen = true; return; }
    const total = s.cards.reduce((a, c) => a + c.qty, 0);
    const mainTotal = sections.filter((x) => x.board === 'main').reduce((a, x) => a + x.cards.reduce((b, c) => b + c.qty, 0), 0);
    s.board = total <= 2 && i === sections.length - 1 && mainTotal >= 90 ? 'commander' : 'side';
  });
  return { sections: sections.filter((s) => s.board !== 'ignore'), errors };
}

/** Parse one card line. Returns null if it doesn't look like a card. */
export function parseCardLine(line) {
  let s = line.trim();
  let foil = '';
  if (/\*F\*/.test(s)) foil = 'foil';
  if (/\*E\*/.test(s)) foil = 'etched';
  s = s.replace(/\*[A-Z]\*/g, '')       // *F* *E* markers
    .replace(/\s#\S+(\s#\S+)*/g, '')      // #tags
    .replace(/\[[^\]]*\]/g, '')           // [category] tags
    .replace(/\^[^^]*\^/g, '')            // ^tag^
    .trim();
  const m = s.match(/^(\d+)\s*x?\s+(.+)$/i);
  let qty = 1, rest = s;
  if (m) { qty = parseInt(m[1], 10); rest = m[2]; }
  let set = '', cn = '';
  const setMatch = rest.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)\s*([\w★\-]+)?\s*$/);
  if (setMatch) { rest = setMatch[1]; set = setMatch[2].toLowerCase(); cn = setMatch[3] || ''; }
  rest = cleanName(rest);
  if (!rest || /^\d+$/.test(rest) || rest.length > 160) return null;
  return { qty, name: rest, set, cn, foil };
}

/** Moxfield-style export text for a deck. */
export function formatDecklist(deck, cardsById, { withSets = false } = {}) {
  const line = (e) => {
    const c = cardsById.get(e.oracle_id);
    const name = c ? c.name : e.name || '?';
    const setPart = withSets && c && c.set ? ` (${c.set.toUpperCase()}) ${c.collector_number}` : '';
    return `${e.qty} ${name}${setPart}`;
  };
  const out = [];
  const cmd = deck.cards.filter((e) => e.board === 'commander');
  const main = deck.cards.filter((e) => e.board === 'main');
  const side = deck.cards.filter((e) => e.board === 'side');
  const byName = (a, b) => (cardsById.get(a.oracle_id)?.name || '').localeCompare(cardsById.get(b.oracle_id)?.name || '');
  if (cmd.length) { out.push('Commander'); cmd.sort(byName).forEach((e) => out.push(line(e))); out.push(''); out.push('Deck'); }
  main.sort(byName).forEach((e) => out.push(line(e)));
  if (side.length) { out.push(''); out.push('Sideboard'); side.sort(byName).forEach((e) => out.push(line(e))); }
  return out.join('\n');
}
