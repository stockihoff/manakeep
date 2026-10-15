// Save-to-folder support (File System Access API, Edge/Chrome), same approach as Quillkeep.
// Folder layout:
//   .manakeep/state.json   collection, decks, settings (machine-readable, what Manakeep loads)
//   .manakeep/cards.json   cached Scryfall card data (so a second PC doesn't need to re-download)
//   Decks/<name>.txt       each deck as a Moxfield-style list (readable, importable anywhere)
//   Collection.csv         your collection as a Moxfield-style CSV

export const FS_OK = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

export async function pickFolder() {
  return window.showDirectoryPicker({ id: 'manakeep', mode: 'readwrite', startIn: 'documents' });
}

export async function permission(dir, request = false) {
  const opts = { mode: 'readwrite' };
  if ((await dir.queryPermission(opts)) === 'granted') return 'granted';
  if (!request) return 'prompt';
  return dir.requestPermission(opts);
}

async function subdir(dir, name, create) {
  try { return await dir.getDirectoryHandle(name, { create }); } catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
}

export async function readJSON(dir, path) {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) { d = await subdir(d, p, false); if (!d) return null; }
  try {
    const fh = await d.getFileHandle(parts.at(-1));
    const f = await fh.getFile();
    return JSON.parse(await f.text());
  } catch (e) {
    if (e.name === 'NotFoundError') return null;
    throw e;
  }
}

export async function writeText(dir, path, text) {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await subdir(d, p, true);
  const fh = await d.getFileHandle(parts.at(-1), { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

export async function removeFile(dir, path) {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) { d = await subdir(d, p, false); if (!d) return; }
  try { await d.removeEntry(parts.at(-1)); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
}

/** Windows-safe file name. */
export function safeName(name) {
  const s = (name || 'Untitled').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (s || 'Untitled').slice(0, 80);
}
