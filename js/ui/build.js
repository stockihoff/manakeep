import { html, useState, useMemo, useEffect, useRef } from '../vendor/preact-htm.js';
import { state, useStore, saveDeck, newDeck, getAvailability, toast } from '../store.js';
import { Icon, Alert, Empty, Segmented, ColourPicker, ColourIdentity, CardName, CardSearch, ManaCost, plural, navigate } from './common.js';
import { DeckContents, DeckStatsPanel, ValidationList, SwapModal, applySwap } from './deck.js';
import { THEMES, canPair, canBeCommander, isBasic, legalIn } from '../engine/cardinfo.js';
import { buildCommander, buildSixty, commanderOptions, makePool, poolTribes, newSeed, ARCHETYPE_LABELS } from '../engine/builder.js';
import { aiBuild } from '../engine/ai.js';

// Keep the last options/result while navigating around the app.
const memory = { tab: 'quick', opts: null, result: null, aiPrompt: '', aiFormat: 'auto' };

const DEFAULT_OPTS = {
  format: 'commander', commanders: [], randomCommander: false, colors: [], archetype: 'auto', themes: [], tribe: '', keywords: '',
  power: 'focused', randomness: 25, maxCmc: '', noGameChangers: false, include: [], exclude: [],
  targets: { lands: '', ramp: 10, draw: 10, removal: 9, wipe: 3 }, lands60: '',
};

export function BuildView({ params }) {
  const s = useStore();
  const [tab, setTab] = useState(memory.tab);
  const [opts, setOpts] = useState(() => memory.opts || { ...DEFAULT_OPTS });
  const [result, setResultState] = useState(memory.result);
  const setResult = (r) => { memory.result = r; setResultState(r); };
  useEffect(() => { memory.tab = tab; memory.opts = opts; }, [tab, opts]);

  // ?commander=<oracle_id> preselects a commander
  useEffect(() => {
    const cid = params.get('commander');
    if (cid && s.cards.get(cid)) {
      setTab('quick'); setResult(null);
      setOpts((o) => ({ ...o, format: 'commander', commanders: [cid], randomCommander: false }));
      history.replaceState(null, '', '#/build');
    }
  }, []);

  if (!s.collection.length) {
    return html`<div><div class="page-head"><div><h1>Build</h1></div></div>
      <div class="card"><${Empty} icon="library" title="Import your collection first">The builder only uses cards you own. <a href="#/collection">Go to Collection</a></${Empty}></div></div>`;
  }
  if (result) return html`<${ResultView} result=${result} setResult=${setResult} opts=${opts} />`;

  return html`<div>
    <div class="page-head"><div><h1>Build a deck</h1><p>Only uses cards you own that aren't locked in a built deck.</p></div></div>
    <div class="tabs">
      <button class=${tab === 'quick' ? 'on' : ''} onClick=${() => setTab('quick')}><${Icon} name="wand" style="width:16px;vertical-align:-3px" /> Rules-based builder</button>
      <button class=${tab === 'ai' ? 'on' : ''} onClick=${() => setTab('ai')}><${Icon} name="sparkle" style="width:16px;vertical-align:-3px" /> Describe it to the AI</button>
    </div>
    ${tab === 'quick' ? html`<${QuickBuild} opts=${opts} setOpts=${setOpts} onResult=${setResult} />` : html`<${AiBuild} onResult=${setResult} />`}
  </div>`;
}

// ---------- quick build ----------
export function runQuickBuild(opts, seed = newSeed()) {
  const avail = getAvailability();
  const common = {
    seed,
    themes: opts.themes,
    tribe: opts.tribe || null,
    keywords: opts.keywords.split(',').map((k) => k.trim()).filter(Boolean),
    randomness: opts.randomness / 100,
    maxCmc: opts.maxCmc === '' ? null : Number(opts.maxCmc),
    include: opts.include,
    exclude: opts.exclude,
  };
  if (opts.format === 'commander') {
    const t = opts.targets;
    const targets = { ramp: +t.ramp, draw: +t.draw, removal: +t.removal, wipe: +t.wipe };
    if (t.lands !== '') targets.lands = +t.lands;
    return buildCommander(state.cards, avail, {
      ...common, power: opts.power, noGameChangers: opts.noGameChangers, targets,
      commanders: opts.randomCommander ? [] : opts.commanders.map((id) => state.cards.get(id)).filter(Boolean),
    });
  }
  return buildSixty(state.cards, avail, { ...common, colors: opts.colors, archetype: opts.archetype, lands: opts.lands60 === '' ? null : Number(opts.lands60) });
}

