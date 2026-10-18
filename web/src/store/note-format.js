// The on-disk note format: one self-contained HTML file per note.
// Metadata (color, labels, pin, reminder...) lives inside the file in a JSON
// <script> block, so a backup of the folder is a complete backup.

export const FORMAT_VERSION = 1;

export const COLORS = [
  { id: 'default', name: 'Default', light: null, dark: null },
  { id: 'rose', name: 'Rose', light: '#f6b8ae', dark: '#6b2b2b' },
  { id: 'apricot', name: 'Apricot', light: '#f7c79e', dark: '#683a1d' },
  { id: 'butter', name: 'Butter', light: '#faeba2', dark: '#5c4a12' },
  { id: 'mint', name: 'Mint', light: '#d5efc6', dark: '#2c4a2a' },
  { id: 'sage', name: 'Sage', light: '#b7e0d4', dark: '#1d4c46' },
  { id: 'sky', name: 'Sky', light: '#d0e5f3', dark: '#22475b' },
  { id: 'dusk', name: 'Dusk', light: '#b2c7ea', dark: '#2b3b60' },
  { id: 'lilac', name: 'Lilac', light: '#dbcaee', dark: '#46335f' },
  { id: 'blush', name: 'Blush', light: '#f6d4e2', dark: '#5d2f45' },
  { id: 'clay', name: 'Clay', light: '#e9ddcc', dark: '#4a3e31' },
  { id: 'chalk', name: 'Chalk', light: '#e6e8ec', dark: '#363a42' },
];
export const COLOR_IDS = COLORS.map((c) => c.id);

export const PATTERNS = [
  { id: 'none', name: 'None' },
  { id: 'dots', name: 'Dots' },
  { id: 'grid', name: 'Grid' },
  { id: 'ruled', name: 'Ruled' },
  { id: 'waves', name: 'Waves' },
  { id: 'diagonal', name: 'Diagonal' },
  { id: 'confetti', name: 'Confetti' },
];
export const PATTERN_IDS = PATTERNS.map((p) => p.id);

// Pattern tiles drawn with a neutral translucent ink so they work on every color
// (a dark ink on light themes, a light ink on dark ones).
const INK_LIGHT = 'rgba(40,46,60,0.14)';
const INK_DARK = 'rgba(255,255,255,0.13)';
const patternSvg = (ink) => ({
  dots: `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><circle cx='3' cy='3' r='1.6' fill='${ink}'/></svg>`,
  grid: `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><path d='M24 0H0V24' fill='none' stroke='${ink}' stroke-width='1'/></svg>`,
  ruled: `<svg xmlns='http://www.w3.org/2000/svg' width='8' height='28'><path d='M0 27.5H8' stroke='${ink}' stroke-width='1'/></svg>`,
  waves: `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='20'><path d='M0 10 Q12 2 24 10 T48 10' fill='none' stroke='${ink}' stroke-width='1.4'/></svg>`,
  diagonal: `<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14'><path d='M-2 16 L16 -2' stroke='${ink}' stroke-width='1.2'/></svg>`,
  confetti: `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><g fill='${ink}'><circle cx='12' cy='14' r='2.2'/><rect x='52' y='8' width='7' height='3' rx='1.5' transform='rotate(30 55 9)'/><path d='M30 50 l4 7 h-8z'/><circle cx='72' cy='62' r='1.8'/><rect x='10' y='70' width='8' height='3' rx='1.5' transform='rotate(-40 14 71)'/><circle cx='48' cy='82' r='1.4'/></g></svg>`,
});
export const PATTERN_SVG = patternSvg(INK_LIGHT);
const PATTERN_SVG_DARK = patternSvg(INK_DARK);
export function patternUrl(id, dark = false) {
  const svg = (dark ? PATTERN_SVG_DARK : PATTERN_SVG)[id];
  return svg ? `url("data:image/svg+xml,${encodeURIComponent(svg)}")` : 'none';
}

/**
 * CSS for the app: any element with data-pattern="<id>" gets that background,
 * drawn in a light ink when the app theme is dark.
 */
