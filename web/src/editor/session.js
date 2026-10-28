// One open note in the editor: loads it, debounces saves, creates the file on
// first real content and keeps metadata changes in sync with the vault.
import { defaultMeta } from '../store/note-format.js';

export class NeedsPassword extends Error {}

export class EditorSession {
  constructor(vault, { id = null, preset = {} } = {}) {
    this.vault = vault;
    this.id = id;
    this.createdHere = !id;
    const entry = id ? vault.get(id) : null;
    this.meta = entry ? { ...entry.meta } : defaultMeta({ ...preset });
    this.title = entry ? entry.title : '';
    this.html = '';
    this.originalText = null;
    this.snapshotDone = false;
    this.pending = null;
    this.timer = null;
    this.chain = Promise.resolve();
    this.listeners = new Set();
    this.lastError = null;
    this.empty = !id; // existing notes count as non-empty until the editor reports otherwise
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of [...this.listeners]) fn(type, data); }

  async load() {
    if (!this.id) return;
    const e = this.vault.get(this.id);
    if (!e) throw new Error('Note not found');
    if (e.meta.locked) {
      if (!this.vault.password) throw new NeedsPassword('Locked');
      const n = await this.vault.readLocked(this.id);
      this.title = n.title;
      this.html = n.html;
      this.meta = n.meta;
      this.originalText = null; // never keep plain-text history of locked notes
      this.snapshotDone = true;
      return;
    }
    const n = await this.vault.readNote(this.id);
    this.title = n.title;
    this.html = n.html;
    this.meta = n.meta;
    this.originalText = n.text;
  }

  /**
   * What the file holds, as the editor writes it. The editor normalizes HTML
   * on load (and plugins may touch the document without the user typing), so
   * a change only counts when it differs from this.
   */
  setBaseline(title, html) {
    this.baseTitle = title;
    this.baseHtml = html;
  }

  /** Called on every edit; saving happens shortly after typing pauses. */
  change(title, html, empty) {
    this.title = title;
    this.html = html;
    this.empty = empty;
    if (this.id && this.baseHtml != null && title === this.baseTitle && html === this.baseHtml) {
      // Back to exactly what is on disk: nothing to write.
      clearTimeout(this.timer);
      this.pending = null;
      return;
    }
    this.pending = { title, html, empty };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 650);
    this.emit('dirty');
  }

  flush() {
    clearTimeout(this.timer);
    const p = this.pending;
    this.pending = null;
    if (p) {
      this.chain = this.chain.then(() => this.save(p)).then(() => { this.lastError = null; }, (e) => {
        // keep the failed edit queued so the next save or closing the note tries again
        if (!this.pending) this.pending = p;
        this.lastError = e;
        this.emit('error', e);
      });
    }
    return this.chain;
  }

  async save({ title, html, empty }) {
    if (!this.id) {
      if (empty && !title.trim()) return; // nothing worth a file yet
      const entry = await this.vault.createNote({ title, html: this.meta.locked ? '' : html, meta: { ...this.meta, locked: null } });
      this.id = entry.id;
      this.meta = { ...entry.meta };
      this.snapshotDone = true;
      this.setBaseline(title, html);
      this.emit('created', this.id);
      this.emit('saved', entry);
      return;
    }
    const snapshotOf = !this.snapshotDone && this.originalText ? this.originalText : null;
    const { entry, external } = await this.vault.saveContent(this.id, { title, html }, { snapshotOf, source: this });
    this.snapshotDone = true;
    this.setBaseline(title, html);
    this.meta = { ...entry.meta };
    this.emit('saved', entry);
    if (external) this.emit('external');
  }

  async updateMeta(patch) {
    const changes = typeof patch === 'function' ? patch({ ...this.meta }) : patch;
    if (!changes) return;
    this.meta = { ...this.meta, ...changes };
    this.emit('meta');
    if (!this.id) {
      // Not created yet: the note is written with this metadata once it has content.
      if (this.pending) await this.flush();
      return;
    }
    await this.flush();
    await this.vault.updateMeta(this.id, changes);
    const e = this.vault.get(this.id);
    if (e) this.meta = { ...e.meta };
    this.emit('meta');
  }

  /** Flush and, if the note ended up empty, remove it like Keep does. Returns 'discarded', 'unsaved' or null. */
  async close() {
    await this.flush();
    if (this.pending) return 'unsaved';
    if (this.id && this.empty && !this.title.trim() && !this.meta.reminder && !this.meta.locked) {
      if (this.createdHere) {
        await this.vault.deleteForever([this.id]);
      } else {
        await this.vault.trash([this.id]);
      }
      return 'discarded';
    }
    return null;
  }
}
