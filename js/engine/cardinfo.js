// Card normalisation (Scryfall -> compact record) and rules-text classification.
// Pure module: no DOM, no network. Used by the app and by the Node tests.

export const COLORS = ['W', 'U', 'B', 'R', 'G'];
export const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' };

const BASIC_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest', 'Snow-Covered Wastes',
]);
export const BASIC_FOR_COLOR = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest', C: 'Wastes' };

const NON_DECK_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'planar', 'scheme', 'vanguard', 'augment', 'host']);

/** Convert a Scryfall card object into the compact record the app stores. */
export function normalizeCard(sc) {
  const faces = Array.isArray(sc.card_faces) ? sc.card_faces : null;
  const front = faces ? faces[0] : sc;
  const join = (k) => faces ? faces.map((f) => f[k] || '').filter(Boolean).join(' // ') : (sc[k] || '');
  const img = (f) => f && f.image_uris ? { normal: f.image_uris.normal, small: f.image_uris.small, art: f.image_uris.art_crop } : null;
  const images = [];
  if (sc.image_uris) images.push(img(sc));
  else if (faces) faces.forEach((f) => { const i = img(f); if (i) images.push(i); });

  const legal = sc.legalities || {};
  return {
    oracle_id: sc.oracle_id || (faces && faces[0].oracle_id) || sc.id,
    id: sc.id,
    name: sc.name,
    front_name: front.name || sc.name,
    layout: sc.layout || 'normal',
    mana_cost: sc.mana_cost != null && sc.mana_cost !== '' ? sc.mana_cost : (front.mana_cost || ''),
    cmc: typeof sc.cmc === 'number' ? sc.cmc : 0,
    type_line: sc.type_line || join('type_line'),
    front_type: front.type_line || sc.type_line || '',
    oracle_text: sc.oracle_text != null && !faces ? sc.oracle_text : join('oracle_text'),
    colors: sc.colors || (faces ? [...new Set(faces.flatMap((f) => f.colors || []))] : []),
    color_identity: sc.color_identity || [],
    keywords: sc.keywords || [],
    produced_mana: sc.produced_mana || [],
    power: front.power ?? null,
    toughness: front.toughness ?? null,
    loyalty: front.loyalty ?? null,
    rarity: sc.rarity || '',
    set: sc.set || '',
    collector_number: sc.collector_number || '',
    edhrec_rank: sc.edhrec_rank ?? null,
    legal: {
      commander: legal.commander || 'not_legal',
      vintage: legal.vintage || 'not_legal',
      standard: legal.standard || 'not_legal',
      pioneer: legal.pioneer || 'not_legal',
      modern: legal.modern || 'not_legal',
      pauper: legal.pauper || 'not_legal',
    },
    prices: { usd: sc.prices?.usd ? Number(sc.prices.usd) : null, eur: sc.prices?.eur ? Number(sc.prices.eur) : null },
    images,
    game_changer: !!sc.game_changer,
    scryfall_uri: sc.scryfall_uri || '',
  };
}

// ---------- simple predicates ----------
export const isBasic = (c) => BASIC_NAMES.has(c.name) || /^Basic\b/.test(c.front_type || c.type_line || '');
export const isLand = (c) => /\bLand\b/.test(c.front_type || c.type_line);
export const isCreature = (c) => /\bCreature\b/.test(c.front_type || c.type_line);
export const isLegendary = (c) => /\bLegendary\b/.test(c.front_type || c.type_line);
export const isPlaneswalker = (c) => /\bPlaneswalker\b/.test(c.front_type || c.type_line);
export const isPlayable = (c) => !NON_DECK_LAYOUTS.has(c.layout) && !/\b(Conspiracy|Scheme|Plane|Phenomenon|Vanguard|Dungeon|Attraction|Stickers)\b/.test(c.type_line);

export function canBeCommander(c) {
  if (!isPlayable(c)) return false;
  const front = c.front_type || c.type_line;
  if (/\bLegendary\b/.test(front) && /\bCreature\b/.test(front)) return true;
  if (/can be your commander/i.test(c.oracle_text)) return true;
  if (/\bLegendary\b/.test(front) && /\bVehicle\b|\bSpacecraft\b/.test(front) && /can be your commander/i.test(c.oracle_text)) return true;
  return false;
}

