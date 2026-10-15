import { html, useState, useMemo } from '../vendor/preact-htm.js';
import { state, useStore, saveDeck, deleteDeck, duplicateDeck, getAvailability, toast } from '../store.js';
import { Icon, ManaCost, CardName, Modal, Alert, Empty, Segmented, ColourIdentity, CardSearch, money, plural, copyText, downloadFile, navigate } from './common.js';
import { isBasic, isLand, isCreature, rolesOf, canBeCommander, canPair, withinIdentity, legalIn, COLORS, ROLE_LABELS, singletonLimit, sixtyLimit } from '../engine/cardinfo.js';
import { deckStats, validateDeck, typeGroup, TYPE_ORDER, deckIdentity, FORMATS } from '../engine/analyze.js';
import { deckOwnership } from '../engine/pool.js';
import { swapSuggestions, suggestUpgrades } from '../engine/builder.js';
import { formatDecklist } from '../engine/parsers.js';
import { aiSuggestSwaps } from '../engine/ai.js';

const PRIMARY_ROLES = ['ramp', 'draw', 'removal', 'counter', 'wipe', 'tutor', 'protection', 'recursion', 'threat', 'creature', 'utility'];
const primaryRole = (c) => { const r = rolesOf(c); return isLand(c) ? 'land' : PRIMARY_ROLES.find((x) => r.includes(x)) || 'utility'; };

