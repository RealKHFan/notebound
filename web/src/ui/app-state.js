// Global UI state + the actions components call. Kept framework-light on purpose:
// a tiny store with subscribe() and a hook that re-renders on change.
import { useEffect, useState } from 'preact/hooks';
import { native, on } from '../native.js';
import { Vault } from '../store/vault.js';
import { setDevice, record } from './diagnostics.js';
import { imageInfo } from '../store/previews.js';
import { nextOccurrence } from '../store/recurrence.js';

export const vault = new Vault();

function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const fn of [...subs]) fn(state);
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

export const ui = createStore({
  phase: 'loading', // loading | onboarding | locked | ready | error
  error: null,
  view: { name: 'notes' },
  search: null, // { query, filters } while the search page is open
  selection: [],
  drawer: false,
  pages: [], // stack of full-screen pages: editor, settings, history, drawing, image...
  sheet: null, // { type, props }
  dialog: null, // { ...options, resolve }
  snack: null,
  insets: { top: 0, bottom: 0, left: 0, right: 0, ime: 0 },
  night: false,
  info: { sdk: 0, appVersion: '', folderName: '' },
  vaultVersion: 0,
  lockedAt: 0,
  progress: null, // { text, done, total } while an import, export or backup runs
});

/** Show a progress card while `fn` runs (exports, backups, imports). */
export async function withProgress(text, fn) {
  ui.set({ progress: { text, done: 0, total: 0 } });
  try {
    return await fn((done, total, label) => ui.set((s) => ({ progress: { ...(s.progress || {}), text: label || s.progress?.text || text, done, total } })));
  } finally {
    ui.set({ progress: null });
  }
}

export function useUi() {
  const [, force] = useState(0);
  useEffect(() => {
    const a = ui.subscribe(() => force((x) => x + 1));
    const b = vault.subscribe(() => force((x) => x + 1));
    return () => { a(); b(); };
  }, []);
  return ui.get();
}

// ---------- appearance ----------
export function effectiveTheme() {
  const t = vault.settings.theme;
  if (t === 'system') return ui.get().night ? 'dark' : 'light';
  return t;
}
let lastBars = '';
export function applyAppearance() {
  const root = document.documentElement;
  const s = vault.settings;
  const theme = effectiveTheme();
  root.dataset.theme = theme;
  root.dataset.accent = s.accent || 'ink';
  root.style.setProperty('--editor-size', `${Number(s.fontSize) || 17}px`);
  root.style.setProperty('--editor-leading', String(Number(s.lineHeight) || 1.6));
  root.dataset.editorFont = s.editorFont || 'sans';
  const { insets } = ui.get();
  root.style.setProperty('--safe-top', `${insets.top || 0}px`);
  root.style.setProperty('--safe-bottom', `${insets.ime > 0 ? 0 : insets.bottom || 0}px`);
  root.style.setProperty('--safe-left', `${insets.left || 0}px`);
  root.style.setProperty('--safe-right', `${insets.right || 0}px`);
  root.style.setProperty('--ime', `${insets.ime || 0}px`);
  const bars = theme;
  if (bars !== lastBars) {
    lastBars = bars;
    native.setSystemBars(theme === 'light', getComputedStyle(root).getPropertyValue('--bg').trim()).catch(() => {});
  }
}

// ---------- boot ----------
export async function boot() {
  try {
    const info = await native.init();
    ui.set({
      insets: info.insets || ui.get().insets,
      night: !!info.night,
      info: { sdk: info.sdk, appVersion: info.appVersion, folderName: info.folderName || '' },
    });
    applyAppearance();
    setDevice(info.device);
    if (info.intent) pendingIntent = info.intent;
    if (info.lastCrash) {
      record('previous crash', info.lastCrash);
      pendingCrash = info.lastCrash;
    }
    if (!info.hasFolder) {
      ui.set({ phase: 'onboarding' });
      return;
    }
    folderKey = info.folderKey;
    if (await appLockEnabled()) {
      ui.set({ phase: 'locked' });
      return;
    }
    await openVault();
  } catch (e) {
    console.error(e);
    ui.set({ phase: 'error', error: String(e.message || e) });
  }
}