export function patternCss() {
  const ids = Object.keys(PATTERN_SVG);
  const light = ids.map((id) => `--pat-${id}:${patternUrl(id)}`).join(';');
  const dark = ids.map((id) => `--pat-${id}:${patternUrl(id, true)}`).join(';');
  const uses = ids.map((id) => `[data-pattern="${id}"]{background-image:var(--pat-${id})}`).join('');
  return `:root{${light}}html[data-theme="dark"],html[data-theme="black"]{${dark}}${uses}`;
}

export function newId(len = 8) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  // ids start with a letter so they are always valid in HTML ids / CSS selectors
  if (/^[0-9]/.test(s)) s = 'n' + s.slice(1);
  return s;
}

export function defaultMeta(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: newId(),
    created: now,
    modified: now,
    color: 'default',
    pattern: 'none',
    pinned: false,
    favorite: false,
    archived: false,
    trashed: null,
    labels: [],
    notebooks: [],
    reminder: null,
    order: Date.now(),
    readonly: false,
    locked: null,
    ...overrides,
  };
}

// Make sure metadata read from disk (possibly hand-edited) has sane types.
export function normalizeMeta(raw, fallbackId) {
  const m = defaultMeta();
  const src = raw && typeof raw === 'object' ? raw : {};
  const str = (v, d) => (typeof v === 'string' && v ? v : d);
  const bool = (v) => v === true;
  const out = {
    id: str(src.id, fallbackId || m.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || m.id,
    created: validDate(src.created) || validDate(src.modified) || m.created,
    modified: validDate(src.modified) || validDate(src.created) || m.modified,
    color: COLOR_IDS.includes(src.color) ? src.color : 'default',
    pattern: PATTERN_IDS.includes(src.pattern) ? src.pattern : 'none',
    pinned: bool(src.pinned),
    favorite: bool(src.favorite),
    archived: bool(src.archived),
    trashed: validDate(src.trashed) || null,
    labels: uniqStrings(src.labels),
    notebooks: uniqStrings(src.notebooks),
    reminder: normalizeReminder(src.reminder),
    order: Number.isFinite(src.order) ? src.order : Date.parse(validDate(src.created) || m.created),
    readonly: bool(src.readonly),
    locked: normalizeLocked(src.locked),
  };
  // Keep unknown keys from newer versions so we never destroy data we don't understand.
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out;
}

function validDate(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function uniqStrings(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const s = x.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
export const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
function normalizeReminder(r) {
  if (!r || typeof r !== 'object') return null;
  const at = validDate(r.at);
  if (!at) return null;
  return { at, repeat: REPEATS.includes(r.repeat) && r.repeat !== 'none' ? r.repeat : null };
}
function normalizeLocked(l) {
  if (!l || typeof l !== 'object') return null;
  if (typeof l.data !== 'string' || typeof l.iv !== 'string' || typeof l.salt !== 'string') return null;
  return {
    v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter: Number(l.iter) || 310000, salt: l.salt, iv: l.iv, data: l.data,
    // attachment paths used by the locked note, so cleanup never deletes them
    refs: uniqStrings(l.refs),
  };
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// File names keep the title readable in a file manager and end with the id so they are unique.
export function sanitizeTitleForFile(title) {
  let s = String(title || '').normalize('NFC');
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\\/:*?"<>|#%{}^~\[\]`]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (s.length > 48) s = s.slice(0, 48).replace(/[. ]+$/, '').trim();
  return s || 'Untitled';
}
export function noteFileName(title, id) {
  return `${sanitizeTitleForFile(title)}_${id}.html`;
}
export function idFromFileName(name) {
  const m = /_([a-zA-Z0-9]{4,40})\.html?$/i.exec(name || '');
  return m ? m[1] : null;
}

export function hashString(s) {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(36);
}

// CSS embedded in each note file so it reads nicely when opened in any browser.
export function noteFileCss() {
  const colorRules = COLORS.filter((c) => c.light)
    .map((c) => `html[data-color="${c.id}"]{--nb-bg:${c.light}}@media (prefers-color-scheme:dark){html[data-color="${c.id}"]{--nb-bg:${c.dark}}}`)
    .join('');
  const patternRules = Object.keys(PATTERN_SVG)
    .map((id) => `html[data-pattern="${id}"] body{background-image:${patternUrl(id)}}@media (prefers-color-scheme:dark){html[data-pattern="${id}"] body{background-image:${patternUrl(id, true)}}}`)
    .join('');
  return `:root{color-scheme:light dark;--nb-bg:#fff;--nb-fg:#1c2233;--nb-muted:#5f6779;--nb-rule:rgba(0,0,0,.12);--nb-accent:#2e4bd6}
@media (prefers-color-scheme:dark){:root{--nb-bg:#181c24;--nb-fg:#e5e8ef;--nb-muted:#9aa2b4;--nb-rule:rgba(255,255,255,.16);--nb-accent:#93a6ff}}
${colorRules}${patternRules}
html{background:var(--nb-bg);color:var(--nb-fg)}
body{margin:0;font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background-attachment:local}
.nb-note{max-width:44rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
.nb-title{font-size:1.75rem;line-height:1.25;margin:0 0 1.25rem;font-weight:650}
.nb-content img{max-width:100%;height:auto;border-radius:8px}
.nb-content a{color:var(--nb-accent)}
.nb-content blockquote{margin:1em 0;padding-left:1em;border-left:3px solid var(--nb-rule);color:var(--nb-muted)}
.nb-content pre{background:rgba(127,127,127,.12);padding:.8em 1em;border-radius:8px;overflow:auto;font-size:.88em}
.nb-content code{font-family:ui-monospace,"JetBrains Mono",monospace;font-size:.9em;background:rgba(127,127,127,.14);padding:.1em .3em;border-radius:4px}
.nb-content pre code{background:none;padding:0}
.nb-content table{border-collapse:collapse;width:100%;margin:1em 0}
.nb-content td,.nb-content th{border:1px solid var(--nb-rule);padding:.4em .6em;vertical-align:top}
.nb-content th{background:rgba(127,127,127,.1);text-align:left}
.nb-content ul[data-type="taskList"]{list-style:none;padding-left:.2em}
.nb-content li[data-type="taskItem"]{display:flex;gap:.55em;align-items:flex-start}
.nb-content li[data-type="taskItem"]>label{flex:none;margin-top:.2em}
.nb-content li[data-type="taskItem"]>div{flex:1}
.nb-content li[data-type="taskItem"]>div>p{margin:0}
.nb-content li[data-checked="true"]>div{text-decoration:line-through;opacity:.6}
.nb-content .callout{border-radius:10px;padding:.7em 1em;margin:1em 0;background:rgba(46,75,214,.08);border-left:4px solid var(--nb-accent)}
.nb-content .callout[data-callout="warning"]{background:rgba(240,169,46,.12);border-color:#e09a1f}
.nb-content .callout[data-callout="danger"]{background:rgba(214,60,60,.1);border-color:#d64545}
.nb-content .callout[data-callout="success"]{background:rgba(46,160,90,.1);border-color:#2f9e5b}
.nb-content .callout>*:first-child{margin-top:0}.nb-content .callout>*:last-child{margin-bottom:0}
.nb-content .spoiler{background:var(--nb-fg);color:transparent;border-radius:3px;cursor:pointer}
.nb-content .spoiler:hover,.nb-content .spoiler:focus{background:rgba(127,127,127,.2);color:inherit}
.nb-content mark{border-radius:2px;padding:0 .1em}
.nb-content hr{border:0;border-top:1px solid var(--nb-rule);margin:1.5em 0}
.nb-content details{border:1px solid var(--nb-rule);border-radius:8px;padding:.4em .8em;margin:1em 0}
.nb-content summary{font-weight:600;cursor:pointer}
.nb-content p.nb-small{font-size:.8em;color:var(--nb-muted)}
.nb-content [data-type="inline-math"],.nb-content [data-type="block-math"]{font-family:ui-monospace,monospace}
.nb-content [data-type="block-math"]{display:block;text-align:center;margin:1em 0}
.nb-content .attachment{display:inline-flex;gap:.5em;align-items:center;border:1px solid var(--nb-rule);border-radius:8px;padding:.4em .7em;text-decoration:none;color:inherit}
.nb-locked{color:var(--nb-muted);font-style:italic}
.nb-meta-labels{margin-top:2rem;color:var(--nb-muted);font-size:.85em}`;
}

/**
 * Turn a note into the text of its .html file.
 * @param {{meta: object, title: string, html: string}} note
 */
/** Pictures with a stored preview fall back to it when ../attachments cannot be reached. */
export function withPreviewFallback(html) {
  return String(html || '')
    .replace(/(<img\b[^>]*?)\s+onerror="[^"]*"/gi, '$1')
    .replace(/<img\b(?=[^>]*\sdata-preview="data:image\/)/gi, '<img onerror="this.onerror=null;this.src=this.getAttribute(\'data-preview\')"');
}

export function serializeNote({ meta, title, html }) {
  const m = { format: 'notebound', formatVersion: FORMAT_VERSION, ...meta };
  // "<" is escaped so the JSON can never close the <script> element early.
  const json = JSON.stringify(m, null, 1).replace(/</g, '\\u003c');
  const lang = ((typeof navigator !== 'undefined' && navigator.language) || 'en').split(/[@.]/)[0].replace('_', '-');
  const labels = (meta.labels || []).length
    ? `\n<p class="nb-meta-labels">${meta.labels.map((l) => '#' + escapeHtml(l)).join(' ')}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" data-color="${escapeHtml(meta.color || 'default')}" data-pattern="${escapeHtml(meta.pattern || 'none')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Notebound">
<title>${escapeHtml(title || 'Untitled')}</title>
<script type="application/json" id="notebound-meta">
${json}
</script>
<style>
${noteFileCss()}
</style>
</head>
<body>
<main class="nb-note">
<h1 class="nb-title">${escapeHtml(title || '')}</h1>
<div class="nb-content">
${withPreviewFallback(html)}
</div>${labels}
</main>
</body>
</html>
`;
}

// The first test builds of this app were called Pocketbook. Their note files
// use these older names, and are read exactly like current files.
const LEGACY_META_ID = 'pocketbook-meta';
const LEGACY_PREFIX = 'pb-';

/** Class names from those older files (pb-small, ...) become the current ones (nb-small, ...). */
function upgradeLegacyClasses(root) {
  root.querySelectorAll(`[class*="${LEGACY_PREFIX}"]`).forEach((el) => {
    for (const c of [...el.classList]) {
      if (c.startsWith(LEGACY_PREFIX)) el.classList.replace(c, 'nb-' + c.slice(LEGACY_PREFIX.length));
    }
  });
}

/**
 * Read a note file. Works for Notebound files (also those from the first
 * builds, named Pocketbook) and for plain HTML files that someone dropped
 * into the notes folder.
 */
export function parseNote(text, fileName = '') {
  const doc = new DOMParser().parseFromString(String(text || ''), 'text/html');
  const metaEl = doc.getElementById('notebound-meta') || doc.getElementById(LEGACY_META_ID);
  let raw = null;
  if (metaEl) {
    try { raw = JSON.parse(metaEl.textContent); } catch { raw = null; }
  }
  const foreign = !raw;
  const fallbackId = idFromFileName(fileName) || 'f' + hashString(fileName || text.slice(0, 200));
  const meta = normalizeMeta(raw, fallbackId);
  delete meta.format;
  delete meta.formatVersion;
  let title = '';
  let contentEl = doc.querySelector('.nb-content') || doc.querySelector(`.${LEGACY_PREFIX}content`);
  const titleEl = doc.querySelector('.nb-title') || doc.querySelector(`.${LEGACY_PREFIX}title`);
  if (titleEl) title = titleEl.textContent.trim();
  if (!contentEl) {
    contentEl = doc.body || doc.documentElement;
    contentEl.querySelectorAll('script,style,link,meta,noscript,iframe,object,embed').forEach((n) => n.remove());
    if (!title) {
      title = (doc.title || '').trim();
      const h1 = contentEl.querySelector('h1');
      if (!title && h1) title = h1.textContent.trim();
      if (h1 && h1.textContent.trim() === title) h1.remove();
    }
    if (!title && fileName) title = fileName.replace(/\.[^.]+$/, '').replace(/_[a-z0-9]{4,40}$/i, '');
  }
  upgradeLegacyClasses(contentEl);
  return { meta, title, html: contentEl.innerHTML.trim(), contentEl, foreign };
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TR', 'TABLE', 'DETAILS', 'SUMMARY', 'SECTION', 'ARTICLE', 'HR', 'BR', 'FIGURE', 'FIGCAPTION']);

/** Plain text of a DOM subtree with line breaks between blocks. */
export function blockText(el) {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === 3) { parts.push(node.nodeValue); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LABEL' || tag === 'INPUT') return;
    if (tag === 'BR') { parts.push('\n'); return; }
    if (tag === 'IMG') return;
    if (node.dataset && node.dataset.latex) { parts.push(node.dataset.latex); return; }
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push('\n');
    if (tag === 'TD' || tag === 'TH') parts.push(' ');
    for (const c of node.childNodes) walk(c);
    if (block) parts.push('\n');
  };
  walk(el);
  return parts.join('').replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function vaultPathFromSrc(src) {
  if (!src) return null;
  let s = String(src);
  if (s.startsWith('../')) s = s.slice(3);
  else if (s.startsWith('/vault/')) s = s.slice(7);
  else if (/^[a-z]+:/i.test(s)) return null;
  try { s = decodeURIComponent(s); } catch { /* keep as is */ }
  return s.replace(/^\/+/, '');
}

/** A copy of the note body with spoiler text covered, for previews (cards, widget, notifications). */
export function maskSpoilers(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('.spoiler, [data-spoiler]').forEach((sp) => {
    sp.textContent = '\u2588'.repeat(Math.min(12, Math.max(3, sp.textContent.length)));
  });
  return copy;
}

/** Everything the home screen and search need, without keeping the full HTML in memory. */
export function extractInfo(contentEl, title = '') {
  const text = blockText(contentEl);
  const shown = maskSpoilers(contentEl);
  const previewText = blockText(shown);
  const items = [];
  shown.querySelectorAll('li[data-type="taskItem"]').forEach((li) => {
    let depth = 0;
    for (let p = li.parentElement; p && p !== shown; p = p.parentElement) {
      if (p.matches('li[data-type="taskItem"]')) depth++;
    }
    const body = li.querySelector(':scope > div') || li;
    const first = body.querySelector('p') || body;
    items.push({ t: blockText(first).slice(0, 200), c: li.getAttribute('data-checked') === 'true', d: depth });
  });
  const firstBlock = [...contentEl.children].find((c) => !(c.tagName === 'P' && !c.textContent.trim() && !c.querySelector('img')));
  const isList = !!firstBlock && firstBlock.matches('ul[data-type="taskList"]');
  const images = [];
  contentEl.querySelectorAll('img').forEach((img) => {
    const path = vaultPathFromSrc(img.getAttribute('src'));
    if (!path) return;
    images.push({
      p: path,
      w: Number(img.getAttribute('width')) || Number(img.dataset.w) || 0,
      h: Number(img.getAttribute('height')) || Number(img.dataset.h) || 0,
      d: img.hasAttribute('data-drawing') ? 1 : 0,
    });
  });
  const attachments = [];
  contentEl.querySelectorAll('[data-attachment]').forEach((a) => {
    const p = vaultPathFromSrc(a.getAttribute('href'));
    if (p) attachments.push(p);
  });
  const noteLinks = [...new Set([...contentEl.querySelectorAll('a[data-note-id]')].map((a) => a.getAttribute('data-note-id')).filter(Boolean))];
  const urls = contentEl.querySelectorAll('a[href^="http"]').length + (text.match(/https?:\/\/\S+/g) || []).length;
  const words = (title + ' ' + text).trim().split(/\s+/).filter(Boolean).length;
  return {
    preview: previewText.slice(0, 700),
    text: text.slice(0, 60000),
    items: items.slice(0, 200),
    isList,
    images: images.slice(0, 12),
    imageCount: images.length,
    attachments,
    noteLinks,
    hasLinks: urls > 0,
    words,
    chars: text.length,
  };
}

/** All vault files a note's HTML refers to (images, drawings, attachments). */
export function referencedFiles(html) {
  const out = new Set();
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const p = vaultPathFromSrc(m[1].replace(/&amp;/g, '&'));
    if (p && p.startsWith('attachments/')) out.add(p);
  }
  return [...out];
}

export function normalizeForSearch(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
