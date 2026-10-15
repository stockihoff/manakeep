// Shared UI pieces.
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { state, openCard, toast } from '../store.js';
import { COLORS } from '../engine/cardinfo.js';

export { html };

// ---------- icons (inline SVG, stroke-based) ----------
const P = {
  library: '<path d="M4 19V5M8 19V5M12 19l4-14 4 1.2-4 14z"/>',
  decks: '<rect x="3" y="6" width="13" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/>',
  wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>',
  crown: '<path d="m2 18 2-11 5 5 3-7 3 7 5-5 2 11z"/><path d="M4 21h16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  swap: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  flip: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
};
export function Icon({ name, ...rest }) {
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: P[name] || '' }} ...${rest}></svg>`;
}

export const Logo = () => html`<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1cf7e"/><stop offset="1" stop-color="#b9822a"/></linearGradient></defs><path d="M16 2 28 9v14L16 30 4 23V9z" fill="url(#lg)"/><path d="M16 8l6 3.5v9L16 24l-6-3.5v-9z" fill="none" stroke="#1b1508" stroke-width="2"/><circle cx="16" cy="16" r="2.4" fill="#1b1508"/></svg>`;

// ---------- mana symbols ----------
const symUrl = (s) => `https://svgs.scryfall.io/card-symbols/${s.replace(/\//g, '').toUpperCase()}.svg`;
function Sym({ s }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    const col = COLORS.find((c) => s.includes(c));
    return html`<span class="ms" style=${col ? `background: var(--m-${col})` : ''} title=${`{${s}}`}>${col ? '' : s}</span>`;
  }
  return html`<img src=${symUrl(s)} alt=${`{${s}}`} title=${`{${s}}`} loading="lazy" onError=${() => setBroken(true)} />`;
}
export function ManaCost({ cost, lg }) {
  if (!cost) return null;
  const parts = cost.split(' // ');
  return html`<span class=${`mana${lg ? ' lg' : ''}`}>${parts.map((p, i) => html`${i > 0 ? html`<span class="faint"> // </span>` : ''}${[...p.matchAll(/\{([^}]+)\}/g)].map((m) => html`<${Sym} s=${m[1]} />`)}`)}</span>`;
}
export function ColourIdentity({ ids }) {
  const list = ids && ids.length ? ids : ['C'];
  return html`<span class="mana">${list.map((c) => html`<${Sym} s=${c} />`)}</span>`;
}
export function ColourPicker({ value, onChange, allowColourless }) {
  const toggle = (c) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c].sort((a, b) => COLORS.indexOf(a) - COLORS.indexOf(b)));
  return html`<div class="colour-picker" role="group" aria-label="Colours">
    ${COLORS.map((c) => html`<button type="button" class=${value.includes(c) ? 'on' : ''} onClick=${() => toggle(c)} aria-pressed=${value.includes(c)} title=${c}><img src=${symUrl(c)} alt=${c} /></button>`)}
    ${allowColourless ? html`<button type="button" class=${value.includes('C') ? 'on' : ''} onClick=${() => toggle('C')} title="Colourless"><img src=${symUrl('C')} alt="C" /></button>` : ''}
  </div>`;
}

// ---------- card name with hover preview ----------
let previewEl = null;
function showPreview(card, ev) {
  const src = card?.images?.[0]?.normal;
  if (!src) return;
  if (!previewEl) { previewEl = document.createElement('img'); previewEl.className = 'hover-preview'; previewEl.alt = ''; document.body.appendChild(previewEl); }
  previewEl.src = src;
  previewEl.style.display = 'block';
  movePreview(ev);
}
function movePreview(ev) {
  if (!previewEl) return;
  const w = 240, h = 335;
  let x = ev.clientX + 18, y = ev.clientY - h / 2;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - 18;
  y = Math.max(8, Math.min(window.innerHeight - h - 8, y));
  previewEl.style.left = `${x}px`; previewEl.style.top = `${y}px`;
}
export function hidePreview() { if (previewEl) previewEl.style.display = 'none'; }

