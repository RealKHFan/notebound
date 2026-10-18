// Generates the Android icon resources (launcher, splash, notification,
// shortcuts, widget buttons) from the Notebound mark and Lucide glyphs.
// Run: node tools/make-icons.mjs   (needs rsvg-convert for the PNG mipmaps)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as lucide from 'lucide';

const here = path.dirname(fileURLToPath(import.meta.url));
const res = path.resolve(here, '../../app/src/main/res');
const docs = path.resolve(here, '../../docs');
const write = (rel, text) => {
  const f = path.join(res, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};

const BLUE = '#2E4BD6';
const PAGES = '#B9C6F5';
const SPINE = '#DDE4FB';
const BAND = '#F0A92E';

const rr = (x, y, w, h, r) => {
  const f = (n) => +n.toFixed(2);
  return `M${f(x + r)},${f(y)} H${f(x + w - r)} A${f(r)},${f(r)} 0 0 1 ${f(x + w)},${f(y + r)} V${f(y + h - r)} A${f(r)},${f(r)} 0 0 1 ${f(x + w - r)},${f(y + h)} H${f(x + r)} A${f(r)},${f(r)} 0 0 1 ${f(x)},${f(y + h - r)} V${f(y + r)} A${f(r)},${f(r)} 0 0 1 ${f(x + r)},${f(y)} Z`;
};

// The mark in a 48-unit box (same as web/src/ui/Logo.jsx), scaled into a 108 adaptive canvas.
function mark(scale, off) {
  const t = (v) => v * scale + off;
  const s = (v) => v * scale;
  return {
    pages: rr(t(16.5), t(11.5), s(19), s(27), s(3.5)),
    cover: rr(t(13.5), t(9.5), s(20), s(28), s(3.5)),
    spine: rr(t(13.5), t(9.5), s(3.2), s(28), s(1.4)),
    band: rr(t(27.6), t(8), s(3.6), s(31), s(1.6)),
  };
}

const vec = (size, vp, paths, extra = '') => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${size}dp" android:height="${size}dp"
    android:viewportWidth="${vp}" android:viewportHeight="${vp}"${extra}>
${paths}
</vector>
`;
const fill = (d, color, alpha) => `    <path android:fillColor="${color}"${alpha ? ` android:fillAlpha="${alpha}"` : ''} android:pathData="${d}" />`;

// ---------- launcher (adaptive) ----------
const m = mark(1.8, 10.8);
write('drawable/ic_launcher_foreground.xml', vec(108, 108, [fill(m.pages, PAGES), fill(m.cover, '#FFFFFF'), fill(m.spine, SPINE), fill(m.band, BAND)].join('\n')));
write('drawable/ic_launcher_monochrome.xml', vec(108, 108, [fill(m.pages, '#000000', '0.55'), fill(m.cover, '#000000'), fill(m.band, '#000000')].join('\n')));
write('mipmap-anydpi-v26/ic_launcher.xml', `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_bg" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`);
fs.copyFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher.xml'), path.join(res, 'mipmap-anydpi-v26/ic_launcher_round.xml'));

// splash: mark on a blue disc, the system crops to a circle
write('drawable/ic_splash.xml', vec(108, 108, [`    <path android:fillColor="${BLUE}" android:pathData="M54,0 A54,54 0 1 1 53.99,0 Z" />`, fill(m.pages, PAGES), fill(m.cover, '#FFFFFF'), fill(m.spine, SPINE), fill(m.band, BAND)].join('\n')));

// small mark for the quick-note widget
const w = mark(0.5, 0);
write('drawable/ic_w_logo.xml', vec(24, 24, [`    <path android:fillColor="${BLUE}" android:pathData="${rr(0, 0, 24, 24, 6.5)}" />`, fill(w.pages, PAGES), fill(w.cover, '#FFFFFF'), fill(w.spine, SPINE), fill(w.band, BAND)].join('\n')));

// notification: white silhouette (24dp)
const n = mark(0.5, 0);
write('drawable/ic_notification.xml', vec(24, 24, [fill(n.pages, '#FFFFFF', '0.6'), fill(n.cover, '#FFFFFF'), fill(n.band, '#FFFFFF')].join('\n')));

// ---------- Lucide glyphs -> vector paths ----------
function elementToPath([tag, a]) {
  switch (tag) {
    case 'path': return a.d;
    case 'circle': return `M${+a.cx - +a.r},${a.cy} a${a.r},${a.r} 0 1,0 ${2 * a.r},0 a${a.r},${a.r} 0 1,0 ${-2 * a.r},0`;
    case 'ellipse': return `M${+a.cx - +a.rx},${a.cy} a${a.rx},${a.ry} 0 1,0 ${2 * a.rx},0 a${a.rx},${a.ry} 0 1,0 ${-2 * a.rx},0`;
    case 'rect': {
      const x = +a.x, y = +a.y, wd = +a.width, h = +a.height, r = Math.min(+(a.rx || 0), wd / 2, h / 2);
      return r ? rr(x, y, wd, h, r) : `M${x},${y} h${wd} v${h} h${-wd} Z`;
    }
    case 'line': return `M${a.x1},${a.y1} L${a.x2},${a.y2}`;
    case 'polyline': return 'M' + a.points.trim().split(/\s+/).join(' L');
    case 'polygon': return 'M' + a.points.trim().split(/\s+/).join(' L') + ' Z';
    default: throw new Error('unsupported ' + tag);
  }
}
function glyph(name, color, { size = 24, offset = 0, scale = 1, width = 2 } = {}) {
  const node = lucide[name];
  if (!node) throw new Error('no icon ' + name);
  // one <path> per element: a path that starts with a relative "m" must not be joined to the previous one
  const paths = node.map(elementToPath).map((d) => `        <path android:strokeColor="${color}" android:strokeWidth="${width}" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000" android:pathData="${d}" />`).join('\n');
  return `    <group android:translateX="${offset}" android:translateY="${offset}" android:scaleX="${scale}" android:scaleY="${scale}">
${paths}
    </group>`;
}

// shortcuts: glyph on a soft disc
const shortcuts = { ic_sc_note: 'NotebookPen', ic_sc_list: 'SquareCheckBig', ic_sc_drawing: 'Brush', ic_sc_photo: 'Camera' };
for (const [file, icon] of Object.entries(shortcuts)) {
  write(`drawable/${file}.xml`, vec(48, 48, [`    <path android:fillColor="#E3E8FC" android:pathData="M24,0 A24,24 0 1 1 23.99,0 Z" />`, glyph(icon, BLUE, { offset: 12, scale: 1, width: 2 })].join('\n')));
}
// widget buttons tinted with the widget text color (follows dark mode)
const widgetIcons = { ic_w_list: 'SquareCheckBig', ic_w_drawing: 'Brush', ic_w_photo: 'Camera', ic_w_plus: 'Plus', ic_w_pin: 'Pin' };
for (const [file, icon] of Object.entries(widgetIcons)) {
  write(`drawable/${file}.xml`, vec(24, 24, glyph(icon, '#FFFFFFFF', { width: 1.9 }), '\n    android:tint="@color/widget_text"'));
}

// ---------- legacy PNG launcher icons (Android 7.x) and store icon ----------
const svgMark = (bgShape) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="512" height="512">
${bgShape}
<path fill="${PAGES}" d="${m.pages}"/><path fill="#fff" d="${m.cover}"/><path fill="${SPINE}" d="${m.spine}"/><path fill="${BAND}" d="${m.band}"/>
</svg>`;
const squareSvg = svgMark(`<path fill="${BLUE}" d="${rr(6, 6, 96, 96, 22)}"/>`);
const roundSvg = svgMark(`<circle cx="54" cy="54" r="48" fill="${BLUE}"/>`);
const fullSvg = svgMark(`<rect width="108" height="108" fill="${BLUE}"/>`);
const tmp = fs.mkdtempSync('/tmp/nb-icons-');
fs.writeFileSync(path.join(tmp, 'square.svg'), squareSvg);
fs.writeFileSync(path.join(tmp, 'round.svg'), roundSvg);
fs.writeFileSync(path.join(tmp, 'full.svg'), fullSvg);
const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, px] of Object.entries(dens)) {
  fs.mkdirSync(path.join(res, `mipmap-${d}`), { recursive: true });
  execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), '-o', path.join(res, `mipmap-${d}/ic_launcher.png`), path.join(tmp, 'square.svg')]);
  execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), '-o', path.join(res, `mipmap-${d}/ic_launcher_round.png`), path.join(tmp, 'round.svg')]);
}
fs.mkdirSync(docs, { recursive: true });
execFileSync('rsvg-convert', ['-w', '512', '-h', '512', '-o', path.join(docs, 'icon-512.png'), path.join(tmp, 'full.svg')]);
fs.writeFileSync(path.join(docs, 'icon.svg'), squareSvg);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('icons written to', res);
