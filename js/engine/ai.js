// AI deck building via the Anthropic Messages API, called straight from the browser with the
// user's own API key. Pipeline: plan (interpret prompt) -> rule engine shortlist -> Claude picks
// cards from the shortlist only -> validate & repair so the result is always legal and owned.
import {
  COLORS, THEMES, isBasic, isLand, canBeCommander, canPair,
  singletonLimit, sixtyLimit, compactLine, BASIC_FOR_COLOR,
} from './cardinfo.js';
import {
  buildCommander, buildSixty, commanderOptions, makePool, poolTribes, themeCounts, rankCandidates, ARCHETYPE_LABELS, deckProfile,
} from './builder.js';

const API = 'https://api.anthropic.com/v1';

export class AIError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

function headers(apiKey) {
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  };
}

async function handle(res) {
  if (res.ok) return res.json();
  let detail = '';
  try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
  if (res.status === 401) throw new AIError('Your Anthropic API key was rejected. Check it in Settings.', 'auth');
  if (res.status === 403) throw new AIError(`The API key doesn't have access to this. ${detail}`, 'auth');
  if (res.status === 404) throw new AIError(`Model not found — pick another model in Settings. ${detail}`, 'model');
  if (res.status === 429) throw new AIError('Rate limited by the Anthropic API. Wait a minute and try again.', 'rate');
  if (res.status === 529 || res.status === 503) throw new AIError('The Anthropic API is overloaded right now. Try again shortly.', 'overloaded');
  if (res.status === 400 && /credit/i.test(detail)) throw new AIError('Your Anthropic account is out of credits.', 'billing');
  throw new AIError(`Anthropic API error ${res.status}: ${detail}`);
}

/** List models available to this key: [{id, name}] (newest first as returned by the API). */
export async function listModels(apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/models?limit=100`, { headers: headers(apiKey) });
  const json = await handle(res);
  return (json.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
}

/** Choose a sensible default: newest Sonnet, else first model. */
export function defaultModel(models) {
  return (models.find((m) => /sonnet/i.test(m.id)) || models[0] || {}).id || '';
}

/** One forced tool call. Returns { input, usage }. */
export async function callTool({ apiKey, model, system, prompt, tool, maxTokens = 8000, fetchImpl = fetch, signal }) {
  if (!apiKey) throw new AIError('Add your Anthropic API key in Settings to use AI building.', 'auth');
  if (!model) throw new AIError('Choose a model in Settings.', 'model');
  let res;
  try {
    res = await fetchImpl(`${API}/messages`, {
      method: 'POST',
      headers: headers(apiKey),
      signal,
      body: JSON.stringify({
        model, max_tokens: maxTokens, system,
        messages: [{ role: 'user', content: prompt }],
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
      }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new AIError('Cancelled.', 'abort');
    throw new AIError(`Couldn't reach the Anthropic API (${e.message}). Check your connection.`, 'network');
  }
  const json = await handle(res);
  const block = (json.content || []).find((b) => b.type === 'tool_use');
  if (!block) throw new AIError('The model did not return a structured answer. Try again.');
  if (json.stop_reason === 'max_tokens') throw new AIError('The model ran out of output space. Try again or pick a model with a larger output limit.');
  return { input: block.input, usage: json.usage || {} };
}

// ---------- prompt building ----------
const THEME_KEYS = Object.keys(THEMES);

function themeVocab() {
  return THEME_KEYS.map((k) => `${k} (${THEMES[k].label})`).join(', ');
}

