// The vault is the folder the user picked. This module owns every read and
// write to it and keeps an in-memory index of all notes for fast rendering.
import { native } from '../native.js';
import {
  parseNote, serializeNote, extractInfo, noteFileName, idFromFileName, defaultMeta,
  referencedFiles, normalizeForSearch, newId, COLORS, escapeHtml,
} from './note-format.js';
import { nextOccurrence } from './recurrence.js';
import { sortEntries } from './query.js';
import { addPreviewsToHtml } from './previews.js';
import * as vc from './crypto.js';

export const NOTES = 'notes';
export const ATTACHMENTS = 'attachments';
export const HISTORY = 'history';
export const CONFIG_FILE = 'notebound.json';
// The first builds (named Pocketbook) kept the same settings in this file. It is read once and left as it is.
export const LEGACY_CONFIG_FILE = 'pocketbook.json';
const CACHE_FILE = 'index-v2.json';
export const LOCKED_PLACEHOLDER = '<p class="nb-locked">This note is locked. Open it in Notebound to read it.</p>';

export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark | black
  accent: 'ink', // ink | teal | plum | ember | forest
  layout: 'grid', // grid | list
  sort: 'custom', // custom | modified | created | title
  editorFont: 'sans', // sans | serif | mono
  fontSize: 17,
  lineHeight: 1.6,
  newNotesAtBottom: false,
  checkedToBottom: true,
  spellcheck: true,
  markdownShortcuts: true,
  emojiShortcodes: true,
  trashDays: 7, // 0 = keep forever
  history: true,
  historyMax: 30,
  morning: '08:00',
  afternoon: '13:00',
  evening: '18:00',
  cardLines: 10,
};

function defaultConfig() {
  return { format: 'notebound', version: 1, labels: [], notebooks: [], settings: { ...DEFAULT_SETTINGS }, vault: null };
}

const nowIso = () => new Date().toISOString();
const notePath = (file) => `${NOTES}/${file}`;

export class Vault {
  constructor() {
    this.entries = new Map();
    this.config = defaultConfig();
    this.listeners = new Set();
    this.version = 0;
    this.locks = new Map();
    this.folderKey = '';
    this.password = null;
    this.timers = {};
    this.scanning = null;
    this.ready = false;
  }

  // ---------- change notification ----------
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(change = {}) {
    this.version++;
    for (const fn of [...this.listeners]) {
      try { fn(change); } catch (e) { console.error(e); }
    }
    this.debounce('cache', 1200, () => this.saveCache());
    this.debounce('reminders', 700, () => this.syncReminders());
    this.debounce('widget', 1500, () => this.updateWidget());
  }
  debounce(name, ms, fn) {
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(() => { fn().catch?.((e) => console.warn(name, e)); }, ms);
  }
  async flushAll() {
    for (const k of Object.keys(this.timers)) clearTimeout(this.timers[k]);
    await Promise.allSettled([this.writeConfigNow(), this.saveCache(), this.syncReminders(), this.updateWidget()]);
  }

  // ---------- opening ----------
  async open(folderKey) {
    this.folderKey = folderKey || '';
    await native.mkdirs(NOTES);
    await native.mkdirs(ATTACHMENTS);
    await native.mkdirs(HISTORY);
    await this.loadConfig();
    await this.loadCache();
    this.ready = true;
    this.emit({ type: 'load' });
    // The cached index is on screen now; reading the folder happens in the background.
    this.initialScan = this.scan()
      .then(() => this.purgeTrash())
      .catch((e) => { console.error('scan failed', e); this.scanError = e; this.emit({ type: 'scan-error' }); });
  }
  get hasScanned() { return this.scannedOnce === true; }