/** Partner-style pairing: returns true if a and b may be co-commanders. */
export function canPair(a, b) {
  if (!a || !b || a.oracle_id === b.oracle_id) return false;
  const kw = (c) => new Set((c.keywords || []).map((k) => k.toLowerCase()));
  const ka = kw(a), kb = kw(b);
  const ta = a.oracle_text || '', tb = b.oracle_text || '';
  if (ka.has('partner') && kb.has('partner') && !/Partner with/.test(ta) && !/Partner with/.test(tb)) return true;
  const pw = (t) => (t.match(/Partner with ([^\n(]+)/) || [])[1]?.trim();
  if (pw(ta) === b.name || pw(tb) === a.name) return true;
  if (ka.has('friends forever') && kb.has('friends forever')) return true;
  const isBg = (c) => /\bBackground\b/.test(c.type_line);
  if ((/Choose a Background/i.test(ta) && isBg(b)) || (/Choose a Background/i.test(tb) && isBg(a))) return true;
  const isDoctor = (c) => /\bTime Lord Doctor\b/.test(c.type_line);
  if ((/Doctor's companion/i.test(ta) && isDoctor(b)) || (/Doctor's companion/i.test(tb) && isDoctor(a))) return true;
  return false;
}

/** How many copies of a card a singleton (Commander) deck may contain. */
export function singletonLimit(c) {
  if (isBasic(c)) return Infinity;
  const t = c.oracle_text || '';
  if (/A deck can have any number of cards named/i.test(t)) return Infinity;
  const m = t.match(/A deck can have up to (\w+) cards named/i);
  if (m) return WORD_NUM[m[1].toLowerCase()] || Number(m[1]) || 1;
  return 1;
}
/** Copy limit for 60-card casual decks. */
export function sixtyLimit(c) {
  const s = singletonLimit(c);
  return s === 1 ? 4 : s;
}
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function legalIn(c, format) {
  if (!isPlayable(c)) return false;
  if (format === 'commander') return c.legal.commander === 'legal';
  // Casual 60-card: anything printed for constructed play; banned-in-vintage cards are ante/dexterity cards.
  return c.legal.vintage === 'legal' || c.legal.vintage === 'restricted';
}

export function withinIdentity(c, identity) {
  const id = new Set(identity);
  return (c.color_identity || []).every((x) => id.has(x));
}

/** Count coloured pips in a mana cost, e.g. {1}{U}{U} -> {U:2}. Hybrid counts half to each. */
export function pips(cost) {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const m of (cost || '').matchAll(/\{([^}]+)\}/g)) {
    const parts = m[1].split('/').filter((p) => COLORS.includes(p));
    for (const p of parts) out[p] += 1 / parts.length;
  }
  return out;
}

// ---------- role classification ----------
export const ROLE_LABELS = {
  land: 'Land', ramp: 'Ramp', draw: 'Card draw', removal: 'Removal', wipe: 'Board wipe',
  counter: 'Counterspell', tutor: 'Tutor', protection: 'Protection', recursion: 'Recursion',
  threat: 'Threat', creature: 'Creature', utility: 'Utility',
};

