import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { Logo } from './Logo.jsx';
import { vault, ui, popPage, ask, snack, runAction, chooseFolder, unlockApp } from './app-state.js';
import { fullDate, formatBytes } from './format.js';
import { vaultUrl } from './NoteCard.jsx';
import { native } from '../native.js';
import { Editor } from '@tiptap/core';
import { buildExtensions } from '../editor/extensions.js';

const REASONS = { edit: 'Before editing', external: 'Changed outside Notebound', duplicate: 'Duplicate file', restore: 'Before restoring' };

export function HistoryPage({ page }) {
  const [list, setList] = useState(null);
  const [preview, setPreview] = useState(null);
  const holder = useRef(null);
  const entry = vault.get(page.id);
  const load = () => vault.listHistory(page.id).then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!preview || !holder.current) return undefined;
    const ed = new Editor({
      element: holder.current,
      editable: false,
      injectCSS: false,
      content: preview.html,
      extensions: buildExtensions({ checkedToBottom: () => false, emojiEnabled: () => false, slashCommands: () => [], searchNotes: () => [] }),
      editorProps: { attributes: { class: 'nb-editor-content' } },
    });
    return () => ed.destroy();
  }, [preview]);

  const open = async (h) => {
    try {
      const snap = await vault.readSnapshot(page.id, h.name);
      setPreview({ ...snap, item: h });
    } catch (e) {
      snack(e.message);
    }
  };
  const restore = async () => {
    const ok = await ask({ title: 'Restore this version?', message: 'The current text is kept in history, so you can switch back.', confirm: 'Restore' });
    if (!ok) return;
    await runAction('Restore', () => vault.restoreSnapshot(page.id, preview.item.name));
    snack('Version restored');
    popPage();
  };

  if (preview) {
    return (
      <div class="page-layer editor-page" data-color={preview.meta.color}>
        <div class="page-top" style={{ background: 'transparent' }}>
          <button class="icon-btn" onClick={() => setPreview(null)} aria-label="Back to versions"><Icon name="back" /></button>
          <h1>{fullDate(new Date(preview.item.time).toISOString())}</h1>
          <button class="btn tonal" onClick={restore}>Restore</button>
        </div>
        <div class="editor-scroll">
          <div class="editor-inner">
            <div class="title-input static">{preview.title}</div>
            <div ref={holder} class="nb-editor readonly" />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div class="page-layer">
      <div class="page-top">
        <button class="icon-btn" onClick={popPage} aria-label="Back"><Icon name="back" /></button>
        <h1>Version history</h1>
      </div>
      <div class="page-scroll">
        <p class="muted" style={{ margin: '0 6px 14px', fontSize: '14px' }}>
          {entry?.title ? `Earlier versions of "${entry.title}". ` : ''}They are stored in the history folder next to your notes.
        </p>
        {list === null ? <div class="spinner" style={{ margin: '40px auto' }} /> : null}
        {list && !list.length ? <p class="muted" style={{ textAlign: 'center', padding: '40px 20px' }}>No earlier versions yet. A version is saved each time you start editing this note.</p> : null}
        {list?.map((h) => (
          <button key={h.name} class="history-item" onClick={() => open(h)}>
            <Icon name="history" />
            <span class="grow">
              <div style={{ fontWeight: 560 }}>{fullDate(new Date(h.time).toISOString())}</div>
              <div class="muted" style={{ fontSize: '13px' }}>{REASONS[h.reason] || 'Saved version'} · {formatBytes(h.size)}</div>
            </span>
            <Icon name="chevron-right" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function ImageViewer({ page }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map());
  const start = useRef(null);
  const onDown = (e) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { scale, pos, pts: new Map(pointers.current) };
  };
  const onMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = start.current;
    const pts = [...pointers.current.values()];
    const startPts = [...s.pts.values()];
    if (pts.length >= 2 && startPts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const d0 = Math.hypot(startPts[0].x - startPts[1].x, startPts[0].y - startPts[1].y) || 1;
      setScale(Math.max(1, Math.min(6, s.scale * (d / d0))));
    } else if (pts.length === 1 && startPts.length === 1 && scale > 1) {
      setPos({ x: s.pos.x + pts[0].x - startPts[0].x, y: s.pos.y + pts[0].y - startPts[0].y });
    }
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    start.current = { scale, pos, pts: new Map(pointers.current) };
    if (scale <= 1.01) setPos({ x: 0, y: 0 });
  };
  return (
    <div class="viewer" role="dialog" aria-label="Image">
      <div class="page-top">
        <button class="icon-btn" onClick={popPage} aria-label="Close"><Icon name="x" /></button>
        <span class="spacer" />
        <button class="icon-btn" onClick={() => setScale(Math.min(6, scale * 1.5))} aria-label="Zoom in"><Icon name="zoom-in" /></button>
        <button class="icon-btn" onClick={() => { setScale(1); setPos({ x: 0, y: 0 }); }} aria-label="Reset zoom"><Icon name="zoom-out" /></button>
        <button class="icon-btn" onClick={() => native.shareFile(page.src, '', page.src.split('/').pop()).catch((e) => snack(e.message))} aria-label="Share"><Icon name="share" /></button>
      </div>
      <div class="viewer-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDblClick={() => { setScale(scale > 1 ? 1 : 2.5); setPos({ x: 0, y: 0 }); }}>
        <img src={vaultUrl(page.src)} class={page.drawing ? 'drawing' : ''} alt="" draggable={false} style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }} />
      </div>
    </div>
  );
}

export function Onboarding() {
  const [busy, setBusy] = useState(false);
  return (
    <div class="center-screen onboarding">
      <Logo size={84} />
      <h1>Your notes, in a folder you own</h1>
      <p>Notebound saves every note as a file in a folder you choose, like Documents/Notebound. Back it up however you like.</p>
      <div class="onboard-points">
        <div><Icon name="folder" size={20} /><span>Each note is a normal .html file that opens in any browser.</span></div>
        <div><Icon name="shield" size={20} /><span>The app has no internet access. Nothing leaves your phone.</span></div>
        <div><Icon name="file-input" size={20} /><span>Already have notes here? Pick that folder and they appear.</span></div>
      </div>
      <button class="btn primary" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await chooseFolder(); } catch (e) { snack(e.message || String(e)); } finally { setBusy(false); }
      }}
      >
        <Icon name="folder-open" size={20} /> Choose folder
      </button>
      <p style={{ fontSize: '13px' }}>Tip: open Documents, tap "New folder", name it Notebound, then "Use this folder".</p>
    </div>
  );
}

export function LockScreen() {
  const [error, setError] = useState('');
  const tryUnlock = async () => {
    setError('');
    try {
      const ok = await unlockApp();
      if (!ok) setError('Not unlocked. Try again.');
    } catch (e) {
      setError(e.message || String(e));
    }
  };
  useEffect(() => { tryUnlock(); }, []);
  return (
    <div class="center-screen">
      <Logo size={72} />
      <h1>Notebound is locked</h1>
      {error ? <p>{error}</p> : null}
      <button class="btn primary" onClick={tryUnlock}><Icon name="fingerprint" size={20} /> Unlock</button>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div class="center-screen" aria-busy="true">
      <Logo size={64} />
      <div class="spinner" />
    </div>
  );
}

export function ErrorScreen() {
  const { error } = ui.get();
  return (
    <div class="center-screen">
      <Logo size={64} />
      <h1>Something went wrong</h1>
      <p>{error}</p>
      <button class="btn primary" onClick={() => chooseFolder()}>Choose folder again</button>
      <button class="btn text" onClick={() => location.reload()}>Try again</button>
    </div>
  );
}