export function CardName({ card, oid, children }) {
  const c = card || state.cards.get(oid);
  if (!c) return html`<span class="muted">${children || 'Unknown card'}</span>`;
  return html`<a class="cardname" href="#" onClick=${(e) => { e.preventDefault(); hidePreview(); openCard(c.oracle_id); }}
    onMouseEnter=${(e) => showPreview(c, e)} onMouseMove=${movePreview} onMouseLeave=${hidePreview}>${children || c.name}</a>`;
}

// ---------- modal ----------
export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement;
    ref.current?.querySelector('input, textarea, select, button.primary')?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, []);
  return html`<div class="modal-backdrop" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
      <div class="modal-head"><h2>${title}</h2><button class="ghost icon" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button></div>
      <div class="modal-body">${children}</div>
      ${footer ? html`<div class="modal-foot">${footer}</div>` : ''}
    </div>
  </div>`;
}

export function Segmented({ options, value, onChange }) {
  return html`<div class="segmented" role="radiogroup">${options.map(([v, label]) => html`<button type="button" role="radio" aria-checked=${value === v} class=${value === v ? 'on' : ''} onClick=${() => onChange(v)}>${label}</button>`)}</div>`;
}

export function Alert({ kind = 'info', children }) {
  const icon = kind === 'error' || kind === 'warn' ? 'alert' : kind === 'good' ? 'check' : 'info';
  return html`<div class=${`alert ${kind}`}><${Icon} name=${icon} /><div class="grow">${children}</div></div>`;
}

export function Empty({ icon = 'layers', title, children }) {
  return html`<div class="empty"><${Icon} name=${icon} /><h3>${title}</h3><div>${children}</div></div>`;
}

export const money = (n) => (n == null || Number.isNaN(n) ? '—' : `$${n.toFixed(n >= 100 ? 0 : 2)}`);
export const plural = (n, s, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;

export async function copyText(text, label = 'Copied to clipboard') {
  try { await navigator.clipboard.writeText(text); toast(label, 'good'); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(label, 'good'); } catch { toast("Couldn't copy — select the text manually.", 'error'); }
    ta.remove();
  }
}

export function downloadFile(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function navigate(hash) { window.location.hash = hash; }

/** Debounced value hook. */
export function useDebounced(value, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Card search box over a list of cards (local), calls onPick(card). */
export function CardSearch({ cards, onPick, placeholder = 'Search cards…', renderMeta, autoFocus }) {
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const dq = useDebounced(q, 80);
  const results = (() => {
    const s = dq.trim().toLowerCase();
    if (s.length < 2) return [];
    const starts = [], contains = [];
    for (const c of cards) {
      const n = c.name.toLowerCase();
      if (n.startsWith(s)) starts.push(c); else if (n.includes(s)) contains.push(c);
      if (starts.length > 30) break;
    }
    return [...starts, ...contains].slice(0, 12);
  })();
  const pick = (c) => { onPick(c); setQ(''); setHl(0); };
  return html`<div class="relative">
    <input type="search" value=${q} placeholder=${placeholder} autoFocus=${autoFocus}
      onInput=${(e) => { setQ(e.target.value); setHl(0); }}
      onKeyDown=${(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(results.length - 1, h + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); }
        else if (e.key === 'Enter' && results[hl]) { e.preventDefault(); pick(results[hl]); }
        else if (e.key === 'Escape') setQ('');
      }} />
    ${results.length > 0 && html`<div class="search-results">${results.map((c, i) => html`
      <button type="button" class=${i === hl ? 'hl' : ''} onMouseEnter=${() => setHl(i)} onClick=${() => pick(c)}>
        <span class="grow">${c.name}</span>${renderMeta ? renderMeta(c) : html`<${ManaCost} cost=${c.mana_cost} />`}
      </button>`)}</div>`}
  </div>`;
}