let folderKey = '';
let pendingIntent = null;
let pendingCrash = null;

export async function openVault() {
  ui.set({ phase: 'loading' });
  try {
    await vault.open(folderKey);
    applyAppearance();
    ui.set({ phase: 'ready' });
    applySecureFlags();
    vault.initialScan?.then(() => applyDoneReminders());
    // once per folder: give older pictures the copy a browser can show (quietly, after start-up)
    const opened = vault.folderKey;
    vault.initialScan?.then(() => setTimeout(() => {
      vault.addPicturePreviews({ stop: () => vault.folderKey !== opened })
        .catch((e) => console.warn('picture previews', e));
    }, 2500));
    watchReminders();
    if (pendingCrash) {
      const report = pendingCrash;
      pendingCrash = null;
      ask({
        title: 'Notebound closed unexpectedly',
        message: 'Your notes are safe in your folder. You can share the error details to help fix the problem.',
        confirm: 'Share details',
        cancel: 'Close',
      }).then((ok) => { if (ok) native.shareText('Notebound crash report', report).catch(() => {}); });
    }
    if (pendingIntent) {
      const intent = pendingIntent;
      pendingIntent = null;
      handleIntent(intent);
    }
  } catch (e) {
    console.error(e);
    ui.set({ phase: 'error', error: 'Notebound could not open your folder. ' + (e.message || e) });
  }
}

export async function chooseFolder() {
  const picked = await native.pickFolder();
  if (!picked) return false;
  const files = await native.list('');
  const isVault = files.some((f) => f.name === 'notebound.json' || f.name === 'pocketbook.json' || (f.dir && f.name === 'notes'));
  const visible = files.filter((f) => !f.name.startsWith('.'));
  let key = picked.key;
  if (!isVault && visible.length > 0) {
    const choice = await ask({
      title: 'This folder has other files',
      message: `Notebound needs a folder of its own. Create a "Notebound" folder inside "${picked.name}"?`,
      confirm: 'Create Notebound folder',
      cancel: 'Use this folder',
    });
    if (choice) {
      const sub = await native.useSubfolder('Notebound');
      if (sub?.key) key = sub.key;
    }
  }
  folderKey = key;
  ui.set({ info: { ...ui.get().info, folderName: picked.name } });
  await openVault();
  return true;
}

// ---------- locked notes ----------
// The vault password is kept only while a locked note is open. Leaving the
// last open locked note forgets it, so the next one asks again.
const lockedEditors = new Set();
export function markLockedEditor(key, locked) {
  if (locked) lockedEditors.add(key);
  else lockedEditors.delete(key);
}
export function releaseLockedEditor(key) {
  if (!lockedEditors.delete(key)) return;
  if (!lockedEditors.size && vault.password) vault.lockVault();
}
/** After using the password outside a locked note (e.g. an export), forget it again. */
export function relockIfIdle() {
  if (!lockedEditors.size && vault.password) vault.lockVault();
}
export function closeLockedNotes() {
  const open = ui.get().pages.filter((p) => p.type === 'editor' && lockedEditors.has(p.key));
  if (open.length) ui.set((s) => ({ pages: s.pages.filter((p) => !open.includes(p)) }));
  else if (vault.password) vault.lockVault();
}
/** Ask for the vault password when locked notes are involved. Returns false when cancelled or wrong. */
export async function ensureVaultOpen(reason = 'Enter your vault password to continue.') {
  if (!vault.hasVault || vault.vaultUnlocked) return true;
  const pw = await ask({ title: 'Vault password', message: reason, input: '', password: true, confirm: 'Unlock' });
  if (!pw) return false;
  if (await vault.unlockVault(pw)) return true;
  snack('Wrong password');
  return false;
}

