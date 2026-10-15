import { html, useState, useMemo, useRef, useEffect } from '../vendor/preact-htm.js';
import { useStore, importCollection, getAvailability, getUsage, getOwned, getAllocated, addToCollection, toast, clearCollection } from '../store.js';
import { Icon, ManaCost, CardName, Modal, Alert, Empty, Segmented, ColourPicker, money, plural, useDebounced } from './common.js';
import { isBasic, isLand, isCreature, COLORS, COLOR_NAMES } from '../engine/cardinfo.js';
import { typeGroup } from '../engine/analyze.js';
import { autocomplete } from '../data/scryfall.js';

const PAGE = 60;
const SOURCES = { manabox: 'ManaBox CSV', moxfield: 'Moxfield CSV', csv: 'CSV', text: 'Text list' };

export function CollectionView() {
  const s = useStore();
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [q, setQ] = useState('');
  const [colours, setColours] = useState([]);
  const [type, setType] = useState('all');
  const [avail, setAvail] = useState('all');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(0);
  const dq = useDebounced(q, 150);

  const owned = getOwned();
  const alloc = getAllocated();
  const usage = getUsage();
  const free = getAvailability();

  const rows = useMemo(() => {
    const list = [];
    for (const [oid, n] of owned) {
      const c = s.cards.get(oid);
      if (c) list.push({ c, owned: n, alloc: alloc.get(oid) || 0 });
    }
    return list;
  }, [s.version]);

  const stats = useMemo(() => {
    let cards = 0, value = 0;
    const byColour = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, M: 0 };
    for (const r of rows) {
      cards += r.owned;
      if (r.c.prices?.usd) value += r.c.prices.usd * r.owned;
      if (isBasic(r.c)) continue;
      const ci = r.c.color_identity;
      const k = ci.length === 0 ? 'C' : ci.length > 1 ? 'M' : ci[0];
      byColour[k] += r.owned;
    }
    const inDecks = rows.reduce((a, r) => a + Math.min(r.owned, r.alloc), 0);
    return { cards, unique: rows.length, value, byColour, inDecks };
  }, [rows]);

  const filtered = useMemo(() => {
    const t = dq.trim().toLowerCase();
    let out = rows.filter((r) => {
      const c = r.c;
      if (t && !c.name.toLowerCase().includes(t) && !c.type_line.toLowerCase().includes(t) && !(t.length > 3 && c.oracle_text.toLowerCase().includes(t))) return false;
      if (colours.length) {
        const ci = c.color_identity;
        if (colours.includes('C')) { if (ci.length) return false; }
        else if (!colours.every((x) => ci.includes(x)) || !ci.every((x) => colours.includes(x))) return false;
      }
      if (type !== 'all') {
        if (type === 'Creature' ? !isCreature(c) : type === 'Land' ? !isLand(c) : typeGroup(c) !== type) return false;
      }
      const freeN = free.get(c.oracle_id) || 0;
      if (avail === 'free' && freeN <= 0) return false;
      if (avail === 'used' && r.alloc === 0) return false;
      if (avail === 'over' && (isBasic(c) || r.alloc <= r.owned)) return false;
      return true;
    });
    const cmp = {
      name: (a, b) => a.c.name.localeCompare(b.c.name),
      cmc: (a, b) => a.c.cmc - b.c.cmc || a.c.name.localeCompare(b.c.name),
      price: (a, b) => (b.c.prices?.usd || 0) - (a.c.prices?.usd || 0),
      qty: (a, b) => b.owned - a.owned || a.c.name.localeCompare(b.c.name),
      popular: (a, b) => (a.c.edhrec_rank || 1e9) - (b.c.edhrec_rank || 1e9),
    }[sort];
    return out.sort(cmp);
  }, [rows, dq, colours, type, avail, sort, s.version]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = filtered.slice(pg * PAGE, pg * PAGE + PAGE);
  const resetPage = (fn) => (v) => { fn(v); setPage(0); };

  if (!rows.length) {
    return html`<div>
      <div class="page-head"><div><h1>Collection</h1><p>Import your cards to get started.</p></div></div>
      <${Welcome} onImport=${() => setShowImport(true)} />
      ${showImport && html`<${ImportModal} onClose=${() => setShowImport(false)} />`}
    </div>`;
  }

  const total = Object.values(stats.byColour).reduce((a, b) => a + b, 0) || 1;
  return html`<div>
    <div class="page-head">
      <div><h1>Collection</h1><p>${plural(stats.cards, 'card')} · ${plural(stats.unique, 'unique card')} · ${money(stats.value)} (Scryfall USD)</p></div>
      <div class="row tight">
        <button onClick=${() => setShowAdd(true)}><${Icon} name="plus" /> Add cards</button>
        <button class="primary" onClick=${() => setShowImport(true)}><${Icon} name="upload" /> Import</button>
      </div>
    </div>

    <div class="grid cols-4" style="margin-bottom: 16px">
      <div class="card stat"><span class="v">${stats.cards}</span><span class="l">Cards owned</span></div>
      <div class="card stat"><span class="v">${stats.inDecks}</span><span class="l">In built decks</span></div>
      <div class="card stat"><span class="v">${stats.cards - stats.inDecks}</span><span class="l">Free to build with</span></div>
      <div class="card stack tight">
        <span class="l section-title" style="margin: 0">Colour spread</span>
        <div class="colour-bar" title=${Object.entries(stats.byColour).map(([k, v]) => `${k === 'M' ? 'Multicolour' : COLOR_NAMES[k]}: ${v}`).join('\n')}>
          ${['W', 'U', 'B', 'R', 'G', 'M', 'C'].map((k) => html`<div style=${`width:${(stats.byColour[k] / total) * 100}%;background:${k === 'M' ? 'var(--accent)' : `var(--m-${k})`}`}></div>`)}
        </div>
        <span class="small muted">${['W', 'U', 'B', 'R', 'G'].map((k) => `${k} ${stats.byColour[k]}`).join(' · ')} · Multi ${stats.byColour.M}</span>
      </div>
    </div>

    <div class="card" style="margin-bottom: 14px">
      <div class="row">
        <div class="grow" style="min-width: 200px"><input type="search" placeholder="Search name, type or rules text…" value=${q} onInput=${(e) => { setQ(e.target.value); setPage(0); }} /></div>
        <${ColourPicker} value=${colours} onChange=${resetPage(setColours)} allowColourless />
      </div>
      <div class="row" style="margin-top: 10px">
        <select style="width: auto" value=${type} onChange=${(e) => resetPage(setType)(e.target.value)} aria-label="Type">
          ${[['all', 'All types'], ['Creature', 'Creatures'], ['Instant', 'Instants'], ['Sorcery', 'Sorceries'], ['Artifact', 'Artifacts'], ['Enchantment', 'Enchantments'], ['Planeswalker', 'Planeswalkers'], ['Land', 'Lands']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}
        </select>
        <${Segmented} value=${avail} onChange=${resetPage(setAvail)} options=${[['all', 'All'], ['free', 'Free'], ['used', 'In decks'], ['over', 'Over-used']]} />
        <span class="grow"></span>
        <label class="row tight small muted">Sort
          <select style="width: auto" value=${sort} onChange=${(e) => setSort(e.target.value)}>
            <option value="name">Name</option><option value="cmc">Mana value</option><option value="price">Price</option><option value="qty">Quantity</option><option value="popular">EDHREC popularity</option>
          </select>
        </label>
      </div>
    </div>

    <div class="card flush">
      ${filtered.length === 0 ? html`<${Empty} icon="search" title="No matches">Try clearing a filter.</${Empty}>` : html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Card</th><th class="hide-sm">Type</th><th>Cost</th><th class="num">Owned</th><th class="num">Free</th><th class="hide-sm">Decks</th><th class="num hide-sm">Price</th></tr></thead>
        <tbody>${shown.map((r) => {
          const freeN = free.get(r.c.oracle_id) || 0;
          const basic = isBasic(r.c) && s.settings.unlimitedBasics;
          const used = usage.get(r.c.oracle_id) || [];
          const over = !isBasic(r.c) && r.alloc > r.owned;
          return html`<tr>
            <td><${CardName} card=${r.c} /></td>
            <td class="hide-sm type-line">${r.c.type_line}</td>
            <td><${ManaCost} cost=${r.c.mana_cost} /></td>
            <td class="num">${r.owned}</td>
            <td class="num">${basic ? '∞' : over ? html`<span class="badge bad" title="Built decks use more copies than you own">${r.owned - r.alloc}</span>` : freeN}</td>
            <td class="hide-sm"><div class="chips">${used.slice(0, 3).map((u) => html`<a class=${`badge ${u.status === 'built' ? 'good' : ''}`} href=${`#/deck/${u.deckId}`} title=${u.status === 'built' ? 'Built' : 'Draft'}>${u.name}</a>`)}${used.length > 3 ? html`<span class="badge">+${used.length - 3}</span>` : ''}</div></td>
            <td class="num hide-sm muted">${money(r.c.prices?.usd)}</td>
          </tr>`;
        })}</tbody>
      </table></div>
      ${pages > 1 && html`<div class="pager">
        <button class="sm" disabled=${pg === 0} onClick=${() => setPage(pg - 1)}>Previous</button>
        <span class="small muted">Page ${pg + 1} of ${pages} · ${filtered.length} cards</span>
        <button class="sm" disabled=${pg >= pages - 1} onClick=${() => setPage(pg + 1)}>Next</button>
      </div>`}`}
    </div>
    ${showImport && html`<${ImportModal} onClose=${() => setShowImport(false)} />`}
    ${showAdd && html`<${AddCardsModal} onClose=${() => setShowAdd(false)} />`}
  </div>`;
}

function Welcome({ onImport }) {
  return html`<div class="card welcome" style="padding: 28px">
    <div>
      <h2 style="font-family: var(--font-display); font-size: 1.6rem">Welcome to Manakeep</h2>
      <p class="muted">Build Commander and casual decks from the cards you actually own — without stealing cards from decks you've already sleeved up.</p>
      <ol>
        <li><b>Import your collection</b> — a ManaBox or Moxfield CSV export, or a plain text list.</li>
        <li><b>Add your existing decks</b> — paste each Moxfield decklist. Decks marked <i>Built</i> lock their cards.</li>
        <li><b>Build</b> — pick a commander, roll a random deck, or describe what you want to the AI.</li>
      </ol>
      <div class="row" style="margin-top: 18px"><button class="primary" onClick=${onImport}><${Icon} name="upload" /> Import collection</button></div>
    </div>
    <div class="stack">
      <${Alert} kind="info"><b>Where to find the export</b><br />ManaBox: open your collection and use Export (CSV) in the top-right menu.<br />Moxfield: open your Collection page and choose Export.</${Alert}>
      <${Alert} kind="info">Tip: in <a href="#/settings">Settings</a>, choose a save folder (e.g. in OneDrive) and Manakeep saves your collection and decks there automatically, just like Quillkeep.</${Alert}>
    </div>
  </div>`;
}

export function ImportModal({ onClose }) {
  const s = useStore();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState('replace');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef();

  const readFile = (f) => {
    if (!f) return;
    setFileName(f.name);
    const r = new FileReader();
    r.onload = () => setText(String(r.result));
    r.readAsText(f);
  };
  const run = async () => {
    setBusy(true); setReport(null);
    try {
      const rep = await importCollection(text, { mode, onProgress: (d, t) => setProgress({ d, t }) });
      setReport(rep);
      if (rep.cards) toast(`Imported ${rep.cards} cards`, 'good');
    } catch (e) {
      setReport({ errors: [e.message], misses: [], cards: 0 });
    } finally { setBusy(false); setProgress(null); }
  };

  return html`<${Modal} title="Import collection" onClose=${onClose} footer=${report && report.cards ? html`<button class="primary" onClick=${onClose}>Done</button>` : html`
      <button class="ghost" onClick=${onClose}>Cancel</button>
      <button class="primary" disabled=${!text.trim() || busy} onClick=${run}>${busy ? html`<span class="spinner"></span> Importing…` : 'Import'}</button>`}>
    ${report ? html`<div class="stack">
      ${report.cards > 0 && html`<${Alert} kind="good">Imported <b>${report.cards}</b> cards (${report.unique} unique) from ${SOURCES[report.source] || report.source}.</${Alert}>`}
      ${report.misses?.length > 0 && html`<${Alert} kind="warn"><b>${report.misses.length} row(s) couldn't be matched on Scryfall:</b>
        <ul>${report.misses.slice(0, 12).map((m) => html`<li>${m.name}${m.set ? ` (${m.set.toUpperCase()} ${m.cn})` : ''}</li>`)}</ul>${report.misses.length > 12 ? html`<span class="small">…and ${report.misses.length - 12} more</span>` : ''}</${Alert}>`}
      ${report.errors?.length > 0 && html`<${Alert} kind=${report.cards ? 'warn' : 'error'}><ul>${report.errors.slice(0, 8).map((e) => html`<li>${e}</li>`)}</ul></${Alert}>`}
      ${!report.cards && html`<button onClick=${() => setReport(null)}>Try again</button>`}
    </div>` : html`<div class="stack">
      <div class=${`dropzone${over ? ' over' : ''}`} onClick=${() => fileRef.current.click()}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
        onDrop=${(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files[0]); }}>
        <${Icon} name="upload" />
        <div><b>${fileName || 'Drop a CSV or text file here'}</b></div>
        <div class="small">or click to choose · ManaBox, Moxfield, Deckbox-style CSVs and plain lists all work</div>
        <input type="file" accept=".csv,.txt,text/csv,text/plain" class="hidden" ref=${fileRef} onChange=${(e) => readFile(e.target.files[0])} />
      </div>
      <label class="field">…or paste it
        <textarea rows="6" placeholder=${'Name,Set code,Quantity,...\nor\n4 Lightning Bolt\n1 Sol Ring'} value=${text} onInput=${(e) => { setText(e.target.value); setFileName(''); }}></textarea>
      </label>
      ${s.collection.length > 0 && html`<div class="stack tight">
        <span class="small muted" style="font-weight: 550">How should this combine with your current collection?</span>
        <${Segmented} value=${mode} onChange=${setMode} options=${[['replace', 'Replace (full re-export)'], ['add', 'Add to it (new cards)']]} />
        <span class="small faint">${mode === 'replace' ? 'Use this when you export your whole collection again. Your decks are kept.' : 'Use this for a list of newly acquired cards.'}</span>
      </div>`}
      ${progress && html`<div class="stack tight"><div class="progress"><div style=${`width:${(progress.d / progress.t) * 100}%`}></div></div><span class="small muted">Looking up cards on Scryfall… ${progress.d}/${progress.t}</span></div>`}
    </div>`}
  </${Modal}>`;
}

function AddCardsModal({ onClose }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState([]);
  const dq = useDebounced(q, 250);
  useEffect(() => { let live = true; autocomplete(dq).then((r) => live && setResults(r)).catch(() => live && setResults([])); return () => { live = false; }; }, [dq]);
  const add = async (name) => {
    setBusy(true);
    try { const c = await addToCollection(name, qty); setAdded([{ name: c.name, qty }, ...added]); setQ(''); setResults([]); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return html`<${Modal} title="Add cards" onClose=${onClose} footer=${html`<button class="primary" onClick=${onClose}>Done</button>`}>
    <div class="stack">
      <div class="row">
        <div class="grow relative">
          <input type="search" placeholder="Card name (searches all of Scryfall)" value=${q} onInput=${(e) => setQ(e.target.value)} />
          ${results.length > 0 && html`<div class="search-results">${results.map((n) => html`<button type="button" disabled=${busy} onClick=${() => add(n)}>${n}</button>`)}</div>`}
        </div>
        <label class="row tight small muted">Qty <input type="number" min="1" max="99" value=${qty} onInput=${(e) => setQty(Math.max(1, parseInt(e.target.value || '1', 10)))} /></label>
      </div>
      ${added.length > 0 && html`<div class="stack tight">${added.map((a) => html`<div class="row tight"><${Icon} name="check" style="width:16px;color:var(--good)" /> ${a.qty} × ${a.name}</div>`)}</div>`}
    </div>
  </${Modal}>`;
}

export function ClearCollectionButton() {
  const [confirm, setConfirm] = useState(false);
  return confirm
    ? html`<span class="row tight"><span class="small">Remove all collection entries? Decks are kept.</span><button class="danger sm" onClick=${() => { clearCollection(); setConfirm(false); toast('Collection cleared'); }}>Yes, clear</button><button class="sm ghost" onClick=${() => setConfirm(false)}>Cancel</button></span>`
    : html`<button class="danger" onClick=${() => setConfirm(true)}><${Icon} name="trash" /> Clear collection</button>`;
}
