// End-to-end UI test. Serves the app locally, mocks Scryfall + Anthropic, drives Chromium.
// Run: node tests/e2e.mjs   (needs playwright available globally)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REAL_CARDS, syntheticCards } from './fixtures.js';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOTS || path.join(root, 'tests', 'shots');
fs.mkdirSync(shots, { recursive: true });

// ---------- static server ----------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
// FILE=1 tests the single-file desktop build opened straight from disk (like the launcher does).
const base = process.env.FILE ? `file://${path.join(root, 'dist', 'Manakeep.html')}` : `http://localhost:${server.address().port}/`;

// ---------- fixtures ----------
const ALL = [...REAL_CARDS, ...syntheticCards(80)];
const byId = new Map(ALL.map((c) => [c.id, c]));
const byName = new Map(ALL.map((c) => [c.name.toLowerCase(), c]));
for (const c of ALL) if (c.card_faces) byName.set(c.card_faces[0].name.toLowerCase(), c);
const bySetCn = new Map(ALL.map((c) => [`${c.set}|${c.collector_number}`, c]));

const csvRows = ALL.map((c, i) => {
  const qty = /Basic/.test(c.type_line) ? 20 : (i % 7 === 0 ? 2 : 1);
  const sid = i % 2 === 0 ? c.id : ''; // half with Scryfall IDs, half by name only
  return `"${c.name}",${c.set},Test Set,${i % 2 === 0 ? c.collector_number : ''},${i % 11 === 0 ? 'foil' : 'normal'},rare,${qty},${1000 + i},${sid},1.00,false,false,near_mint,en,USD`;
});
csvRows.push('"Totally Fake Card",xxx,Nope,1,normal,rare,1,9999,,1.00,false,false,near_mint,en,USD');
const CSV = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency\n' + csvRows.join('\n');

const krenkoDeck = `1 Sol Ring (TST) 1
1 Lightning Bolt
1 Goblin Chieftain
1 Siege-Gang Commander
1 Beetleback Chief
1 Impact Tremors
1 Chaos Warp
1 Arcane Signet
30 Mountain

1 Krenko, Mob Boss`;

// ---------- run ----------
const browser = await pw.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
// Headless Chromium can't show a folder picker, so hand back a folder in the origin-private file system.
await ctx.addInitScript(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('My Manakeep', { create: true });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(`console: ${m.text()}`); });

let anthropicCalls = 0;
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.host === 'api.scryfall.com') {
    if (url.pathname === '/cards/collection') {
      const { identifiers } = JSON.parse(route.request().postData());
      const data = [], not_found = [];
      for (const id of identifiers) {
        const c = id.id ? byId.get(id.id) : id.collector_number ? bySetCn.get(`${id.set}|${id.collector_number}`) : byName.get((id.name || '').toLowerCase());
        if (c && (!id.set || id.set === c.set || id.id)) data.push(c); else not_found.push(id);
      }
      return route.fulfill({ json: { object: 'list', data, not_found } });
    }
    if (url.pathname === '/cards/autocomplete') {
      const q = url.searchParams.get('q').toLowerCase();
      return route.fulfill({ json: { data: ALL.map((c) => c.name).filter((n) => n.toLowerCase().includes(q)).slice(0, 20) } });
    }
    return route.fulfill({ status: 404, json: {} });
  }
  if (url.host === 'api.anthropic.com') {
    if (url.pathname === '/v1/models') return route.fulfill({ json: { data: [{ id: 'claude-test-opus', display_name: 'Test Opus' }, { id: 'claude-test-sonnet', display_name: 'Test Sonnet' }] } });
    if (url.pathname === '/v1/messages') {
      anthropicCalls++;
      const body = JSON.parse(route.request().postData());
      const h = route.request().headers();
      if (h['x-api-key'] !== 'sk-ant-test') return route.fulfill({ status: 401, json: { error: { message: 'bad key' } } });
      const tool = body.tool_choice.name;
      const prompt = body.messages[0].content;
      let input;
      if (tool === 'submit_plan') input = { format: 'commander', deck_name: 'Drake Storm', commanders: ['Talrand, Sky Summoner'], colors: [], archetype: 'control', themes: ['spells'], tribe: null, keywords: ['draw'], must_include: ['Counterspell'], avoid: [], max_cmc: null, power: 'focused', notes: '' };
      else if (tool === 'submit_deck') {
        const nums = [...prompt.matchAll(/^(\d+)\. /gm)].map((m) => +m[1]);
        input = { deck_name: 'Drake Storm', strategy: 'Cast cheap spells, make drakes, counter what matters.', cards: nums.slice(0, 62).map((n) => ({ n, qty: 1, why: n < 5 ? 'Key spell' : undefined })), basics: { U: 37 }, key_cards: ['Talrand, Sky Summoner'] };
      } else {
        input = { summary: 'More card draw.', swaps: [{ out: 'Shock', in: 1, why: 'Better' }] };
      }
      return route.fulfill({ json: { content: [{ type: 'tool_use', id: 't', name: tool, input }], stop_reason: 'tool_use', usage: { input_tokens: 12000, output_tokens: 900 } } });
    }
  }
  if (url.origin + '/' === base || url.href.startsWith(base)) return route.continue();
  return route.abort(); // images, fonts, symbols
});

