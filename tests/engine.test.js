// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REAL_CARDS, syntheticCards } from './fixtures.js';
import { normalizeCard, rolesOf, themesOf, canBeCommander, canPair, isBasic, pips, singletonLimit } from '../js/engine/cardinfo.js';
import { parseCollection, parseDecklist, parseCardLine, parseCSV, formatDecklist } from '../js/engine/parsers.js';
import { availability, conflicts, deckOwnership } from '../js/engine/pool.js';
import { buildCommander, buildSixty, swapSuggestions, suggestUpgrades, commanderOptions, makePool } from '../js/engine/builder.js';
import { validateDeck, deckStats } from '../js/engine/analyze.js';

const real = REAL_CARDS.map(normalizeCard);
const synth = syntheticCards(140).map(normalizeCard);
const all = [...real, ...synth];
const byId = new Map(all.map((c) => [c.oracle_id, c]));
const byName = new Map(all.map((c) => [c.name, c]));
const N = (n) => byName.get(n);
const collectionOf = (cards, qty = 1) => cards.map((c) => ({ oracle_id: c.oracle_id, qty: isBasic(c) ? 30 : qty, name: c.name }));

test('normalizes double-faced cards', () => {
  const d = real.find((c) => c.name.startsWith('Delver'));
  assert.equal(d.front_name, 'Delver of Secrets');
  assert.equal(d.mana_cost, '{U}');
  assert.equal(d.images.length, 2);
  assert.match(d.oracle_text, /transform/);
});

test('classifies roles', () => {
  const has = (n, r) => assert.ok(rolesOf(N(n)).includes(r), `${n} should be ${r}: ${rolesOf(N(n))}`);
  const not = (n, r) => assert.ok(!rolesOf(N(n)).includes(r), `${n} should not be ${r}: ${rolesOf(N(n))}`);
  has('Sol Ring', 'ramp'); has('Cultivate', 'ramp'); has('Llanowar Elves', 'ramp'); has('Smothering Tithe', 'ramp');
  has('Rhystic Study', 'draw'); has("Night's Whisper", 'draw'); has('Harmonize', 'draw');
  has('Swords to Plowshares', 'removal'); has('Beast Within', 'removal'); has('Lightning Bolt', 'removal'); has('Chaos Warp', 'removal') ;
  has('Wrath of God', 'wipe'); has('Toxic Deluge', 'wipe'); has('Blasphemous Act', 'wipe'); not('Wrath of God', 'removal');
  has('Counterspell', 'counter'); has('Demonic Tutor', 'tutor'); has("Teferi's Protection", 'protection'); has('Eternal Witness', 'recursion');
  has('Command Tower', 'land'); not('Craterhoof Behemoth', 'ramp');
});

test('detects themes', () => {
  assert.ok(themesOf(N('Talrand, Sky Summoner')).includes('spells'));
  assert.ok(themesOf(N('Krenko, Mob Boss')).includes('tokens'));
  assert.ok(themesOf(N('Tatyova, Benthic Druid')).includes('landfall'));
  assert.ok(themesOf(N('Blood Artist')).includes('sacrifice'));
  assert.ok(themesOf(N('Hardened Scales')).includes('counters'));
});

test('commander rules', () => {
  assert.ok(canBeCommander(N('Krenko, Mob Boss')));
  assert.ok(!canBeCommander(N('Lightning Bolt')));
  assert.ok(canPair(N('Thrasios, Triton Hero'), N('Tymna the Weaver')));
  assert.ok(!canPair(N('Krenko, Mob Boss'), N('Tymna the Weaver')));
  assert.deepEqual(pips('{1}{U}{U}'), { W: 0, U: 2, B: 0, R: 0, G: 0 });
  assert.equal(singletonLimit(N('Island')), Infinity);
});

