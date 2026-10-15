// Deck statistics and validation. Pure module.
import {
  isLand, isCreature, isBasic, rolesOf, pips, COLORS, legalIn, withinIdentity,
  singletonLimit, sixtyLimit, canBeCommander, canPair,
} from './cardinfo.js';

export const FORMATS = {
  commander: { label: 'Commander', size: 100, singleton: true },
  casual60: { label: 'Casual 60-card', size: 60, singleton: false },
};

export function typeGroup(c) {
  const t = c.front_type || c.type_line || '';
  for (const g of ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land']) {
    if (new RegExp(`\\b${g}\\b`).test(t)) return g === 'Land' && /\bCreature\b/.test(t) ? 'Creature' : g;
  }
  return 'Other';
}
export const TYPE_ORDER = ['Commander', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other'];

export function deckStats(deck, cardsById) {
  const entries = deck.cards.filter((e) => e.board !== 'maybe' && e.board !== 'side');
  const curve = [0, 0, 0, 0, 0, 0, 0, 0]; // 0..6, 7+
  const roleCounts = {};
  const pipTotals = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const types = {};
  let total = 0, lands = 0, creatures = 0, cmcSum = 0, nonlandCount = 0, usd = 0, missingPrice = 0;
  for (const e of entries) {
    const c = cardsById.get(e.oracle_id);
    total += e.qty;
    if (!c) continue;
    const g = e.board === 'commander' ? 'Commander' : typeGroup(c);
    types[g] = (types[g] || 0) + e.qty;
    if (c.prices?.usd != null) usd += c.prices.usd * e.qty; else if (!isBasic(c)) missingPrice++;
    if (isLand(c)) { lands += e.qty; continue; }
    if (isCreature(c)) creatures += e.qty;
    nonlandCount += e.qty;
    cmcSum += c.cmc * e.qty;
    curve[Math.min(7, Math.floor(c.cmc))] += e.qty;
    for (const r of rolesOf(c)) roleCounts[r] = (roleCounts[r] || 0) + e.qty;
    const p = pips(c.mana_cost);
    for (const k of COLORS) pipTotals[k] += p[k] * e.qty;
  }
  return {
    total, lands, creatures, nonland: nonlandCount, curve, roleCounts, pipTotals, types,
    avgCmc: nonlandCount ? cmcSum / nonlandCount : 0, usd, missingPrice,
  };
}

/** Commander colour identity from the deck's commander entries. */
export function deckIdentity(deck, cardsById) {
  const ids = new Set();
  for (const e of deck.cards) if (e.board === 'commander') (cardsById.get(e.oracle_id)?.color_identity || []).forEach((x) => ids.add(x));
  return COLORS.filter((x) => ids.has(x));
}

/** Returns a list of { level: 'error'|'warn'|'info', msg } */
export function validateDeck(deck, cardsById) {
  const out = [];
  const fmt = FORMATS[deck.format] || FORMATS.casual60;
  const main = deck.cards.filter((e) => e.board === 'main' || e.board === 'commander');
  const count = main.reduce((a, e) => a + e.qty, 0);
  const unknown = main.filter((e) => !cardsById.get(e.oracle_id));
  if (unknown.length) out.push({ level: 'warn', msg: `${unknown.length} card(s) have no card data yet.` });

  if (deck.format === 'commander') {
    const cmds = deck.cards.filter((e) => e.board === 'commander').map((e) => cardsById.get(e.oracle_id)).filter(Boolean);
    if (cmds.length === 0) out.push({ level: 'error', msg: 'No commander set.' });
    else {
      cmds.forEach((c) => { if (!canBeCommander(c)) out.push({ level: 'error', msg: `${c.name} can't be a commander.` }); });
      if (cmds.length === 2 && !canPair(cmds[0], cmds[1])) out.push({ level: 'error', msg: `${cmds[0].name} and ${cmds[1].name} can't be paired as commanders.` });
      if (cmds.length > 2) out.push({ level: 'error', msg: 'More than two commanders.' });
    }
    if (count !== 100) out.push({ level: count > 100 ? 'error' : 'warn', msg: `Deck has ${count} cards (needs exactly 100 including the commander).` });
    const identity = deckIdentity(deck, cardsById);
    for (const e of main) {
      const c = cardsById.get(e.oracle_id);
      if (!c) continue;
      if (cmds.length && !withinIdentity(c, identity)) out.push({ level: 'error', msg: `${c.name} is outside the commander's colour identity.` });
      if (!legalIn(c, 'commander')) out.push({ level: 'error', msg: `${c.name} is not legal in Commander (${c.legal.commander.replace('_', ' ')}).` });
      if (e.qty > singletonLimit(c)) out.push({ level: 'error', msg: `${e.qty} copies of ${c.name} (singleton format).` });
    }
  } else {
    if (count < 60) out.push({ level: 'warn', msg: `Deck has ${count} cards (minimum 60).` });
    for (const e of main) {
      const c = cardsById.get(e.oracle_id);
      if (!c) continue;
      const limit = sixtyLimit(c);
      const total = deck.cards.filter((x) => x.oracle_id === e.oracle_id && x.board !== 'maybe').reduce((a, x) => a + x.qty, 0);
      if (total > limit && e.board === 'main') out.push({ level: 'error', msg: `${total} copies of ${c.name} (max ${limit}).` });
      if (!legalIn(c, 'casual60')) out.push({ level: 'warn', msg: `${c.name} isn't a normal constructed card.` });
    }
    const side = deck.cards.filter((e) => e.board === 'side').reduce((a, e) => a + e.qty, 0);
    if (side > 15) out.push({ level: 'info', msg: `Sideboard has ${side} cards (usual max 15).` });
  }
  const s = deckStats(deck, cardsById);
  const nonCmdTotal = deck.format === 'commander' ? 100 : Math.max(60, s.total);
  const landPct = s.lands / nonCmdTotal;
  if (s.total >= fmt.size * 0.9) {
    if (landPct < 0.33) out.push({ level: 'info', msg: `Only ${s.lands} lands — that's on the low side.` });
    if (landPct > 0.45) out.push({ level: 'info', msg: `${s.lands} lands — that's a lot.` });
  }
  return dedupe(out);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((x) => (seen.has(x.msg) ? false : seen.add(x.msg)));
}