// ---------- reminders while the app is open ----------
/** Notes whose reminder notification got "Done": a one-time reminder is removed from the note. */
export async function applyDoneReminders() {
  let ids = [];
  try { ids = await native.takeDoneReminders(); } catch { return; }
  const now = Date.now();
  for (const id of ids || []) {
    const e = vault.get(id);
    const r = e?.meta.reminder;
    if (r && !r.repeat && Date.parse(r.at) <= now + 60000) await vault.updateMeta(id, { reminder: null }).catch(() => {});
  }
}

let reminderTimer = 0;
let watchingReminders = false;
/** If a reminder comes due while the app is on screen, also say so inside the app. */
export function watchReminders() {
  if (!watchingReminders) {
    watchingReminders = true;
    vault.subscribe(() => { clearTimeout(reminderTimer); reminderTimer = setTimeout(planInAppReminder, 400); });
  }
  planInAppReminder();
}
function planInAppReminder() {
  clearTimeout(reminderTimer);
  const now = Date.now();
  let next = null;
  for (const e of vault.all()) {
    const r = e.meta.reminder;
    if (!r || e.meta.trashed) continue;
    const t = nextOccurrence(r.at, r.repeat, now);
    if (t && t - now < 24 * 3600000 && (!next || t < next.t)) next = { t, e };
  }
  if (!next) return;
  reminderTimer = setTimeout(() => {
    const e = vault.get(next.e.id);
    if (e && document.visibilityState === 'visible' && ui.get().phase === 'ready') {
      snack(`Reminder: ${e.title || 'Note'}`, { action: 'Open', onAction: () => openNote(e.id), duration: 10000 });
      native.haptic('long');
    }
    planInAppReminder();
  }, Math.max(0, next.t - now) + 250);
}

// ---------- app lock ----------
export async function appLockEnabled() {
  return (await native.prefsGet('appLock')) === '1';
}
const OWN_LAUNCH_GRACE = 15 * 60000;
export const NOTE_LOCK_DEFAULT = '10000';
/** How long you can be away from the app before open locked notes close (setting, per phone). */
export async function noteLockMs() {
  const raw = await native.prefsGet('noteLockTimeout');
  const v = Number(raw == null || raw === '' ? NOTE_LOCK_DEFAULT : raw);
  return Number.isFinite(v) && v >= 0 ? v : Number(NOTE_LOCK_DEFAULT);
}
export async function lockTimeoutMs() {
  const v = Number(await native.prefsGet('lockTimeout'));
  return Number.isFinite(v) && v >= 0 ? v : 0;
}
export async function unlockApp() {
  const ok = await native.authenticate('Unlock Notebound');
  if (!ok) return false;
  ui.set({ lockedAt: 0 });
  if (!vault.ready) {
    await openVault();
  } else {
    ui.set({ phase: 'ready' });
    // A widget, shortcut or notification may have opened the app while it was locked.
    if (pendingIntent) {
      const intent = pendingIntent;
      pendingIntent = null;
      handleIntent(intent);
    }
  }
  return true;
}
export async function applySecureFlags() {
  try {
    const secure = (await native.prefsGet('secureScreen')) === '1';
    const lock = await appLockEnabled();
    await native.setSecure(secure, lock || secure);
  } catch (e) {
    console.warn('secure flags', e);
  }
}

// ---------- navigation ----------
export function setView(view) {
  ui.set({ view, drawer: false, selection: [], search: null });
}
export function openSearch(filters = {}) {
  ui.set({ search: { query: '', filters }, selection: [] });
}
export function pushPage(page) {
  ui.set((s) => ({ pages: [...s.pages, { key: Math.random().toString(36).slice(2), ...page }] }));
}
export function popPage() {
  ui.set((s) => ({ pages: s.pages.slice(0, -1) }));
}
export function topPage() {
  const p = ui.get().pages;
  return p[p.length - 1] || null;
}
export function closePage(key) {
  ui.set((s) => ({ pages: s.pages.filter((p) => p.key !== key) }));
}