test('parses ManaBox CSV', () => {
  const csv = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency\n' +
    '"Lightning Bolt",m10,Magic 2010,146,foil,common,4,123,abc-123,0.5,false,false,near_mint,en,USD\n' +
    '"Fire // Ice",mh2,Modern Horizons 2,290,normal,uncommon,1,124,def-456,0.2,false,false,near_mint,en,USD\n';
  const r = parseCollection(csv);
  assert.equal(r.source, 'manabox');
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[0].qty, 4);
  assert.equal(r.entries[0].foil, 'foil');
  assert.equal(r.entries[0].scryfallId, 'abc-123');
  assert.equal(r.entries[1].name, 'Fire // Ice');
  assert.equal(r.entries[1].foil, '');
});

test('parses Moxfield CSV', () => {
  const csv = '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number","Alter","Proxy","Purchase Price"\n' +
    '"4","2","Lightning Bolt","m10","Near Mint","English","foil","","2026-01-01","146","False","False",""\n' +
    '"1","0","Sol Ring","cmm","Near Mint","English","","","2026-01-01","464","False","False",""\n';
  const r = parseCollection(csv);
  assert.equal(r.source, 'moxfield');
  assert.equal(r.entries.length, 2);
  assert.deepEqual([r.entries[1].name, r.entries[1].set, r.entries[1].cn, r.entries[1].qty], ['Sol Ring', 'cmm', '464', 1]);
});

test('parses plain text lists and CSV edge cases', () => {
  const r = parseCollection('4 Lightning Bolt\n1x Sol Ring\nCounterspell\n2 Lightning Bolt');
  assert.equal(r.source, 'text');
  assert.equal(r.entries.find((e) => e.name === 'Lightning Bolt').qty, 6);
  assert.deepEqual(parseCSV('a,"b,c","d ""q"""\r\n1,2,3'), [['a', 'b,c', 'd "q"'], ['1', '2', '3']]);
});

test('parses Moxfield decklist exports', () => {
  assert.deepEqual(parseCardLine('1 Sol Ring (CMM) 464 *F*'), { qty: 1, name: 'Sol Ring', set: 'cmm', cn: '464', foil: 'foil' });
  assert.deepEqual(parseCardLine('2x Lightning Bolt'), { qty: 2, name: 'Lightning Bolt', set: '', cn: '', foil: '' });
  const arena = parseDecklist('Commander\n1 Krenko, Mob Boss (DDT) 52\n\nDeck\n1 Sol Ring (CMM) 464\n30 Mountain\n\nSideboard\n1 Shock');
  assert.deepEqual(arena.sections.map((s) => s.board), ['commander', 'main', 'side']);
  // MTGO-style: commander as a trailing block after a blank line
  const main = Array.from({ length: 99 }, (_, i) => `1 Card ${i}`).join('\n');
  const mtgo = parseDecklist(main + '\n\n1 Krenko, Mob Boss');
  assert.deepEqual(mtgo.sections.map((s) => s.board), ['main', 'commander']);
  const sixty = parseDecklist('4 Lightning Bolt\n20 Mountain\n\n2 Shock');
  assert.deepEqual(sixty.sections.map((s) => s.board), ['main', 'side']);
});

test('availability subtracts built decks only', () => {
  const coll = collectionOf([N('Sol Ring'), N('Lightning Bolt'), N('Mountain')], 2);
  const decks = [
    { id: 'a', status: 'built', cards: [{ oracle_id: N('Sol Ring').oracle_id, qty: 1, board: 'main' }, { oracle_id: N('Lightning Bolt').oracle_id, qty: 2, board: 'main' }] },
    { id: 'b', status: 'draft', cards: [{ oracle_id: N('Sol Ring').oracle_id, qty: 1, board: 'main' }] },
  ];
  const av = availability({ collection: coll, decks, cardsById: byId });
  assert.equal(av.get(N('Sol Ring').oracle_id), 1);
  assert.equal(av.has(N('Lightning Bolt').oracle_id), false);
  assert.equal(av.get(N('Mountain').oracle_id), Infinity);
  const av2 = availability({ collection: coll, decks, cardsById: byId, excludeDeckId: 'a' });
  assert.equal(av2.get(N('Lightning Bolt').oracle_id), 2);
  decks[1].status = 'built';
  decks[1].cards[0].qty = 2;
  const cf = conflicts({ collection: coll, decks, cardsById: byId });
  assert.equal(cf.length, 1);
  assert.equal(cf[0].name, 'Sol Ring');
  const own = deckOwnership(decks[1], { collection: coll, decks, cardsById: byId });
  assert.equal(own.get(N('Sol Ring').oracle_id), 'short');
});