  async loadConfig() {
    let text = await native.read(CONFIG_FILE);
    let fromLegacy = false;
    if (text == null) {
      text = await native.read(LEGACY_CONFIG_FILE);
      fromLegacy = text != null;
    }
    if (text == null) {
      this.config = defaultConfig();
      await this.writeConfigNow();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Never overwrite a file we cannot read: keep a copy before starting fresh.
      await native.write(`notebound.unreadable-${Date.now()}.json`, text);
      parsed = {};
    }
    const base = defaultConfig();
    this.config = {
      ...base,
      ...parsed,
      labels: Array.isArray(parsed.labels) ? parsed.labels.filter((l) => typeof l === 'string' && l.trim()) : [],
      notebooks: Array.isArray(parsed.notebooks)
        ? parsed.notebooks.filter((n) => n && typeof n.id === 'string' && typeof n.name === 'string')
          .map((n) => ({ id: n.id, name: n.name, parent: typeof n.parent === 'string' ? n.parent : null, created: n.created || nowIso() }))
        : [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      vault: parsed.vault && parsed.vault.salt ? parsed.vault : null,
      format: base.format,
    };
    // labels, notebooks, settings and the vault carry over into notebound.json
    if (fromLegacy) await this.writeConfigNow();
  }
  saveConfig() {
    this.debounce('config', 300, () => this.writeConfigNow());
  }
  async writeConfigNow() {
    clearTimeout(this.timers.config);
    const c = { ...this.config, updated: nowIso() };
    await native.write(CONFIG_FILE, JSON.stringify(c, null, 2) + '\n');
  }

  async loadCache() {
    try {
      const text = await native.cacheRead(CACHE_FILE);
      if (!text) return;
      const data = JSON.parse(text);
      if (data.v !== 2 || data.folder !== this.folderKey) return;
      this.entries = new Map();
      for (const e of data.entries || []) this.entries.set(e.id, finalize(e));
    } catch (e) {
      console.warn('index cache ignored', e);
    }
  }
  async saveCache() {
    if (!this.ready) return;
    const entries = [...this.entries.values()].map(({ search, ...rest }) => rest);
    await native.cacheWrite(CACHE_FILE, JSON.stringify({ v: 2, folder: this.folderKey, entries }));
  }

  // ---------- scanning the folder ----------
  scan() {
    if (this.scanning) return this.scanning;
    this.scanning = this._scan().finally(() => { this.scanning = null; });
    return this.scanning;
  }
  async _scan() {
    // Notes saved, created or deleted while the folder is being read win over what the scan saw.
    this.scanDirty = new Map();
    try {
      return await this._scanFolder();
    } finally {
      this.scanDirty = null;
    }
  }
  async _scanFolder() {
    let files = await native.list(NOTES);
    if (await this.recoverTempFiles(files)) files = await native.list(NOTES);
    const html = files.filter((f) => !f.dir && /\.html?$/i.test(f.name));
    const byFile = new Map([...this.entries.values()].map((e) => [e.file, e]));
    const next = [];
    const toRead = [];
    for (const f of html) {
      const cached = byFile.get(f.name);
      if (cached && cached.mtime === f.mtime && cached.size === f.size) next.push(cached);
      else toRead.push(f);
    }
    for (let i = 0; i < toRead.length; i += 40) {
      const batch = toRead.slice(i, i + 40);
      const texts = await native.readMany(batch.map((f) => notePath(f.name)));
      for (const f of batch) {
        const t = texts[notePath(f.name)];
        if (t == null) continue;
        try {
          next.push(this.makeEntry(f, parseNote(t, f.name)));
        } catch (e) {
          console.warn('could not read note', f.name, e);
        }
      }
    }
    const scanned = await this.resolveDuplicateIds(next.filter((e) => !this.scanDirty.has(e.id)));
    const result = scanned.filter((e) => !this.scanDirty.has(e.id));
    for (const e of this.scanDirty.values()) if (e) result.push(e);
    const changed = result.length !== this.entries.size || result.some((e) => this.entries.get(e.id) !== e);
    this.entries = new Map(result.map((e) => [e.id, e]));
    this.mergeLabelsFromNotes();
    const first = !this.scannedOnce;
    this.scannedOnce = true;
    if (changed || toRead.length || first) this.emit({ type: 'scan' });
    return { read: toRead.length, total: result.length };
  }

  async recoverTempFiles(files) {
    // A write goes to "<name>.pbtmp" first. If the app died before it was renamed, finish the job.
    const names = new Map(files.map((f) => [f.name, f]));
    let changed = false;
    for (const f of files) {
      if (!f.name.endsWith('.pbtmp')) continue;
      changed = true;
      const target = f.name.slice(0, -'.pbtmp'.length);
      const existing = names.get(target);
      try {
        if (f.size > 0 && (!existing || f.mtime > existing.mtime)) {
          if (existing) await native.remove(notePath(target));
          await native.rename(notePath(f.name), target);
        } else {
          await native.remove(notePath(f.name));
        }
      } catch (e) {
        console.warn('temp recovery failed', f.name, e);
      }
    }
    return changed;
  }

  async resolveDuplicateIds(list) {
    const groups = new Map();
    for (const e of list) {
      if (!groups.has(e.id)) groups.set(e.id, []);
      groups.get(e.id).push(e);
    }
    const out = [];
    for (const [id, group] of groups) {
      if (group.length === 1) { out.push(group[0]); continue; }
      // The file whose name ends with the id is the original; copies get a new id.
      group.sort((a, b) => {
        const am = idFromFileName(a.file) === id ? 0 : 1;
        const bm = idFromFileName(b.file) === id ? 0 : 1;
        return am - bm || b.mtime - a.mtime;
      });
      out.push(group[0]);
      for (const dup of group.slice(1)) {
        if (idFromFileName(dup.file) === id) {
          // Two files claim to be the same note (interrupted rename): keep the newest, archive the other.
          const text = await native.read(notePath(dup.file));
          if (text != null) await this.saveSnapshot(id, text, 'duplicate');
          await native.remove(notePath(dup.file));
          continue;
        }
        try {
          const text = await native.read(notePath(dup.file));
          const parsed = parseNote(text, dup.file);
          const meta = { ...parsed.meta, id: newId() };
          const entry = await this.writeNote(meta, parsed.title, parsed.html, dup);
          out.push(entry);
        } catch (e) {
          console.warn('could not fix duplicate', dup.file, e);
        }
      }
    }
    return out;
  }

  mergeLabelsFromNotes() {
    const known = new Set(this.config.labels);
    let added = false;
    for (const e of this.entries.values()) {
      for (const l of e.meta.labels) if (!known.has(l)) { known.add(l); this.config.labels.push(l); added = true; }
    }
    if (added) {
      this.config.labels.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      this.saveConfig();
    }
  }

  makeEntry(f, parsed) {
    const { meta, title } = parsed;
    const info = meta.locked
      ? { preview: '', text: '', items: [], isList: false, images: [], imageCount: 0, attachments: [], noteLinks: [], hasLinks: false, words: 0, chars: 0 }
      : extractInfo(parsed.contentEl, title);
    return finalize({
      id: meta.id,
      file: f.name,
      mtime: f.mtime,
      size: f.size,
      meta,
      title,
      foreign: parsed.foreign,
      refs: meta.locked ? meta.locked.refs || [] : referencedFiles(parsed.html),
      ...info,
    });
  }

  // ---------- reading and writing notes ----------
  get(id) { return this.entries.get(id) || null; }
  all() { return [...this.entries.values()]; }

  withLock(id, fn) {
    const prev = this.locks.get(id) || Promise.resolve();
    const p = prev.catch(() => {}).then(fn);
    this.locks.set(id, p);
    p.finally(() => { if (this.locks.get(id) === p) this.locks.delete(id); }).catch(() => {});
    return p;
  }

  async readNote(id) {
    const e = this.get(id);
    if (!e) throw new Error('Note not found');
    const text = await native.read(notePath(e.file));
    if (text == null) {
      await this.scan();
      throw new Error('This note was removed from the folder');
    }
    const parsed = parseNote(text, e.file);
    return { meta: parsed.meta, title: parsed.title, html: parsed.html, text };
  }

  /** Low-level write: serialize, write atomically, remove the old file if the name changed. */
  async writeNote(meta, title, html, prev) {
    const name = noteFileName(title, meta.id);
    const text = serializeNote({ meta, title, html });
    const st = await native.write(notePath(name), text);
    if (prev && prev.file && prev.file !== (st.name || name)) {
      await native.remove(notePath(prev.file)).catch(() => {});
    }
    const entry = this.makeEntry({ name: st.name || name, mtime: st.mtime, size: st.size }, parseNote(text, st.name || name));
    this.entries.set(meta.id, entry);
    if (this.scanDirty) this.scanDirty.set(meta.id, entry);
    return entry;
  }

  nextOrder(atBottom = this.config.settings.newNotesAtBottom) {
    const orders = [...this.entries.values()].map((e) => e.meta.order).filter(Number.isFinite);
    if (!orders.length) return Date.now();
    return atBottom ? Math.min(...orders) - 1000 : Math.max(Date.now(), Math.max(...orders) + 1000);
  }

  async createNote({ title = '', html = '', meta = {} } = {}) {
    const m = defaultMeta({ order: this.nextOrder(), ...meta });
    const entry = await this.withLock(m.id, () => this.writeNote(m, title, html, null));
    this.emit({ type: 'create', id: m.id });
    return entry;
  }

  /**
   * Save edited title/content. Detects edits made outside the app since the
   * note was opened and keeps that version in history instead of losing it.
   */
  async saveContent(id, { title, html }, { snapshotOf = null, source = null } = {}) {
    return this.withLock(id, async () => {
      const e = this.get(id);
      if (!e) throw new Error('Note not found');
      let external = false;
      const st = await native.stat(notePath(e.file));
      if (st && (st.mtime !== e.mtime || st.size !== e.size)) {
        const text = await native.read(notePath(e.file));
        if (text != null) {
          await this.saveSnapshot(id, text, 'external');
          external = true;
        }
      }
      if (snapshotOf && this.config.settings.history) await this.saveSnapshot(id, snapshotOf, 'edit');
      const meta = { ...e.meta, modified: nowIso() };
      let body = html;
      if (meta.locked) {
        if (!this.password) throw new Error('Unlock the vault to save this note');
        meta.locked = { ...(await vc.lockPayload(this.password, this.config.vault, { html })), refs: referencedFiles(html) };
        body = LOCKED_PLACEHOLDER;
      }
      const entry = await this.writeNote(meta, title, body, e);
      // source: the editor session that saved, so an open editor can tell its own saves from others (e.g. a restored version)
      this.emit({ type: 'save', id, external, source });
      return { entry, external };
    });
  }

  /**
   * Notes saved before version 1.0.1 have pictures without the small copy a
   * browser shows when it cannot reach the attachments folder (previews.js).
   * This adds it once, in the background. It is not an edit: "Edited", the
   * order and the history stay as they are, files written by hand (no
   * Notebound metadata) are left alone, and nothing is renamed.
   */
  async addPicturePreviews({ stop = () => false } = {}) {
    if (this.config.picturePreviews) return 0;
    let changed = 0;
    for (const e of [...this.entries.values()]) {
      if (stop()) return changed;
      if (!e.imageCount || e.meta.locked || e.foreign) continue;
      try {
        await this.withLock(e.id, async () => {
          const cur = this.get(e.id);
          if (!cur || cur.meta.locked || cur.foreign) return;
          const text = await native.read(notePath(cur.file));
          if (text == null) return;
          const parsed = parseNote(text, cur.file);
          if (parsed.foreign || parsed.meta.locked || noteFileName(parsed.title, parsed.meta.id) !== cur.file) return;
          const html = await addPreviewsToHtml(parsed.html);
          if (html === parsed.html || stop()) return;
          await this.writeNote(parsed.meta, parsed.title, html, cur);
          changed++;
        });
      } catch (err) {
        console.warn('picture previews', e.id, err);
      }
    }
    this.config.picturePreviews = 1;
    this.saveConfig();
    if (changed) this.emit({ type: 'previews' });
    return changed;
  }

  /** Change metadata of one or more notes without touching their content. */
  async updateMeta(ids, patch, { touch = false } = {}) {
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) {
      await this.withLock(id, async () => {
        const e = this.get(id);
        if (!e) return;
        const text = await native.read(notePath(e.file));
        if (text == null) return;
        const parsed = parseNote(text, e.file);
        const changes = typeof patch === 'function' ? patch({ ...parsed.meta }, e) : patch;
        if (!changes) return;
        const meta = { ...parsed.meta, ...changes };
        if (touch) meta.modified = nowIso();
        await this.writeNote(meta, parsed.title, parsed.html, e);
      });
    }
    this.emit({ type: 'meta', ids: list });
  }