const step = async (name, fn) => {
  if (process.env.FILE && /folder/.test(name)) { console.log(`- ${name} (skipped from file://; run without FILE=1)`); return; }
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✗ ${name}\n  ${e.message.split('\n')[0]}`); await page.screenshot({ path: path.join(shots, `fail-${name.replace(/\W+/g, '-')}.png`), fullPage: true }); throw e; }
};
const expectText = async (t, timeout = 8000) => page.getByText(t, { exact: false }).first().waitFor({ timeout });

try {
  await page.goto(base);
  await step('welcome screen', async () => { await expectText('Welcome to Manakeep'); await page.screenshot({ path: path.join(shots, '01-welcome.png') }); });

  await step('import ManaBox CSV', async () => {
    await page.getByRole('button', { name: 'Import collection' }).click();
    await page.locator('.modal textarea').fill(CSV);
    await page.locator('.modal').getByRole('button', { name: 'Import', exact: true }).click();
    await expectText('Imported', 15000);
    await expectText("couldn't be matched");
    await expectText('Totally Fake Card');
    await page.screenshot({ path: path.join(shots, '02-import-report.png') });
    await page.getByRole('button', { name: 'Done' }).click();
    await expectText('Cards owned');
  });

  await step('collection table, filters, card modal', async () => {
    await page.locator('input[type=search]').first().fill('goblin');
    await expectText('Goblin Chieftain');
    await page.screenshot({ path: path.join(shots, '03-collection.png') });
    await page.getByText('Goblin Chieftain').first().click();
    await expectText('Other Goblin creatures you control');
    await page.screenshot({ path: path.join(shots, '04-card-modal.png') });
    await page.keyboard.press('Escape');
    await page.locator('input[type=search]').first().fill('');
  });

  await step('import a Moxfield deck as built', async () => {
    await page.goto(base + '#/decks');
    await page.getByRole('button', { name: 'Import a Moxfield deck' }).click();
    await page.locator('.modal input[type=text]').fill('Krenko Goblins');
    await page.locator('.modal textarea').fill(krenkoDeck);
    await page.getByRole('button', { name: 'Next' }).click();
    await expectText('Found');
    const chip = page.locator('.modal .chip', { hasText: 'Krenko, Mob Boss' });
    await chip.waitFor();
    if (!(await chip.getAttribute('class')).includes('on')) await chip.click();
    await page.getByRole('button', { name: 'Save deck' }).click();
    await expectText('Krenko Goblins');
    await expectText('cards'); // validation: deck has 39 cards
    await page.screenshot({ path: path.join(shots, '05-imported-deck.png'), fullPage: true });
  });

  await step('rules-based Commander build excludes locked cards', async () => {
    await page.goto(base + '#/build');
    await page.getByPlaceholder('Search your free legendary creatures…').fill('Talr');
    await page.locator('.search-results button', { hasText: 'Talrand' }).click();
    await page.screenshot({ path: path.join(shots, '06-build-options.png'), fullPage: true });
    await page.getByRole('button', { name: 'Build deck' }).click();
    await expectText('Save as built');
    const names = await page.locator('.deck-line .name').allInnerTexts();
    // Sol Ring is owned x2 (one free); Arcane Signet and Chaos Warp are owned x1 and locked by the Krenko deck.
    const locked = ['Arcane Signet', 'Chaos Warp', 'Lightning Bolt'].filter((n) => names.includes(n));
    if (locked.length) throw new Error('Used a card locked in the Krenko deck: ' + locked.join(', '));
    const qtys = await page.locator('.deck-line .qty').allInnerTexts();
    const total = qtys.reduce((a, q) => a + Number(q), 0);
    if (total !== 100) throw new Error(`Deck has ${total} cards`);
    await page.screenshot({ path: path.join(shots, '07-build-result.png'), fullPage: true });
  });

  await step('swap a card in the result', async () => {
    const line = page.locator('.deck-line', { hasText: 'Counterspell' }).first();
    await line.hover();
    await line.getByRole('button', { name: 'Swap' }).click();
    await expectText('Free cards in your collection');
    await page.screenshot({ path: path.join(shots, '08-swap.png') });
    await page.locator('.modal').getByRole('button', { name: 'Swap in' }).first().click();
  });

  await step('save as built and see deck page', async () => {
    await page.getByRole('button', { name: 'Save as built' }).click();
    await expectText('Its cards are locked out of new decks');
    await expectText('Mana curve');
    await page.screenshot({ path: path.join(shots, '09-deck-page.png'), fullPage: true });
  });

  await step('suggestions tab and export', async () => {
    await page.getByRole('button', { name: 'Suggestions' }).click();
    await expectText('Upgrades from your free cards');
    await page.screenshot({ path: path.join(shots, '10-suggestions.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cards', exact: true }).click();
    await page.getByRole('button', { name: 'Export' }).click();
    const text = await page.locator('.modal textarea').inputValue();
    if (!/^Commander\n1 Talrand/.test(text)) throw new Error('Export text wrong: ' + text.slice(0, 60));
    await page.keyboard.press('Escape');
  });

  await step('60-card surprise build', async () => {
    await page.goto(base + '#/build');
    await page.locator('.segmented button', { hasText: 'Casual 60-card' }).click();
    await page.getByRole('button', { name: 'Build deck' }).click();
    await expectText('Save as built');
    const qtys = await page.locator('.deck-line .qty').allInnerTexts();
    const total = qtys.reduce((a, q) => a + Number(q), 0);
    if (total !== 60) throw new Error(`60-card deck has ${total}`);
    await page.getByRole('button', { name: 'Reroll' }).click();
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await expectText("Doesn't reserve any cards");
  });

  await step('commanders page', async () => {
    await page.goto(base + '#/commanders');
    await expectText('free spells');
    await page.screenshot({ path: path.join(shots, '11-commanders.png'), fullPage: true });
  });

  await step('settings: API key + models', async () => {
    await page.goto(base + '#/settings');
    await page.getByPlaceholder('sk-ant-…').fill('sk-ant-test');
    await page.getByRole('button', { name: 'Save key' }).click();
    await page.locator('select option', { hasText: 'Test Sonnet' }).first().waitFor({ state: 'attached' });
    const val = await page.locator('select').first().inputValue();
    if (val !== 'claude-test-sonnet') throw new Error('default model not chosen: ' + val);
    await page.screenshot({ path: path.join(shots, '12-settings.png'), fullPage: true });
  });

  await step('AI build', async () => {
    await page.goto(base + '#/build');
    await page.getByRole('button', { name: /Describe it to the AI/ }).click();
    await page.locator('textarea').fill('A blue spellslinger deck that makes drakes');
    await page.screenshot({ path: path.join(shots, '13-ai-prompt.png') });
    await page.getByRole('button', { name: /Build it/ }).click();
    await expectText('Game plan', 15000);
    const qtys = await page.locator('.deck-line .qty').allInnerTexts();
    const total = qtys.reduce((a, q) => a + Number(q), 0);
    if (total !== 100) throw new Error(`AI deck has ${total}`);
    await page.screenshot({ path: path.join(shots, '14-ai-result.png'), fullPage: true });
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await expectText('Mana curve');
  });

  await step('save to a folder', async () => {
    await page.goto(base + '#/settings');
    await page.getByRole('button', { name: 'Choose save folder' }).click();
    await expectText('Saved to My Manakeep');
    await page.screenshot({ path: path.join(shots, '12b-save-folder.png'), fullPage: true });
    const files = await page.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('My Manakeep');
      const decks = await root.getDirectoryHandle('Decks');
      const names = []; for await (const [n] of decks.entries()) names.push(n);
      const st = JSON.parse(await (await (await (await root.getDirectoryHandle('.manakeep')).getFileHandle('state.json')).getFile()).text());
      const csv = await (await (await root.getFileHandle('Collection.csv')).getFile()).text();
      return { names, decks: st.decks.length, hasKey: 'apiKey' in (st.settings || {}), csvRows: csv.split('\n').length };
    });
    if (files.decks < 3 || files.names.length !== files.decks || files.hasKey || files.csvRows < 100) throw new Error('folder contents wrong: ' + JSON.stringify(files));
    // an edit autosaves
    await page.goto(base + '#/decks');
    await page.locator('.deck-tile', { hasText: 'Krenko Goblins' }).click();
    await page.locator('.inline-edit').fill('Krenko Party');
    await page.locator('.inline-edit').press('Tab');
    await page.waitForTimeout(1800);
    const renamed = await page.evaluate(async () => {
      const decks = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('My Manakeep')).getDirectoryHandle('Decks');
      const names = []; for await (const [n] of decks.entries()) names.push(n); return names;
    });
    if (!renamed.includes('Krenko Party.txt') || renamed.includes('Krenko Goblins.txt')) throw new Error('rename not saved: ' + renamed.join(', '));
  });

  await step('decks list + conflicts', async () => {
    await page.goto(base + '#/decks');
    await expectText(process.env.FILE ? 'Krenko Goblins' : 'Krenko Party');
    await page.screenshot({ path: path.join(shots, '15-decks.png'), fullPage: true });
  });

  await step('data persists after reload', async () => {
    await page.reload();
    await expectText(process.env.FILE ? 'Krenko Goblins' : 'Krenko Party');
    if (!process.env.FILE) await expectText('Saved to My Manakeep');
  });

  await step('a fresh browser loads everything back from the folder', async () => {
    await page.goto(base + '#/settings');
    await page.getByRole('button', { name: 'Delete all data' }).click();
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await expectText('Not saving to a folder');
    await page.goto(base + '#/settings');
    await page.getByRole('button', { name: 'Choose save folder' }).click();
    await expectText('Loaded your collection');
    await page.goto(base + '#/decks');
    await expectText('Krenko Party');
    await expectText('Drake Storm');
  });

  await step('mobile layout', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '#/collection');
    await expectText('Cards owned');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: path.join(shots, '16-mobile-collection.png'), fullPage: false });
    await page.goto(base + '#/decks');
    await page.locator('.deck-tile').first().click();
    await expectText('Mana curve');
    await page.screenshot({ path: path.join(shots, '17-mobile-deck.png'), fullPage: false });
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow || overflow2) throw new Error('Horizontal overflow on mobile');
  });

  await step('light theme renders', async () => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(base + '#/build');
    await page.screenshot({ path: path.join(shots, '18-light.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(base + '#/decks');
    await page.locator('.deck-tile').first().click();
    await expectText('Mana curve');
    await page.screenshot({ path: path.join(shots, '19-dark-deck.png') });
  });

  await step('backup round trip', async () => {
    await page.goto(base + '#/settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
    const file = await dl.path();
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (json.app !== 'manakeep' || !json.decks.length || json.settings.apiKey) throw new Error('backup content wrong');
  });

  if (errors.length) { console.log('Console errors:\n' + errors.join('\n')); process.exitCode = 1; }
  else console.log(`\nAll steps passed. Anthropic calls: ${anthropicCalls}`);
} catch (e) {
  if (errors.length) console.log('Console errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
