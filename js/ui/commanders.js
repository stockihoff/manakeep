import { html, useState, useMemo } from '../vendor/preact-htm.js';
import { useStore, getAvailability } from '../store.js';
import { Icon, Empty, ColourPicker, ColourIdentity, CardName, Segmented, plural, navigate } from './common.js';
import { commanderOptions, makePool, info } from '../engine/builder.js';
import { THEMES } from '../engine/cardinfo.js';

export function CommandersView() {
  const s = useStore();
  const [colours, setColours] = useState([]);
  const [exact, setExact] = useState('includes');
  const [sort, setSort] = useState('support');
  const list = useMemo(() => commanderOptions(makePool(s.cards, getAvailability())), [s.version]);
  const filtered = list.filter((o) => {
    if (!colours.length) return true;
    const ci = o.card.color_identity;
    return exact === 'exact' ? ci.length === colours.length && colours.every((c) => ci.includes(c)) : colours.every((c) => ci.includes(c));
  }).sort(sort === 'support' ? (a, b) => b.spells - a.spells : sort === 'theme' ? (a, b) => b.themed - a.themed || b.spells - a.spells : (a, b) => a.card.name.localeCompare(b.card.name));

  return html`<div>
    <div class="page-head"><div><h1>Commanders</h1><p>Every free legendary you could build around, ranked by how many free cards fit their colours.</p></div></div>
    ${list.length === 0 ? html`<div class="card"><${Empty} icon="crown" title="No free commanders">${s.collection.length ? 'Every legendary creature you own is already in a built deck.' : html`<a href="#/collection">Import your collection</a> first.`}</${Empty}></div>` : html`
    <div class="card row" style="margin-bottom: 14px">
      <${ColourPicker} value=${colours} onChange=${setColours} />
      <${Segmented} value=${exact} onChange=${setExact} options=${[['includes', 'Includes'], ['exact', 'Exactly']]} />
      <span class="grow"></span>
      <label class="row tight small muted">Sort <select style="width:auto" value=${sort} onChange=${(e) => setSort(e.target.value)}>
        <option value="support">Most support</option><option value="theme">Best theme fit</option><option value="name">Name</option></select></label>
    </div>
    <p class="small muted">${plural(filtered.length, 'commander')}</p>
    <div class="grid auto">${filtered.map((o) => {
      const themes = info(o.card).themes.slice(0, 3);
      const weak = o.spells < 60;
      return html`<div class="cmd-tile">
        ${o.card.images?.[0]?.art ? html`<img src=${o.card.images[0].art} alt="" loading="lazy" />` : html`<img alt="" />`}
        <div class="grow">
          <div class="t"><${CardName} card=${o.card} /></div>
          <div class="small muted row tight"><${ColourIdentity} ids=${o.card.color_identity} /> <span style=${weak ? 'color:var(--warn)' : ''}>${o.spells} free spells</span> · ${o.support - o.spells} lands</div>
          ${themes.length > 0 && html`<div class="small faint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${themes.map((t) => THEMES[t]?.label).join(' · ')}${o.themed ? ` (${o.themed} on-theme)` : ''}</div>`}
        </div>
        <button class="icon" title="Build around this" aria-label=${`Build around ${o.card.name}`} onClick=${() => navigate(`#/build?commander=${o.card.oracle_id}`)}><${Icon} name="wand" /></button>
      </div>`;
    })}</div>`}
  </div>`;
}