// Which notes are open in an editor page, so a note is never open twice.
const openEditors = new Map(); // note id -> page key
export function registerEditor(id, key) {
  if (id) openEditors.set(id, key);
}
export function unregisterEditor(key) {
  for (const [id, k] of [...openEditors]) if (k === key) openEditors.delete(id);
}

export function openNote(id) {
  const e = vault.get(id);
  if (!e) return;
  const key = openEditors.get(id);
  const pages = ui.get().pages;
  const i = key ? pages.findIndex((p) => p.key === key) : -1;
  if (i >= 0) {
    // already open further down the stack: go back to it
    ui.set({ pages: pages.slice(0, i + 1), sheet: null });
    return;
  }
  pushPage({ type: 'editor', id });
}
export function newNote(kind = 'text', preset = {}) {
  const { view } = ui.get();
  const meta = { ...preset };
  if (view.name === 'label' && !meta.labels) meta.labels = [view.id];
  if (view.name === 'notebook' && !meta.notebooks) meta.notebooks = [view.id];
  if (view.name === 'favorites') meta.favorite = true;
  if (view.name === 'archive') meta.archived = false;
  pushPage({ type: 'editor', id: null, kind, preset: meta });
}
// ---------- bottom sheets ----------
export const SHEET_OUT_MS = 200;
let sheetSeq = 0;
let sheetTimer = null;
/** Close the keyboard (and Android's cursor handle) so it never sits under a sheet. */
function blurTyping() {
  const a = document.activeElement;
  if (a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) a.blur();
}
export function openSheet(type, props = {}) {
  blurTyping();
  clearTimeout(sheetTimer);
  ui.set({ sheet: { type, props, id: ++sheetSeq } });
}
/** Slides the sheet away, then removes it. Taps already go to what is underneath while it slides. */
export function closeSheet() {
  const cur = ui.get().sheet;
  if (!cur || cur.closing) return;
  ui.set({ sheet: { ...cur, closing: true } });
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => {
    if (ui.get().sheet?.id === cur.id) ui.set({ sheet: null });
  }, SHEET_OUT_MS);
}
export const sheetOpen = (s = ui.get()) => !!(s.sheet && !s.sheet.closing);

/** Modal dialog. Resolves with the input text / true, or null when cancelled. */
export function ask(options) {
  return new Promise((resolve) => {
    ui.set({ dialog: { ...options, resolve } });
  });
}
export function closeDialog(value) {
  const d = ui.get().dialog;
  ui.set({ dialog: null });
  d?.resolve?.(value);
}

let snackTimer = null;
export function snack(text, opts = {}) {
  clearTimeout(snackTimer);
  const id = Math.random();
  ui.set({ snack: { id, text, ...opts } });
  snackTimer = setTimeout(() => {
    if (ui.get().snack?.id === id) ui.set({ snack: null });
  }, opts.duration || 4500);
}
export function runAction(label, fn) {
  return Promise.resolve()
    .then(fn)
    .catch((e) => {
      console.error(label, e);
      snack(`${label} failed: ${e.message || e}`);
    });
}

// Pages register handlers so Back can close inner panels (find bar, menus...) first.
const backHandlers = [];
export function useBackHandler(fn, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    backHandlers.push(fn);
    syncBackState();
    return () => {
      const i = backHandlers.lastIndexOf(fn);
      if (i >= 0) backHandlers.splice(i, 1);
      syncBackState();
    };
  }, [fn, active]);
}

