// Rule-based deck generation for Commander and casual 60-card decks. Pure module.
import {
  COLORS, BASIC_FOR_COLOR, isBasic, isLand, isCreature, isLegendary, canBeCommander, canPair,
  legalIn, withinIdentity, singletonLimit, sixtyLimit, rolesOf, themesOf, subtypesOf, tribesMentioned,
  quality, pips, THEMES,
} from './cardinfo.js';

// ---------- utilities ----------
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

const GENERIC_THEMES = new Set(['spells', 'artifacts', 'enchantments', 'control', 'aggro', 'flyers']);
const CREATURE_HEAVY = new Set(['tokens', 'counters', 'sacrifice', 'aggro', 'voltron', 'blink', 'flyers', 'lifegain']);

/** Analysis cache: roles/themes/subtypes are computed once per card. */
const meta = new WeakMap();
export function info(c) {
  let m = meta.get(c);
  if (!m) {
    m = { roles: rolesOf(c), themes: themesOf(c), subtypes: subtypesOf(c), q: quality(c), text: (c.oracle_text || '').toLowerCase() };
    meta.set(c, m);
  }
  return m;
}

/** Build the candidate pool: [{ card, avail }] from the availability map. */
export function makePool(cardsById, avail) {
  const pool = [];
  for (const [oid, n] of avail) {
    const c = cardsById.get(oid);
    if (c && n > 0) pool.push({ card: c, avail: n });
  }
  return pool;
}

/** Known creature types present in the pool (for tribal detection). */
export function poolTribes(pool, minCount = 1) {
  const counts = new Map();
  for (const { card } of pool) for (const t of info(card).subtypes) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].filter(([, n]) => n >= minCount).sort((a, b) => b[1] - a[1]);
}

/** Theme counts among a list of cards. */
export function themeCounts(cards) {
  const out = {};
  for (const c of cards) for (const t of info(c).themes) out[t] = (out[t] || 0) + 1;
  return out;
}

function synergy(c, ctx) {
  const m = info(c);
  let s = 0;
  const hits = [];
  for (const t of m.themes) {
    const w = ctx.themeWeights[t];
    if (w) { s += w; hits.push(THEMES[t]?.label || t); }
  }
  s = Math.min(1, s * 0.45);
  if (ctx.tribe) {
    if (m.subtypes.includes(ctx.tribe) || /Changeling/.test(c.keywords?.join(' ') || '')) { s += 0.7; hits.unshift(`${ctx.tribe}`); }
    else if (m.text.includes(ctx.tribe.toLowerCase())) { s += 0.45; hits.unshift(`${ctx.tribe} support`); }
  }
  for (const kw of ctx.keywords) {
    if (m.text.includes(kw) || (c.type_line || '').toLowerCase().includes(kw) || c.name.toLowerCase().includes(kw)) { s += 0.5; hits.push(`"${kw}"`); }
  }
  return { s, hits };
}

function baseScore(c, ctx, rand) {
  const m = info(c);
  const syn = synergy(c, ctx);
  let score = ctx.wQ * m.q + ctx.wS * syn.s;
  if (ctx.maxCmc != null && c.cmc > ctx.maxCmc && !isLand(c)) score -= 5;
  if (ctx.noGameChangers && c.game_changer) score -= 5;
  score += ctx.randomness * (rand() - 0.5) * 0.9;
  return { score, hits: syn.hits };
}

function reasonFor(c, roleUsed, hits) {
  const parts = [];
  const labels = { ramp: 'Ramp', draw: 'Card draw', removal: 'Removal', wipe: 'Board wipe', counter: 'Counterspell', protection: 'Protection', land: 'Land', creature: 'Creature', threat: 'Threat', tutor: 'Tutor', recursion: 'Recursion' };
  if (roleUsed && labels[roleUsed]) parts.push(labels[roleUsed]);
  if (hits.length) parts.push(`synergy: ${[...new Set(hits)].slice(0, 2).join(', ')}`);
  if (!parts.length) parts.push(info(c).q > 0.55 ? 'Strong staple' : 'Fills the curve');
  return parts.join(' · ');
}

function landScore(c, colors, ctx) {
  const prod = new Set((c.produced_mana || []).filter((x) => COLORS.includes(x)));
  const ours = colors.filter((x) => prod.has(x)).length;
  const text = c.oracle_text || '';
  let s = 0.5 * info(c).q;
  if (colors.length >= 2) s += ours >= 2 ? 0.55 : ours === 1 ? 0.1 : -0.15;
  else s += ours >= 1 ? 0.2 : 0;
  if (prod.size === 0 && colors.length >= 3) s -= 0.35;
  if (/enters (the battlefield )?tapped/i.test(text) && !/unless|you may pay/i.test(text)) s -= 0.15;
  if (/Sacrifice .*: Search your library for a basic land/i.test(text) && colors.length >= 2) s += 0.2; // fetch-style fixing
  s += ctx.wS * synergy(c, ctx).s * 0.6;
  s += ctx.randomness * 0.1;
  return s;
}

