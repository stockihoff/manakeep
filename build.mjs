// Builds the single-file desktop app: dist/Manakeep.html (everything inlined, runs from file://).
// Usage: npm install --no-save esbuild && node build.mjs
import { build } from 'esbuild';
import fs from 'node:fs';

const VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const js = await build({ entryPoints: ['js/app.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none' });
const css = (await build({ entryPoints: ['css/styles.css'], bundle: true, minify: true, write: false, loader: { '.css': 'css' } })).outputFiles[0].text;
const icon = Buffer.from(fs.readFileSync('icon.svg')).toString('base64');
const code = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="manakeep-version" content="${VERSION}" />
<title>Manakeep</title>
<meta name="theme-color" content="#121419" />
<link rel="icon" href="data:image/svg+xml;base64,${icon}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap" rel="stylesheet" />
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<noscript>Manakeep needs JavaScript.</noscript>
<script>${code}</script>
</body>
</html>
`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/Manakeep.html', html);
console.log(`dist/Manakeep.html  v${VERSION}  ${(html.length / 1024).toFixed(0)} KB`);

// ---------- desktop release folder (like Quillkeep): release/Manakeep ----------
import { execSync } from 'node:child_process';
const R = 'release/Manakeep';
fs.rmSync('release', { recursive: true, force: true });
fs.mkdirSync(`${R}/Launcher`, { recursive: true });
fs.copyFileSync('dist/Manakeep.html', `${R}/Manakeep.html`);
fs.copyFileSync('desktop/Manakeep.cmd', `${R}/Manakeep.cmd`);
fs.copyFileSync('desktop/Install Manakeep (Windows).cmd', `${R}/Install Manakeep (Windows).cmd`);
for (const f of ['install-windows.ps1', 'manakeep.ico', 'README.txt']) fs.copyFileSync(`desktop/${f}`, `${R}/Launcher/${f}`);
// Mac: Manakeep for Mac/{Manakeep.app, Install Manakeep.command, README-Mac.txt}
const M = 'release/mac/Manakeep for Mac';
fs.mkdirSync(M, { recursive: true });
fs.cpSync('desktop/mac', M, { recursive: true });
fs.copyFileSync('dist/Manakeep.html', `${M}/Manakeep.app/Contents/Resources/Manakeep.html`);
fs.chmodSync(`${M}/Manakeep.app/Contents/MacOS/Manakeep`, 0o755);
fs.chmodSync(`${M}/Install Manakeep.command`, 0o755);
execSync(`cd release/mac && zip -qrX "../Manakeep/Manakeep for Mac.zip" "Manakeep for Mac"`);
fs.rmSync('release/mac', { recursive: true, force: true });
console.log(`${R}/ ready`);