export function planTool() {
  return {
    name: 'submit_plan',
    description: 'Submit the deck plan interpreted from the request.',
    input_schema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['commander', 'casual60'] },
        deck_name: { type: 'string', description: 'Short evocative deck name' },
        commanders: { type: 'array', items: { type: 'string' }, description: 'Exact commander names from the AVAILABLE COMMANDERS list (1, or 2 if they can partner). Empty array = no commander chosen (only for casual60).' },
        colors: { type: 'array', items: { type: 'string', enum: COLORS }, description: 'Deck colours for casual60 (ignored for commander).' },
        archetype: { type: 'string', enum: ['aggro', 'tempo', 'midrange', 'control'] },
        themes: { type: 'array', items: { type: 'string', enum: THEME_KEYS }, description: 'Up to 3 strategy themes.' },
        tribe: { type: ['string', 'null'], description: 'Creature type to build around, singular (e.g. "Elf"), or null.' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Lowercase words/phrases to favour in rules text, e.g. "treasure", "flying", "+1/+1 counter".' },
        must_include: { type: 'array', items: { type: 'string' }, description: 'Card names the user explicitly asked for.' },
        avoid: { type: 'array', items: { type: 'string' }, description: 'Card names the user asked to leave out.' },
        max_cmc: { type: ['number', 'null'] },
        power: { type: 'string', enum: ['casual', 'focused', 'optimized'] },
        notes: { type: 'string', description: 'Anything else from the request the card picker should respect.' },
      },
      required: ['format', 'deck_name', 'commanders', 'colors', 'archetype', 'themes', 'tribe', 'keywords', 'must_include', 'avoid', 'max_cmc', 'power', 'notes'],
    },
  };
}

export function deckTool() {
  return {
    name: 'submit_deck',
    description: 'Submit the final decklist chosen from the numbered candidate list.',
    input_schema: {
      type: 'object',
      properties: {
        deck_name: { type: 'string' },
        strategy: { type: 'string', description: '2-4 sentences: how the deck wins and how to pilot it.' },
        cards: {
          type: 'array',
          description: 'Chosen cards by candidate number. Do not include the commander or basic lands here.',
          items: {
            type: 'object',
            properties: { n: { type: 'integer' }, qty: { type: 'integer' }, why: { type: 'string', description: 'Very short reason (max 8 words), only for key cards; otherwise omit.' } },
            required: ['n', 'qty'],
          },
        },
        basics: {
          type: 'object',
          description: 'Number of each basic land.',
          properties: { W: { type: 'integer' }, U: { type: 'integer' }, B: { type: 'integer' }, R: { type: 'integer' }, G: { type: 'integer' }, C: { type: 'integer' } },
        },
        key_cards: { type: 'array', items: { type: 'string' }, description: 'Up to 6 card names that define the deck.' },
      },
      required: ['deck_name', 'strategy', 'cards', 'basics', 'key_cards'],
    },
  };
}

const SYSTEM = `You are an expert Magic: The Gathering deck builder helping a player build decks ONLY from cards they own and that aren't already used in their other decks. Be precise, follow the format rules exactly, and only ever reference cards from the lists you are given.`;

function collectionOverview(pool) {
  const nonBasic = pool.filter(({ card }) => !isBasic(card));
  const byColour = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, M: 0 };
  for (const { card } of nonBasic) {
    const ci = card.color_identity;
    if (ci.length === 0) byColour.C++; else if (ci.length > 1) byColour.M++; else byColour[ci[0]]++;
  }
  const tribes = poolTribes(nonBasic, 6).slice(0, 15).map(([t, n]) => `${t} ${n}`).join(', ');
  const themes = Object.entries(themeCounts(nonBasic.map((x) => x.card))).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  return `Available non-basic cards: ${nonBasic.length} (W ${byColour.W}, U ${byColour.U}, B ${byColour.B}, R ${byColour.R}, G ${byColour.G}, colourless ${byColour.C}, multicolour ${byColour.M}).\nCommon creature types: ${tribes || 'none'}.\nTheme counts: ${themes}.`;
}