function QuickBuild({ opts, setOpts, onResult }) {
  const s = useStore();
  const set = (patch) => setOpts({ ...opts, ...patch });
  const avail = getAvailability();
  const pool = useMemo(() => makePool(s.cards, avail), [s.version]);
  const cmdOpts = useMemo(() => commanderOptions(pool), [pool]);
  const tribes = useMemo(() => poolTribes(pool.filter(({ card }) => !isBasic(card)), 5).slice(0, 40).map(([t]) => t).sort(), [pool]);
  const freeCards = useMemo(() => pool.map((x) => x.card).filter((c) => !isBasic(c)).sort((a, b) => a.name.localeCompare(b.name)), [pool]);
  const selected = opts.commanders.map((id) => s.cards.get(id)).filter(Boolean);
  const partnerOptions = selected.length === 1 ? cmdOpts.filter((o) => canPair(selected[0], o.card)) : [];
  const [busy, setBusy] = useState(false);
  const canGo = opts.format === 'casual60' || opts.randomCommander || selected.length > 0;

  const go = (o = opts) => {
    setBusy(true);
    setTimeout(() => {
      try {
        const r = runQuickBuild(o);
        if (r.error) toast(r.error, 'error', 6000); else onResult({ ...r, source: 'generated', opts: o });
      } catch (e) { console.error(e); toast(`Build failed: ${e.message}`, 'error'); }
      setBusy(false);
    }, 10);
  };
  const surprise = () => {
    const o = { ...DEFAULT_OPTS, format: opts.format, randomCommander: true, randomness: 70, archetype: 'auto' };
    setOpts(o); go(o);
  };

  return html`<div class="split">
    <div class="stack">
      <div class="card stack">
        <div class="row between">
          <${Segmented} value=${opts.format} onChange=${(v) => set({ format: v })} options=${[['commander', 'Commander'], ['casual60', 'Casual 60-card']]} />
          <button onClick=${surprise} disabled=${busy}><${Icon} name="dice" /> Surprise me</button>
        </div>
        ${opts.format === 'commander' ? html`<div class="stack tight">
          <div class="row between"><span class="section-title" style="margin:0">Commander</span>
            <label class="check small"><input type="checkbox" checked=${opts.randomCommander} onChange=${(e) => set({ randomCommander: e.target.checked })} /> Pick one at random</label></div>
          ${!opts.randomCommander && html`<div class="stack tight">
            ${selected.length > 0 && html`<div class="stack tight">${selected.map((c) => html`<div class="cmd-tile">
              ${c.images?.[0]?.art ? html`<img src=${c.images[0].art} alt="" />` : html`<img alt="" />`}
              <div class="grow"><div class="t"><${CardName} card=${c} /></div><div class="small muted"><${ColourIdentity} ids=${c.color_identity} /> ${plural(cmdOpts.find((o) => o.card.oracle_id === c.oracle_id)?.spells || 0, 'free on-colour card')}</div></div>
              <button class="icon ghost" aria-label="Remove" onClick=${() => set({ commanders: opts.commanders.filter((x) => x !== c.oracle_id) })}><${Icon} name="x" /></button>
            </div>`)}</div>`}
            ${selected.length === 0 && html`<${CardSearch} cards=${cmdOpts.map((o) => o.card)} placeholder="Search your free legendary creatures…" onPick=${(c) => set({ commanders: [c.oracle_id] })}
              renderMeta=${(c) => html`<span class="row tight"><${ColourIdentity} ids=${c.color_identity} /><span class="small faint">${cmdOpts.find((o) => o.card.oracle_id === c.oracle_id)?.spells}</span></span>`} />`}
            ${selected.length === 1 && partnerOptions.length > 0 && html`<details><summary class="small muted" style="cursor:pointer">Add a partner (${partnerOptions.length} available)</summary>
              <div class="chips" style="margin-top:6px">${partnerOptions.slice(0, 20).map((o) => html`<button type="button" class="chip" onClick=${() => set({ commanders: [...opts.commanders, o.card.oracle_id] })}>${o.card.name}</button>`)}</div></details>`}
            ${selected.length === 0 && cmdOpts.length > 0 && html`<div class="small muted">Best supported: ${cmdOpts.slice(0, 5).map((o, i) => html`${i ? ', ' : ''}<a href="#" onClick=${(e) => { e.preventDefault(); set({ commanders: [o.card.oracle_id] }); }}>${o.card.name}</a>`)} · <a href="#/commanders">see all</a></div>`}
            ${cmdOpts.length === 0 && html`<${Alert} kind="warn">No free legendary creatures in your collection.</${Alert}>`}
          </div>`}
          ${opts.randomCommander && html`<span class="small faint">Chooses from your free commanders, weighted towards ones with lots of supporting cards.</span>`}
        </div>` : html`<div class="grid cols-2">
          <label class="field">Colours <span class="hint">Leave empty to let it pick the deepest colours</span><${ColourPicker} value=${opts.colors} onChange=${(v) => set({ colors: v })} /></label>
          <label class="field">Archetype<select value=${opts.archetype} onChange=${(e) => set({ archetype: e.target.value })}>
            <option value="auto">Surprise me</option>${Object.entries(ARCHETYPE_LABELS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        </div>`}
      </div>

      <div class="card stack">
        <div>
          <div class="section-title">Themes <span class="faint" style="text-transform:none;letter-spacing:0">— optional, leave empty for auto</span></div>
          <div class="chips">${Object.entries(THEMES).map(([k, t]) => {
            const on = opts.themes.includes(k);
            return html`<button type="button" class=${`chip${on ? ' on' : ''}`} onClick=${() => set({ themes: on ? opts.themes.filter((x) => x !== k) : [...opts.themes, k] })}>${t.label}</button>`;
          })}</div>
        </div>
        <div class="grid cols-2">
          <label class="field">Creature type<select value=${opts.tribe} onChange=${(e) => set({ tribe: e.target.value })}>
            <option value="">Auto / none</option>${tribes.map((t) => html`<option value=${t}>${t}</option>`)}</select></label>
          <label class="field">Favour words in rules text <span class="hint">Comma-separated, e.g. treasure, flying</span><input type="text" value=${opts.keywords} onInput=${(e) => set({ keywords: e.target.value })} /></label>
        </div>
        <div class="grid cols-2">
          ${opts.format === 'commander' && html`<label class="field">Power level<${Segmented} value=${opts.power} onChange=${(v) => set({ power: v })} options=${[['casual', 'Casual'], ['focused', 'Focused'], ['optimized', 'Optimised']]} /></label>`}
          <label class="field">Randomness <span class="hint">${opts.randomness < 15 ? 'Best cards every time' : opts.randomness < 50 ? 'A bit of variety' : opts.randomness < 80 ? 'Lots of variety' : 'Chaos'}</span>
            <input type="range" min="0" max="100" value=${opts.randomness} onInput=${(e) => set({ randomness: +e.target.value })} /></label>
        </div>
      </div>

      <details class="card">
        <summary style="cursor:pointer;font-weight:600">Advanced</summary>
        <div class="stack" style="margin-top: 14px">
          ${opts.format === 'commander' ? html`<div class="grid cols-4">
            ${[['lands', 'Lands', 'auto'], ['ramp', 'Ramp'], ['draw', 'Card draw'], ['removal', 'Interaction'], ['wipe', 'Board wipes']].map(([k, l, ph]) => html`<label class="field">${l}<input type="number" min="0" max="60" placeholder=${ph || ''} value=${opts.targets[k]} onInput=${(e) => set({ targets: { ...opts.targets, [k]: e.target.value } })} /></label>`)}
          </div>` : html`<label class="field">Lands <span class="hint">Blank = by archetype</span><input type="number" min="14" max="30" placeholder="auto" value=${opts.lands60} onInput=${(e) => set({ lands60: e.target.value })} /></label>`}
          <div class="grid cols-2">
            <label class="field">Max mana value<input type="number" min="0" max="16" placeholder="none" value=${opts.maxCmc} onInput=${(e) => set({ maxCmc: e.target.value })} /></label>
            ${opts.format === 'commander' && html`<label class="check small" style="align-self:end;padding-bottom:8px"><input type="checkbox" checked=${opts.noGameChangers} onChange=${(e) => set({ noGameChangers: e.target.checked })} /> Avoid Game Changers (lower brackets)</label>`}
          </div>
          <${PickList} label="Must include" cards=${freeCards} ids=${opts.include} onChange=${(ids) => set({ include: ids })} />
          <${PickList} label="Never include" cards=${freeCards} ids=${opts.exclude} onChange=${(ids) => set({ exclude: ids })} />
          <div><button class="ghost sm" onClick=${() => setOpts({ ...DEFAULT_OPTS, format: opts.format })}>Reset options</button></div>
        </div>
      </details>
    </div>

    <div class="card sticky stack">
      <h3>Ready?</h3>
      <p class="small muted">${opts.format === 'commander' ? 'Builds a 100-card singleton deck with sensible ramp, draw, interaction and land counts, leaning into your commander\'s themes.' : 'Builds a 60-card deck with up to 4 copies of each card (never more than you have free).'}</p>
      <button class="primary" disabled=${!canGo || busy} onClick=${() => go()} style="padding: 12px">${busy ? html`<span class="spinner"></span> Building…` : html`<${Icon} name="wand" /> Build deck`}</button>
      ${!canGo && html`<span class="small faint">Choose a commander or tick “Pick one at random”.</span>`}
      <hr class="divider" />
      <div class="small muted">${plural(freeCards.length, 'free card')} available · ${plural(cmdOpts.length, 'possible commander')}</div>
    </div>
  </div>`;
}

function PickList({ label, cards, ids, onChange }) {
  return html`<div class="stack tight">
    <span class="small muted" style="font-weight:550">${label}</span>
    ${ids.length > 0 && html`<div class="chips">${ids.map((id) => html`<span class="chip">${state.cards.get(id)?.name}<button aria-label="Remove" onClick=${() => onChange(ids.filter((x) => x !== id))}><${Icon} name="x" style="width:13px" /></button></span>`)}</div>`}
    <${CardSearch} cards=${cards} placeholder="Search free cards…" onPick=${(c) => !ids.includes(c.oracle_id) && onChange([...ids, c.oracle_id])} />
  </div>`;
}

// ---------- AI build ----------
const EXAMPLES = [
  'A blue spellslinger Commander deck that makes lots of tokens',
  'Random Commander deck — surprise me, but keep it casual',
  'Mono-green elves, 60 cards, fast and aggressive',
  'A graveyard recursion deck with my best black and green cards',
  'Something that can beat a blue-green ramp deck',
  'Control deck with counterspells and board wipes, 60 cards',
];

function AiBuild({ onResult }) {
  const s = useStore();
  const [prompt, setPrompt] = useState(memory.aiPrompt);
  const [format, setFormat] = useState(memory.aiFormat);
  const [steps, setSteps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const abort = useRef(null);
  useEffect(() => { memory.aiPrompt = prompt; memory.aiFormat = format; }, [prompt, format]);

  if (!s.settings.apiKey) {
    return html`<div class="card"><${Empty} icon="lock" title="Add an Anthropic API key">
      <p>AI building calls Claude with your own API key (billed by Anthropic per use — a deck costs a few cents). The key stays in this browser.</p>
      <a class="btn primary" href="#/settings">Open Settings</a>
    </${Empty}></div>`;
  }
  const run = async () => {
    setBusy(true); setError(null); setSteps([]);
    abort.current = new AbortController();
    try {
      const r = await aiBuild({
        request: prompt, format, cardsById: s.cards, avail: getAvailability(), apiKey: s.settings.apiKey, model: s.settings.model,
        signal: abort.current.signal, onStep: (label) => setSteps((st) => [...st, label]),
      });
      onResult({ ...r, source: 'ai', prompt });
    } catch (e) {
      if (e.kind !== 'abort') setError(e.message);
    } finally { setBusy(false); }
  };
  return html`<div class="split">
    <div class="card stack">
      <label class="field">What do you want to play?
        <textarea rows="4" value=${prompt} onInput=${(e) => setPrompt(e.target.value)} placeholder="e.g. A Commander deck using my blue cards that steals the opponent's stuff" disabled=${busy}
          onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) run(); }}></textarea></label>
      <div class="prompt-examples">${EXAMPLES.map((x) => html`<button type="button" onClick=${() => setPrompt(x)} disabled=${busy}>${x}</button>`)}</div>
      <label class="field">Format<${Segmented} value=${format} onChange=${setFormat} options=${[['auto', 'From my description'], ['commander', 'Commander'], ['casual60', 'Casual 60-card']]} /></label>
      ${error && html`<${Alert} kind="error">${error}</${Alert}>`}
      ${busy && html`<ul class="steps">${steps.map((st, i) => html`<li class=${i < steps.length - 1 ? 'done' : ''}>${i < steps.length - 1 ? html`<${Icon} name="check" />` : html`<span class="spinner"></span>`} ${st}</li>`)}</ul>`}
      <div class="row">
        <button class="primary" disabled=${!prompt.trim() || busy} onClick=${run}>${busy ? 'Building…' : html`<${Icon} name="sparkle" /> Build it`}</button>
        ${busy && html`<button class="ghost" onClick=${() => abort.current?.abort()}>Cancel</button>`}
        <span class="small faint">Ctrl/⌘ + Enter</span>
      </div>
    </div>
    <div class="card stack">
      <h3>How it works</h3>
      <ol class="small muted" style="padding-left:18px;margin:0;display:flex;flex-direction:column;gap:6px">
        <li>Claude reads your request and picks a commander or colours from what you have free.</li>
        <li>The rules engine shortlists ~250 of your best-fitting free cards.</li>
        <li>Claude chooses the final list from that shortlist only.</li>
        <li>Manakeep checks counts, legality and ownership, and fixes anything off.</li>
      </ol>
      <p class="small faint">Model: ${s.settings.model || 'not set'} · <a href="#/settings">change</a></p>
    </div>
  </div>`;
}

// ---------- result ----------
function ResultView({ result, setResult, opts }) {
  const s = useStore();
  const [deck, setDeck] = useState(() => ({ ...newDeck({ ...result.deck, source: result.source, notes: result.deck.notes || '' }), id: null }));
  const [swapFor, setSwapFor] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDeck({ ...newDeck({ ...result.deck, source: result.source, notes: result.deck.notes || '' }), id: null }); }, [result]);

  const reroll = () => {
    if (result.source === 'ai') { setResult(null); return; }
    const r = runQuickBuild(result.opts || opts);
    if (r.error) toast(r.error, 'error'); else setResult({ ...r, source: 'generated', opts: result.opts || opts });
  };
  const save = async (status) => {
    setSaving(true);
    const d = await saveDeck({ ...deck, id: undefined, status });
    toast(`Saved ${d.name}${status === 'built' ? ' — its cards are now locked' : ''}`, 'good', 5000);
    setResult(null);
    navigate(`#/deck/${d.id}`);
  };
  const sum = result.summary || {};
  const cmdCards = deck.cards.filter((e) => e.board === 'commander').map((e) => s.cards.get(e.oracle_id)).filter(Boolean);

  return html`<div>
    <div class="row" style="margin-bottom: 8px"><a href="#" class="small muted row tight" onClick=${(e) => { e.preventDefault(); setResult(null); }}><${Icon} name="back" style="width:14px" /> Back to options</a></div>
    <div class="page-head" style="align-items:flex-start">
      <div class="grow">
        <input class="inline-edit" value=${deck.name} aria-label="Deck name" onInput=${(e) => setDeck({ ...deck, name: e.target.value })} />
        <div class="row tight" style="margin-top:6px">
          <span class="badge accent">${result.source === 'ai' ? 'AI build' : 'Generated'}</span>
          ${(sum.identity || sum.colors) && html`<${ColourIdentity} ids=${sum.identity || sum.colors} />`}
          ${sum.archetype && html`<span class="badge">${ARCHETYPE_LABELS[sum.archetype] || sum.archetype}</span>`}
          ${sum.tribe && html`<span class="badge">${sum.tribe}</span>`}
          ${(sum.themes || []).slice(0, 3).map((t) => html`<span class="badge">${THEMES[t]?.label || t}</span>`)}
        </div>
      </div>
      <div class="row tight">
        <button onClick=${reroll}><${Icon} name=${result.source === 'ai' ? 'edit' : 'refresh'} /> ${result.source === 'ai' ? 'New prompt' : 'Reroll'}</button>
        <button disabled=${saving} onClick=${() => save('draft')}>Save as draft</button>
        <button class="primary" disabled=${saving} onClick=${() => save('built')}><${Icon} name="check" /> Save as built</button>
      </div>
    </div>
    <div class="split">
      <div class="stack">
        ${result.ai?.strategy && html`<div class="strategy"><b>Game plan.</b> ${result.ai.strategy}</div>`}
        ${result.warnings?.length > 0 && html`<${Alert} kind="warn"><ul>${result.warnings.map((w) => html`<li>${w}</li>`)}</ul></${Alert}>`}
        <${ValidationList} deck=${deck} />
        <div class="card"><${DeckContents} deck=${deck} editable onChange=${setDeck} showReasons onSwap=${setSwapFor} /></div>
        ${result.ai?.usage && html`<p class="small faint">Used ${result.ai.usage.input_tokens.toLocaleString()} input + ${result.ai.usage.output_tokens.toLocaleString()} output tokens.</p>`}
      </div>
      <div class="card sticky"><${DeckStatsPanel} deck=${deck} /></div>
    </div>
    ${swapFor && html`<${SwapModal} deck=${deck} oracleId=${swapFor} onClose=${() => setSwapFor(null)} onSwap=${(o, i) => setDeck(applySwap(deck, o, i))} />`}
  </div>`;
}