  trash(ids) { return this.updateMeta(ids, { trashed: nowIso(), pinned: false }); }
  restore(ids) { return this.updateMeta(ids, { trashed: null }); }
  archive(ids, archived = true) { return this.updateMeta(ids, archived ? { archived: true, pinned: false } : { archived: false }); }

  async deleteForever(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const removed = [];
    for (const id of list) {
      await this.withLock(id, async () => {
        const e = this.get(id);
        if (!e) return;
        await native.remove(notePath(e.file));
        await native.remove(`${HISTORY}/${id}`).catch(() => {});
        this.entries.delete(id);
        if (this.scanDirty) this.scanDirty.set(id, null);
        removed.push(e);
      });
    }
    // Remove attachments no remaining note uses.
    const stillUsed = new Set();
    for (const e of this.entries.values()) for (const r of e.refs) stillUsed.add(r);
    for (const e of removed) {
      for (const r of e.refs) if (!stillUsed.has(r)) await native.remove(r).catch(() => {});
    }
    this.emit({ type: 'delete', ids: list });
  }

  async emptyTrash() {
    const ids = this.all().filter((e) => e.meta.trashed).map((e) => e.id);
    if (ids.length) await this.deleteForever(ids);
    return ids.length;
  }

  async purgeTrash() {
    const days = Number(this.config.settings.trashDays);
    if (!days) return 0;
    const cutoff = Date.now() - days * 86400000;
    const ids = this.all().filter((e) => e.meta.trashed && Date.parse(e.meta.trashed) < cutoff).map((e) => e.id);
    if (ids.length) await this.deleteForever(ids);
    return ids.length;
  }