function distributeBasics(n, colors, pipTotals, availBasic) {
  const out = {};
  if (n <= 0) return out;
  const use = colors.length ? colors : ['C'];
  const weights = use.map((x) => (x === 'C' ? 1 : Math.max(0.5, pipTotals[x] || 0)));
  const sum = weights.reduce((a, b) => a + b, 0);
  let given = 0;
  use.forEach((x, i) => { out[x] = Math.floor((weights[i] / sum) * n); given += out[x]; });
  // ensure at least 1 of each colour when possible, then hand out remainders by weight
  use.forEach((x) => { if (out[x] === 0 && given < n) { out[x] = 1; given++; } });
  const order = use.map((x, i) => [x, weights[i]]).sort((a, b) => b[1] - a[1]).map(([x]) => x);
  let i = 0;
  while (given < n) { out[order[i % order.length]]++; given++; i++; }
  // cap by owned basics
  for (const x of use) {
    const cap = availBasic(x);
    if (out[x] > cap) out[x] = cap;
  }
  return out;
}

function findBasic(cardsById, color) {
  const name = BASIC_FOR_COLOR[color];
  for (const c of cardsById.values()) if (c.name === name) return c;
  return null;
}

function contextFrom(opts, seedThemes, tribe) {
  const power = opts.power || 'focused';
  const wQ = power === 'casual' ? 0.35 : power === 'optimized' ? 0.7 : 0.5;
  const wS = power === 'casual' ? 0.75 : power === 'optimized' ? 0.45 : 0.6;
  const themeWeights = {};
  for (const [t, w] of Object.entries(seedThemes)) themeWeights[t] = w;
  return {
    wQ, wS, themeWeights, tribe: tribe || null,
    keywords: (opts.keywords || []).map((k) => k.toLowerCase().trim()).filter(Boolean),
    maxCmc: opts.maxCmc ?? null,
    noGameChangers: !!opts.noGameChangers,
    randomness: Math.max(0, Math.min(1, opts.randomness ?? 0.25)),
  };
}

// ---------- commander selection ----------
/** Owned, available commanders ranked by how many on-colour cards are free for them. */
export function commanderOptions(pool, { minSupport = 0 } = {}) {
  const nonBasic = pool.filter(({ card }) => !isBasic(card) && legalIn(card, 'commander'));
  return pool
    .filter(({ card }) => canBeCommander(card) && legalIn(card, 'commander'))
    .map(({ card }) => {
      const support = nonBasic.filter(({ card: x }) => x.oracle_id !== card.oracle_id && withinIdentity(x, card.color_identity));
      const spells = support.filter(({ card: x }) => !isLand(x));
      const cmdThemes = info(card).themes;
      const themed = cmdThemes.length ? spells.filter(({ card: x }) => info(x).themes.some((t) => cmdThemes.includes(t))).length : 0;
      return { card, support: support.length, spells: spells.length, themed };
    })
    .filter((o) => o.support >= minSupport)
    .sort((a, b) => b.spells - a.spells);
}

export function pickRandomCommander(pool, rand, { colors = null } = {}) {
  let opts = commanderOptions(pool).filter((o) => o.spells >= 45);
  if (colors && colors.length) opts = opts.filter((o) => o.card.color_identity.length === colors.length && colors.every((x) => o.card.color_identity.includes(x)));
  if (!opts.length) opts = commanderOptions(pool).filter((o) => o.spells >= 20);
  if (!opts.length) return null;
  const weights = opts.map((o) => Math.sqrt(o.spells) * (1 + o.themed / 30));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < opts.length; i++) { r -= weights[i]; if (r <= 0) return opts[i].card; }
  return opts[opts.length - 1].card;
}

// ---------- Commander builder ----------
/**
 * opts: { commanders: [card], themes?: string[], tribe?: string, keywords?: string[], power?, randomness?,
 *         maxCmc?, include?: oracle_id[], exclude?: oracle_id[], noGameChangers?, targets?: {lands, ramp, draw, removal, wipe},
 *         seed?, scoreBoost?: Map<oracle_id, number>, name? }
 */