function checkCommanderDeck(res, avail) {
  assert.ok(!res.error, res.error);
  const deck = { ...res.deck, id: 'x', status: 'draft' };
  const total = deck.cards.reduce((a, e) => a + e.qty, 0);
  assert.equal(total, 100, `deck has ${total} cards`);
  const errs = validateDeck(deck, byId).filter((v) => v.level === 'error');
  assert.deepEqual(errs, []);
  for (const e of deck.cards) {
    const c = byId.get(e.oracle_id);
    if (!isBasic(c)) assert.ok((avail.get(e.oracle_id) || 0) >= e.qty, `${c.name} not available`);
  }
  return deck;
}

test('builds a legal Commander deck from available cards only', () => {
  const coll = collectionOf(all);
  const av = availability({ collection: coll, decks: [], cardsById: byId });
  const res = buildCommander(byId, av, { commanders: [N('Krenko, Mob Boss')], seed: 42 });
  const deck = checkCommanderDeck(res, av);
  const s = deckStats(deck, byId);
  assert.ok(s.lands >= 33 && s.lands <= 39, `lands ${s.lands}`);
  assert.ok((s.roleCounts.ramp || 0) >= 6, `ramp ${s.roleCounts.ramp}`);
  assert.ok(deck.cards.some((e) => e.oracle_id === N('Goblin Chieftain').oracle_id), 'goblin synergy picked');
  assert.equal(res.summary.tribe, 'Goblin');
});

test('excludes cards used in other built decks', () => {
  const coll = collectionOf(all);
  const first = buildCommander(byId, availability({ collection: coll, decks: [], cardsById: byId }), { commanders: [N('Talrand, Sky Summoner')], seed: 1 });
  const decks = [{ id: 'd1', status: 'built', ...first.deck }];
  const av = availability({ collection: coll, decks, cardsById: byId });
  const second = buildCommander(byId, av, { commanders: [N('Tatyova, Benthic Druid')], seed: 2 });
  checkCommanderDeck(second, av);
  const used = new Set(first.deck.cards.filter((e) => !isBasic(byId.get(e.oracle_id))).map((e) => e.oracle_id));
  const overlap = second.deck.cards.filter((e) => used.has(e.oracle_id));
  assert.deepEqual(overlap.map((e) => byId.get(e.oracle_id).name), []);
});

test('random commander and partners', () => {
  const coll = collectionOf(all);
  const av = availability({ collection: coll, decks: [], cardsById: byId });
  const res = buildCommander(byId, av, { seed: 99, randomness: 0.8 });
  checkCommanderDeck(res, av);
  const pair = buildCommander(byId, av, { commanders: [N('Thrasios, Triton Hero'), N('Tymna the Weaver')], seed: 5 });
  const deck = checkCommanderDeck(pair, av);
  assert.equal(deck.cards.filter((e) => e.board === 'commander').length, 2);
  assert.ok(commanderOptions(makePool(byId, av)).length >= 5);
});

test('small pool fills with basics and warns', () => {
  const coll = collectionOf(real);
  const av = availability({ collection: coll, decks: [], cardsById: byId });
  const res = buildCommander(byId, av, { commanders: [N('Ezuri, Renegade Leader')], seed: 3 });
  const deck = checkCommanderDeck(res, av);
  assert.ok(res.warnings.length > 0);
  assert.ok(deckStats(deck, byId).lands > 40);
});

test('limited basics are respected', () => {
  const coll = collectionOf(all).map((e) => (isBasic(byId.get(e.oracle_id)) ? { ...e, qty: 5 } : e));
  const av = availability({ collection: coll, decks: [], cardsById: byId, unlimitedBasics: false });
  const res = buildCommander(byId, av, { commanders: [N('Krenko, Mob Boss')], seed: 4 });
  const m = res.deck.cards.find((e) => e.oracle_id === N('Mountain').oracle_id);
  assert.ok(!m || m.qty <= 5);
  assert.ok(res.warnings.some((w) => /basic lands short/.test(w)));
});