  async duplicate(id) {
    const src = await this.readNote(id);
    const meta = {
      ...src.meta,
      id: newId(),
      created: nowIso(),
      modified: nowIso(),
      pinned: false,
      reminder: null,
      order: this.nextOrder(false),
    };
    const entry = await this.writeNote(meta, src.title, src.html, null);
    this.emit({ type: 'create', id: meta.id });
    return entry;
  }

  /** Manual ordering: place `id` between two neighbours (either may be null). */
  async reorder(id, beforeEntry, afterEntry) {
    let order;
    if (beforeEntry && afterEntry) order = (beforeEntry.meta.order + afterEntry.meta.order) / 2;
    else if (beforeEntry) order = beforeEntry.meta.order - 1000;
    else if (afterEntry) order = afterEntry.meta.order + 1000;
    else return;
    await this.updateMeta(id, { order });
  }

  // ---------- version history ----------
  async saveSnapshot(id, text, reason = 'edit') {
    if (!text) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await native.write(`${HISTORY}/${id}/${ts}_${reason}.html`, text);
    await this.pruneHistory(id);
  }
  async listHistory(id) {
    const files = await native.list(`${HISTORY}/${id}`);
    return files
      .filter((f) => !f.dir && f.name.endsWith('.html'))
      .map((f) => {
        const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_?([a-z]*)\.html$/.exec(f.name);
        const time = m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : f.mtime;
        return { name: f.name, time, reason: m ? m[6] || 'edit' : 'edit', size: f.size };
      })
      .sort((a, b) => b.time - a.time);
  }
  async pruneHistory(id) {
    const max = Math.max(1, Number(this.config.settings.historyMax) || 30);
    const list = await this.listHistory(id);
    for (const old of list.slice(max)) await native.remove(`${HISTORY}/${id}/${old.name}`).catch(() => {});
  }
  async readSnapshot(id, name) {
    const text = await native.read(`${HISTORY}/${id}/${name}`);
    if (text == null) throw new Error('This version no longer exists');
    const parsed = parseNote(text, name);
    let html = parsed.html;
    if (parsed.meta.locked) {
      if (!this.password) throw new Error('Unlock the vault to see this version');
      html = (await vc.unlockPayload(this.password, parsed.meta.locked)).html;
    }
    return { title: parsed.title, html, meta: parsed.meta };
  }
  async restoreSnapshot(id, name) {
    const snap = await this.readSnapshot(id, name);
    const current = await this.readNote(id);
    return this.saveContent(id, { title: snap.title, html: snap.html }, { snapshotOf: current.text });
  }

