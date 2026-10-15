import { html } from '../vendor/preact-htm.js';
import { useStore, connectFolder, reconnectFolder, disconnectFolder, resolveFolderChoice, saveNow } from '../store.js';
import { Icon, Modal, Alert } from './common.js';

const ago = (t) => {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(t).toLocaleString();
};

/** Small status pill for the top bar. */
export function FolderStatus() {
  const { folder } = useStore();
  if (folder.status === 'unsupported') return null;
  if (folder.status === 'none') return html`<a class="save-pill muted" href="#/settings" title="Your data is only in this browser. Choose a folder in Settings to save it to disk."><span class="dot off"></span>Not saving to a folder</a>`;
  if (folder.status === 'reconnect') return html`<button class="save-pill warn" onClick=${reconnectFolder} title="Click to keep saving to your folder"><span class="dot warn"></span>Reconnect folder</button>`;
  if (folder.status === 'error') return html`<button class="save-pill bad" onClick=${saveNow} title=${folder.error}><span class="dot bad"></span>Save failed — retry</button>`;
  const label = folder.status === 'saving' ? 'Saving…' : `Saved to ${folder.name}`;
  return html`<span class="save-pill" title=${folder.savedAt ? `Last saved ${ago(folder.savedAt)}` : ''}><span class=${`dot ${folder.status === 'saving' ? 'busy' : 'ok'}`}></span>${label}</span>`;
}

/** Banner + modal that need the user's attention. */
export function FolderPrompts() {
  const { folder } = useStore();
  return html`
    ${folder.status === 'reconnect' && html`<div class="banner">
      <${Icon} name="alert" />
      <span class="grow">Reconnect to your save folder <b>${folder.name}</b> to keep saving there. Your browser asks once per visit — choose “Allow on every visit” to skip this.</span>
      <button class="primary sm" onClick=${reconnectFolder}>Reconnect</button>
    </div>`}
    ${folder.choice && html`<${Modal} title="This folder already has Manakeep data" onClose=${() => resolveFolderChoice(null)} footer=${html`
      <button class="ghost" onClick=${() => resolveFolderChoice(null)}>Cancel</button>
      <button onClick=${() => resolveFolderChoice('save')}>Replace it with this browser's data</button>
      <button class="primary" onClick=${() => resolveFolderChoice('open')}>Use the folder's data</button>`}>
      <p><b>${folder.choice.name}</b> has a collection of ${folder.choice.cards} cards and ${folder.choice.decks} decks, saved ${ago(folder.choice.savedAt)}.</p>
      <p class="muted">Use the folder's data if you've been using Manakeep on another computer. Replace it only if this browser has the newer copy.</p>
    </${Modal}>`}
  `;
}

/** Settings card. */
export function FolderSettings() {
  const { folder } = useStore();
  if (folder.status === 'unsupported') {
    return html`<div class="card stack"><h3>Save folder</h3>
      <${Alert} kind="warn">Open Manakeep in <b>Microsoft Edge</b> or <b>Google Chrome</b> to save to a folder. Until then your data stays in this browser; use Backup below to keep a copy.</${Alert}></div>`;
  }
  const connected = folder.status !== 'none';
  return html`<div class="card stack">
    <h3>Save folder</h3>
    <p class="small muted">Like Quillkeep, Manakeep can save everything into a folder you choose, every time something changes. Pick a folder inside OneDrive or Google Drive and your collection and decks follow you to other computers.</p>
    ${connected ? html`<div class="stack tight">
      <div class="row tight"><${Icon} name="check" style="width:16px;color:var(--good)" /> <span>Saving to <b>${folder.name}</b>${folder.status === 'reconnect' ? ' (needs reconnecting)' : ''}</span></div>
      <div class="small faint">Inside: <span class="mono">Decks/*.txt</span> (Moxfield-style lists), <span class="mono">Collection.csv</span>, and a hidden <span class="mono">.manakeep</span> folder Manakeep loads from.</div>
      <div class="row tight">
        ${folder.status === 'reconnect' ? html`<button class="primary" onClick=${reconnectFolder}>Reconnect</button>` : html`<button onClick=${saveNow}><${Icon} name="refresh" /> Save now</button>`}
        <button onClick=${connectFolder}>Choose a different folder</button>
        <button class="ghost" onClick=${disconnectFolder}>Stop saving here</button>
      </div>
    </div>` : html`<div class="row tight"><button class="primary" onClick=${connectFolder}><${Icon} name="upload" /> Choose save folder</button></div>`}
  </div>`;
}
