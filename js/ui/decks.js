import { html, useState, useMemo } from '../vendor/preact-htm.js';
import { state, useStore, saveDeck, newDeck, resolveDecklist, guessCommander, toast } from '../store.js';
import { Icon, Modal, Alert, Empty, Segmented, ColourIdentity, CardName, money, plural, navigate } from './common.js';
import { conflicts, deckOwnership } from '../engine/pool.js';
import { deckStats, deckIdentity, FORMATS } from '../engine/analyze.js';
import { canBeCommander } from '../engine/cardinfo.js';

export function DecksView() {
  const s = useStore();
  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState('all');
  const cf = useMemo(() => conflicts({ collection: s.collection, decks: s.decks, cardsById: s.cards, unlimitedBasics: s.settings.unlimitedBasics }), [s.version]);
  const list = s.decks.filter((d) => filter === 'all' || d.status === filter || d.format === filter);
  const create = async () => { const d = await saveDeck(newDeck()); navigate(`#/deck/${d.id}`); };

  return html`<div>
    <div class="page-head">
      <div><h1>Decks</h1><p>${plural(s.decks.filter((d) => d.status === 'built').length, 'built deck')} locking cards · ${plural(s.decks.filter((d) => d.status !== 'built').length, 'draft')}</p></div>
      <div class="row tight">
        <button onClick=${create}><${Icon} name="plus" /> New empty deck</button>
        <button onClick=${() => setShowImport(true)}><${Icon} name="upload" /> Import from Moxfield</button>
        <a class="btn primary" href="#/build"><${Icon} name="wand" /> Build a deck</a>
      </div>
    </div>
    ${cf.length > 0 && html`<div style="margin-bottom: 16px"><${ConflictPanel} list=${cf} /></div>`}
    ${s.decks.length === 0 ? html`<div class="card"><${Empty} icon="decks" title="No decks yet">
        <p>Import the decks you've already built so their cards are reserved, then build new ones from what's left.</p>
        <div class="row" style="justify-content:center"><button class="primary" onClick=${() => setShowImport(true)}><${Icon} name="upload" /> Import a Moxfield deck</button><a class="btn" href="#/build">Build one</a></div>
      </${Empty}></div>` : html`
      <div class="row" style="margin-bottom: 14px"><${Segmented} value=${filter} onChange=${setFilter} options=${[['all', 'All'], ['built', 'Built'], ['draft', 'Drafts'], ['commander', 'Commander'], ['casual60', '60-card']]} /></div>
      <div class="grid auto">${list.map((d) => html`<${DeckTile} deck=${d} />`)}</div>`}
    ${showImport && html`<${DeckImportModal} onClose=${() => setShowImport(false)} />`}
  </div>`;
}