export function buildPlanPrompt({ request, format, pool }) {
  const cmds = commanderOptions(pool).filter((o) => o.spells >= 25).slice(0, 120);
  const cmdLines = cmds.map((o) => `- ${compactLine(o.card, 110)} | identity ${o.card.color_identity.join('') || 'C'} | ${o.spells} free on-colour spells`).join('\n');
  return `The player wants a new deck. Their request:
"""${request}"""

Format preference: ${format === 'auto' ? 'decide from the request (default to commander if unclear)' : format}.

COLLECTION OVERVIEW
${collectionOverview(pool)}

AVAILABLE COMMANDERS (owned, not used in other decks; with how many free cards fit their colours)
${cmdLines || '(none with enough support)'}

Theme keys you may use: ${themeVocab()}.

Interpret the request into a plan. For Commander, choose commander(s) ONLY from the list above — pick the one that best fits the request and has enough support (prefer 60+ free on-colour spells). For casual60, choose 1-3 colours with enough cards. If the request is vague or asks for something random, make an interesting choice. Call submit_plan.`;
}

export function buildSelectPrompt({ plan, format, commanders, candidates, baseline, colors, request }) {
  const fmtRules = format === 'commander'
    ? `COMMANDER: exactly ${100 - commanders.length} cards plus the commander(s) = 100. Singleton (qty 1) unless a card says otherwise. Typically 35-38 lands total (basics + non-basic lands), ~10 ramp, ~10 card draw, 8-10 removal/interaction, 2-4 board wipes, the rest synergy and threats.`
    : `CASUAL 60: exactly 60 cards. Up to 4 copies of a card (never more than "have"). Typically 22-26 lands (aggro ~22, control ~25). Prefer 4-ofs of the best cards for consistency; 1-2 of situational or expensive cards.`;
  const lines = candidates.map((x, i) => `${i + 1}. ${compactLine(x.card, 140)} | roles: ${x.roles.filter((r) => r !== 'utility').join(',') || '-'} | have ${x.avail === Infinity ? '∞' : x.avail}${baseline.has(x.card.oracle_id) ? ' | *' : ''}`).join('\n');
  return `Build the final deck from the numbered CANDIDATES below — the player owns these and they are free to use.

Original request: """${request}"""
Plan: ${JSON.stringify({ name: plan.deck_name, archetype: plan.archetype, themes: plan.themes, tribe: plan.tribe, keywords: plan.keywords, power: plan.power, max_cmc: plan.max_cmc, notes: plan.notes })}
${format === 'commander' ? `Commander(s): ${commanders.map((c) => compactLine(c, 400)).join(' || ')}` : `Colours: ${colors.join('')}`}
Basic lands available: ${colors.length ? colors.map((c) => BASIC_FOR_COLOR[c]).join(', ') : 'Wastes'} (unlimited unless noted).

RULES
${fmtRules}
- Only use candidate numbers from the list; qty must not exceed "have".
- Cards marked * are what a rules-based builder picked; use them as a fallback, but improve on it for the request.
- Count carefully: sum of qty in "cards" + all basics must equal the deck size${format === 'commander' ? ' minus the commander(s)' : ''}.

CANDIDATES
${lines}

Call submit_deck.`;
}

