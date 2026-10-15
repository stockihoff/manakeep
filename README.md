# Manakeep

Build Magic: The Gathering decks from the cards you **own** — without stealing cards from decks you've already built.

- **Collection**: import a ManaBox or Moxfield CSV (or any plain list). Search, filter by colour/type, see what's free and what's in decks.
- **Decks**: paste Moxfield decklists. Decks marked **Built** lock their cards, so new decks can't use them. Drafts don't reserve anything. Over-used cards are flagged.
- **Builder** (rules-based, free): pick a commander (or roll a random one), choose themes, creature type, power level and randomness. Gets you a legal 100-card Commander deck or a 60-card casual deck with sensible land/ramp/draw/removal counts.
- **AI builder** (optional, uses your Anthropic API key): describe the deck you want in plain English. Claude only picks from cards you have free, and Manakeep fixes any count or legality mistakes.
- **Deck tools**: mana curve, colour pips, role counts, legality checks, swap suggestions from your free cards, AI tuning, and export back to Moxfield.

Everything is stored in your browser (IndexedDB). Card data comes from [Scryfall](https://scryfall.com).

## Put it on GitHub Pages

It's a static site with no build step.

1. Create a new repo on GitHub, e.g. `manakeep`.
2. Upload or push everything in this folder to it.
   ```bash
   cd manakeep
   git init && git add . && git commit -m "Manakeep"
   git branch -M main
   git remote add origin https://github.com/<your-username>/manakeep.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, then save.
4. After a minute it's live at `https://<your-username>.github.io/manakeep/`.

To update it later, commit and push again.

### Running it locally

Browsers block ES modules from `file://`, so serve the folder:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Using it

1. **Collection → Import**: drop in your ManaBox or Moxfield CSV export. Use *Replace* when you re-export your whole collection later. Your decks are kept.
2. **Decks → Import from Moxfield**: in Moxfield, open a deck, use Export, copy the text, and paste it in. Mark decks you've physically assembled as **Built**.
3. **Build**: choose a commander from **Commanders** (ranked by how many free cards support them), or use the builder directly.
4. Save the result as **Built** once you've sleeved it up, and those cards are locked out of future builds.

### Moving between devices

Data lives in one browser. Use **Settings → Download backup** and **Restore backup** to move it, e.g. from your PC to your phone.

### AI building

Add an Anthropic API key under **Settings** (create one at console.anthropic.com). It's stored in this browser's localStorage and sent only to `api.anthropic.com`. Each AI deck makes two API calls, usually around 25k input tokens and 2–4k output tokens. Pick the model in Settings; a Sonnet model is a good default. Set a spend limit in the Anthropic console if you like.

## How the builder works

- Cards are classified from their rules text into roles (ramp, draw, removal, wipes, counters, tutors, protection, recursion) and themes (tokens, +1/+1 counters, graveyard, spells, lifegain, sacrifice, landfall, artifacts, enchantments, blink…).
- Each candidate is scored on quality (EDHREC popularity from Scryfall), synergy with the commander's themes and creature types, your keywords, and curve fit, plus optional randomness.
- Commander: fill role quotas → creature minimum → best remaining cards with curve shaping → land count adjusted to the average mana value → non-basic lands for your colours → basics split by coloured pips.
- 60-card: picks colours (or uses yours), archetype, theme/tribe, then creatures and spells with sensible copy counts (4-ofs for the best, fewer for expensive or legendary cards), capped by how many you have free.

## Development

- `js/engine/` — pure logic (parsers, card classification, availability, builders, AI pipeline). No DOM.
- `js/data/` — IndexedDB and the Scryfall client.
- `js/ui/` — Preact + htm components (vendored in `js/vendor/`, no build step).
- Tests: `node --test tests/*.test.js` (engine + AI with mocked API), `node tests/e2e.mjs` (full UI in headless Chromium with mocked Scryfall/Anthropic; needs Playwright).

Not affiliated with Wizards of the Coast, Scryfall, Moxfield or ManaBox. Card data and images © Scryfall / Wizards of the Coast.