test('builds 60-card casual decks', () => {
  const coll = collectionOf(all, 4);
  const av = availability({ collection: coll, decks: [], cardsById: byId });
  for (const archetype of ['aggro', 'tempo', 'midrange', 'control', 'auto']) {
    for (const seed of [1, 2, 3]) {
      const res = buildSixty(byId, av, { archetype, seed });
      const deck = { ...res.deck, id: 'y' };
      const total = deck.cards.reduce((a, e) => a + e.qty, 0);
      assert.equal(total, 60, `${archetype}/${seed}: ${total}`);
      assert.deepEqual(validateDeck(deck, byId).filter((v) => v.level === 'error'), [], `${archetype}/${seed}`);
      for (const e of deck.cards) if (!isBasic(byId.get(e.oracle_id))) assert.ok(e.qty <= 4);
      const s = deckStats(deck, byId);
      assert.ok(s.lands >= 20 && s.lands <= 27, `${archetype} lands ${s.lands}`);
    }
  }
  const red = buildSixty(byId, av, { colors: ['R'], archetype: 'aggro', tribe: 'Goblin', seed: 8 });
  assert.deepEqual(red.summary.colors, ['R']);
  assert.ok(red.deck.cards.some((e) => e.oracle_id === N('Goblin Guide').oracle_id));
});

test('60-card copies respect what you own', () => {
  const coll = collectionOf(all, 1);
  const av = availability({ collection: coll, decks: [], cardsById: byId });
  const res = buildSixty(byId, av, { seed: 11 });
  for (const e of res.deck.cards) if (!isBasic(byId.get(e.oracle_id))) assert.equal(e.qty, 1);
});

test('swap and upgrade suggestions', () => {
  const coll = collectionOf(all);
  const av0 = availability({ collection: coll, decks: [], cardsById: byId });
  const res = buildCommander(byId, av0, { commanders: [N('Krenko, Mob Boss')], seed: 42, randomness: 1 });
  const deck = { ...res.deck, id: 'z', status: 'built' };
  const av = availability({ collection: coll, decks: [deck], cardsById: byId, excludeDeckId: 'z' });
  const removal = deck.cards.find((e) => e.role === 'removal');
  const sw = swapSuggestions(deck, removal.oracle_id, byId, av);
  assert.ok(sw.length > 0);
  assert.ok(sw.every((s) => !deck.cards.some((e) => e.oracle_id === s.card.oracle_id)));
  assert.ok(sw.every((s) => s.card.color_identity.every((c) => c === 'R')));
  const up = suggestUpgrades(deck, byId, av);
  assert.ok(Array.isArray(up));
});

test('exports decklists', () => {
  const coll = collectionOf(all);
  const av = availability({ collection: coll, decks: [], cardsById: byId });
  const res = buildCommander(byId, av, { commanders: [N('Krenko, Mob Boss')], seed: 42 });
  const text = formatDecklist(res.deck, byId);
  const back = parseDecklist(text);
  assert.equal(back.sections[0].board, 'commander');
  assert.equal(back.sections.flatMap((s) => s.cards).reduce((a, c) => a + c.qty, 0), 100);
});

test('edicts and reanimation are classified sensibly', () => {
  assert.ok(!rolesOf(N('Fleshbag Marauder')).includes('wipe'));
  assert.ok(rolesOf(N('Fleshbag Marauder')).includes('removal'));
  assert.ok(rolesOf(N('Reanimate')).includes('recursion'));
  assert.ok(rolesOf(N('Animate Dead')).includes('recursion'));
});

test('board wipes stay near their target', () => {
  const coll = collectionOf(all);
  const av = availability({ collection: coll, decks: [], cardsById: byId });
  for (const seed of [1, 2, 3]) {
    const res = buildCommander(byId, av, { commanders: [N('Talrand, Sky Summoner')], seed });
    const s = deckStats({ ...res.deck }, byId);
    assert.ok((s.roleCounts.wipe || 0) <= 5, `wipes ${s.roleCounts.wipe}`);
  }
});
