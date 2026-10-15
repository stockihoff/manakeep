import { html, useState } from '../vendor/preact-htm.js';
import { state, useStore, openCard, getUsage, getOwned, getAllocated, setOwnedQty, toast } from '../store.js';
import { Modal, ManaCost, Icon, money, ColourIdentity, navigate } from './common.js';
import { rolesOf, themesOf, ROLE_LABELS, THEMES, isBasic, canBeCommander } from '../engine/cardinfo.js';
import { printImage } from '../data/scryfall.js';

export function CardModal() {
  const s = useStore();
  const [face, setFace] = useState(0);
  const c = s.openCardId && s.cards.get(s.openCardId);
  if (!c) return null;
  const close = () => { setFace(0); openCard(null); };
  const usage = getUsage().get(c.oracle_id) || [];
  const owned = getOwned().get(c.oracle_id) || 0;
  const alloc = getAllocated().get(c.oracle_id) || 0;
  const prints = s.collection.filter((e) => e.oracle_id === c.oracle_id);
  const img = c.images[face]?.normal || c.images[0]?.normal;
  const roles = rolesOf(c).filter((r) => ROLE_LABELS[r] && r !== 'utility');
  const themes = themesOf(c);
  const basic = isBasic(c);

  return html`<${Modal} title=${c.name} onClose=${close} wide>
    <div class="card-detail">
      <div class="stack tight">
        ${img ? html`<img class="card-img" src=${img} alt=${c.name} />` : html`<div class="card-img"></div>`}
        ${c.images.length > 1 && html`<button class="sm" onClick=${() => setFace((face + 1) % c.images.length)}><${Icon} name="flip" /> Flip</button>`}
      </div>
      <div class="stack">
        <div class="row between">
          <div><${ManaCost} cost=${c.mana_cost} lg /></div>
          <div class="row tight">
            ${c.prices?.usd != null && html`<span class="badge">${money(c.prices.usd)}</span>`}
            ${c.game_changer && html`<span class="badge warn" title="On the Commander Game Changers list">Game Changer</span>`}
            <span class="badge">${c.rarity}</span>
          </div>
        </div>
        <div class="type-line">${c.type_line}${c.power != null ? ` · ${c.power}/${c.toughness}` : ''}${c.loyalty != null ? ` · Loyalty ${c.loyalty}` : ''}</div>
        <div class="oracle">${c.oracle_text}</div>
        <div class="chips">
          ${roles.map((r) => html`<span class="badge info">${ROLE_LABELS[r]}</span>`)}
          ${themes.map((t) => html`<span class="badge accent">${THEMES[t]?.label || t}</span>`)}
          <span class="badge">Identity <${ColourIdentity} ids=${c.color_identity} /></span>
          ${c.legal.commander !== 'legal' && html`<span class="badge bad">Commander: ${c.legal.commander.replace('_', ' ')}</span>`}
        </div>
        <hr class="divider" />
        <div class="grid cols-3">
          <div class="stat"><span class="v">${basic && s.settings.unlimitedBasics ? '∞' : owned}</span><span class="l">Owned</span></div>
          <div class="stat"><span class="v">${alloc}</span><span class="l">In built decks</span></div>
          <div class="stat"><span class="v" style=${!basic && owned - alloc < 0 ? 'color: var(--bad)' : ''}>${basic && s.settings.unlimitedBasics ? '∞' : owned - alloc}</span><span class="l">Free</span></div>
        </div>
        ${!basic && html`<div class="row tight">
          <span class="muted small">Owned copies:</span>
          <button class="icon sm" aria-label="Remove a copy" onClick=${() => setOwnedQty(c.oracle_id, Math.max(0, owned - 1))}><${Icon} name="minus" /></button>
          <span class="mono">${owned}</span>
          <button class="icon sm" aria-label="Add a copy" onClick=${() => setOwnedQty(c.oracle_id, owned + 1).then(() => toast(`Added a copy of ${c.name}`, 'good'))}><${Icon} name="plus" /></button>
        </div>`}
        ${usage.length > 0 && html`<div>
          <div class="section-title">Used in</div>
          <div class="stack tight">${usage.map((u) => html`<div class="row tight">
            <a href=${`#/deck/${u.deckId}`} onClick=${close}>${u.name}</a>
            <span class="muted small">×${u.qty}</span>
            <span class=${`badge ${u.status === 'built' ? 'good' : ''}`}>${u.status === 'built' ? 'Built' : 'Draft'}</span>
          </div>`)}</div>
        </div>`}
        ${prints.length > 0 && html`<div>
          <div class="section-title">Your printings</div>
          <div class="chips">${prints.map((p) => html`<a class="chip" href=${printImage(p.print_id, 'large')} target="_blank" rel="noopener">${(p.set || '').toUpperCase()} ${p.cn}${p.foil ? ` · ${p.foil}` : ''} ×${p.qty}</a>`)}</div>
        </div>`}
        <div class="row">
          ${canBeCommander(c) && html`<button class="primary" onClick=${() => { close(); navigate(`#/build?commander=${c.oracle_id}`); }}><${Icon} name="wand" /> Build around this</button>`}
          ${c.scryfall_uri && html`<a class="btn" href=${c.scryfall_uri} target="_blank" rel="noopener"><${Icon} name="external" /> Scryfall</a>`}
        </div>
      </div>
    </div>
  </${Modal}>`;
}
