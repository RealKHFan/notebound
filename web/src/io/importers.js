// Import from Google Keep (Takeout), Notesnook exports, Notebound backups and
// plain .md / .txt / .html files, either picked one by one or inside a .zip.
import { native } from '../native.js';
import { vault } from '../ui/app-state.js';
import { escapeHtml, newId, parseNote, COLOR_IDS } from '../store/note-format.js';
import { linkify, markdownToHtml, normalizeImportedHtml, sanitizeHtml } from './text.js';
import { addPreviewsToHtml } from '../store/previews.js';

const KEEP_COLORS = {
  DEFAULT: 'default', RED: 'rose', ORANGE: 'apricot', YELLOW: 'butter', GREEN: 'mint', TEAL: 'sage', BLUE: 'sky',
  CERULEAN: 'dusk', DARK_BLUE: 'dusk', PURPLE: 'lilac', PINK: 'blush', BROWN: 'clay', GRAY: 'chalk', GREY: 'chalk',
};
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i;

const usecToIso = (u) => {
  const n = Number(u);
  return Number.isFinite(n) && n > 0 ? new Date(Math.floor(n / 1000)).toISOString() : null;
};

function dirname(p) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i + 1) : '';
}
function basename(p) {
  return p.slice(p.lastIndexOf('/') + 1);
}
function stripExt(name) {
  return name.replace(/\.[^.]+$/, '');
}
function resolveRel(dir, rel) {
  const parts = (dir + rel).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

/** A source is one picked file: either a single document or a zip with many entries. */
class Source {
  constructor(file) {
    this.file = file;
    this.entries = file.zip ? file.entries.map((e) => e.name) : [file.name];
    this.lower = new Map(this.entries.map((n) => [n.toLowerCase(), n]));
  }
  read(entry) { return native.importRead(this.file.id, this.file.zip ? entry : null); }
  extract(entry, dest) { return native.importExtract(this.file.id, this.file.zip ? entry : null, dest); }
  find(path) {
    if (this.entries.includes(path)) return path;
    const l = path.toLowerCase();
    if (this.lower.has(l)) return this.lower.get(l);
    // Takeout sometimes names "x.jpeg" in JSON but stores "x.jpg" (and the other way round)
    const alt = l.replace(/\.jpeg$/, '.jpg');
    const alt2 = l.replace(/\.jpg$/, '.jpeg');
    return this.lower.get(alt) || this.lower.get(alt2) || null;
  }
}

async function copyAttachment(src, entry) {
  const name = basename(entry).replace(/[^\w.\-]+/g, '-').slice(-60);
  const dest = `attachments/imported-${newId(6)}-${name}`;
  const st = await src.extract(entry, dest);
  return st ? { path: dest, size: st.size } : null;
}

/** Copy images referenced by an imported HTML/Markdown document into attachments/ and rewrite their paths. */
async function adoptLocalMedia(src, entryPath, html) {
  if (!src.file.zip) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const dir = dirname(entryPath);
  for (const img of doc.querySelectorAll('img[src]')) {
    const s = img.getAttribute('src');
    if (/^[a-z]+:/i.test(s)) { if (!s.startsWith('data:')) img.remove(); continue; }
    let rel;
    try { rel = decodeURIComponent(s); } catch { rel = s; }
    const found = src.find(resolveRel(dir, rel));
    if (!found) { img.remove(); continue; }
    const copied = await copyAttachment(src, found);
    if (copied) img.setAttribute('src', `../${copied.path}`);
    else img.remove();
  }
  for (const a of doc.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href');
    if (/^[a-z]+:/i.test(h) || h.startsWith('#')) continue;
    let rel;
    try { rel = decodeURIComponent(h); } catch { rel = h; }
    const found = src.find(resolveRel(dir, rel));
    if (!found || /\.(md|markdown|html?|txt)$/i.test(found)) continue;
    const copied = await copyAttachment(src, found);
    if (copied) {
      a.setAttribute('href', `../${copied.path}`);
      a.setAttribute('data-attachment', '');
      a.setAttribute('data-name', basename(found));
      a.setAttribute('data-size', String(copied.size || 0));
    }
  }
  return doc.body.innerHTML;
}

function metaFromFront(front) {
  const m = {};
  const labels = front.tags || front.labels || front.keywords;
  if (labels) m.labels = (Array.isArray(labels) ? labels : String(labels).split(',')).map((x) => String(x).replace(/^#/, '').trim()).filter(Boolean);
  const created = front.created || front.created_at || front.date || front.createdat;
  const updated = front.updated || front.updated_at || front.modified || front.edited || front.updatedat || front.dateedited;
  if (created && Number.isFinite(Date.parse(created))) m.created = new Date(created).toISOString();
  if (updated && Number.isFinite(Date.parse(updated))) m.modified = new Date(updated).toISOString();
  const bool = (v) => v === true || v === 'true' || v === 'yes';
  if (bool(front.pinned)) m.pinned = true;
  if (bool(front.favorite) || bool(front.favorited)) m.favorite = true;
  if (bool(front.archived)) m.archived = true;
  if (front.color && COLOR_IDS.includes(String(front.color).toLowerCase())) m.color = String(front.color).toLowerCase();
  return m;
}

async function addNote({ title, html, meta }, stats) {
  for (const l of meta.labels || []) vault.addLabel(l);
  html = await addPreviewsToHtml(html);
  await vault.createNote({ title, html, meta: { ...meta, order: meta.order ?? vault.nextOrder(false) } });
  stats.notes++;
}

async function importKeepJson(src, entry, stats) {
  const data = JSON.parse(await src.read(entry));
  if (!data || (data.textContent === undefined && !data.listContent && !data.title && !data.attachments)) return false;
  const dir = dirname(entry);
  const parts = [];
  if (data.attachments) {
    for (const att of data.attachments) {
      const found = src.find(dir + att.filePath) || src.find(att.filePath);
      if (!found) { stats.missing++; continue; }
      const copied = await copyAttachment(src, found);
      if (!copied) continue;
      if (/^image\//.test(att.mimetype || '') || IMAGE_EXT.test(found)) parts.push(`<img src="../${escapeHtml(copied.path)}" alt="">`);
      else parts.push(`<a class="attachment" data-attachment="" href="../${escapeHtml(copied.path)}" data-name="${escapeHtml(basename(found))}" data-size="${copied.size || 0}" data-mime="${escapeHtml(att.mimetype || '')}">📎 ${escapeHtml(basename(found))}</a>`);
    }
  }
  if (Array.isArray(data.listContent)) {
    const items = data.listContent.map((it) => `<li data-type="taskItem" data-checked="${it.isChecked ? 'true' : 'false'}"><p>${escapeHtml(it.text || '')}</p></li>`);
    parts.push(`<ul data-type="taskList">${items.join('')}</ul>`);
  } else if (data.textContentHtml) {
    parts.push(sanitizeHtml(normalizeImportedHtml(data.textContentHtml)));
  } else if (data.textContent) {
    parts.push(linkify(data.textContent));
  }
  if (Array.isArray(data.annotations)) {
    for (const a of data.annotations) {
      if (a.url && /^https?:/i.test(a.url)) parts.push(`<p><a href="${escapeHtml(a.url)}">${escapeHtml(a.title || a.url)}</a></p>`);
    }
  }
  const meta = {
    color: KEEP_COLORS[String(data.color || 'DEFAULT').toUpperCase()] || 'default',
    pinned: !!data.isPinned,
    archived: !!data.isArchived,
    trashed: data.isTrashed ? new Date().toISOString() : null,
    labels: (data.labels || []).map((l) => l.name).filter(Boolean),
  };
  const created = usecToIso(data.createdTimestampUsec);
  const edited = usecToIso(data.userEditedTimestampUsec);
  if (created) meta.created = created;
  if (edited) meta.modified = edited;
  if (!created && edited) meta.created = edited;
  meta.order = Date.parse(meta.modified || meta.created || new Date().toISOString());
  await addNote({ title: data.title || '', html: parts.join('') || '<p></p>', meta }, stats);
  return true;
}

async function importNoteboundHtml(src, entry, text, stats) {
  const parsed = parseNote(text, basename(entry));
  if (parsed.foreign) return false;
  const html = await adoptLocalMedia(src, entry, parsed.html);
  const meta = { ...parsed.meta };
  if (vault.get(meta.id)) meta.id = newId();
  for (const l of meta.labels) vault.addLabel(l);
  // notebooks from another vault may not exist here
  meta.notebooks = meta.notebooks.filter((n) => vault.config.notebooks.some((x) => x.id === n));
  await vault.createNote({ title: parsed.title, html: await addPreviewsToHtml(html), meta });
  stats.notes++;
  return true;
}

async function importDocument(src, entry, stats) {
  const name = basename(entry);
  const text = await src.read(entry);
  if (text == null) return;
  if (/\.json$/i.test(name)) {
    try {
      if (await importKeepJson(src, entry, stats)) return;
    } catch (e) {
      console.warn('not a Keep note', entry, e);
    }
    stats.skipped++;
    return;
  }
  if (/\.html?$/i.test(name)) {
    // Keep Takeout ships an .html next to every .json: skip it when the .json exists.
    if (src.find(entry.replace(/\.html?$/i, '.json'))) return;
    // pocketbook-meta: files from the first builds (named Pocketbook)
    if (/id="(?:notebound|pocketbook)-meta"/.test(text) && (await importNoteboundHtml(src, entry, text, stats))) return;
    const parsed = parseNote(text, name);
    let html = sanitizeHtml(normalizeImportedHtml(parsed.html));
    html = await adoptLocalMedia(src, entry, html);
    await addNote({ title: parsed.title || stripExt(name), html, meta: {} }, stats);
    return;
  }
  if (/\.(md|markdown|mdown)$/i.test(name)) {
    const { html: raw, front } = markdownToHtml(text);
    let html = raw.trim();
    let title = front.title || '';
    // A leading "# Title" becomes the note title (and is not repeated in the text).
    const m = /^<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (m) {
      const h1 = new DOMParser().parseFromString(m[1], 'text/html').body.textContent.trim();
      if (!title || h1 === title) {
        title = title || h1;
        html = html.slice(m[0].length).trim();
      }
    }
    html = await adoptLocalMedia(src, entry, html);
    await addNote({ title: title || stripExt(name), html, meta: metaFromFront(front) }, stats);
    return;
  }
  if (/\.txt$/i.test(name)) {
    // Google Takeout puts a Labels.txt next to the notes; it is not a note.
    if (/^labels\.txt$/i.test(name) && src.entries.some((e) => dirname(e) === dirname(entry) && /\.json$/i.test(e))) return;
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    await addNote({ title: stripExt(name), html: linkify(lines.join('\n')), meta: {} }, stats);
    return;
  }
  stats.skipped++;
}

/** Ask Android for files, then import everything we understand. */
export async function runImport(onProgress = () => {}) {
  const picked = await native.pickImport();
  if (!picked?.files?.length) return null;
  const stats = { notes: 0, skipped: 0, missing: 0 };
  try {
    for (const file of picked.files) {
      const src = new Source(file);
      // Notebound backups bring their notebooks along.
      const conf = src.entries.find((e) => basename(e) === 'notebound.json') || src.entries.find((e) => basename(e) === 'pocketbook.json');
      if (conf) {
        try {
          const data = JSON.parse(await src.read(conf));
          for (const nb of data.notebooks || []) if (!vault.config.notebooks.some((x) => x.id === nb.id)) { vault.config.notebooks.push({ id: nb.id, name: nb.name, parent: nb.parent || null, created: nb.created }); }
          vault.saveConfig();
        } catch { /* ignore */ }
      }
      const docs = src.entries.filter((e) => /\.(json|html?|md|markdown|mdown|txt)$/i.test(e) && !/(^|\/)((?:notebound|pocketbook)\.json|history\/)/.test(e) && !basename(e).startsWith('.'));
      let i = 0;
      for (const entry of docs) {
        onProgress(++i, docs.length, entry);
        try {
          await importDocument(src, entry, stats);
        } catch (e) {
          console.warn('import failed', entry, e);
          stats.skipped++;
        }
      }
    }
  } finally {
    await native.importDone().catch(() => {});
    vault.emit({ type: 'import' });
  }
  return stats;
}