  // ---------- labels ----------
  addLabel(name) {
    const n = String(name || '').trim();
    if (!n || this.config.labels.includes(n)) return false;
    this.config.labels.push(n);
    this.config.labels.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    this.saveConfig();
    this.emit({ type: 'labels' });
    return true;
  }
  async renameLabel(from, to) {
    const n = String(to || '').trim();
    if (!n || n === from) return;
    this.config.labels = [...new Set(this.config.labels.map((l) => (l === from ? n : l)))];
    this.saveConfig();
    const ids = this.all().filter((e) => e.meta.labels.includes(from)).map((e) => e.id);
    await this.updateMeta(ids, (m) => ({ labels: [...new Set(m.labels.map((l) => (l === from ? n : l)))] }));
    this.emit({ type: 'labels' });
  }
  async deleteLabel(name) {
    this.config.labels = this.config.labels.filter((l) => l !== name);
    this.saveConfig();
    const ids = this.all().filter((e) => e.meta.labels.includes(name)).map((e) => e.id);
    await this.updateMeta(ids, (m) => ({ labels: m.labels.filter((l) => l !== name) }));
    this.emit({ type: 'labels' });
  }

  // ---------- notebooks ----------
  addNotebook(name, parent = null) {
    const nb = { id: 'nb' + newId(6), name: String(name).trim() || 'Notebook', parent, created: nowIso() };
    this.config.notebooks.push(nb);
    this.saveConfig();
    this.emit({ type: 'notebooks' });
    return nb;
  }
  renameNotebook(id, name) {
    const nb = this.config.notebooks.find((n) => n.id === id);
    if (!nb || !String(name).trim()) return;
    nb.name = String(name).trim();
    this.saveConfig();
    this.emit({ type: 'notebooks' });
  }
  moveNotebook(id, parent) {
    const nb = this.config.notebooks.find((n) => n.id === id);
    if (!nb) return;
    // refuse to move a notebook into its own subtree
    for (let p = parent; p; p = this.config.notebooks.find((n) => n.id === p)?.parent) if (p === id) return;
    nb.parent = parent || null;
    this.saveConfig();
    this.emit({ type: 'notebooks' });
  }
  async deleteNotebook(id) {
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of this.config.notebooks) if (n.parent && doomed.has(n.parent) && !doomed.has(n.id)) { doomed.add(n.id); grew = true; }
    }
    this.config.notebooks = this.config.notebooks.filter((n) => !doomed.has(n.id));
    this.saveConfig();
    const ids = this.all().filter((e) => e.meta.notebooks.some((n) => doomed.has(n))).map((e) => e.id);
    await this.updateMeta(ids, (m) => ({ notebooks: m.notebooks.filter((n) => !doomed.has(n)) }));
    this.emit({ type: 'notebooks' });
  }

  // ---------- settings ----------
  get settings() { return this.config.settings; }
  setSettings(patch) {
    this.config.settings = { ...this.config.settings, ...patch };
    this.saveConfig();
    this.emit({ type: 'settings' });
  }

  // ---------- locked notes ----------
  get hasVault() { return !!this.config.vault; }
  get vaultUnlocked() { return !!this.password; }

  async createVault(password) {
    if (this.config.vault) throw new Error('A vault password already exists');
    this.config.vault = await vc.createVault(password);
    this.password = password;
    await this.writeConfigNow();
    this.emit({ type: 'vault' });
  }
  async unlockVault(password) {
    if (!(await vc.verifyVault(password, this.config.vault))) return false;
    this.password = password;
    this.emit({ type: 'vault' });
    return true;
  }
  lockVault() {
    this.password = null;
    vc.forgetKeys();
    this.emit({ type: 'vault' });
  }
  async lockNote(id) {
    if (!this.password) throw new Error('Unlock the vault first');
    await this.withLock(id, async () => {
      const e = this.get(id);
      if (!e) throw new Error('Note not found');
      const text = await native.read(notePath(e.file));
      const parsed = parseNote(text, e.file);
      if (parsed.meta.locked) return;
      await this.purgeHistoryFor(id); // plain-text history would defeat the lock
      const locked = { ...(await vc.lockPayload(this.password, this.config.vault, { html: parsed.html })), refs: referencedFiles(parsed.html) };
      await this.writeNote({ ...parsed.meta, locked }, parsed.title, LOCKED_PLACEHOLDER, e);
    });
    this.emit({ type: 'meta', ids: [id] });
  }
  async purgeHistoryFor(id) {
    await native.remove(`${HISTORY}/${id}`).catch(() => {});
  }
  async readLocked(id) {
    const n = await this.readNote(id);
    if (!n.meta.locked) return n;
    if (!this.password) throw new Error('Vault is locked');
    const payload = await vc.unlockPayload(this.password, n.meta.locked);
    return { ...n, html: payload.html };
  }
  async unlockNote(id) {
    await this.withLock(id, async () => {
      const e = this.get(id);
      if (!e) throw new Error('Note not found');
      const text = await native.read(notePath(e.file));
      const parsed = parseNote(text, e.file);
      if (!parsed.meta.locked) return;
      const payload = await vc.unlockPayload(this.password, parsed.meta.locked);
      await this.writeNote({ ...parsed.meta, locked: null }, parsed.title, payload.html, e);
    });
    this.emit({ type: 'meta', ids: [id] });
  }
  async changeVaultPassword(oldPassword, newPassword) {
    if (!(await vc.verifyVault(oldPassword, this.config.vault))) return false;
    const vault = await vc.createVault(newPassword);
    const lockedIds = this.all().filter((e) => e.meta.locked).map((e) => e.id);
    for (const id of lockedIds) {
      await this.withLock(id, async () => {
        const e = this.get(id);
        const parsed = parseNote(await native.read(notePath(e.file)), e.file);
        if (!parsed.meta.locked) return;
        const payload = await vc.unlockPayload(oldPassword, parsed.meta.locked);
        const locked = { ...(await vc.lockPayload(newPassword, vault, payload)), refs: parsed.meta.locked.refs || [] };
        await this.writeNote({ ...parsed.meta, locked }, parsed.title, LOCKED_PLACEHOLDER, e);
      });
    }
    this.config.vault = vault;
    this.password = newPassword;
    await this.writeConfigNow();
    this.emit({ type: 'vault' });
    return true;
  }
  async removeVault(password) {
    if (!(await vc.verifyVault(password, this.config.vault))) return false;
    this.password = password;
    for (const e of this.all().filter((x) => x.meta.locked)) await this.unlockNote(e.id);
    this.config.vault = null;
    this.password = null;
    await this.writeConfigNow();
    this.emit({ type: 'vault' });
    return true;
  }

  // ---------- attachments ----------
  async writeAttachmentText(name, text) {
    const path = `${ATTACHMENTS}/${name}`;
    await native.write(path, text);
    return path;
  }
  /** Attachments that no note uses any more. History versions are not counted. */
  async unusedAttachments() {
    const files = await native.list(ATTACHMENTS);
    const used = new Set();
    for (const e of this.entries.values()) for (const r of e.refs) used.add(r);
    return files.filter((f) => !f.dir && !used.has(`${ATTACHMENTS}/${f.name}`));
  }
  async removeUnusedAttachments() {
    const list = await this.unusedAttachments();
    for (const f of list) await native.remove(`${ATTACHMENTS}/${f.name}`).catch(() => {});
    return list.length;
  }

  // ---------- reminders & widget (pushed to Android) ----------
  async syncReminders() {
    if (!this.ready) return;
    const now = Date.now();
    const items = [];
    for (const e of this.entries.values()) {
      const r = e.meta.reminder;
      if (!r || e.meta.trashed) continue;
      const at = nextOccurrence(r.at, r.repeat, now);
      if (!at) continue;
      items.push({
        id: e.id,
        title: e.title || (e.meta.locked ? 'Locked note' : 'Reminder'),
        text: e.meta.locked ? '' : (e.isList ? e.items.filter((i) => !i.c).map((i) => '☐ ' + i.t).join('\n') : e.preview).slice(0, 300),
        at,
        base: Date.parse(r.at),
        repeat: r.repeat || 'none',
      });
    }
    await native.syncReminders(items);
  }

  async updateWidget() {
    if (!this.ready) return;
    const list = sortEntries(this.all().filter((e) => !e.meta.trashed && !e.meta.archived), this.config.settings.sort);
    const pinned = list.filter((e) => e.meta.pinned);
    const others = list.filter((e) => !e.meta.pinned);
    const notes = [...pinned, ...others].slice(0, 40).map((e) => {
      const color = COLORS.find((c) => c.id === e.meta.color) || COLORS[0];
      return {
        id: e.id,
        title: e.title,
        text: e.meta.locked ? 'Locked note' : (e.isList
          ? e.items.filter((i) => !i.c).slice(0, 6).map((i) => '☐ ' + i.t).join('\n')
          : e.preview.slice(0, 200)),
        light: color.light || '',
        dark: color.dark || '',
        pinned: e.meta.pinned,
      };
    });
    await native.widgetData(JSON.stringify({ notes }));
  }
}

function finalize(e) {
  e.search = normalizeForSearch(`${e.title}\n${e.text}\n${e.meta.labels.join(' ')}`);
  return e;
}

export function plainTextToHtml(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}