export function buildCommander(cardsById, avail, opts) {
  const seed = opts.seed ?? newSeed();
  const rand = rng(seed);
  const warnings = [];
  const pool = makePool(cardsById, avail);
  let commanders = (opts.commanders || []).filter(Boolean);
  if (!commanders.length) {
    const c = pickRandomCommander(pool, rand, { colors: opts.colors });
    if (!c) return { error: 'No commander in your available collection has enough on-colour cards to build around.' };
    commanders = [c];
  }
  if (commanders.length === 2 && !canPair(commanders[0], commanders[1])) warnings.push(`${commanders[0].name} and ${commanders[1].name} aren't a legal partner pair.`);
  const identity = COLORS.filter((x) => commanders.some((c) => c.color_identity.includes(x)));
  const cmdIds = new Set(commanders.map((c) => c.oracle_id));
  const exclude = new Set(opts.exclude || []);

  // Themes: user-chosen first, then commander text, then strongest themes in the on-colour pool.
  const candidates = pool.filter(({ card }) => !cmdIds.has(card.oracle_id) && !exclude.has(card.oracle_id) && legalIn(card, 'commander') && withinIdentity(card, identity));
  const themeW = {};
  (opts.themes || []).forEach((t) => { themeW[t] = 1.4; });
  commanders.forEach((c) => info(c).themes.forEach((t) => { themeW[t] = Math.max(themeW[t] || 0, 1.0); }));
  if (Object.keys(themeW).length < 2) {
    const counts = themeCounts(candidates.filter(({ card }) => !isLand(card)).map((x) => x.card));
    Object.entries(counts).filter(([k]) => !GENERIC_THEMES.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([t]) => { if (!themeW[t]) themeW[t] = 0.5; });
  }
  let tribe = opts.tribe || null;
  if (!tribe) {
    const known = poolTribes(candidates, 6).map(([t]) => t);
    const mentioned = commanders.flatMap((c) => tribesMentioned(c, known));
    if (mentioned.length) tribe = mentioned[0];
  }
  const ctx = contextFrom(opts, themeW, tribe);
  const boost = opts.scoreBoost || new Map();

  const scored = candidates.map(({ card, avail: n }) => {
    const b = baseScore(card, ctx, rand);
    return { card, avail: n, score: b.score + (boost.get(card.oracle_id) || 0), hits: b.hits, m: info(card) };
  });
  const spells = scored.filter((x) => !isLand(x.card) && !isBasic(x.card));
  const lands = scored.filter((x) => isLand(x.card) && !isBasic(x.card));

  const slots = 100 - commanders.length;
  const t = { lands: 37, ramp: 10, draw: 10, removal: 9, wipe: 3, ...(opts.targets || {}) };
  if (opts.power === 'casual' && !opts.targets?.wipe) t.wipe = 2;
  let landTarget = t.lands;
  let spellSlots = slots - landTarget;

  const chosen = new Map(); // oracle_id -> {entry, qty, role}
  const add = (x, role, qty = 1) => {
    if (role === 'removal' && !x.m.roles.includes('removal') && x.m.roles.includes('counter')) role = 'counter';
    chosen.set(x.card.oracle_id, { x, qty, role, reason: role === 'include' ? 'You asked for this' : reasonFor(x.card, role, x.hits) });
  };
  const roleCount = (r) => [...chosen.values()].filter((v) => v.x.m.roles.includes(r) || (r === 'removal' && v.x.m.roles.includes('counter'))).length;
  const spellCount = () => [...chosen.values()].filter((v) => !isLand(v.x.card)).reduce((a, v) => a + v.qty, 0);

  // 1) forced includes
  for (const oid of opts.include || []) {
    const x = scored.find((s) => s.card.oracle_id === oid);
    if (x) add(x, 'include');
    else if (!cmdIds.has(oid)) { const c = cardsById.get(oid); if (c) warnings.push(`Couldn't include ${c.name} (not available or outside colour identity).`); }
  }
  // 2) role quotas
  const roleBonus = {
    ramp: (c) => (c.cmc <= 2 ? 0.25 : c.cmc === 3 ? 0.1 : -0.1) + (/search your library/i.test(c.oracle_text) ? 0.05 : 0),
    draw: (c) => (/whenever|at the beginning/i.test(c.oracle_text) ? 0.15 : 0) - Math.max(0, c.cmc - 4) * 0.08,
    removal: (c) => (/exile target|destroy target/i.test(c.oracle_text) ? 0.1 : 0) + (/Instant/.test(c.type_line) ? 0.08 : 0) - Math.max(0, c.cmc - 3) * 0.06,
    wipe: () => 0,
  };
  for (const role of ['ramp', 'removal', 'draw', 'wipe']) {
    const need = t[role] - roleCount(role);
    if (need <= 0) continue;
    const opts2 = spells
      .filter((x) => !chosen.has(x.card.oracle_id) && (x.m.roles.includes(role) || (role === 'removal' && x.m.roles.includes('counter'))))
      .map((x) => ({ x, s: x.score + roleBonus[role](x.card) + 0.15 * (x.m.roles.length - 1) }))
      .sort((a, b) => b.s - a.s);
    opts2.slice(0, need).forEach(({ x }) => add(x, role));
    if (opts2.length < need) warnings.push(`Only found ${roleCount(role)} ${role} cards (target ${t[role]}).`);
  }
  // 3) creature minimum
  const creatureHeavy = Object.keys(themeW).some((x) => CREATURE_HEAVY.has(x)) || !!tribe;
  const spellsTheme = (themeW.spells || 0) >= 1;
  const creatureTarget = spellsTheme ? 10 : creatureHeavy ? 26 : 18;
  const creatureCount = () => [...chosen.values()].filter((v) => isCreature(v.x.card)).length;
  if (creatureCount() < creatureTarget) {
    spells.filter((x) => !chosen.has(x.card.oracle_id) && isCreature(x.card))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, creatureTarget - creatureCount()))
      .forEach((x) => { if (spellCount() < spellSlots) add(x, x.m.roles.includes('threat') ? 'threat' : 'creature'); });
  }
  // 4) fill to spell slots with curve shaping
  const curveTarget = [0.08, 0.12, 0.2, 0.22, 0.17, 0.11, 0.1]; // cmc 0,1,2,3,4,5,6+
  const bucket = (c) => Math.min(6, Math.floor(c.cmc));
  const fill = (target) => {
    const remaining = spells.filter((x) => !chosen.has(x.card.oracle_id));
    while (spellCount() < target && remaining.length) {
      const counts = [0, 0, 0, 0, 0, 0, 0];
      for (const v of chosen.values()) if (!isLand(v.x.card)) counts[bucket(v.x.card)]++;
      let bestI = -1, best = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const x = remaining[i];
        const b = bucket(x.card);
        const over = counts[b] - curveTarget[b] * target;
        let s = x.score - (over > 0 ? 0.08 * over : -0.04);
        if (x.m.roles.includes('wipe') && roleCount('wipe') >= t.wipe + 1) s -= 0.6;
        if (x.m.roles.includes('counter') && !x.m.roles.includes('removal') && roleCount('counter') >= 8) s -= 0.3;
        if (s > best) { best = s; bestI = i; }
      }
      const [x] = remaining.splice(bestI, 1);
      add(x, x.m.roles.find((r) => ['ramp', 'draw', 'removal', 'wipe', 'counter', 'protection', 'tutor', 'recursion', 'threat'].includes(r)) || (isCreature(x.card) ? 'creature' : null));
    }
  };
  fill(spellSlots);

  // 5) adjust land count to the curve we ended up with
  const avg = (() => { const v = [...chosen.values()].filter((y) => !isLand(y.x.card)); return v.reduce((a, y) => a + y.x.card.cmc, 0) / (v.length || 1); })();
  if (!opts.targets?.lands) {
    const ramp = roleCount('ramp');
    landTarget = avg < 2.6 ? 34 : avg < 3.0 ? 35 : avg < 3.4 ? 36 : avg > 3.9 ? 38 : 37;
    if (ramp >= 13) landTarget -= 1;
    const newSpellSlots = slots - landTarget;
    if (newSpellSlots > spellSlots) fill(newSpellSlots);
    else if (newSpellSlots < spellSlots) {
      const drop = [...chosen.entries()].filter(([, v]) => !isLand(v.x.card) && v.role !== 'include' && !['ramp', 'removal', 'draw', 'wipe'].includes(v.role))
        .sort((a, b) => a[1].x.score - b[1].x.score).slice(0, spellSlots - newSpellSlots);
      drop.forEach(([k]) => chosen.delete(k));
    }
    spellSlots = newSpellSlots;
  }
  if (spellCount() < spellSlots) {
    warnings.push(`Your available pool only had ${spellCount()} usable non-land cards for this commander; the rest is filled with basic lands.`);
  }

  // 6) lands
  const pipTotals = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const v of [...chosen.values(), ...commanders.map((c) => ({ x: { card: c }, qty: 1 }))]) {
    const p = pips(v.x.card.mana_cost);
    for (const k of COLORS) pipTotals[k] += p[k] * (v.qty || 1);
  }
  const nonlandCount = spellCount();
  const landSlots = slots - nonlandCount;
  const minBasics = identity.length <= 1 ? Math.round(landSlots * 0.4) : identity.length === 2 ? Math.round(landSlots * 0.3) : Math.round(landSlots * 0.15);
  const scoredLands = lands.filter((x) => !chosen.has(x.card.oracle_id))
    .map((x) => ({ x, s: landScore(x.card, identity, ctx) + (boost.get(x.card.oracle_id) || 0) }))
    .sort((a, b) => b.s - a.s);
  let colourlessUtility = 0;
  let nonbasicTaken = [...chosen.values()].filter((v) => isLand(v.x.card)).length;
  for (const { x, s } of scoredLands) {
    if (nonbasicTaken >= landSlots - minBasics) break;
    if (s < 0.25) break;
    const prodColours = (x.card.produced_mana || []).filter((c) => COLORS.includes(c));
    if (!prodColours.length) { if (colourlessUtility >= (identity.length <= 1 ? 5 : 3)) continue; colourlessUtility++; }
    add(x, 'land');
    nonbasicTaken++;
  }
  const basicsNeeded = slots - spellCount() - nonbasicTaken;
  const availBasic = (col) => { const b = findBasic(cardsById, col); return b ? (avail.get(b.oracle_id) || 0) : 0; };
  const basics = distributeBasics(basicsNeeded, identity, pipTotals, availBasic);
  let basicsGiven = Object.values(basics).reduce((a, b) => a + b, 0);
  if (basicsGiven < basicsNeeded) {
    // Not enough basics owned: take lower-scored nonbasics, then warn.
    for (const { x } of scoredLands) {
      if (basicsGiven + nonbasicTaken >= basicsNeeded + nonbasicTaken) break;
      if (chosen.has(x.card.oracle_id)) continue;
      add(x, 'land'); nonbasicTaken++; basicsGiven++;
    }
    if (basicsGiven < basicsNeeded) warnings.push(`You're ${basicsNeeded - basicsGiven} basic lands short — turn on "Assume unlimited basic lands" in Settings if you have plenty.`);
  }

  // assemble
  const cards = commanders.map((c) => ({ oracle_id: c.oracle_id, qty: 1, board: 'commander', reason: 'Commander' }));
  for (const [oid, v] of chosen) cards.push({ oracle_id: oid, qty: v.qty, board: 'main', reason: v.reason, role: v.role });
  for (const [col, n] of Object.entries(basics)) {
    if (!n) continue;
    const b = findBasic(cardsById, col);
    if (b) cards.push({ oracle_id: b.oracle_id, qty: n, board: 'main', reason: 'Basic land', role: 'land' });
  }
  const themeList = Object.entries(themeW).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return {
    seed,
    deck: {
      format: 'commander',
      name: opts.name || `${commanders.map((c) => c.front_name || c.name).join(' & ')}${tribe ? ` ${tribe}` : themeList[0] ? ` ${THEMES[themeList[0]]?.label.split(' ')[0]}` : ''}`,
      cards,
    },
    warnings,
    summary: { commanders: commanders.map((c) => c.name), identity, themes: themeList, tribe, landTarget, avgCmc: avg },
  };
}

