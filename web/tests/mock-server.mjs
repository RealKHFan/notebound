// Test double for the Android host. It implements the same bridge methods as
// Bridge.java against a real temporary folder, so tests can check the exact
// files the app writes. Each test gets its own server and folders.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BUILD_DIR = process.env.NB_BUILD_DIR ? path.resolve(process.env.NB_BUILD_DIR) : path.resolve(here, '../.test-build');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.pdf': 'application/pdf', '.md': 'text/markdown',
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function safeJoin(root, rel) {
  const p = path.resolve(root, String(rel || '').replace(/^\/+/, ''));
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Path escapes the folder: ' + rel);
  return p;
}
const statOf = (p) => {
  const s = fs.statSync(p);
  return { mtime: Math.floor(s.mtimeMs), size: s.size };
};

export async function startMockServer(opts = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-test-'));
  const state = {
    base,
    vaultDir: opts.vaultDir || path.join(base, 'Documents', 'Notebound'),
    privateDir: path.join(base, 'private'),
    savedDir: path.join(base, 'saved'),
    hasFolder: !!opts.hasFolder,
    prefs: { ...(opts.prefs || {}) },
    calls: [],
    picks: { images: [], files: [], photo: null, import: [], folder: true },
    auth: { available: true, result: true, ...(opts.auth || {}) },
    notification: 'granted',
    importFiles: new Map(),
    sdk: 36,
  };
  for (const d of [state.vaultDir, state.privateDir, state.savedDir]) fs.mkdirSync(d, { recursive: true });

  let counter = 0;
  const uniqueAttachment = (origName) => {
    const ext = path.extname(origName).toLowerCase() || '.bin';
    const stem = path.basename(origName, path.extname(origName)).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'file';
    let name;
    do { name = `${stem}-${Date.now().toString(36)}${(counter++).toString(36)}${ext}`; } while (fs.existsSync(path.join(state.vaultDir, 'attachments', name)));
    return name;
  };
  const copyIntoAttachments = (src) => {
    fs.mkdirSync(path.join(state.vaultDir, 'attachments'), { recursive: true });
    const name = uniqueAttachment(path.basename(src));
    const dst = path.join(state.vaultDir, 'attachments', name);
    fs.copyFileSync(src, dst);
    return { path: `attachments/${name}`, name: path.basename(src), mime: mimeOf(src).split(';')[0], size: fs.statSync(dst).size };
  };

  const methods = {
    init: () => ({
      hasFolder: state.hasFolder,
      folderName: state.hasFolder ? path.basename(state.vaultDir) : null,
      folderKey: state.hasFolder ? 'mock:' + state.vaultDir : null,
      sdk: state.sdk,
      appVersion: '1.0.0',
      night: !!state.night,
      insets: { top: 24, bottom: 16, left: 0, right: 0, ime: 0 },
      intent: state.pendingIntent || null,
      lastCrash: state.lastCrash || null,
      device: 'Test device, Android 16',
    }),
    pickFolder: () => {
      if (!state.picks.folder) return null;
      state.hasFolder = true;
      return { name: path.basename(state.vaultDir), key: 'mock:' + state.vaultDir, empty: fs.readdirSync(state.vaultDir).length === 0 };
    },
    useSubfolder: ({ name }) => {
      state.vaultDir = path.join(state.vaultDir, name);
      fs.mkdirSync(state.vaultDir, { recursive: true });
      return { name, key: 'mock:' + state.vaultDir };
    },
    list: ({ path: p }) => {
      const dir = safeJoin(state.vaultDir, p);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).map((d) => {
        const s = fs.statSync(path.join(dir, d.name));
        return { name: d.name, dir: d.isDirectory(), size: d.isDirectory() ? 0 : s.size, mtime: Math.floor(s.mtimeMs) };
      });
    },
    mkdirs: ({ path: p }) => { fs.mkdirSync(safeJoin(state.vaultDir, p), { recursive: true }); return true; },
    read: ({ path: p }) => {
      const f = safeJoin(state.vaultDir, p);
      return fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null;
    },
    readMany: ({ paths }) => Object.fromEntries(paths.map((p) => [p, methods.read({ path: p })])),
    write: ({ path: p, text }) => {
      const f = safeJoin(state.vaultDir, p);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.pbtmp', text, 'utf8');
      fs.renameSync(f + '.pbtmp', f);
      return statOf(f);
    },
    writeBase64: ({ path: p, data }) => {
      const f = safeJoin(state.vaultDir, p);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, Buffer.from(data, 'base64'));
      return statOf(f);
    },
    readBase64: ({ path: p }) => {
      const f = safeJoin(state.vaultDir, p);
      return fs.existsSync(f) ? fs.readFileSync(f).toString('base64') : null;
    },
    stat: ({ path: p }) => {
      const f = safeJoin(state.vaultDir, p);
      return fs.existsSync(f) ? statOf(f) : null;
    },
    delete: ({ path: p }) => {
      const f = safeJoin(state.vaultDir, p);
      if (!fs.existsSync(f)) return false;
      fs.rmSync(f, { recursive: true, force: true });
      return true;
    },
    rename: ({ path: p, name }) => {
      const f = safeJoin(state.vaultDir, p);
      const target = path.join(path.dirname(f), name);
      if (fs.existsSync(target)) throw new Error('A file with that name already exists');
      fs.renameSync(f, target);
      return { name };
    },
    copy: ({ src, dst }) => {
      const s = safeJoin(state.vaultDir, src);
      const d = safeJoin(state.vaultDir, dst);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
      return statOf(d);
    },
    prefsGet: ({ key }) => (key in state.prefs ? state.prefs[key] : null),
    prefsSet: ({ key, value }) => { if (value == null) delete state.prefs[key]; else state.prefs[key] = value; return true; },
    cacheRead: ({ name }) => {
      const f = safeJoin(state.privateDir, name);
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    },
    cacheWrite: ({ name, text }) => { fs.writeFileSync(safeJoin(state.privateDir, name), text); return true; },
    pickImages: () => state.picks.images.splice(0).map(copyIntoAttachments),
    pickFiles: () => state.picks.files.splice(0).map(copyIntoAttachments),
    capturePhoto: () => {
      const p = state.picks.photo;
      state.picks.photo = null;
      return p ? copyIntoAttachments(p) : null;
    },
    importShared: ({ uris }) => uris.map((u) => copyIntoAttachments(u.replace(/^file:\/\//, ''))),
    pickImport: () => {
      const files = state.picks.import.splice(0);
      if (!files.length) return null;
      state.importFiles.clear();
      return {
        files: files.map((f, i) => {
          const id = 'imp' + i;
          const buf = fs.readFileSync(f);
          const zip = /\.zip$/i.test(f);
          const entry = { id, name: path.basename(f), size: buf.length, zip };
          if (zip) {
            const un = unzipSync(new Uint8Array(buf));
            state.importFiles.set(id, { zip: un });
            entry.entries = Object.keys(un).filter((n) => !n.endsWith('/')).map((n) => ({ name: n, size: un[n].length }));
          } else {
            state.importFiles.set(id, { buf });
          }
          return entry;
        }),
      };
    },
    importRead: ({ id, entry }) => {
      const f = state.importFiles.get(id);
      if (!f) throw new Error('Unknown import file');
      if (f.zip) return f.zip[entry] ? strFromU8(f.zip[entry]) : null;
      return f.buf.toString('utf8');
    },
    importExtract: ({ id, entry, dest }) => {
      const f = state.importFiles.get(id);
      const data = f.zip ? f.zip[entry] : f.buf;
      if (!data) return null;
      const d = safeJoin(state.vaultDir, dest);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.writeFileSync(d, data);
      return statOf(d);
    },
    importDone: () => { state.importFiles.clear(); return true; },
    saveAs: ({ name, text, base64 }) => {
      fs.writeFileSync(path.join(state.savedDir, name), base64 ? Buffer.from(base64, 'base64') : text);
      return true;
    },
    saveZip: async ({ name, entries }) => {
      if (state.zipDelay) await new Promise((r) => setTimeout(r, state.zipDelay));
      const files = {};
      for (const e of entries) {
        if (e.text != null) files[e.path] = strToU8(e.text);
        else if (e.vaultPath) {
          const f = safeJoin(state.vaultDir, e.vaultPath);
          if (fs.existsSync(f)) files[e.path] = new Uint8Array(fs.readFileSync(f));
        }
      }
      fs.writeFileSync(path.join(state.savedDir, name), zipSync(files));
      return true;
    },
    print: () => true,
    shareText: () => true,
    shareFile: () => true,
    openFile: () => true,
    openUrl: () => true,
    syncReminders: ({ items }) => { state.reminders = items; return { scheduled: items.length, exact: true }; },
    notificationPermission: () => state.notification,
    exactAlarmStatus: () => state.exact !== false,
    testReminder: ({ delayMs, title }) => { state.testReminder = { delayMs, title }; return true; },
    takeDoneReminders: () => { const d = state.doneReminders || []; state.doneReminders = []; return d; },
    openAlarmSettings: () => true,
    authAvailable: () => ({ available: state.auth.available, reason: state.auth.available ? null : 'Set a screen lock first' }),
    authenticate: () => state.auth.result,
    setSecure: () => true,
    setSystemBars: () => true,
    haptic: () => true,
    widgetData: ({ json }) => { state.widget = JSON.parse(json); return true; },
    setBackHandler: ({ enabled }) => { state.backEnabled = enabled; return true; },
    exit: () => { state.exited = (state.exited || 0) + 1; return true; },
  };

  const mockClient = fs.readFileSync(path.join(here, 'mock-native.js'), 'utf8');

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/__mock/call') {
        const body = await readBody(req);
        const { method, args } = JSON.parse(body);
        state.calls.push({ method, args, t: Date.now() });
        const fn = methods[method];
        if (!fn) throw new Error('Unknown native method ' + method);
        if (state.delay?.[method]) await new Promise((r) => setTimeout(r, state.delay[method]));
        const result = await fn(args || {});
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: result === undefined ? null : result }));
        return;
      }
      if (url.pathname === '/__mock/mock-native.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(mockClient);
        return;
      }
      if (url.pathname.startsWith('/vault/')) {
        const f = safeJoin(state.vaultDir, decodeURIComponent(url.pathname.slice(7)));
        if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': mimeOf(f), 'cache-control': 'no-store' });
        res.end(fs.readFileSync(f));
        return;
      }
      if (url.pathname.startsWith('/app/')) {
        const rel = url.pathname.slice(5) || 'index.html';
        const f = safeJoin(BUILD_DIR, decodeURIComponent(rel));
        if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
        let data = fs.readFileSync(f);
        if (rel === 'index.html') {
          data = Buffer.from(data.toString('utf8').replace('<script src="app.js"></script>', '<script src="/__mock/mock-native.js"></script>\n<script src="app.js"></script>'));
        }
        res.writeHead(200, { 'content-type': mimeOf(f) });
        res.end(data);
        return;
      }
      res.writeHead(404);
      res.end();
    } catch (e) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    state,
    url: `http://127.0.0.1:${port}`,
    appUrl: `http://127.0.0.1:${port}/app/index.html`,
    calls: (m) => state.calls.filter((c) => !m || c.method === m),
    vaultFile: (rel) => path.join(state.vaultDir, rel),
    readVault: (rel) => fs.readFileSync(path.join(state.vaultDir, rel), 'utf8'),
    listVault: (rel = '') => (fs.existsSync(path.join(state.vaultDir, rel)) ? fs.readdirSync(path.join(state.vaultDir, rel)) : []),
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); fs.rmSync(base, { recursive: true, force: true }); }),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