// ---------- validation & repair ----------
function repair({ format, commanders, picks, basics, candidates, baselineDeck, cardsById, avail, colors }) {
  const warnings = [];
  const size = format === 'commander' ? 100 - commanders.length : 60;
  const limitOf = (c) => (format === 'commander' ? singletonLimit(c) : sixtyLimit(c));
  const chosen = new Map();
  for (const p of picks) {
    const x = candidates[p.n - 1];
    if (!x) { warnings.push(`Ignored unknown pick #${p.n}.`); continue; }
    const max = Math.min(limitOf(x.card), x.avail);
    const prev = chosen.get(x.card.oracle_id)?.qty || 0;
    const qty = Math.max(1, Math.min(max, prev + (Number(p.qty) || 1)));
    if (prev + (Number(p.qty) || 1) > max) warnings.push(`Reduced ${x.card.name} to ${qty} (you have ${x.avail === Infinity ? 'plenty' : x.avail}, limit ${limitOf(x.card)}).`);
    chosen.set(x.card.oracle_id, { card: x.card, qty, why: p.why || chosen.get(x.card.oracle_id)?.why || '', score: x.score });
  }
  // basics
  const basicEntries = [];
  const allowedBasic = colors.length ? colors : ['C'];
  for (const [col, nRaw] of Object.entries(basics || {})) {
    const n = Math.max(0, Math.floor(Number(nRaw) || 0));
    if (!n) continue;
    if (!allowedBasic.includes(col)) { warnings.push(`Dropped ${n} ${BASIC_FOR_COLOR[col]} (off-colour).`); continue; }
    const b = [...cardsById.values()].find((c) => c.name === BASIC_FOR_COLOR[col]);
    if (!b) continue;
    const have = avail.get(b.oracle_id) || 0;
    basicEntries.push({ card: b, qty: Math.min(n, have) });
    if (have < n) warnings.push(`Only ${have} ${b.name} available.`);
  }
  const total = () => [...chosen.values()].reduce((a, v) => a + v.qty, 0) + basicEntries.reduce((a, v) => a + v.qty, 0);
  // too many: trim lowest-scored non-land spells, then excess basics
  if (total() > size) {
    const over = total() - size;
    warnings.push(`The AI picked ${over} card(s) too many — trimmed the weakest.`);
    const order = [...chosen.values()].filter((v) => !isLand(v.card)).sort((a, b) => a.score - b.score);
    for (const v of order) { if (total() <= size) break; v.qty--; if (v.qty <= 0) chosen.delete(v.card.oracle_id); }
    for (const b of basicEntries.sort((a, z) => z.qty - a.qty)) while (total() > size && b.qty > 0) b.qty--;
  }
  // too few: fill from the rule-based deck, then basics
  if (total() < size) {
    const short = size - total();
    warnings.push(`The AI picked ${short} card(s) too few — filled from the rules-based build.`);
    for (const e of baselineDeck.cards) {
      if (total() >= size) break;
      if (e.board !== 'main') continue;
      const c = cardsById.get(e.oracle_id);
      if (!c || isBasic(c)) continue;
      const have = chosen.get(c.oracle_id)?.qty || 0;
      const room = Math.min(limitOf(c), avail.get(c.oracle_id) || 0) - have;
      if (room <= 0) continue;
      const add = Math.min(room, e.qty, size - total());
      chosen.set(c.oracle_id, { card: c, qty: have + add, why: chosen.get(c.oracle_id)?.why || 'Filled in', score: 0 });
    }
    let i = 0;
    while (total() < size) {
      const col = allowedBasic[i++ % allowedBasic.length];
      let entry = basicEntries.find((b) => b.card.name === BASIC_FOR_COLOR[col]);
      if (!entry) {
        const b = [...cardsById.values()].find((c) => c.name === BASIC_FOR_COLOR[col]);
        if (!b) break;
        entry = { card: b, qty: 0 }; basicEntries.push(entry);
      }
      if (entry.qty >= (avail.get(entry.card.oracle_id) || 0)) { if (i > 20) break; continue; }
      entry.qty++;
    }
  }
  const cards = [
    ...commanders.map((c) => ({ oracle_id: c.oracle_id, qty: 1, board: 'commander', reason: 'Commander' })),
    ...[...chosen.values()].map((v) => ({ oracle_id: v.card.oracle_id, qty: v.qty, board: 'main', reason: v.why || '' })),
    ...basicEntries.filter((b) => b.qty > 0).map((b) => ({ oracle_id: b.card.oracle_id, qty: b.qty, board: 'main', reason: 'Basic land' })),
  ];
  return { cards, warnings };
}

function findByName(name, pool) {
  const n = (name || '').toLowerCase().trim();
  return pool.find(({ card }) => card.name.toLowerCase() === n || card.front_name.toLowerCase() === n)?.card || null;
}

/**
 * Full AI build. onStep(label) reports progress.
 * Returns { deck, warnings, summary, ai: { strategy, plan, key_cards, usage } }.
 */