export function handleBack() {
  const s = ui.get();
  if (s.dialog) { closeDialog(null); return true; }
  if (sheetOpen(s)) { closeSheet(); return true; }
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    if (backHandlers[i]()) return true;
  }
  if (s.pages.length) { popPage(); return true; }
  if (s.drawer) { ui.set({ drawer: false }); return true; }
  if (s.selection.length) { ui.set({ selection: [] }); return true; }
  if (s.search) { ui.set({ search: null }); return true; }
  if (s.view.name !== 'notes') { setView({ name: 'notes' }); return true; }
  return false;
}

let lastBackEnabled = null;
export function syncBackState() {
  const s = ui.get();
  const enabled = !!(s.dialog || sheetOpen(s) || backHandlers.length || s.pages.length || s.drawer || s.selection.length || s.search || s.view.name !== 'notes');
  if (enabled !== lastBackEnabled) {
    lastBackEnabled = enabled;
    native.setBackHandler(enabled);
  }
}
ui.subscribe(syncBackState);

// ---------- host events ----------
let pausedAt = 0;
export function installHostEvents() {
  on('back', () => {
    if (!handleBack()) native.exit();
  });
  // Android reports how far a long write (backup .zip) has come.
  on('progress', (d) => {
    if (ui.get().progress && d) ui.set((s) => ({ progress: { ...s.progress, done: d.done || 0, total: d.total || 0 } }));
  });
  on('insets', (insets) => {
    ui.set({ insets });
    applyAppearance();
  });
  on('night', (d) => {
    ui.set({ night: !!d?.dark });
    applyAppearance();
  });
  on('pause', () => {
    pausedAt = Date.now();
    window.dispatchEvent(new CustomEvent('nb-flush'));
    if (vault.ready) vault.flushAll();
  });
  on('resume', async (d) => {
    const away = d?.pausedMs ?? (pausedAt ? Date.now() - pausedAt : 0);
    // Coming back from a picker or the camera that the app opened is not leaving the app,
    // unless it took very long (then you may have gone off to other apps in between).
    const own = !!d?.forResult && away < OWN_LAUNCH_GRACE;
    // Locked notes close again after a short time away from the app (10 seconds unless changed).
    if (vault.password && !own && away >= (await noteLockMs())) closeLockedNotes();
    if (ui.get().phase === 'ready' && !own && (await appLockEnabled()) && away >= (await lockTimeoutMs())) {
      ui.set({ phase: 'locked', lockedAt: Date.now() });
      return;
    }
    if (vault.ready) {
      vault.scan().catch(() => {});
      applyDoneReminders();
    }
  });
  on('intent', (intent) => {
    if (ui.get().phase === 'ready') handleIntent(intent);
    else pendingIntent = intent;
  });
  window.addEventListener('keydown', (e) => {
    // Hardware keyboard / desktop: Escape behaves like Back.
    if (e.key === 'Escape' && !e.defaultPrevented) {
      if (handleBack()) e.preventDefault();
    }
  });
}

export async function handleIntent(intent) {
  if (!intent) return;
  switch (intent.action) {
    case 'open':
      if (intent.noteId && !vault.get(intent.noteId)) await vault.initialScan?.catch(() => {});
      if (intent.noteId && vault.get(intent.noteId)) {
        ui.set({ pages: [], sheet: null });
        openNote(intent.noteId);
      }
      break;
    case 'new':
      ui.set({ pages: [], sheet: null });
      newNote(intent.kind || 'text');
      break;
    case 'share': {
      let attachments = [];
      if (intent.uris?.length) {
        try { attachments = await native.importShared(intent.uris); } catch (e) { snack('Could not add the shared files'); }
        for (const a of attachments) {
          if (/^image\//.test(a.mime || '')) Object.assign(a, await imageInfo(a.path));
        }
      }
      ui.set({ pages: [], sheet: null });
      pushPage({
        type: 'editor', id: null, kind: 'shared',
        shared: { title: intent.subject || '', text: intent.text || '', attachments },
        preset: {},
      });
      break;
    }
    default:
      break;
  }
}
