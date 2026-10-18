// Builds the Notebound UI into app/src/main/assets/web (or --out <dir>).
// Everything is bundled locally: the app has no internet permission.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : args.includes('--test') ? path.resolve(here, '.test-build') : path.resolve(here, '../app/src/main/assets/web');
const watch = args.includes('--watch');
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Compact emoji table generated from the TipTap emoji dataset: [emoji, shortcodes, tags]
function buildEmojiData() {
  const src = path.join(here, 'node_modules/@tiptap/extension-emoji/dist/index.js');
  return import(src).then((mod) => {
    const rows = [];
    for (const e of mod.emojis) {
      if (!e.emoji || !e.shortcodes?.length) continue;
      let emoji = e.emoji;
      // Symbols like ❤ default to text style on Android unless followed by the emoji selector.
      const cps = [...emoji];
      if (cps.length === 1 && /[\u00a9\u00ae\u203c\u2049\u2122\u2139\u2190-\u21ff\u2300-\u23ff\u24c2\u25aa-\u27bf\u2934\u2935\u2b05-\u2b55\u3030\u303d\u3297\u3299]/.test(emoji)) emoji += '\ufe0f';
      rows.push([emoji, e.shortcodes, (e.tags || []).slice(0, 6)]);
    }
    return rows;
  });
}

// KaTeX ships woff, woff2 and ttf; WebView only needs woff2.
const katexWoff2Only = {
  name: 'katex-woff2-only',
  setup(build) {
    build.onLoad({ filter: /katex\.min\.css$/ }, async (a) => {
      let css = await fs.promises.readFile(a.path, 'utf8');
      css = css.replace(/,url\([^)]*?\.woff\) format\("woff"\)/g, '').replace(/,url\([^)]*?\.ttf\) format\("truetype"\)/g, '');
      return { contents: css, loader: 'css', resolveDir: path.dirname(a.path) };
    });
  },
};

const emojiPlugin = {
  name: 'emoji-data',
  setup(build) {
    build.onResolve({ filter: /^virtual:emoji-data$/ }, () => ({ path: 'emoji-data', namespace: 'emoji' }));
    build.onLoad({ filter: /.*/, namespace: 'emoji' }, async () => ({
      contents: JSON.stringify(await buildEmojiData()),
      loader: 'json',
    }));
  },
};

const options = {
  entryPoints: { app: path.join(here, 'src/main.jsx') },
  bundle: true,
  outdir: outDir,
  format: 'iife',
  target: ['chrome80'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: !watch,
  sourcemap: false,
  legalComments: 'none',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'text' },
  assetNames: 'assets/[name]-[hash]',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [katexWoff2Only, emojiPlugin],
  metafile: true,
  logLevel: 'info',
};

// Collect the license of every third-party package that ends up in the bundle.
function writeLicenses(metafile) {
  const roots = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const m = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (m) roots.add(path.resolve(here, m[1]));
  }
  const parts = [];
  for (const root of [...roots].sort()) {
    let pkgJson;
    try { pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { continue; }
    const licFile = fs.readdirSync(root).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    const text = licFile ? fs.readFileSync(path.join(root, licFile), 'utf8').trim() : `License: ${pkgJson.license || 'see package'}`;
    parts.push(`${pkgJson.name} ${pkgJson.version} (${pkgJson.license || 'unknown'})\n${'-'.repeat(60)}\n${text}\n`);
  }
  fs.writeFileSync(path.join(outDir, 'third-party-licenses.txt'),
    'Notebound includes the following open-source software.\nIcons: Lucide (ISC). Fonts: Instrument Sans, Newsreader, JetBrains Mono (SIL Open Font License 1.1).\n\n' + parts.join('\n'));
  return parts.length;
}

const html = fs.readFileSync(path.join(here, 'src/index.html'), 'utf8');
fs.writeFileSync(path.join(outDir, 'index.html'), html);

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  const result = await esbuild.build(options);
  const n = writeLicenses(result.metafile);
  console.log(`licenses of ${n} bundled packages written`);
  if (args.includes('--test')) {
    // Pure modules for the browser unit tests (never shipped in the app).
    await esbuild.build({ ...options, entryPoints: { units: path.join(here, 'tests/unit/entry.js') }, metafile: false, logLevel: 'warning' });
    fs.writeFileSync(path.join(outDir, 'units.html'), '<!DOCTYPE html><meta charset="utf-8"><link rel="stylesheet" href="units.css"><script src="units.js"></script>');
  }
}