export async function aiBuild({ request, format = 'auto', cardsById, avail, apiKey, model, onStep = () => {}, fetchImpl = fetch, signal, shortlistSize = 220 }) {
  const pool = makePool(cardsById, avail);
  const usage = { input_tokens: 0, output_tokens: 0 };
  const addUsage = (u) => { usage.input_tokens += u.input_tokens || 0; usage.output_tokens += u.output_tokens || 0; };

  onStep('Reading your request…');
  const p1 = await callTool({ apiKey, model, system: SYSTEM, prompt: buildPlanPrompt({ request, format, pool }), tool: planTool(), maxTokens: 2000, fetchImpl, signal });
  addUsage(p1.usage);
  const plan = p1.input;
  const fmt = format === 'auto' ? (plan.format === 'casual60' ? 'casual60' : 'commander') : format;
  const warnings = [];

  // resolve commanders / colours
  let commanders = [];
  if (fmt === 'commander') {
    commanders = (plan.commanders || []).map((n) => findByName(n, pool)).filter((c) => c && canBeCommander(c)).slice(0, 2);
    if (commanders.length === 2 && !canPair(commanders[0], commanders[1])) { warnings.push(`${commanders[1].name} can't partner with ${commanders[0].name}; using one commander.`); commanders = [commanders[0]]; }
    if (!commanders.length) {
      const fallback = commanderOptions(pool).find((o) => o.spells >= 40);
      if (!fallback) throw new AIError('No commander in your available collection has enough on-colour cards.');
      warnings.push(`The AI's commander choice wasn't available, so ${fallback.card.name} was used.`);
      commanders = [fallback.card];
    }
  }
  const colors = fmt === 'commander'
    ? COLORS.filter((x) => commanders.some((c) => c.color_identity.includes(x)))
    : (plan.colors || []).filter((x) => COLORS.includes(x));
  const include = (plan.must_include || []).map((n) => findByName(n, pool)).filter(Boolean).map((c) => c.oracle_id);
  const exclude = (plan.avoid || []).map((n) => findByName(n, pool)).filter(Boolean).map((c) => c.oracle_id);
  (plan.must_include || []).forEach((n) => { if (!findByName(n, pool)) warnings.push(`"${n}" isn't in your available collection.`); });

  onStep('Shortlisting cards from your collection…');
  const common = { themes: plan.themes || [], tribe: plan.tribe || null, keywords: plan.keywords || [], power: plan.power, maxCmc: plan.max_cmc ?? null, include, exclude, name: plan.deck_name, randomness: 0.1 };
  const baselineRes = fmt === 'commander'
    ? buildCommander(cardsById, avail, { ...common, commanders })
    : buildSixty(cardsById, avail, { ...common, colors, archetype: plan.archetype });
  if (baselineRes.error) throw new AIError(baselineRes.error);
  const finalColors = fmt === 'commander' ? colors : baselineRes.summary.colors;
  const ranked = rankCandidates(cardsById, avail, { format: fmt, identity: finalColors, themes: plan.themes, tribe: plan.tribe, keywords: plan.keywords, power: plan.power, archetype: plan.archetype, maxCmc: plan.max_cmc, exclude: [...exclude, ...commanders.map((c) => c.oracle_id)] });
  const baselineIds = new Set(baselineRes.deck.cards.filter((e) => e.board === 'main').map((e) => e.oracle_id));
  const nonland = ranked.filter((x) => !isLand(x.card));
  const lands = ranked.filter((x) => isLand(x.card));
  const shortlist = [];
  const seen = new Set();
  const push = (x) => { if (!seen.has(x.card.oracle_id)) { seen.add(x.card.oracle_id); shortlist.push(x); } };
  ranked.filter((x) => baselineIds.has(x.card.oracle_id) || include.includes(x.card.oracle_id)).forEach(push);
  nonland.slice(0, shortlistSize).forEach(push);
  lands.slice(0, 40).forEach(push);

  onStep(`Choosing cards (${shortlist.length} candidates)…`);
  const p2 = await callTool({
    apiKey, model, system: SYSTEM, maxTokens: 8000, fetchImpl, signal, tool: deckTool(),
    prompt: buildSelectPrompt({ plan, format: fmt, commanders, candidates: shortlist, baseline: baselineIds, colors: finalColors, request }),
  });
  addUsage(p2.usage);
  const out = p2.input;

  onStep('Checking legality and ownership…');
  const fixed = repair({ format: fmt, commanders, picks: out.cards || [], basics: out.basics || {}, candidates: shortlist, baselineDeck: baselineRes.deck, cardsById, avail, colors: finalColors });
  warnings.push(...fixed.warnings);
  return {
    deck: { format: fmt, name: out.deck_name || plan.deck_name || baselineRes.deck.name, cards: fixed.cards, notes: out.strategy || '' },
    warnings,
    summary: {
      ...(fmt === 'commander' ? { commanders: commanders.map((c) => c.name) } : { archetype: plan.archetype }),
      colors: finalColors, identity: finalColors, themes: plan.themes, tribe: plan.tribe,
    },
    ai: { strategy: out.strategy, key_cards: out.key_cards || [], plan, usage },
  };
}

