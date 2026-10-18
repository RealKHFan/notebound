// Export notes as HTML, Markdown, plain text (single file or .zip) and PDF.
import { native } from '../native.js';
import { vault, ensureVaultOpen, relockIfIdle } from '../ui/app-state.js';
import { serializeNote, sanitizeTitleForFile, referencedFiles } from '../store/note-format.js';
import { htmlToMarkdown, htmlToText } from './text.js';

export const EXPORT_FORMATS = [
  { id: 'html', name: 'HTML', ext: 'html', mime: 'text/html' },
  { id: 'md', name: 'Markdown', ext: 'md', mime: 'text/markdown' },
  { id: 'txt', name: 'Plain text', ext: 'txt', mime: 'text/plain' },
];

async function contentOf(id) {
  const e = vault.get(id);
  if (!e) return null;
  const n = e.meta.locked ? await vault.readLocked(id) : await vault.readNote(id);
  return { entry: e, title: n.title, html: n.html, meta: n.meta };
}

function render(fmt, n) {
  if (fmt === 'md') return htmlToMarkdown(n.title, n.html);
  if (fmt === 'txt') return htmlToText(n.title, n.html);
  // exported HTML never contains the encrypted payload, only readable content
  return serializeNote({ meta: { ...n.meta, locked: null }, title: n.title, html: n.html });
}

function uniqueName(base, ext, used) {
  let name = `${base}.${ext}`;
  let i = 2;
  while (used.has(name.toLowerCase())) name = `${base} (${i++}).${ext}`;
  used.add(name.toLowerCase());
  return name;
}

async function unlockFor(ids) {
  if (!ids.some((id) => vault.get(id)?.meta.locked)) return true;
  return ensureVaultOpen('Some of these notes are locked. Enter your vault password to export them.');
}

/**
 * Export the given notes. One note becomes a single file; several notes (or a
 * note with pictures) become a .zip with notes/ and attachments/.
 * Resolves true when saved, false when cancelled.
 */
export async function exportNotes(ids, fmt = 'html') {
  if (!(await unlockFor(ids))) return false;
  try {
    return await exportUnlocked(ids, fmt);
  } finally {
    relockIfIdle();
  }
}

async function exportUnlocked(ids, fmt) {
  const f = EXPORT_FORMATS.find((x) => x.id === fmt) || EXPORT_FORMATS[0];
  const notes = [];
  for (const id of ids) {
    const n = await contentOf(id);
    if (n) notes.push(n);
  }
  if (!notes.length) return false;
  const refs = new Set();
  for (const n of notes) for (const r of referencedFiles(n.html)) refs.add(r);
  if (notes.length === 1 && !refs.size) {
    const n = notes[0];
    return native.saveAs(`${sanitizeTitleForFile(n.title)}.${f.ext}`, f.mime, render(fmt, n));
  }
  const used = new Set();
  const entries = notes.map((n) => ({ path: `notes/${uniqueName(sanitizeTitleForFile(n.title), f.ext, used)}`, text: render(fmt, n) }));
  for (const r of refs) entries.push({ path: r, vaultPath: r });
  const name = notes.length === 1 ? `${sanitizeTitleForFile(notes[0].title)}.zip` : `Notebound export ${new Date().toISOString().slice(0, 10)}.zip`;
  return native.saveZip(name, entries);
}

/** Full backup: every note file, the attachments and notebound.json, exactly as they are on disk. */
export async function backupAll() {
  await vault.flushAll();
  const entries = [{ path: 'notebound.json', vaultPath: 'notebound.json' }];
  for (const e of vault.all()) entries.push({ path: `notes/${e.file}`, vaultPath: `notes/${e.file}` });
  const atts = await native.list('attachments');
  for (const a of atts) if (!a.dir) entries.push({ path: `attachments/${a.name}`, vaultPath: `attachments/${a.name}` });
  return native.saveZip(`Notebound backup ${new Date().toISOString().slice(0, 10)}.zip`, entries);
}

export async function printNote(id) {
  if (!(await unlockFor([id]))) return false;
  let n;
  try {
    n = await contentOf(id);
  } finally {
    relockIfIdle();
  }
  if (!n) return false;
  const html = serializeNote({ meta: { ...n.meta, locked: null, pattern: 'none' }, title: n.title, html: n.html })
    // print on white paper regardless of the note color
    .replace(/<html ([^>]*)data-color="[^"]*"/, '<html $1data-color="default"');
  return native.print(n.title || 'Note', html);
}
