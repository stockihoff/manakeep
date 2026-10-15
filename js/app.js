import { html, render, useState, useEffect } from './vendor/preact-htm.js';
import { useStore, init, dismissToast } from './store.js';
import { Icon, Logo, hidePreview } from './ui/common.js';
import { CollectionView } from './ui/collection.js';
import { DecksView } from './ui/decks.js';
import { DeckView } from './ui/deck.js';
import { BuildView } from './ui/build.js';
import { CommandersView } from './ui/commanders.js';
import { SettingsView } from './ui/settings.js';
import { CardModal } from './ui/cardmodal.js';
import { FolderStatus, FolderPrompts } from './ui/folder.js';

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, params: new URLSearchParams(query) };
}

function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => { setRoute(parseHash()); hidePreview(); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

const NAV = [
  ['collection', 'Collection', 'library'],
  ['decks', 'Decks', 'decks'],
  ['build', 'Build', 'wand'],
  ['commanders', 'Commanders', 'crown'],
  ['settings', 'Settings', 'gear'],
];

function App() {
  const s = useStore();
  const { parts, params } = useRoute();
  const page = parts[0] || (s.collection.length ? 'decks' : 'collection');
  // Pin the default route once data has loaded so later state changes don't swap pages underneath the user.
  useEffect(() => { if (s.ready && !parts[0]) window.location.replace(`#/${page}`); }, [s.ready]);

  useEffect(() => {
    const titles = { collection: 'Collection', decks: 'Decks', deck: 'Deck', build: 'Build', commanders: 'Commanders', settings: 'Settings' };
    document.title = `${titles[page] || ''}${titles[page] ? ' · ' : ''}Manakeep`;
  }, [page]);

  let view;
  if (s.error) view = html`<div class="card"><h2>Something went wrong</h2><p>${s.error}</p><p class="muted">Manakeep needs IndexedDB. Private browsing windows sometimes block it.</p></div>`;
  else if (!s.ready) view = html`<div class="row" style="justify-content:center;padding:60px"><span class="spinner"></span></div>`;
  else if (page === 'collection') view = html`<${CollectionView} />`;
  else if (page === 'decks') view = html`<${DecksView} />`;
  else if (page === 'deck') view = html`<${DeckView} id=${parts[1]} key=${parts[1]} />`;
  else if (page === 'build') view = html`<${BuildView} params=${params} />`;
  else if (page === 'commanders') view = html`<${CommandersView} />`;
  else if (page === 'settings') view = html`<${SettingsView} />`;
  else view = html`<div class="card"><h2>Page not found</h2><a href="#/decks">Go to decks</a></div>`;

  const active = page === 'deck' ? 'decks' : page;
  return html`
    <header class="topbar"><div class="topbar-inner">
      <a class="logo" href="#/decks"><${Logo} />Manakeep</a>
      <nav class="nav">${NAV.map(([k, label, icon]) => html`<a href=${`#/${k}`} class=${active === k ? 'active' : ''}><${Icon} name=${icon} />${label}</a>`)}</nav>
      <span class="spacer"></span>
      ${s.ready && html`<${FolderStatus} />`}
    </div></header>
    <main>${s.ready && html`<${FolderPrompts} />`}${view}</main>
    <${CardModal} />
    <div class="toasts" aria-live="polite">${s.toasts.map((t) => html`<div class=${`toast ${t.kind}`}><span class="grow">${t.msg}</span><button class="ghost icon sm" aria-label="Dismiss" onClick=${() => dismissToast(t.id)}><${Icon} name="x" /></button></div>`)}</div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
init();