// ---------- casual 60-card builder ----------
const ARCHETYPES = {
  aggro: { lands: 22, creatures: [18, 26], curve: [0.02, 0.3, 0.34, 0.22, 0.1, 0.02, 0] },
  tempo: { lands: 23, creatures: [12, 18], curve: [0.02, 0.24, 0.32, 0.24, 0.12, 0.06, 0] },
  midrange: { lands: 24, creatures: [14, 20], curve: [0.0, 0.12, 0.26, 0.28, 0.2, 0.1, 0.04] },
  control: { lands: 25, creatures: [5, 10], curve: [0.0, 0.1, 0.26, 0.26, 0.18, 0.12, 0.08] },
};
export const ARCHETYPE_LABELS = { aggro: 'Aggro', tempo: 'Tempo', midrange: 'Midrange', control: 'Control' };

function archetypeFit(c, arch) {
  const m = info(c);
  const t = c.oracle_text || '';
  const cre = isCreature(c);
  const pow = Number(c.power) || 0;
  let s = 0;
  if (arch === 'aggro') {
    if (cre && c.cmc <= 3) s += 0.5;
    if (cre && pow >= c.cmc) s += 0.2;
    if (/\bhaste\b|first strike|double strike|trample|menace/i.test(t)) s += 0.12;
    if (m.themes.includes('burn')) s += 0.35;
    if (c.cmc >= 5) s -= 0.6;
    if (m.roles.includes('wipe')) s -= 0.8;
    if (m.roles.includes('counter')) s -= 0.3;
  } else if (arch === 'tempo') {
    if (/\bflash\b|\bflying\b/i.test(t)) s += 0.3;
    if (m.roles.includes('counter')) s += 0.35;
    if (cre && c.cmc <= 3) s += 0.25;
    if (/return target [^.]* to (its|their) owner's hand/i.test(t)) s += 0.25;
    if (c.cmc >= 5) s -= 0.5;
    if (m.roles.includes('wipe')) s -= 0.5;
  } else if (arch === 'midrange') {
    if (cre && c.cmc >= 2 && c.cmc <= 5) s += 0.35;
    if (m.roles.includes('removal')) s += 0.35;
    if (m.roles.includes('threat')) s += 0.15;
    if (m.roles.includes('draw')) s += 0.1;
    if (c.cmc >= 7) s -= 0.4;
  } else if (arch === 'control') {
    if (m.roles.includes('removal')) s += 0.45;
    if (m.roles.includes('counter')) s += 0.45;
    if (m.roles.includes('draw')) s += 0.4;
    if (m.roles.includes('wipe')) s += 0.55;
    if (cre && c.cmc <= 2 && pow <= 2 && !m.roles.some((r) => ['draw', 'removal'].includes(r))) s -= 0.3;
    if (m.roles.includes('threat') && cre) s += 0.1;
    if (c.cmc >= 8) s -= 0.3;
  }
  return s;
}

function colourCombos() {
  const out = COLORS.map((c) => [c]);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) out.push([COLORS[i], COLORS[j]]);
  return out;
}

