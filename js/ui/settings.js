import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { useStore, updateSettings, exportBackup, importBackup, refreshCardData, wipeEverything, toast } from '../store.js';
import { Icon, Alert, downloadFile, plural } from './common.js';
import { ClearCollectionButton } from './collection.js';
import { FolderSettings } from './folder.js';
import { listModels, defaultModel } from '../engine/ai.js';

export function SettingsView() {
  const s = useStore();
  const [key, setKey] = useState(s.settings.apiKey);
  const [show, setShow] = useState(false);
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState(null);
  const [refresh, setRefresh] = useState(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const fileRef = useRef();

  const loadModels = async (k = s.settings.apiKey) => {
    if (!k) return;
    setLoadingModels(true); setModelError(null);
    try {
      const m = await listModels(k);
      setModels(m);
      if (!s.settings.model || !m.some((x) => x.id === s.settings.model)) await updateSettings({ model: defaultModel(m) });
    } catch (e) { setModelError(e.message); } finally { setLoadingModels(false); }
  };
  useEffect(() => { loadModels(); }, []);

  const saveKey = async () => {
    await updateSettings({ apiKey: key });
    if (key.trim()) { toast('API key saved', 'good'); loadModels(key.trim()); } else { setModels([]); toast('API key removed'); }
  };
  const doBackup = async () => {
    const data = await exportBackup();
    downloadFile(`manakeep-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
  };
  const doRestore = (f) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try { await importBackup(JSON.parse(String(r.result))); toast('Backup restored', 'good'); }
      catch (e) { toast(e.message || "Couldn't read that backup", 'error'); }
    };
    r.readAsText(f);
  };
  const doRefresh = async () => {
    setRefresh({ d: 0, t: s.cards.size });
    try { const n = await refreshCardData((d, t) => setRefresh({ d, t })); toast(`Updated ${n} cards from Scryfall`, 'good'); }
    catch (e) { toast(e.message, 'error'); } finally { setRefresh(null); }
  };

  return html`<div>
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="grid cols-2" style="align-items:start">
      <div class="stack">
        <div class="card stack">
          <h3><${Icon} name="sparkle" style="width:18px;vertical-align:-3px" /> AI deck building</h3>
          <p class="small muted">Uses your own Anthropic API key (from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>). It's stored only in this browser and sent only to api.anthropic.com. Usage is billed to your Anthropic account.</p>
          <label class="field">API key
            <div class="row tight">
              <input class="grow" type=${show ? 'text' : 'password'} value=${key} onInput=${(e) => setKey(e.target.value)} placeholder="sk-ant-…" autocomplete="off" spellcheck="false" />
              <button class="ghost sm" onClick=${() => setShow(!show)}>${show ? 'Hide' : 'Show'}</button>
            </div>
          </label>
          <div class="row tight"><button class="primary" onClick=${saveKey} disabled=${key === s.settings.apiKey}>Save key</button>
            ${s.settings.apiKey && html`<button class="ghost" onClick=${() => { setKey(''); updateSettings({ apiKey: '' }); setModels([]); }}>Remove</button>`}</div>
          ${s.settings.apiKey && html`<label class="field">Model
            <div class="row tight">
              <select class="grow" value=${s.settings.model} onChange=${(e) => updateSettings({ model: e.target.value })} disabled=${!models.length}>
                ${models.length ? models.map((m) => html`<option value=${m.id}>${m.name} (${m.id})</option>`) : html`<option value=${s.settings.model}>${s.settings.model || 'Load models…'}</option>`}
              </select>
              <button class="sm" onClick=${() => loadModels()} disabled=${loadingModels}>${loadingModels ? html`<span class="spinner"></span>` : html`<${Icon} name="refresh" />`}</button>
            </div>
            <span class="hint">A Sonnet model is a good balance of quality and cost.</span>
          </label>`}
          ${modelError && html`<${Alert} kind="error">${modelError}</${Alert}>`}
          <${Alert} kind="warn">Anyone with access to this browser profile could read the key. Don't use Manakeep with a key on a shared computer; you can set a monthly spend limit in the Anthropic console.</${Alert}>
        </div>

        <div class="card stack">
          <h3>Deck building</h3>
          <label class="check"><input type="checkbox" checked=${s.settings.unlimitedBasics} onChange=${(e) => updateSettings({ unlimitedBasics: e.target.checked })} />
            <span>Assume unlimited basic lands<br /><span class="small muted">Most players have piles of basics. Turn off to only use the basics in your collection.</span></span></label>
        </div>
      </div>

      <div class="stack">
        <${FolderSettings} />
        <div class="card stack">
          <h3>Backup</h3>
          <p class="small muted">A single file with your collection, decks and card data — handy for moving to a device without your save folder. The API key is never included.</p>
          <div class="row tight">
            <button onClick=${doBackup}><${Icon} name="download" /> Download backup</button>
            <button onClick=${() => fileRef.current.click()}><${Icon} name="upload" /> Restore backup</button>
            <input type="file" accept=".json,application/json" class="hidden" ref=${fileRef} onChange=${(e) => doRestore(e.target.files[0])} />
          </div>
          <${Alert} kind="info">Restoring replaces everything currently in Manakeep on this device.</${Alert}>
        </div>

        <div class="card stack">
          <h3>Card data</h3>
          <p class="small muted">${plural(s.cards.size, 'card')} cached from Scryfall. Refresh to pick up new prices, legality changes and rules updates.</p>
          <div class="row tight"><button onClick=${doRefresh} disabled=${!!refresh || !s.cards.size}>${refresh ? html`<span class="spinner"></span> ${refresh.d}/${refresh.t}` : html`<${Icon} name="refresh" /> Refresh from Scryfall`}</button></div>
        </div>

        <div class="card stack">
          <h3>Danger zone</h3>
          <div class="row tight"><${ClearCollectionButton} /></div>
          ${confirmWipe
            ? html`<div class="row tight"><span class="small">Delete your collection, decks and cached cards from this browser? (Your save folder isn't touched.)</span><button class="danger sm" onClick=${async () => { await wipeEverything(); setConfirmWipe(false); toast('Deleted from this browser. Your save folder was not touched.'); }}>Delete everything</button><button class="sm ghost" onClick=${() => setConfirmWipe(false)}>Cancel</button></div>`
            : html`<div><button class="danger" onClick=${() => setConfirmWipe(true)}><${Icon} name="trash" /> Delete all data</button></div>`}
        </div>

        <p class="small faint">Manakeep ${document.querySelector('meta[name="manakeep-version"]')?.content || 'dev'} · Manakeep isn't affiliated with Wizards of the Coast, Scryfall, Moxfield or ManaBox. Card data and images © Scryfall / Wizards of the Coast.</p>
      </div>
    </div>
  </div>`;
}
