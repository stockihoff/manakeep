import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REAL_CARDS, syntheticCards } from './fixtures.js';
import { normalizeCard, isBasic } from '../js/engine/cardinfo.js';
import { availability } from '../js/engine/pool.js';
import { aiBuild, aiSuggestSwaps, listModels, defaultModel, AIError } from '../js/engine/ai.js';
import { validateDeck } from '../js/engine/analyze.js';

const all = [...REAL_CARDS, ...syntheticCards(140)].map(normalizeCard);
const byId = new Map(all.map((c) => [c.oracle_id, c]));
const coll = all.map((c) => ({ oracle_id: c.oracle_id, qty: isBasic(c) ? 40 : 2 }));
const avail = availability({ collection: coll, decks: [], cardsById: byId });

function mockFetch(responder) {
  const calls = [];
  const f = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    const out = responder(url, body, calls.length);
    return { ok: out.status ? out.status < 300 : true, status: out.status || 200, json: async () => out.json };
  };
  f.calls = calls;
  return f;
}
const toolUse = (input) => ({ json: { content: [{ type: 'tool_use', name: 'x', input }], stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 200 } } });

function parseCandidates(prompt) {
  return [...prompt.matchAll(/^(\d+)\. (.+?) [{|]/gm)].map((m) => ({ n: +m[1], name: m[2].trim() }));
}

test('aiBuild produces a legal 100-card deck and repairs miscounts', async () => {
  const f = mockFetch((url, body, i) => {
    if (i === 1) {
      assert.equal(body.tool_choice.name, 'submit_plan');
      assert.match(body.messages[0].content, /Krenko, Mob Boss/);
      return toolUse({ format: 'commander', deck_name: 'Goblin Party', commanders: ['Krenko, Mob Boss'], colors: [], archetype: 'aggro', themes: ['tokens'], tribe: 'Goblin', keywords: ['goblin'], must_include: ['Impact Tremors', 'Black Lotus'], avoid: ['Shock'], max_cmc: null, power: 'focused', notes: '' });
    }
    assert.equal(body.tool_choice.name, 'submit_deck');
    const cands = parseCandidates(body.messages[0].content);
    assert.ok(cands.length > 100);
    assert.ok(!cands.some((c) => c.name === 'Shock'), 'avoided card excluded');
    // pick 50 cards, one invalid number, one duplicate with too many copies, and 30 Mountains (short of 99)
    const picks = cands.slice(0, 50).map((c) => ({ n: c.n, qty: 1 }));
    picks.push({ n: 9999, qty: 1 }, { n: cands[0].n, qty: 3 });
    return toolUse({ deck_name: 'Goblin Party', strategy: 'Go wide with goblins.', cards: picks, basics: { R: 30, U: 2 }, key_cards: ['Krenko, Mob Boss'] });
  });
  const steps = [];
  const res = await aiBuild({ request: 'goblins, lots of tokens', format: 'auto', cardsById: byId, avail, apiKey: 'k', model: 'm', fetchImpl: f, onStep: (s) => steps.push(s) });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const deck = { ...res.deck, id: 'a' };
  assert.equal(deck.cards.reduce((a, e) => a + e.qty, 0), 100);
  assert.deepEqual(validateDeck(deck, byId).filter((v) => v.level === 'error'), []);
  assert.ok(res.warnings.some((w) => /Black Lotus/.test(w)));
  assert.ok(res.warnings.some((w) => /off-colour/.test(w)));
  assert.ok(res.warnings.some((w) => /too few/.test(w)));
  assert.ok(steps.length >= 3);
  assert.equal(res.ai.usage.input_tokens, 2000);
});

test('aiBuild trims an oversized 60-card list', async () => {
  const f = mockFetch((url, body, i) => {
    if (i === 1) return toolUse({ format: 'casual60', deck_name: 'Elves', commanders: [], colors: ['G'], archetype: 'aggro', themes: [], tribe: 'Elf', keywords: [], must_include: [], avoid: [], max_cmc: 4, power: 'casual', notes: '' });
    const cands = parseCandidates(body.messages[0].content);
    return toolUse({ deck_name: 'Elves', strategy: 's', cards: cands.slice(0, 30).map((c) => ({ n: c.n, qty: 4 })), basics: { G: 22 }, key_cards: [] });
  });
  const res = await aiBuild({ request: 'elves', format: 'casual60', cardsById: byId, avail, apiKey: 'k', model: 'm', fetchImpl: f });
  const deck = { ...res.deck, id: 'b' };
  assert.equal(deck.cards.reduce((a, e) => a + e.qty, 0), 60);
  for (const e of deck.cards) if (!isBasic(byId.get(e.oracle_id))) assert.ok(e.qty <= 2, 'clamped to owned copies');
  assert.deepEqual(validateDeck(deck, byId).filter((v) => v.level === 'error'), []);
});

test('API errors map to friendly messages', async () => {
  const f = mockFetch(() => ({ status: 401, json: { error: { message: 'invalid x-api-key' } } }));
  await assert.rejects(aiBuild({ request: 'x', cardsById: byId, avail, apiKey: 'bad', model: 'm', fetchImpl: f }), (e) => e instanceof AIError && e.kind === 'auth');
  await assert.rejects(aiBuild({ request: 'x', cardsById: byId, avail, apiKey: '', model: 'm', fetchImpl: f }), /API key/);
});

test('model listing and swaps', async () => {
  const f = mockFetch(() => ({ json: { data: [{ id: 'claude-opus-x', display_name: 'Opus' }, { id: 'claude-sonnet-y', display_name: 'Sonnet' }] } }));
  const models = await listModels('k', f);
  assert.equal(defaultModel(models), 'claude-sonnet-y');
  const deck = { id: 'd', format: 'commander', cards: [{ oracle_id: all.find((c) => c.name === 'Krenko, Mob Boss').oracle_id, qty: 1, board: 'commander' }, { oracle_id: all.find((c) => c.name === 'Shock').oracle_id, qty: 1, board: 'main' }] };
  const f2 = mockFetch((u, body) => toolUse({ summary: 'better', swaps: [{ out: 'Shock', in: 1, why: 'stronger' }, { out: 'Krenko, Mob Boss', in: 2, why: 'no' }, { out: 'Nope', in: 1, why: 'x' }] }));
  const r = await aiSuggestSwaps({ deck, goal: 'more removal', cardsById: byId, avail, apiKey: 'k', model: 'm', fetchImpl: f2 });
  assert.equal(r.swaps.length, 1);
  assert.equal(r.swaps[0].out.name, 'Shock');
});