function DeckTile({ deck }) {
  const s = state;
  const cmd = deck.cards.find((e) => e.board === 'commander');
  const art = (cmd && s.cards.get(cmd.oracle_id)?.images?.[0]?.art) || (() => {
    const best = deck.cards.map((e) => s.cards.get(e.oracle_id)).filter((c) => c && c.images?.[0]?.art && !/Land/.test(c.type_line)).sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9))[0];
    return best?.images[0].art;
  })();
  const st = deckStats(deck, s.cards);
  const own = deckOwnership(deck, { collection: s.collection, decks: s.decks, cardsById: s.cards, unlimitedBasics: s.settings.unlimitedBasics });
  const short = [...own.values()].filter((v) => v !== 'ok').length;
  const ids = deck.format === 'commander' ? deckIdentity(deck, s.cards) : null;
  return html`<a class="deck-tile" href=${`#/deck/${deck.id}`}>
    <div class="art" style=${art ? `background-image:url("${art}")` : ''}></div>
    <div class="body">
      <h3>${deck.name}</h3>
      <div class="row tight">
        <span class=${`badge ${deck.status === 'built' ? 'good' : ''}`}>${deck.status === 'built' ? 'Built' : 'Draft'}</span>
        <span class="badge">${FORMATS[deck.format]?.label}</span>
        ${ids && html`<${ColourIdentity} ids=${ids} />`}
      </div>
      <div class="small muted">${st.total} cards · ${st.lands} lands · avg ${st.avgCmc.toFixed(1)}${short ? html` · <span style="color:var(--warn)">${short} not free</span>` : ''}</div>
    </div>
  </a>`;
}

function ConflictPanel({ list }) {
  const [open, setOpen] = useState(false);
  return html`<${Alert} kind="warn">
    <div class="row between"><span><b>${plural(list.length, 'card')}</b> ${list.length === 1 ? 'is' : 'are'} used by more built decks than you have copies for.</span>
    <button class="sm" onClick=${() => setOpen(!open)}>${open ? 'Hide' : 'Show'}</button></div>
    ${open && html`<div class="table-wrap" style="margin-top: 8px"><table class="table">
      <thead><tr><th>Card</th><th class="num">Need</th><th class="num">Own</th><th>Decks</th></tr></thead>
      <tbody>${list.map((c) => html`<tr><td><${CardName} oid=${c.oracle_id} /></td><td class="num">${c.need}</td><td class="num">${c.have}</td>
        <td><div class="chips">${c.decks.map((d) => html`<a class="badge" href=${`#/deck/${d.deckId}`}>${d.name}</a>`)}</div></td></tr>`)}</tbody>
    </table></div>`}
  </${Alert}>`;
}

export function DeckImportModal({ onClose }) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState('commander');
  const [status, setStatus] = useState('built');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [commanderIds, setCommanderIds] = useState([]);

  const parse = async () => {
    setBusy(true);
    try {
      const r = await resolveDecklist(text);
      // A trailing 1-2 card "sideboard" made only of legends is almost always the commander (MTGO-style export).
      const side = r.cards.filter((e) => e.board === 'side');
      const isLegend = (e) => canBeCommander(state.cards.get(e.oracle_id) || { type_line: '', oracle_text: '', layout: 'normal' });
      if (!r.cards.some((e) => e.board === 'commander') && side.length && side.length <= 2 && side.every(isLegend)) {
        r.cards = r.cards.map((e) => (e.board === 'side' ? { ...e, board: 'commander' } : e));
      }
      const total = r.cards.reduce((a, e) => a + e.qty, 0);
      const fmt = r.cards.some((e) => e.board === 'commander') || total >= 95 ? 'commander' : total <= 80 ? 'casual60' : format;
      setFormat(fmt);
      let cmds = r.cards.filter((e) => e.board === 'commander').map((e) => e.oracle_id);
      if (fmt === 'commander' && !cmds.length) { const g = guessCommander(r.cards); if (g) cmds = [g]; }
      setCommanderIds(cmds);
      setResult(r);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const save = async () => {
    let cards = result.cards.map((e) => ({ ...e, board: e.board === 'commander' ? 'main' : e.board }));
    if (format === 'commander') cards = cards.map((e) => (commanderIds.includes(e.oracle_id) ? { ...e, board: 'commander', qty: 1 } : e));
    if (format === 'commander') cards = cards.map((e) => (e.board === 'side' ? { ...e, board: 'maybe' } : e));
    const d = await saveDeck(newDeck({ name: name.trim() || guessName(cards), format, status, cards, source: 'moxfield' }));
    toast(`Imported ${d.name}`, 'good');
    onClose();
    navigate(`#/deck/${d.id}`);
  };

  const guessName = (cards) => {
    const c = cards.find((e) => e.board === 'commander');
    return c ? `${state.cards.get(c.oracle_id)?.front_name || 'Imported'} deck` : 'Imported deck';
  };

  const legends = result ? result.cards.filter((e) => canBeCommander(state.cards.get(e.oracle_id) || { type_line: '', oracle_text: '', layout: 'normal' })) : [];
  const total = result ? result.cards.filter((e) => e.board !== 'side' && e.board !== 'maybe').reduce((a, e) => a + e.qty, 0) : 0;

  return html`<${Modal} title="Import a deck" onClose=${onClose} footer=${result ? html`
      <button class="ghost" onClick=${() => setResult(null)}>Back</button>
      <button class="primary" disabled=${!result.cards.length || (format === 'commander' && !commanderIds.length)} onClick=${save}>Save deck</button>` : html`
      <button class="ghost" onClick=${onClose}>Cancel</button>
      <button class="primary" disabled=${!text.trim() || busy} onClick=${parse}>${busy ? html`<span class="spinner"></span> Reading…` : 'Next'}</button>`}>
    ${!result ? html`<div class="stack">
      <${Alert} kind="info">In Moxfield, open the deck → <b>More</b> → <b>Export</b> → copy the text (any format works), then paste it here.</${Alert}>
      <label class="field">Deck name<input type="text" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Optional — guessed from the commander" /></label>
      <label class="field">Decklist<textarea rows="12" class="mono" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${'1 Sol Ring (CMM) 464\n1 Arcane Signet\n...\n\n1 Krenko, Mob Boss'}></textarea></label>
      <div class="row">
        <label class="field">Status<${Segmented} value=${status} onChange=${setStatus} options=${[['built', 'Built (lock cards)'], ['draft', 'Draft']]} /></label>
      </div>
    </div>` : html`<div class="stack">
      <${Alert} kind=${result.misses.length ? 'warn' : 'good'}>
        Found <b>${total}</b> cards${result.misses.length ? html`; couldn't match ${result.misses.length}: ${result.misses.slice(0, 8).join(', ')}${result.misses.length > 8 ? '…' : ''}` : '.'}
      </${Alert}>
      <label class="field">Format<${Segmented} value=${format} onChange=${setFormat} options=${[['commander', 'Commander'], ['casual60', 'Casual 60-card']]} /></label>
      ${format === 'commander' && html`<div class="stack tight">
        <span class="small muted" style="font-weight:550">Commander${commanderIds.length > 1 ? 's' : ''} (pick one, or two partners)</span>
        ${legends.length === 0 ? html`<${Alert} kind="error">No card in this list can be a commander.</${Alert}>` : html`<div class="chips">${legends.map((e) => {
          const on = commanderIds.includes(e.oracle_id);
          return html`<button type="button" class=${`chip${on ? ' on' : ''}`} onClick=${() => setCommanderIds(on ? commanderIds.filter((x) => x !== e.oracle_id) : [...commanderIds, e.oracle_id].slice(-2))}>${on ? html`<${Icon} name="crown" style="width:14px" />` : ''}${state.cards.get(e.oracle_id)?.name}</button>`;
        })}</div>`}
      </div>`}
      <label class="field">Status<${Segmented} value=${status} onChange=${setStatus} options=${[['built', 'Built (lock cards)'], ['draft', 'Draft']]} /></label>
    </div>`}
  </${Modal}>`;
}
