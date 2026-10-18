import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { ui, useUi, closeDialog, closeSheet, snack, withProgress } from './app-state.js';
import { Home } from './Home.jsx';
import { EditorPage } from '../editor/EditorPage.jsx';
import { SettingsPage, LabelsPage, AboutPage } from './Settings.jsx';
import { HistoryPage, ImageViewer, Onboarding, LockScreen, LoadingScreen, ErrorScreen } from './pages.jsx';
import { DrawingPage } from './Drawing.jsx';
import { Sheet, SheetState, MenuSheet, ColorSheet, LabelSheet, NotebookSheet, ReminderSheet } from './sheets.jsx';
import { exportNotes, printNote, EXPORT_FORMATS } from '../io/exporters.js';

function Dialog({ d }) {
  const [values, setValues] = useState(() => {
    if (d.fields) return Object.fromEntries(d.fields.map((f) => [f.name, f.value || '']));
    return { input: d.input ?? '' };
  });
  const [error, setError] = useState('');
  const first = useRef(null);
  useEffect(() => {
    setTimeout(() => { first.current?.focus(); first.current?.select?.(); }, 60);
  }, []);
  const hasInput = d.fields || d.input !== undefined;
  const submit = () => {
    if (d.validate) {
      const err = d.validate(values);
      if (err) { setError(err); return; }
    }
    if (d.fields) closeDialog(values);
    else if (d.input !== undefined) closeDialog(values.input);
    else closeDialog(true);
  };
  const fields = d.fields || (d.input !== undefined ? [{ name: 'input', type: d.password ? 'password' : 'text', placeholder: d.placeholder }] : []);
  return (
    <div class="dialog-wrap">
      <div class="scrim" style={{ zIndex: 0 }} onClick={() => closeDialog(null)} />
      <form class="dialog" role="alertdialog" aria-modal="true" aria-label={d.title} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {d.title ? <h2>{d.title}</h2> : null}
        {d.message ? <p>{d.message}</p> : null}
        {fields.map((f, i) => (
          <div key={f.name}>
            {f.label ? <label class="muted" style={{ fontSize: '13px' }} for={`dlg-${f.name}`}>{f.label}</label> : null}
            <input
              id={`dlg-${f.name}`}
              ref={i === 0 ? first : null}
              class="field"
              type={f.type || 'text'}
              inputMode={f.inputMode}
              autoCapitalize={f.inputMode === 'url' || f.type === 'password' ? 'off' : undefined}
              placeholder={f.placeholder || ''}
              value={values[f.name]}
              autocomplete={f.type === 'password' ? 'off' : undefined}
              style={d.mono ? { fontFamily: 'var(--font-mono)' } : null}
              onInput={(e) => setValues({ ...values, [f.name]: e.currentTarget.value })}
              aria-label={f.label || d.title}
            />
          </div>
        ))}
        {hasInput ? <div class="error" role="alert">{error}</div> : null}
        <div class="actions">
          {d.extra ? <button type="button" class="btn text danger" style={{ marginRight: 'auto' }} onClick={() => closeDialog(d.extra.value)}>{d.extra.label}</button> : null}
          {d.cancel !== null ? <button type="button" class="btn text" onClick={() => closeDialog(null)}>{d.cancel || 'Cancel'}</button> : null}
          <button type="submit" class={'btn ' + (d.danger ? 'primary danger' : 'primary')}>{d.confirm || 'OK'}</button>
        </div>
      </form>
    </div>
  );
}

function Snack({ s, inEditor }) {
  return (
    <div class={'snack' + (inEditor ? ' in-editor' : '')} role="status" aria-live="polite">
      <span class="text">{s.text}</span>
      {s.action ? <button onClick={() => { ui.set({ snack: null }); s.onAction?.(); }}>{s.action}</button> : null}
    </div>
  );
}

function ProgressCard({ p }) {
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  return (
    <div class="progress-card" role="status" aria-live="polite">
      <div class="row">
        <div class="spinner small" aria-hidden="true" />
        <span class="text">{p.text}</span>
        {pct !== null ? <span class="pct">{pct}%</span> : null}
      </div>
      <div class={'bar' + (pct === null ? ' indeterminate' : '')}><span style={pct !== null ? { width: `${pct}%` } : null} /></div>
    </div>
  );
}