const RX = {
  ramp: [
    /\{T\}[^.\n]*: Add\b/, /\bAdd \{[WUBRGC]\}/, /Add (one|two|three) mana/i, /mana of any (one )?colou?r/i,
    /search your library for (up to (one|two|three) )?(a |an )?(basic )?(land|Forest|Plains|Island|Swamp|Mountain)/i,
    /put (a|an|up to \w+) (basic )?land cards? from your hand onto the battlefield/i,
    /create (a|two|three|X) Treasure tokens?/i, /You may play an additional land/i, /costs? \{\d\} less to cast/i,
  ],
  draw: [
    /\bdraws? (a|two|three|four|X|that many|\w+) cards?/i, /\bdraw cards? equal/i, /investigate/i,
    /look at the top \w+ cards of your library\. Put (one|two|\w+) of them into your hand/i,
    /exile the top (card|\w+ cards) of your library\. (Until|You may play|You may cast)/i, /\bConnive/i, /create a Clue/i,
  ],
  removal: [
    /destroy target (creature|artifact|enchantment|planeswalker|permanent|nonland|noncreature|attacking|tapped|nonblack|nonwhite|creature or planeswalker)/i,
    /exile target (creature|artifact|enchantment|planeswalker|permanent|nonland|attacking|tapped|card from a graveyard|creature or planeswalker)/i,
    /deals? (\d+|X|damage equal to [^.]+) damage to (target|any target|another target|each opponent's creature)/i,
    /target creature gets -\d+\/-\d+|target creature gets -X\/-X/i, /return target (nonland )?(creature|permanent|nonland permanent)[^.]* to (its|their) owner's hand/i,
    /target (player|opponent) sacrifices/i, /each (opponent|player) sacrifices (a|an) (creature|nonland)/i, /fights? (target|another target|up to one target)/i,
    /\bput target (creature|nonland permanent) on (the )?(top|bottom) of its owner's library/i,
    /owner of target (nonland )?permanent shuffles it/i, /shuffles? target [^.]* into (its|their) (owner's )?library/i,
    /gain control of target (creature|permanent|artifact)/i, /target (creature|permanent) (an opponent controls )?loses all abilities/i,
  ],
  wipe: [
    /destroy all (creatures|nonland permanents|artifacts|enchantments|permanents|other creatures|nonland)/i,
    /exile all (creatures|nonland permanents|other creatures|permanents)/i, /each (creature|other creature|creature your opponents control) gets? -(\d+|X)\/-(\d+|X)|all (other )?creatures get -(\d+|X)\/-(\d+|X)/i,
    /deals? \d+ damage to each creature/i, /return all (nonland permanents|creatures) to their owners' hands/i, /each player sacrifices all/i, /each (player|opponent) sacrifices (two|three|half)/i,
  ],
  counter: [/counter target (spell|noncreature spell|creature spell|instant|activated|ability)/i],
  tutor: [/search your library for (a|an|any|up to (one|two)) (card|creature|artifact|enchantment|instant|sorcery|planeswalker|legendary|Equipment|Aura)(?! named)/i],
  protection: [
    /(gain|gains|have|has) (hexproof|indestructible|shroud|protection from)/i, /\bphase out\b/i,
    /counter target spell or ability that targets/i, /can't be (countered|the target)/i, /\bWard\b/,
  ],
  recursion: [
    /return (target|up to \w+ target|a|an|all|each) [^.]*card[^.]* from (your|a) graveyard to (your hand|the battlefield)/i,
    /cast [^.]* from your graveyard/i, /return [^.]* from your graveyard/i, /(put|return) target creature card from (a|your) graveyard onto the battlefield/i, /return enchanted creature card to the battlefield/i, /\bflashback\b|\bescape\b|\bunearth\b|\bembalm\b|\beternalize\b/i,
  ],
};

/** Returns an array of role keys for a card. */
export function rolesOf(c) {
  if (isLand(c)) {
    const r = ['land'];
    if (c.produced_mana && c.produced_mana.length >= 3) r.push('fixing');
    return r;
  }
  const text = (c.oracle_text || '').replace(/\([^)]*\)/g, ''); // strip reminder text
  const roles = [];
  for (const [role, list] of Object.entries(RX)) if (list.some((rx) => rx.test(text))) roles.push(role);
  // Mana rocks / dorks written as "{T}: Add {G}." are ramp only if cheap enough to matter.
  if (roles.includes('ramp') && c.cmc > 4 && !/search your library/i.test(text)) roles.splice(roles.indexOf('ramp'), 1);
  if (roles.includes('wipe') && roles.includes('removal') && !/target/i.test(text)) roles.splice(roles.indexOf('removal'), 1);
  if (isCreature(c)) roles.push('creature');
  if ((isCreature(c) && (Number(c.power) >= 4 || c.cmc >= 5)) || isPlaneswalker(c) || /you win the game|each opponent loses \d+ life|extra turn/i.test(text)) roles.push('threat');
  if (roles.length === 0 || (roles.length === 1 && roles[0] === 'creature')) roles.push('utility');
  return roles;
}

// ---------- themes ----------
// Each theme has "enabler" patterns (cards that care) and "payoff/fodder" patterns (cards that fit).
export const THEMES = {
  tokens: { label: 'Tokens / go wide', rx: [/create (a|an|two|three|four|X|\w+) [^.]*tokens?/i, /creatures you control get \+\d/i, /for each creature you control/i, /\bpopulate\b/i, /whenever (a|another) (nontoken )?creature enters the battlefield under your control/i, /creature tokens? you control/i, /twice that many of those tokens/i] },
  counters: { label: '+1/+1 counters', rx: [/\+1\/\+1 counters?/i, /\bproliferate\b/i, /\bevolve\b|\badapt\b|\boutlast\b|\bmodular\b/i] },
  graveyard: { label: 'Graveyard', rx: [/from (your|a) graveyard/i, /creature card in a graveyard/i, /\bmill\b|mills?/i, /put the top \w+ cards of your library into your graveyard/i, /\bdredge\b|\bdelirium\b|\bthreshold\b|\bflashback\b|\bescape\b/i, /cards? in your graveyard/i] },
  artifacts: { label: 'Artifacts', rx: [/\bartifacts? you control\b/i, /whenever (you cast an|an) artifact/i, /\baffinity for artifacts\b|\bimprovise\b|\bmetalcraft\b/i, /artifact (spell|creature) you cast/i] },
  enchantments: { label: 'Enchantments', rx: [/\benchantments? you control\b/i, /whenever (you cast an|an) enchantment/i, /\bconstellation\b/i] },
  spells: { label: 'Instants & sorceries', rx: [/whenever you cast (an|a) (instant|sorcery|noncreature)/i, /instant (and|or) sorcery (spells|cards)/i, /\bmagecraft\b|\bprowess\b/i, /copy (target|that) (instant|sorcery|spell)/i] },
  lifegain: { label: 'Lifegain', rx: [/whenever you gain life/i, /\bgain \d+ life\b|\bgains? life\b/i, /\blifelink\b/i] },
  sacrifice: { label: 'Sacrifice / aristocrats', rx: [/\bsacrifice (a|another) (creature|permanent|artifact)/i, /whenever (a|another) creature (you control )?dies/i, /whenever [^.]* dies/i] },
  landfall: { label: 'Landfall / lands', rx: [/\blandfall\b/i, /whenever a land enters/i, /play an additional land/i, /lands? you control/i] },
  flyers: { label: 'Flyers', rx: [/\bflying\b/i, /creatures? with flying/i] },
  voltron: { label: 'Equipment & auras', rx: [/\bequip\b|\bEquipment\b/i, /\bAura\b|enchanted creature gets/i, /equipped creature/i] },
  blink: { label: 'Blink', rx: [/exile (up to \w+ )?(another )?target [^.]*(you control|you own)[^.]*\. Return (it|that card|those cards) to the battlefield/i, /exile (another )?target [^.]*, then return (it|that card)/i, /\bflicker\b/i, /return (it|that card|the exiled card) to the battlefield under (its owner's|your) control/i, /whenever another (nontoken )?creature enters the battlefield under your control/i] },
  draw_matters: { label: 'Draw matters', rx: [/whenever you draw (a|your second) card/i, /draws? (two|three|seven|\w+) cards/i] },
  discard: { label: 'Discard', rx: [/(target|each) (player|opponent) discards/i, /whenever (a|an) (player|opponent) discards/i, /\bmadness\b/i] },
  control: { label: 'Control', rx: [/counter target/i, /tap target/i, /doesn't untap/i, /can't attack/i, /return target [^.]* to (its|their) owner's hand/i] },
  aggro: { label: 'Aggro / combat', rx: [/\bhaste\b/i, /whenever [^.]* attacks/i, /\bdouble strike\b|\bfirst strike\b|\btrample\b/i, /combat damage to a player/i, /additional combat/i] },
  burn: { label: 'Direct damage', rx: [/deals? \d+ damage to (each opponent|any target|target player|target opponent)/i, /each opponent loses \d+ life/i] },
};

/** Theme keys a card's text supports. */
export function themesOf(c) {
  const text = (c.oracle_text || '').replace(/\([^)]*\)/g, '');
  const out = [];
  for (const [k, t] of Object.entries(THEMES)) if (t.rx.some((rx) => rx.test(text))) out.push(k);
  if (/\bArtifact\b/.test(c.type_line) && !out.includes('artifacts')) out.push('artifacts');
  if (/\bEnchantment\b/.test(c.type_line) && !out.includes('enchantments')) out.push('enchantments');
  if (/\b(Instant|Sorcery)\b/.test(c.front_type) && !out.includes('spells')) out.push('spells');
  if ((c.keywords || []).includes('Flying') && !out.includes('flyers')) out.push('flyers');
  return out;
}

/** Creature subtypes printed on a card. */
export function subtypesOf(c) {
  const tl = c.type_line || '';
  return tl.split(' // ').flatMap((half) => {
    const [left, right] = half.split(' — ');
    return right && /\b(Creature|Kindred|Tribal)\b/.test(left) ? right.trim().split(/\s+/) : [];
  });
}

/** Creature types a card's rules text cares about ("Merfolk you control", "Elf spells"). */
export function tribesMentioned(c, knownTypes) {
  // Ignore token types ("create a 2/2 Drake creature token") — that's not a tribal payoff.
  const text = (c.oracle_text || '').replace(/create [^.]*?tokens?/gi, '');
  const found = new Set();
  for (const t of knownTypes) {
    const plural = t.endsWith('f') ? t.slice(0, -1) + 'ves' : t + 's';
    const rx = new RegExp(`\\b(${t}|${plural})\\b`);
    if (rx.test(text)) found.add(t);
  }
  return [...found];
}

/** 0..1 quality proxy from EDHREC popularity rank (lower rank = more played). */
export function quality(c) {
  const r = c.edhrec_rank;
  if (!r) return 0.25;
  return Math.max(0, Math.min(1, 1 - Math.log10(r) / Math.log10(30000)));
}

/** Short one-line summary of a card for AI prompts. */
export function compactLine(c, maxText = 150) {
  let t = (c.oracle_text || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > maxText) t = t.slice(0, maxText - 1) + '…';
  const pt = c.power != null ? ` ${c.power}/${c.toughness}` : '';
  return `${c.name} ${c.mana_cost || ''} | ${c.type_line}${pt} | ${t}`;
}