// ---------- AI tune an existing deck ----------
export function swapsTool() {
  return {
    name: 'submit_swaps',
    description: 'Suggest card swaps for the deck.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '1-3 sentences on what the swaps achieve.' },
        swaps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { out: { type: 'string', description: 'Exact name of a card currently in the deck.' }, in: { type: 'integer', description: 'Candidate number to bring in.' }, why: { type: 'string' } },
            required: ['out', 'in', 'why'],
          },
        },
      },
      required: ['summary', 'swaps'],
    },
  };
}

export async function aiSuggestSwaps({ deck, goal, cardsById, avail, apiKey, model, fetchImpl = fetch, signal, maxSwaps = 10 }) {
  const prof = deckProfile(deck, cardsById);
  const inDeck = new Set(deck.cards.map((e) => e.oracle_id));
  const ranked = rankCandidates(cardsById, avail, { format: deck.format, identity: prof.colors, themes: Object.keys(prof.themeWeights), tribe: prof.tribe, keywords: [] })
    .filter((x) => !inDeck.has(x.card.oracle_id))
    .slice(0, 160);
  const deckLines = deck.cards.filter((e) => e.board !== 'maybe').map((e) => {
    const c = cardsById.get(e.oracle_id);
    return c ? `${e.qty} ${e.board === 'commander' ? '[Commander] ' : ''}${compactLine(c, 90)}` : null;
  }).filter(Boolean).join('\n');
  const candLines = ranked.map((x, i) => `${i + 1}. ${compactLine(x.card, 120)} | have ${x.avail === Infinity ? '∞' : x.avail}`).join('\n');
  const prompt = `Here is a ${deck.format === 'commander' ? 'Commander' : 'casual 60-card'} deck:\n${deckLines}\n\nThe player's goal for changes: """${goal || 'make the deck stronger and more consistent'}"""\n\nCANDIDATES (owned and free to use):\n${candLines}\n\nSuggest up to ${maxSwaps} one-for-one swaps that best serve the goal. "out" must be an exact card name from the deck (not the commander); "in" must be a candidate number. Keep land counts sensible. Call submit_swaps.`;
  const r = await callTool({ apiKey, model, system: SYSTEM, prompt, tool: swapsTool(), maxTokens: 3000, fetchImpl, signal });
  const byName = new Map(deck.cards.map((e) => [cardsById.get(e.oracle_id)?.name.toLowerCase(), e]));
  const swaps = (r.input.swaps || []).map((s) => {
    const outEntry = byName.get((s.out || '').toLowerCase());
    const inX = ranked[s.in - 1];
    if (!outEntry || !inX || outEntry.board === 'commander') return null;
    return { out: cardsById.get(outEntry.oracle_id), in: inX.card, why: s.why };
  }).filter(Boolean);
  return { summary: r.input.summary || '', swaps, usage: r.usage };
}

export { ARCHETYPE_LABELS };