function InsertSheet({ items }) {
  return (
    <Sheet title="Add to note">
      <div class="menu-grid">
        {items.map((it) => (
          <button key={it.label} onClick={it.onClick}>
            <span class="tile"><Icon name={it.icon} /></span>
            {it.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function InfoSheet({ rows }) {
  return (
    <Sheet title="Note info">
      <dl class="info-list">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </Sheet>
  );
}

function ExportSheet({ ids }) {
  const run = async (fn, done) => {
    closeSheet();
    try {
      const ok = await withProgress(ids.length > 1 ? `Exporting ${ids.length} notes…` : 'Exporting…', fn);
      if (ok && done) snack(done);
    } catch (e) { snack('Export failed: ' + (e.message || e)); }
  };
  return (
    <MenuSheet
      title={ids.length > 1 ? `Export ${ids.length} notes` : 'Export note'}
      items={[
        ...EXPORT_FORMATS.map((f) => ({ icon: 'file-down', label: f.name, sub: ids.length > 1 ? 'Saved as a .zip' : `.${f.ext} file`, onClick: () => run(() => exportNotes(ids, f.id), ids.length > 1 ? `${ids.length} notes exported` : 'Note exported'), keepOpen: true })),
        ids.length === 1 ? { icon: 'printer', label: 'PDF', sub: 'Print or save as PDF', onClick: () => run(() => printNote(ids[0]), null), keepOpen: true } : null,
      ]}
    />
  );
}

function SheetHost({ sheet }) {
  return (
    <SheetState.Provider value={{ closing: !!sheet.closing }}>
      <SheetContent sheet={sheet} />
    </SheetState.Provider>
  );
}

function SheetContent({ sheet }) {
  const p = sheet.props || {};
  switch (sheet.type) {
    case 'menu': return <MenuSheet {...p} />;
    case 'color': return <ColorSheet {...p} />;
    case 'labels': return <LabelSheet {...p} />;
    case 'notebooks': return <NotebookSheet {...p} />;
    case 'reminder': return <ReminderSheet {...p} />;
    case 'insert': return <InsertSheet {...p} />;
    case 'info': return <InfoSheet {...p} />;
    case 'export': return <ExportSheet {...p} />;
    default: return null;
  }
}

function PageHost({ page }) {
  switch (page.type) {
    case 'editor': return <EditorPage page={page} />;
    case 'settings': return <SettingsPage />;
    case 'labels': return <LabelsPage />;
    case 'about': return <AboutPage />;
    case 'history': return <HistoryPage page={page} />;
    case 'image': return <ImageViewer page={page} />;
    case 'drawing': return <DrawingPage page={page} />;
    default: return null;
  }
}

export function App() {
  const s = useUi();
  if (s.phase === 'loading') return <><LoadingScreen />{s.dialog ? <Dialog key={s.dialog.title} d={s.dialog} /> : null}</>;
  if (s.phase === 'onboarding') return <><Onboarding />{s.dialog ? <Dialog key={s.dialog.title} d={s.dialog} /> : null}{s.snack ? <Snack s={s.snack} /> : null}</>;
  if (s.phase === 'locked') return <LockScreen />;
  if (s.phase === 'error') return <><ErrorScreen />{s.dialog ? <Dialog key={s.dialog.title} d={s.dialog} /> : null}</>;
  const inEditor = s.pages.some((p) => p.type === 'editor');
  return (
    <>
      <Home />
      {s.pages.map((p) => <PageHost key={p.key} page={p} />)}
      {s.sheet ? <SheetHost key={s.sheet.id} sheet={s.sheet} /> : null}
      {s.dialog ? <Dialog key={s.dialog.title + (s.dialog.message || '')} d={s.dialog} /> : null}
      {s.snack ? <Snack key={s.snack.id} s={s.snack} inEditor={inEditor} /> : null}
      {s.progress ? <ProgressCard p={s.progress} /> : null}
    </>
  );
}