/**
 * opts: { colors?: string[], archetype?: 'aggro'|'tempo'|'midrange'|'control'|'auto', themes?, tribe?, keywords?,
 *         randomness?, include?, exclude?, maxCmc?, lands?, seed?, scoreBoost?, name? }
 */
export function buildSixty(cardsById, avail, opts = {}) {
  const seed = opts.seed ?? newSeed();
  const rand = rng(seed);
  const warnings = [];
  const pool = makePool(cardsById, avail).filter(({ card }) => legalIn(card, 'casual60') && !(opts.exclude || []).includes(card.oracle_id));
  let arch = opts.archetype && opts.archetype !== 'auto' ? opts.archetype : ['aggro', 'tempo', 'midrange', 'control'][Math.floor(rand() * 4)];
  const A = ARCHETYPES[arch];
  const themeW = {};
  (opts.themes || []).forEach((t) => { themeW[t] = 1.4; });
  const baseCtx = contextFrom({ ...opts, power: 'focused' }, themeW, opts.tribe);
  baseCtx.wQ = 0.3;

  // choose colours
  let colors = (opts.colors || []).filter((c) => COLORS.includes(c));
  if (!colors.length) {
    const combos = colourCombos().map((combo) => {
      const cs = pool.filter(({ card }) => !isLand(card) && card.color_identity.length && withinIdentity(card, combo));
      const scores = cs.map(({ card }) => archetypeFit(card, arch) + baseCtx.wS * synergy(card, baseCtx).s + 0.3 * info(card).q).sort((a, b) => b - a);
      const depth = scores.slice(0, 22).reduce((a, b) => a + b, 0) + (cs.length >= 22 ? 0 : -10);
      return { combo, depth: depth * (combo.length === 1 ? 0.92 : 1) + rand() * (2 + 8 * baseCtx.randomness) };
    }).sort((a, b) => b.depth - a.depth);
    colors = combos[0].combo;
  }
  const candidates = pool.filter(({ card }) => withinIdentity(card, colors));
  if (!Object.keys(themeW).length) {
    const counts = themeCounts(candidates.filter(({ card }) => !isLand(card)).map((x) => x.card));
    const top = Object.entries(counts).filter(([k]) => !GENERIC_THEMES.has(k)).sort((a, b) => b[1] - a[1]);
    const pick = top[Math.floor(rand() * Math.min(3, top.length))];
    if (pick) themeW[pick[0]] = 0.8;
  }
  let tribe = opts.tribe || null;
  if (!tribe && rand() < 0.35 + 0.3 * baseCtx.randomness) {
    const tribes = poolTribes(candidates.filter(({ card }) => isCreature(card)), 8).filter(([t]) => !['Human', 'Wizard', 'Warrior', 'Soldier'].includes(t));
    if (tribes.length) tribe = tribes[Math.floor(rand() * Math.min(3, tribes.length))][0];
  }
  const ctx = contextFrom(opts, themeW, tribe);
  ctx.wQ = 0.3;
  const boost = opts.scoreBoost || new Map();
  const scored = candidates.map(({ card, avail: n }) => {
    const b = baseScore(card, ctx, rand);
    return { card, avail: n, score: b.score + archetypeFit(card, arch) + (boost.get(card.oracle_id) || 0), hits: b.hits, m: info(card) };
  });
  const spells = scored.filter((x) => !isLand(x.card));
  const landsPool = scored.filter((x) => isLand(x.card) && !isBasic(x.card));

  let landCount = opts.lands || A.lands;
  const spellSlots = () => 60 - landCount;
  const chosen = new Map();
  const total = () => [...chosen.values()].reduce((a, v) => a + v.qty, 0);
  const copiesFor = (x, rank) => {
    const limit = Math.min(sixtyLimit(x.card), x.avail);
    let want = rank < 6 ? 4 : rank < 12 ? 3 : 2;
    if (isLegendary(x.card)) want = Math.min(want, 2);
    if (x.card.cmc >= 5) want = Math.min(want, 2);
    if (x.m.roles.includes('wipe')) want = Math.min(want, 2);
    return Math.max(1, Math.min(limit, want));
  };
  const add = (x, qty, why) => chosen.set(x.card.oracle_id, { x, qty, reason: why || reasonFor(x.card, x.m.roles.find((r) => ['removal', 'draw', 'counter', 'wipe', 'ramp', 'threat'].includes(r)), x.hits) });

  for (const oid of opts.include || []) {
    const x = scored.find((s) => s.card.oracle_id === oid);
    if (x) add(x, Math.min(4, x.avail, sixtyLimit(x.card)), 'You asked for this');
  }

  // creatures first, to the archetype's range
  const [cMin, cMax] = A.creatures;
  const cre = spells.filter((x) => isCreature(x.card) && !chosen.has(x.card.oracle_id)).sort((a, b) => b.score - a.score);
  let creCount = [...chosen.values()].filter((v) => isCreature(v.x.card)).reduce((a, v) => a + v.qty, 0);
  const creTarget = Math.round(cMin + (cMax - cMin) * (0.4 + 0.2 * rand()));
  let rank = 0;
  for (const x of cre) {
    if (creCount >= creTarget || total() >= spellSlots()) break;
    const q = Math.min(copiesFor(x, rank++), creTarget - creCount + 1, spellSlots() - total());
    add(x, q); creCount += q;
  }
  // non-creature spells with curve shaping
  const bucket = (c) => Math.min(6, Math.floor(c.cmc));
  const rest = spells.filter((x) => !chosen.has(x.card.oracle_id) && !isCreature(x.card));
  const curveCounts = () => { const k = [0, 0, 0, 0, 0, 0, 0]; for (const v of chosen.values()) if (!isLand(v.x.card)) k[bucket(v.x.card)] += v.qty; return k; };
  rank = 0;
  while (total() < spellSlots() && (rest.length || cre.some((x) => !chosen.has(x.card.oracle_id)))) {
    const counts = curveCounts();
    const pickFrom = rest.length ? rest : cre.filter((x) => !chosen.has(x.card.oracle_id));
    let bestI = 0, best = -Infinity;
    pickFrom.forEach((x, i) => {
      const b = bucket(x.card);
      const over = counts[b] - A.curve[b] * spellSlots();
      const s = x.score - (over > 0 ? 0.04 * over : 0);
      if (s > best) { best = s; bestI = i; }
    });
    const x = pickFrom[bestI];
    if (rest.length) rest.splice(bestI, 1);
    const q = Math.min(copiesFor(x, rank++), spellSlots() - total());
    if (q > 0) add(x, q);
  }
  // if pool was thin, bump copies of what we already have
  if (total() < spellSlots()) {
    for (const v of [...chosen.values()].sort((a, b) => b.x.score - a.x.score)) {
      const limit = Math.min(sixtyLimit(v.x.card), v.x.avail);
      while (v.qty < limit && total() < spellSlots()) v.qty++;
    }
  }
  if (total() < spellSlots()) {
    warnings.push(`Only ${total()} non-land cards were available in ${colors.join('')}; extra lands fill the gap.`);
  }
  // lands
  const pipTotals = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const v of chosen.values()) { const p = pips(v.x.card.mana_cost); for (const k of COLORS) pipTotals[k] += p[k] * v.qty; }
  const landSlots = 60 - total();
  const maxNonbasic = colors.length === 1 ? 4 : Math.round(landSlots * 0.45);
  let nb = 0;
  const lscored = landsPool.map((x) => ({ x, s: landScore(x.card, colors, ctx) })).sort((a, b) => b.s - a.s);
  for (const { x, s } of lscored) {
    if (nb >= maxNonbasic || s < 0.35) break;
    const prod = (x.card.produced_mana || []).filter((c) => COLORS.includes(c));
    if (colors.length >= 2 && colors.filter((c) => prod.includes(c)).length < 2 && !/Sacrifice .*Search/i.test(x.card.oracle_text)) continue;
    const q = Math.min(x.avail, 4, maxNonbasic - nb);
    add(x, q, 'Dual land'); nb += q;
  }
  const basicsNeeded = 60 - total();
  const availBasic = (col) => { const b = findBasic(cardsById, col); return b ? (avail.get(b.oracle_id) || 0) : 0; };
  const basics = distributeBasics(basicsNeeded, colors, pipTotals, availBasic);
  const given = Object.values(basics).reduce((a, b) => a + b, 0);
  if (given < basicsNeeded) warnings.push(`You're ${basicsNeeded - given} basic lands short.`);

  const cards = [];
  for (const [oid, v] of chosen) cards.push({ oracle_id: oid, qty: v.qty, board: 'main', reason: v.reason });
  for (const [col, n] of Object.entries(basics)) {
    const b = findBasic(cardsById, col);
    if (b && n) cards.push({ oracle_id: b.oracle_id, qty: n, board: 'main', reason: 'Basic land' });
  }
  const themeList = Object.keys(themeW);
  const colourName = colors.map((c) => ({ W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' })[c]).join('-');
  return {
    seed,
    deck: { format: 'casual60', name: opts.name || `${colourName} ${tribe || (themeList[0] ? THEMES[themeList[0]]?.label.split(' ')[0] : '')} ${ARCHETYPE_LABELS[arch]}`.replace(/\s+/g, ' ').trim(), cards },
    warnings,
    summary: { colors, archetype: arch, themes: themeList, tribe, landTarget: landCount },
  };
}

// ---------- swaps & upgrades ----------
/** Detect a deck's dominant themes/tribe for suggestion scoring. */
export function deckProfile(deck, cardsById) {
  const cards = deck.cards.filter((e) => e.board !== 'maybe').map((e) => cardsById.get(e.oracle_id)).filter(Boolean);
  const nonland = cards.filter((c) => !isLand(c));
  const counts = themeCounts(nonland);
  const themeWeights = {};
  Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([k, n]) => { if (n >= 4) themeWeights[k] = 1; });
  const tribes = new Map();
  for (const c of nonland) for (const t of info(c).subtypes) tribes.set(t, (tribes.get(t) || 0) + 1);
  const topTribe = [...tribes].sort((a, b) => b[1] - a[1])[0];
  const tribe = topTribe && topTribe[1] >= Math.max(8, nonland.length * 0.25) ? topTribe[0] : null;
  const cmds = deck.cards.filter((e) => e.board === 'commander').map((e) => cardsById.get(e.oracle_id)).filter(Boolean);
  let colors = COLORS.filter((x) => cards.some((c) => c.color_identity.includes(x)));
  if (deck.format === 'commander' && cmds.length) colors = COLORS.filter((x) => cmds.some((c) => c.color_identity.includes(x)));
  return { themeWeights, tribe, colors, cmds };
}

/** Alternatives for one card from the available pool. */
export function swapSuggestions(deck, oracleId, cardsById, avail, { limit = 8 } = {}) {
  const target = cardsById.get(oracleId);
  if (!target) return [];
  const prof = deckProfile(deck, cardsById);
  const ctx = contextFrom({ randomness: 0 }, prof.themeWeights, prof.tribe);
  const inDeck = new Set(deck.cards.map((e) => e.oracle_id));
  const tRoles = info(target).roles.filter((r) => r !== 'utility');
  const tLand = isLand(target);
  const out = [];
  for (const { card, avail: n } of makePool(cardsById, avail)) {
    if (inDeck.has(card.oracle_id) || isBasic(card)) continue;
    if (!legalIn(card, deck.format === 'commander' ? 'commander' : 'casual60')) continue;
    if (!withinIdentity(card, prof.colors)) continue;
    if (isLand(card) !== tLand) continue;
    const m = info(card);
    const shared = tRoles.filter((r) => m.roles.includes(r)).length;
    if (tRoles.length && shared === 0) continue;
    const syn = synergy(card, ctx);
    const s = shared * 0.4 + ctx.wS * syn.s + ctx.wQ * m.q - Math.abs(card.cmc - target.cmc) * 0.07;
    out.push({ card, avail: n, score: s, why: reasonFor(card, tRoles.find((r) => m.roles.includes(r)), syn.hits) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Whole-deck upgrade ideas: weakest cards paired with stronger available replacements. */
export function suggestUpgrades(deck, cardsById, avail, { limit = 10 } = {}) {
  const prof = deckProfile(deck, cardsById);
  const ctx = contextFrom({ randomness: 0 }, prof.themeWeights, prof.tribe);
  const val = (c) => ctx.wQ * info(c).q + ctx.wS * synergy(c, ctx).s;
  const weak = deck.cards
    .filter((e) => e.board === 'main')
    .map((e) => cardsById.get(e.oracle_id))
    .filter((c) => c && !isBasic(c))
    .map((c) => ({ c, v: val(c) }))
    .sort((a, b) => a.v - b.v)
    .slice(0, limit * 2);
  const used = new Set();
  const out = [];
  for (const { c, v } of weak) {
    const alts = swapSuggestions(deck, c.oracle_id, cardsById, avail, { limit: 5 }).filter((a) => !used.has(a.card.oracle_id));
    const best = alts.find((a) => val(a.card) > v + 0.08);
    if (best) { used.add(best.card.oracle_id); out.push({ out: c, in: best.card, why: best.why, gain: val(best.card) - v }); }
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/** Ranked candidate list for a plan (used to build the AI shortlist). */
export function rankCandidates(cardsById, avail, { format = 'commander', identity = [], themes = [], tribe = null, keywords = [], power = 'focused', archetype = null, maxCmc = null, exclude = [] } = {}) {
  const ex = new Set(exclude);
  const fmt = format === 'commander' ? 'commander' : 'casual60';
  const themeW = {};
  themes.forEach((t) => { themeW[t] = 1.2; });
  const ctx = contextFrom({ power, keywords, maxCmc, randomness: 0 }, themeW, tribe);
  if (fmt === 'casual60') ctx.wQ = 0.3;
  const still = () => 0.5;
  return makePool(cardsById, avail)
    .filter(({ card }) => !isBasic(card) && !ex.has(card.oracle_id) && legalIn(card, fmt) && withinIdentity(card, identity))
    .map(({ card, avail: n }) => {
      const b = baseScore(card, ctx, still);
      const score = b.score + (fmt === 'casual60' && archetype ? archetypeFit(card, archetype) : 0) + (isLand(card) ? landScore(card, identity, ctx) - 0.5 : 0);
      return { card, avail: n, score, hits: b.hits, roles: info(card).roles };
    })
    .sort((a, b) => b.score - a.score);
}
