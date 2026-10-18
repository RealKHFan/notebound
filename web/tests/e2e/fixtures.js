import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startMockServer } from '../mock-server.mjs';
import { serializeNote, defaultMeta, noteFileName } from '../../src/store/note-format.js';

export { expect };

export const test = base.extend({
  srvOptions: [{ hasFolder: true }, { option: true }],
  srv: async ({ srvOptions }, use) => {
    const s = await startMockServer(srvOptions);
    await use(s);
    await s.close();
  },
  app: async ({ page, srv }, use) => {
    // "Failed to fetch" only happens when the test server shuts down at the end of a test.
    page.on('pageerror', (e) => { if (!/Failed to fetch/.test(e.message)) throw new Error('Page error: ' + e.message); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('[console]', m.text()); });
    await page.goto(srv.appUrl);
    await use(page);
  },
});

/** Write a note file straight into the test vault, like another app or a restore would. */
export function seedNote(srv, { title = '', html = '<p></p>', ...meta } = {}) {
  const m = defaultMeta(meta);
  const dir = path.join(srv.state.vaultDir, 'notes');
  fs.mkdirSync(dir, { recursive: true });
  const name = noteFileName(title, m.id);
  fs.writeFileSync(path.join(dir, name), serializeNote({ meta: m, title, html }));
  return { id: m.id, file: name, path: path.join(dir, name) };
}

export function noteFiles(srv) {
  return srv.listVault('notes').filter((f) => f.endsWith('.html'));
}

export function readNoteByTitle(srv, title) {
  const f = noteFiles(srv).find((n) => n.startsWith(title));
  return f ? srv.readVault('notes/' + f) : null;
}

export function metaOf(html) {
  const m = /<script type="application\/json" id="notebound-meta">\n([\s\S]*?)\n<\/script>/.exec(html);
  return m ? JSON.parse(m[1]) : null;
}

/** Simulate the Android host pushing an event (back button, keyboard, resume...). */
export async function hostEvent(page, name, data) {
  await page.evaluate(([n, d]) => window.__mockEmit(n, d), [name, data]);
}

export async function waitForSave(page) {
  // saves are debounced by 650 ms
  await page.waitForTimeout(1100);
}

/** A button inside the open dialog (avoids matching buttons on the page behind it). */
export function dialogButton(page, name) {
  return page.getByRole('alertdialog').getByRole('button', { name, exact: true });
}

/** Put the caret at the very end of the note, like tapping after the last line. */
export async function caretToEnd(page) {
  const ed = page.locator('.nb-editor-content');
  await ed.evaluate((el) => {
    el.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.waitForTimeout(80);
}
