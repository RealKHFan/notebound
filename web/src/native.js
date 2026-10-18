// Bridge to the Android host (MainActivity / Bridge.java).
// Every call is asynchronous: JS -> NoteboundNative.call(id, method, json),
// Java answers later with window.__nbNative.resolve(id, json) or reject(id, message).
// Java pushes events (back button, keyboard insets, resume, shared content...) with emit().

const pending = new Map();
const listeners = new Map();
let seq = 0;

window.__nbNative = {
  resolve(id, json) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    let value = null;
    try { value = json == null || json === '' ? null : JSON.parse(json); } catch (e) { p.reject(e); return; }
    p.resolve(value);
  },
  reject(id, message) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p.reject(new Error(message || 'Native call failed'));
  },
  emit(name, json) {
    let data = null;
    try { data = json ? JSON.parse(json) : null; } catch { data = null; }
    const set = listeners.get(name);
    if (set) for (const fn of [...set]) {
      try { fn(data); } catch (e) { console.error('native event handler failed', name, e); }
    }
  },
};

export function hasNative() {
  return typeof window.NoteboundNative !== 'undefined';
}

export function call(method, args = {}) {
  return new Promise((resolve, reject) => {
    if (!hasNative()) { reject(new Error('Notebound must run inside its Android app')); return; }
    const id = ++seq;
    pending.set(id, { resolve, reject });
    try {
      window.NoteboundNative.call(id, method, JSON.stringify(args));
    } catch (e) {
      pending.delete(id);
      reject(e);
    }
  });
}

export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}

// Convenience wrappers so call sites read naturally.
export const native = {
  init: () => call('init'),
  pickFolder: () => call('pickFolder'),
  useSubfolder: (name) => call('useSubfolder', { name }),
  list: (path) => call('list', { path }),
  mkdirs: (path) => call('mkdirs', { path }),
  read: (path) => call('read', { path }),
  readMany: (paths) => call('readMany', { paths }),
  write: (path, text) => call('write', { path, text }),
  writeBase64: (path, data) => call('writeBase64', { path, data }),
  readBase64: (path) => call('readBase64', { path }),
  stat: (path) => call('stat', { path }),
  remove: (path) => call('delete', { path }),
  rename: (path, name) => call('rename', { path, name }),
  copy: (src, dst) => call('copy', { src, dst }),
  prefsGet: (key) => call('prefsGet', { key }),
  prefsSet: (key, value) => call('prefsSet', { key, value }),
  cacheRead: (name) => call('cacheRead', { name }),
  cacheWrite: (name, text) => call('cacheWrite', { name, text }),
  pickImages: (multiple = true) => call('pickImages', { multiple }),
  pickFiles: (multiple = true) => call('pickFiles', { multiple }),
  capturePhoto: () => call('capturePhoto'),
  importShared: (uris) => call('importShared', { uris }),
  pickImport: () => call('pickImport'),
  importRead: (id, entry) => call('importRead', { id, entry }),
  importExtract: (id, entry, dest) => call('importExtract', { id, entry, dest }),
  importDone: () => call('importDone'),
  saveAs: (name, mime, text, base64) => call('saveAs', { name, mime, text, base64 }),
  saveZip: (name, entries) => call('saveZip', { name, entries }),
  print: (title, html) => call('print', { title, html }),
  shareText: (subject, text) => call('shareText', { subject, text }),
  shareFile: (path, mime, name) => call('shareFile', { path, mime, name }),
  openFile: (path, mime) => call('openFile', { path, mime }),
  openUrl: (url) => call('openUrl', { url }),
  syncReminders: (items) => call('syncReminders', { items }),
  notificationPermission: (request) => call('notificationPermission', { request }),
  exactAlarmStatus: () => call('exactAlarmStatus'),
  testReminder: (delayMs, title, text) => call('testReminder', { delayMs, title, text }),
  takeDoneReminders: () => call('takeDoneReminders'),
  openAlarmSettings: () => call('openAlarmSettings'),
  authAvailable: () => call('authAvailable'),
  authenticate: (title) => call('authenticate', { title }),
  setSecure: (secure, hideRecents) => call('setSecure', { secure, hideRecents }),
  setSystemBars: (lightBackground, color) => call('setSystemBars', { lightBackground, color }),
  haptic: (kind = 'tick') => call('haptic', { kind }).catch(() => {}),
  widgetData: (json) => call('widgetData', { json }),
  setBackHandler: (enabled) => call('setBackHandler', { enabled }).catch(() => {}),
  exit: () => call('exit'),
};