// ---------- deck contents ----------
export function DeckContents({ deck, editable, onChange, ownership, showReasons, onSwap }) {
  const [groupBy, setGroupBy] = useState('type');
  const cards = state.cards;
  const isCmdFormat = deck.format === 'commander';
  const groups = useMemo(() => {
    const g = new Map();
    for (const e of deck.cards) {
      const c = cards.get(e.oracle_id);
      if (!c) continue;
      let key;
      if (e.board === 'commander') key = 'Commander';
      else if (e.board === 'side') key = 'Sideboard';
      else if (e.board === 'maybe') key = 'Maybeboard';
      else key = groupBy === 'type' ? typeGroup(c) : ROLE_LABELS[primaryRole(c)] || 'Land';
      if (!g.has(key)) g.set(key, []);
      g.get(key).push({ e, c });
    }
    for (const list of g.values()) list.sort((a, b) => a.c.cmc - b.c.cmc || a.c.name.localeCompare(b.c.name));
    const order = groupBy === 'type' ? [...TYPE_ORDER, 'Sideboard', 'Maybeboard'] : ['Commander', ...Object.values(ROLE_LABELS), 'Sideboard', 'Maybeboard'];
    return [...g.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
  }, [deck, groupBy, state.version]);

  const update = (fn) => onChange({ ...deck, cards: fn(deck.cards.map((x) => ({ ...x }))) });
  const setQty = (e, q) => update((list) => list.map((x) => (x.oracle_id === e.oracle_id && x.board === e.board ? { ...x, qty: q } : x)).filter((x) => x.qty > 0));
  const move = (e, board) => update((list) => {
    const rest = list.filter((x) => !(x.oracle_id === e.oracle_id && x.board === e.board));
    return [...rest, { ...e, board, qty: board === 'commander' ? 1 : e.qty }];
  });
  const maxFor = (c) => (isCmdFormat ? singletonLimit(c) : sixtyLimit(c));

  return html`<div>
    <div class="row between" style="margin-bottom: 10px">
      <${Segmented} value=${groupBy} onChange=${setGroupBy} options=${[['type', 'By type'], ['role', 'By role']]} />
      ${ownership && html`<span class="row tight small muted">
        <span class="own-dot own-ok"></span> Free <span class="own-dot own-short" style="margin-left:6px"></span> Shared with a built deck <span class="own-dot own-missing" style="margin-left:6px"></span> Not owned
      </span>`}
    </div>
    <div class="deck-columns">
      ${groups.map(([name, list]) => html`<div class="deck-group">
        <h4><span>${name}</span><span class="faint">${list.reduce((a, x) => a + x.e.qty, 0)}</span></h4>
        ${list.map(({ e, c }) => {
          const own = ownership?.get(e.oracle_id);
          return html`<div class="deck-line">
            ${ownership && html`<span class=${`own-dot own-${own || 'ok'}`} title=${own === 'missing' ? 'Not in your collection' : own === 'short' ? 'Not enough free copies (used by another built deck)' : 'You have this free'}></span>`}
            <span class="qty">${e.qty}</span>
            <span class="name"><${CardName} card=${c} />${showReasons && e.reason && e.board !== 'commander' && html`<span class="reason" title=${e.reason}>${e.reason}</span>`}</span>
            <${ManaCost} cost=${c.mana_cost} />
            ${editable && html`<span class="actions">
              ${e.board !== 'commander' && (isBasic(c) || e.qty < maxFor(c)) && html`<button class="icon sm ghost" title="Add a copy" aria-label="Add a copy" onClick=${() => setQty(e, e.qty + 1)}><${Icon} name="plus" /></button>`}
              ${e.board !== 'commander' && html`<button class="icon sm ghost" title="Remove a copy" aria-label="Remove a copy" onClick=${() => setQty(e, e.qty - 1)}><${Icon} name="minus" /></button>`}
              ${onSwap && e.board !== 'commander' && !isBasic(c) && html`<button class="icon sm ghost" title="Swap for something you own" aria-label="Swap" onClick=${() => onSwap(e.oracle_id)}><${Icon} name="swap" /></button>`}
              ${isCmdFormat && e.board === 'main' && canBeCommander(c) && html`<button class="icon sm ghost" title="Make commander" aria-label="Make commander" onClick=${() => move(e, 'commander')}><${Icon} name="crown" /></button>`}
              ${e.board === 'commander' && html`<button class="icon sm ghost" title="Move to main deck" aria-label="Move to main deck" onClick=${() => move(e, 'main')}><${Icon} name="arrow" /></button>`}
              ${!isCmdFormat && e.board === 'main' && html`<button class="icon sm ghost" title="Move to sideboard" aria-label="Move to sideboard" onClick=${() => move(e, 'side')}><${Icon} name="arrow" /></button>`}
              ${e.board === 'side' && html`<button class="icon sm ghost" title="Move to main deck" aria-label="Move to main deck" onClick=${() => move(e, 'main')}><${Icon} name="back" /></button>`}
            </span>`}
          </div>`;
        })}
      </div>`)}
    </div>
  </div>`;
}

// ---------- stats ----------
const TARGETS = { ramp: 10, draw: 10, removal: 8, wipe: 3 };
export function DeckStatsPanel({ deck }) {
  const st = deckStats(deck, state.cards);
  const max = Math.max(1, ...st.curve);
  const pipSum = Object.values(st.pipTotals).reduce((a, b) => a + b, 0) || 1;
  const identity = deck.format === 'commander' ? deckIdentity(deck, state.cards) : null;
  const interaction = (st.roleCounts.removal || 0) + (st.roleCounts.counter || 0);
  return html`<div class="stack">
    <div class="grid cols-2">
      <div class="stat"><span class="v">${st.total}<span class="faint small">/${FORMATS[deck.format]?.size || 60}</span></span><span class="l">Cards</span></div>
      <div class="stat"><span class="v">${st.lands}</span><span class="l">Lands</span></div>
      <div class="stat"><span class="v">${st.creatures}</span><span class="l">Creatures</span></div>
      <div class="stat"><span class="v">${st.avgCmc.toFixed(2)}</span><span class="l">Avg mana value</span></div>
    </div>
    <div>
      <div class="section-title">Mana curve</div>
      <div class="curve">${st.curve.map((n, i) => html`<div class="bar"><b>${n || ''}</b><div style=${`height:${(n / max) * 100}%`}></div><span>${i === 7 ? '7+' : i}</span></div>`)}</div>
    </div>
    <div>
      <div class="section-title">Coloured pips</div>
      <div class="colour-bar">${COLORS.map((k) => html`<div style=${`width:${(st.pipTotals[k] / pipSum) * 100}%;background:var(--m-${k})`} title=${`${k}: ${Math.round(st.pipTotals[k])}`}></div>`)}</div>
      <div class="small muted" style="margin-top: 4px">${COLORS.filter((k) => st.pipTotals[k] > 0).map((k) => `${k} ${Math.round(st.pipTotals[k])}`).join(' · ') || 'Colourless'}${identity ? html` · Identity <${ColourIdentity} ids=${identity} />` : ''}</div>
    </div>
    <div class="stack tight">
      <div class="section-title">Roles</div>
      ${[['ramp', st.roleCounts.ramp || 0], ['draw', st.roleCounts.draw || 0], ['removal', interaction], ['wipe', st.roleCounts.wipe || 0]].map(([r, n]) => {
        const t = deck.format === 'commander' ? TARGETS[r] : null;
        return html`<div class="role-meter"><span>${r === 'removal' ? 'Interaction' : ROLE_LABELS[r]}</span>
          <div class="track"><div class=${`fill${t && n < t * 0.7 ? ' low' : ''}`} style=${`width:${Math.min(100, (n / (t || 12)) * 100)}%`}></div></div>
          <span class="num" title=${t ? `Typical: ~${t}` : ''}>${n}${t ? html`<span class="faint">/${t}</span>` : ''}</span></div>`;
      })}
      ${['tutor', 'protection', 'recursion'].filter((r) => st.roleCounts[r]).map((r) => html`<div class="role-meter"><span>${ROLE_LABELS[r]}</span><div class="track"><div class="fill" style=${`width:${Math.min(100, (st.roleCounts[r] / 10) * 100)}%`}></div></div><span class="num">${st.roleCounts[r]}</span></div>`)}
    </div>
    <div class="small muted">Est. value ${money(st.usd)}${st.missingPrice ? ` (${st.missingPrice} without prices)` : ''}</div>
  </div>`;
}

export function ValidationList({ deck }) {
  const v = validateDeck(deck, state.cards);
  if (!v.length) return html`<${Alert} kind="good">Deck is legal for ${FORMATS[deck.format]?.label}.</${Alert}>`;
  const errors = v.filter((x) => x.level === 'error'), warns = v.filter((x) => x.level !== 'error');
  return html`<div class="stack tight">
    ${errors.length > 0 && html`<${Alert} kind="error"><ul>${errors.slice(0, 8).map((x) => html`<li>${x.msg}</li>`)}</ul>${errors.length > 8 ? html`<span class="small">…and ${errors.length - 8} more</span>` : ''}</${Alert}>`}
    ${warns.length > 0 && html`<${Alert} kind="warn"><ul>${warns.map((x) => html`<li>${x.msg}</li>`)}</ul></${Alert}>`}
  </div>`;
}

// ---------- swap modal ----------
export function SwapModal({ deck, oracleId, onClose, onSwap, excludeDeckId }) {
  const avail = getAvailability(excludeDeckId);
  const c = state.cards.get(oracleId);
  const list = useMemo(() => swapSuggestions(deck, oracleId, state.cards, avail, { limit: 10 }), [oracleId]);
  return html`<${Modal} title=${`Swap ${c?.name}`} onClose=${onClose}>
    ${list.length === 0 ? html`<${Empty} icon="swap" title="No alternatives">Nothing free in your collection fills the same role in these colours.</${Empty}>` : html`
    <div class="stack tight">
      <p class="muted small">Free cards in your collection that fill a similar role, best fit first.</p>
      ${list.map((x) => html`<div class="deck-line">
        <span class="name"><${CardName} card=${x.card} /><span class="reason">${x.why}</span></span>
        <${ManaCost} cost=${x.card.mana_cost} />
        <button class="sm" onClick=${() => { onSwap(oracleId, x.card.oracle_id); onClose(); }}>Swap in</button>
      </div>`)}
    </div>`}
  </${Modal}>`;
}

export function applySwap(deck, outId, inId) {
  let replaced = false;
  const cards = deck.cards.flatMap((e) => {
    if (!replaced && e.oracle_id === outId && e.board !== 'commander') {
      replaced = true;
      const rest = e.qty > 1 ? [{ ...e, qty: e.qty - 1 }] : [];
      return [...rest, { oracle_id: inId, qty: 1, board: e.board, reason: 'Swapped in' }];
    }
    return [e];
  });
  return { ...deck, cards };
}

// ---------- add-card box ----------
function AddCardBox({ deck, onChange }) {
  const s = useStore();
  const [scope, setScope] = useState('free');
  const identity = deck.format === 'commander' ? deckIdentity(deck, s.cards) : null;
  const avail = getAvailability(deck.id);
  const pool = useMemo(() => {
    const ids = scope === 'free' ? [...avail.keys()] : scope === 'owned' ? [...new Set(s.collection.map((e) => e.oracle_id))] : [...s.cards.keys()];
    return ids.map((id) => s.cards.get(id)).filter((c) => c && (!identity || deck.cards.every((e) => e.board !== 'commander') || withinIdentity(c, identity)) && legalIn(c, deck.format === 'commander' ? 'commander' : 'casual60'))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [scope, s.version, deck.cards.length]);
  const add = (c) => {
    const existing = deck.cards.find((e) => e.oracle_id === c.oracle_id && e.board === 'main');
    const limit = deck.format === 'commander' ? singletonLimit(c) : sixtyLimit(c);
    if (existing && existing.qty >= limit) { toast(`Already at the limit for ${c.name}`, 'warn'); return; }
    const cards = existing ? deck.cards.map((e) => (e === existing ? { ...e, qty: e.qty + 1 } : e)) : [...deck.cards, { oracle_id: c.oracle_id, qty: 1, board: 'main' }];
    onChange({ ...deck, cards });
    toast(`Added ${c.name}`, 'good', 1800);
  };
  return html`<div class="stack tight">
    <div class="row between"><span class="section-title" style="margin:0">Add a card</span>
      <${Segmented} value=${scope} onChange=${setScope} options=${[['free', 'Free'], ['owned', 'All owned'], ['known', 'Any card']]} /></div>
    <${CardSearch} cards=${pool} onPick=${add} placeholder=${scope === 'free' ? 'Search your free cards…' : 'Search…'}
      renderMeta=${(c) => html`<span class="row tight"><${ManaCost} cost=${c.mana_cost} />${avail.get(c.oracle_id) ? '' : html`<span class="badge warn">not free</span>`}</span>`} />
    ${identity && html`<span class="small faint">Limited to the commander's colour identity.</span>`}
  </div>`;
}

// ---------- suggestions tab ----------
function Suggestions({ deck, onChange }) {
  const s = useStore();
  const avail = getAvailability(deck.id);
  const ups = useMemo(() => suggestUpgrades(deck, s.cards, avail, { limit: 10 }), [deck, s.version]);
  const [goal, setGoal] = useState('');
  const [ai, setAi] = useState(null);
  const [busy, setBusy] = useState(false);
  const runAi = async () => {
    setBusy(true); setAi(null);
    try { setAi(await aiSuggestSwaps({ deck, goal, cardsById: s.cards, avail, apiKey: s.settings.apiKey, model: s.settings.model })); }
    catch (e) { toast(e.message, 'error', 7000); } finally { setBusy(false); }
  };
  const swap = (out, inn) => { onChange(applySwap(deck, out.oracle_id, inn.oracle_id)); toast(`Swapped ${out.name} → ${inn.name}`, 'good'); };
  return html`<div class="stack">
    <div class="card">
      <h3>Upgrades from your free cards</h3>
      <p class="small muted">Lower-rated cards in this deck, each paired with a stronger free card that does a similar job.</p>
      ${ups.length === 0 ? html`<p class="muted">No clear upgrades available right now.</p>` : ups.map((u) => html`<div class="swap-row">
        <span><${CardName} card=${u.out} /></span><${Icon} name="arrow" style="width:16px;color:var(--faint)" /><span><${CardName} card=${u.in} /> <span class="small faint">${u.why}</span></span>
        <button class="sm" onClick=${() => swap(u.out, u.in)}>Swap</button></div>`)}
    </div>
    <div class="card">
      <h3><${Icon} name="sparkle" style="width:18px;vertical-align:-3px" /> Ask the AI to tune it</h3>
      ${!s.settings.apiKey ? html`<${Alert} kind="info">Add your Anthropic API key in <a href="#/settings">Settings</a> to get AI suggestions.</${Alert}>` : html`
      <div class="stack tight">
        <textarea rows="2" placeholder="What should change? e.g. “more removal”, “faster”, “lean harder into tokens”, “lower the power level”" value=${goal} onInput=${(e) => setGoal(e.target.value)}></textarea>
        <div class="row"><button class="primary" disabled=${busy} onClick=${runAi}>${busy ? html`<span class="spinner"></span> Thinking…` : 'Suggest swaps'}</button></div>
        ${ai && html`<div class="stack tight" style="margin-top: 6px">
          <div class="strategy">${ai.summary}</div>
          ${ai.swaps.length === 0 ? html`<p class="muted">No valid swaps came back.</p>` : ai.swaps.map((x) => html`<div class="swap-row">
            <span><${CardName} card=${x.out} /></span><${Icon} name="arrow" style="width:16px;color:var(--faint)" /><span><${CardName} card=${x.in} /> <span class="small faint">${x.why}</span></span>
            <button class="sm" disabled=${!deck.cards.some((e) => e.oracle_id === x.out.oracle_id) || deck.cards.some((e) => e.oracle_id === x.in.oracle_id)} onClick=${() => swap(x.out, x.in)}>Swap</button></div>`)}
        </div>`}
      </div>`}
    </div>
  </div>`;
}

// ---------- export ----------
function ExportModal({ deck, onClose }) {
  const [withSets, setWithSets] = useState(false);
  const text = formatDecklist(deck, state.cards, { withSets });
  return html`<${Modal} title="Export decklist" onClose=${onClose} footer=${html`
    <button onClick=${() => downloadFile(`${deck.name.replace(/[^\w\- ]+/g, '').trim() || 'deck'}.txt`, text)}><${Icon} name="download" /> Download .txt</button>
    <button class="primary" onClick=${() => copyText(text)}><${Icon} name="copy" /> Copy</button>`}>
    <div class="stack">
      <label class="check small"><input type="checkbox" checked=${withSets} onChange=${(e) => setWithSets(e.target.checked)} /> Include set codes</label>
      <textarea class="mono" rows="14" readOnly value=${text}></textarea>
      <p class="small muted">Paste into Moxfield's “Import” box (or Arena-style importers). Commander and sideboard sections are labelled.</p>
    </div>
  </${Modal}>`;
}

// ---------- page ----------
export function DeckView({ id }) {
  const s = useStore();
  const deck = s.decks.find((d) => d.id === id);
  const [tab, setTab] = useState('cards');
  const [swapFor, setSwapFor] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  if (!deck) return html`<${Empty} title="Deck not found"><a href="#/decks">Back to decks</a></${Empty}>`;
  const ownership = deckOwnership(deck, { collection: s.collection, decks: s.decks, cardsById: s.cards, unlimitedBasics: s.settings.unlimitedBasics });
  const short = [...ownership.values()].filter((v) => v !== 'ok').length;
  const update = (d) => saveDeck(d);
  const setStatus = (status) => {
    if (status === 'built' && short) toast(`${short} card(s) in this deck aren't free — they'll show as over-used in your collection.`, 'warn', 6000);
    update({ ...deck, status });
  };
  const cmds = deck.cards.filter((e) => e.board === 'commander').map((e) => s.cards.get(e.oracle_id)).filter(Boolean);

  return html`<div>
    <div class="row" style="margin-bottom: 8px"><a href="#/decks" class="small muted row tight"><${Icon} name="back" style="width:14px" /> Decks</a></div>
    <div class="page-head" style="align-items: flex-start">
      <div class="grow">
        <input class="inline-edit" value=${deck.name} aria-label="Deck name" onChange=${(e) => update({ ...deck, name: e.target.value.trim() || 'Untitled deck' })} />
        <div class="row tight" style="margin-top: 6px">
          <span class="badge">${FORMATS[deck.format]?.label}</span>
          ${cmds.length > 0 && html`<span class="badge"><${ColourIdentity} ids=${deckIdentity(deck, s.cards)} /></span>`}
          ${short > 0 && html`<span class="badge warn" title="Cards that are missing or already used by another built deck">${plural(short, 'card')} not free</span>`}
          <span class="small faint">Updated ${new Date(deck.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
      <div class="row tight">
        <div class="stack tight" style="align-items: flex-end">
          <${Segmented} value=${deck.status} onChange=${setStatus} options=${[['draft', 'Draft'], ['built', 'Built']]} />
          <span class="small faint">${deck.status === 'built' ? 'Its cards are locked out of new decks' : "Doesn't reserve any cards"}</span>
        </div>
      </div>
    </div>
    <div class="row tight" style="margin-bottom: 16px">
      <button onClick=${() => setShowExport(true)}><${Icon} name="download" /> Export</button>
      <button onClick=${async () => { const d = await duplicateDeck(deck.id); navigate(`#/deck/${d.id}`); toast('Deck duplicated', 'good'); }}><${Icon} name="copy" /> Duplicate</button>
      ${cmds.length > 0 && html`<button onClick=${() => navigate(`#/build?commander=${cmds[0].oracle_id}`)}><${Icon} name="wand" /> Rebuild with this commander</button>`}
      <span class="grow"></span>
      ${confirmDel
        ? html`<span class="row tight"><span class="small">Delete this deck?</span><button class="danger sm" onClick=${async () => { await deleteDeck(deck.id); navigate('#/decks'); toast('Deck deleted'); }}>Delete</button><button class="sm ghost" onClick=${() => setConfirmDel(false)}>Cancel</button></span>`
        : html`<button class="ghost danger" onClick=${() => setConfirmDel(true)}><${Icon} name="trash" /> Delete</button>`}
    </div>

    <div class="tabs">
      ${[['cards', 'Cards'], ['suggest', 'Suggestions'], ['notes', 'Notes']].map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}
    </div>
    <div class="split">
      <div class="stack">
        ${tab === 'cards' && html`
          <${ValidationList} deck=${deck} />
          <div class="card"><${AddCardBox} deck=${deck} onChange=${update} /></div>
          <div class="card">${deck.cards.length ? html`<${DeckContents} deck=${deck} editable onChange=${update} ownership=${ownership} showReasons=${deck.source === 'generated' || deck.source === 'ai'} onSwap=${setSwapFor} />` : html`<${Empty} title="Empty deck">Search above to add cards.</${Empty}>`}</div>`}
        ${tab === 'suggest' && html`<${Suggestions} deck=${deck} onChange=${update} />`}
        ${tab === 'notes' && html`<div class="card stack">
          <label class="field">Notes<textarea rows="10" value=${deck.notes || ''} onChange=${(e) => update({ ...deck, notes: e.target.value })} placeholder="Game plan, mulligan notes, cards to pick up…"></textarea></label>
        </div>`}
      </div>
      <div class="card sticky"><${DeckStatsPanel} deck=${deck} /></div>
    </div>
    ${swapFor && html`<${SwapModal} deck=${deck} oracleId=${swapFor} excludeDeckId=${deck.id} onClose=${() => setSwapFor(null)} onSwap=${(o, i) => update(applySwap(deck, o, i))} />`}
    ${showExport && html`<${ExportModal} deck=${deck} onClose=${() => setShowExport(false)} />`}
  </div>`;
}
