import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { Logo } from './Logo.jsx';
import {
  vault, ui, popPage, pushPage, ask, snack, runAction, chooseFolder, applyAppearance, applySecureFlags, setView, withProgress, NOTE_LOCK_DEFAULT, openSheet,
} from './app-state.js';
import { native } from '../native.js';
import { runImport } from '../io/importers.js';
import { backupAll, exportNotes, EXPORT_FORMATS } from '../io/exporters.js';
import { plural } from './format.js';
import { diagnosticsText } from './diagnostics.js';

function Toggle({ title, desc, value, onChange, icon }) {
  return (
    <button class="setting" role="switch" aria-checked={value ? 'true' : 'false'} onClick={() => onChange(!value)}>
      {icon ? <Icon name={icon} /> : null}
      <span class="text"><div class="title">{title}</div>{desc ? <div class="desc">{desc}</div> : null}</span>
      <span class={'switch' + (value ? ' on' : '')} aria-hidden="true" />
    </button>
  );
}

function Row({ title, desc, value, onClick, icon, danger }) {
  return (
    <button class="setting" onClick={onClick} style={danger ? { color: 'var(--danger)' } : null}>
      {icon ? <Icon name={icon} /> : null}
      <span class="text"><div class="title">{title}</div>{desc ? <div class="desc">{desc}</div> : null}</span>
      {value ? <span class="value">{value}</span> : null}
    </button>
  );
}

function Segmented({ value, options, onChange, label }) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v ? 'true' : 'false'} class={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

function choose(title, options, current) {
  return new Promise((resolve) => {
    openSheet('menu', {
      title,
      items: options.map(([v, l]) => ({ label: l, checked: v === current, onClick: () => resolve(v) })),
    });
  });
}

const ACCENTS = [['ink', '#2e4bd6'], ['teal', '#0d7c74'], ['plum', '#7a3fb8'], ['ember', '#c2501a'], ['forest', '#2f7a3b'], ['graphite', '#3b4254']];
const SOURCE_URL = 'https://github.com/RealKHFan/notebound';
const NOTE_LOCK_TIMEOUTS = [['0', 'Immediately'], ['10000', 'After 10 seconds'], ['60000', 'After 1 minute'], ['300000', 'After 5 minutes']];
const LOCK_TIMEOUTS = [['0', 'Immediately'], ['30000', 'After 30 seconds'], ['60000', 'After 1 minute'], ['300000', 'After 5 minutes'], ['900000', 'After 15 minutes']];

export function SettingsPage() {
  const s = vault.settings;
  const set = (patch) => { vault.setSettings(patch); applyAppearance(); };
  const [device, setDevice] = useState({ appLock: false, lockTimeout: '0', noteLock: NOTE_LOCK_DEFAULT, secureScreen: false, auth: null, exact: true, notif: 'granted' });
  const info = ui.get().info;

  const loadDevice = async () => {
    const [appLock, lockTimeout, secureScreen, auth, exact, notif, noteLock] = await Promise.all([
      native.prefsGet('appLock'), native.prefsGet('lockTimeout'), native.prefsGet('secureScreen'),
      native.authAvailable().catch(() => null), native.exactAlarmStatus().catch(() => true), native.notificationPermission(false).catch(() => 'granted'),
      native.prefsGet('noteLockTimeout'),
    ]);
    setDevice({ appLock: appLock === '1', lockTimeout: lockTimeout || '0', noteLock: noteLock || NOTE_LOCK_DEFAULT, secureScreen: secureScreen === '1', auth, exact, notif });
  };
  useEffect(() => { loadDevice(); }, []);

  const setAppLock = async (on) => {
    if (on) {
      if (!device.auth?.available) {
        await ask({ title: 'Set a screen lock first', message: device.auth?.reason || 'App lock uses your fingerprint, face or phone PIN. Add one in Android settings first.', confirm: 'OK', cancel: null });
        return;
      }
      const ok = await native.authenticate('Turn on app lock');
      if (!ok) return;
    }
    await native.prefsSet('appLock', on ? '1' : null);
    await applySecureFlags();
    loadDevice();
  };

  const doImport = async () => {
    try {
      const stats = await withProgress('Importing…', (step) => runImport((i, n) => step(i, n, `Importing ${i} of ${n}…`)));
      if (stats) {
        const extra = [stats.skipped ? `${stats.skipped} skipped` : '', stats.missing ? `${plural(stats.missing, 'attachment', 'attachments')} not found` : ''].filter(Boolean).join(', ');
        snack(`${plural(stats.notes, 'note', 'notes')} imported${extra ? ` (${extra})` : ''}`);
      }
    } catch (e) {
      snack('Import failed: ' + (e.message || e));
    }
  };

  const doExportAll = async () => {
    const fmt = await choose('Export all notes as', [...EXPORT_FORMATS.map((f) => [f.id, f.name]), ['backup', 'Full backup (.zip of the folder)']], null);
    if (!fmt) return;
    try {
      if (fmt === 'backup') {
        const ok = await withProgress('Saving backup…', () => backupAll());
        if (ok) snack(`Backup saved: ${plural(vault.all().length, 'note', 'notes')} with their pictures and files`);
      } else {
        const ids = vault.all().filter((e) => !e.meta.trashed).map((e) => e.id);
        const ok = await withProgress(`Exporting ${ids.length} notes…`, () => exportNotes(ids, fmt));
        if (ok) snack(`${plural(ids.length, 'note', 'notes')} exported`);
      }
    } catch (e) {
      snack('Export failed: ' + (e.message || e));
    }
  };

  const vaultRows = vault.hasVault ? (
    <>
      <Row icon="lock" title="Change vault password" onClick={async () => {
        const res = await ask({
          title: 'Change vault password',
          fields: [
            { name: 'old', label: 'Current password', type: 'password' },
            { name: 'pw', label: 'New password', type: 'password' },
            { name: 'pw2', label: 'Repeat new password', type: 'password' },
          ],
          confirm: 'Change',
          validate: (v) => (!v.pw || v.pw.length < 4 ? 'Use at least 4 characters.' : v.pw !== v.pw2 ? 'The new passwords do not match.' : null),
        });
        if (!res) return;
        const ok = await withProgress('Re-encrypting locked notes…', () => vault.changeVaultPassword(res.old, res.pw)).catch((e) => { snack(e.message); return false; });
        snack(ok ? 'Vault password changed' : 'Current password is wrong');
      }} />
      <Row icon="clock" title="Close locked notes" desc="How long you can be away from the app before an open locked note closes and needs the password again" value={NOTE_LOCK_TIMEOUTS.find(([v]) => v === device.noteLock)?.[1] || 'After 10 seconds'} onClick={async () => {
        const v = await choose('Close locked notes', NOTE_LOCK_TIMEOUTS, device.noteLock);
        if (v != null) { await native.prefsSet('noteLockTimeout', v); loadDevice(); }
      }} />
      {vault.vaultUnlocked ? <Row icon="lock" title="Lock vault now" desc="Locked notes need the password again" onClick={() => { vault.lockVault(); snack('Vault locked'); }} /> : null}
      <Row icon="unlock" title="Remove vault" desc="Decrypts all locked notes and deletes the vault password" danger onClick={async () => {
        const pw = await ask({ title: 'Remove vault?', message: 'All locked notes are decrypted and saved as normal notes.', input: '', password: true, confirm: 'Remove vault', danger: true });
        if (!pw) return;
        const ok = await withProgress('Decrypting locked notes…', () => vault.removeVault(pw)).catch(() => false);
        snack(ok ? 'Vault removed' : 'Wrong password');
      }} />
    </>
  ) : (
    <Row icon="lock" title="Locked notes" desc="Lock a note from its menu to encrypt it with a vault password" />
  );

  return (
    <div class="page-layer">
      <div class="page-top">
        <button class="icon-btn" onClick={popPage} aria-label="Back"><Icon name="back" /></button>
        <h1>Settings</h1>
      </div>
      <div class="page-scroll">

        <section class="settings-group">
          <h2>Storage</h2>
          <Row icon="folder" title="Notes folder" desc={`Every note is an .html file in this folder. Back it up any way you like.`} value={info.folderName || ''} onClick={async () => {
            const ok = await ask({ title: 'Choose another folder?', message: 'Notebound will show the notes in the new folder. Your current folder is not changed or deleted.', confirm: 'Choose folder' });
            if (ok) { popPage(); await chooseFolder(); }
          }} />
          <Row icon="refresh" title="Rescan folder" desc="Pick up notes added or changed by other apps" onClick={() => runAction('Rescan', async () => { const r = await vault.scan(); snack(`${plural(r.total, 'note', 'notes')} in folder`); })} />
          <Row icon="file-input" title="Import notes" desc="Google Keep Takeout .zip, Notesnook export, Notebound backup, or .md / .txt / .html files" onClick={doImport} />
          <Row icon="file-output" title="Export all notes" desc="HTML, Markdown, plain text, or a full backup .zip" onClick={doExportAll} />
          <Row icon="paperclip" title="Clean up attachments" desc="Delete images and files no note uses any more" onClick={async () => {
            const list = await vault.unusedAttachments();
            if (!list.length) { snack('No unused attachments'); return; }
            const ok = await ask({ title: `Delete ${plural(list.length, 'unused file', 'unused files')}?`, message: 'They are not used by any note. Older versions in history may lose their images.', confirm: 'Delete', danger: true });
            if (ok) snack(`${plural(await vault.removeUnusedAttachments(), 'file', 'files')} deleted`);
          }} />
        </section>

        <section class="settings-group">
          <h2>Appearance</h2>
          <div class="setting-block">
            <div class="title">Theme</div>
            <Segmented label="Theme" value={s.theme} onChange={(v) => set({ theme: v })} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['black', 'Black']]} />
          </div>
          <div class="setting-block">
            <div class="title">Accent color</div>
            <div class="accent-dots" role="radiogroup" aria-label="Accent color">
              {ACCENTS.map(([id, hex]) => (
                <button key={id} role="radio" aria-checked={s.accent === id ? 'true' : 'false'} aria-label={id} class={s.accent === id ? 'on' : ''} style={{ background: hex }} onClick={() => set({ accent: id })} />
              ))}
            </div>
          </div>
          <div class="setting-block">
            <div class="title">Note font</div>
            <Segmented label="Note font" value={s.editorFont} onChange={(v) => set({ editorFont: v })} options={[['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']]} />
          </div>
          <div class="setting-block">
            <div class="title">Text size</div>
            <Segmented label="Text size" value={String(s.fontSize)} onChange={(v) => set({ fontSize: Number(v) })} options={[['15', 'S'], ['17', 'M'], ['19', 'L'], ['22', 'XL']]} />
          </div>
          <div class="setting-block">
            <div class="title">Line spacing</div>
            <Segmented label="Line spacing" value={String(s.lineHeight)} onChange={(v) => set({ lineHeight: Number(v) })} options={[['1.4', 'Tight'], ['1.6', 'Normal'], ['1.85', 'Relaxed']]} />
          </div>
          <Row icon="rows" title="Lines shown on cards" value={String(s.cardLines)} onClick={async () => {
            const v = await choose('Lines shown on cards', [['6', '6'], ['10', '10'], ['16', '16'], ['30', '30']], String(s.cardLines));
            if (v) set({ cardLines: Number(v) });
          }} />
          <Row icon="sort" title="Sort notes" value={{ custom: 'Custom order', modified: 'Last edited', created: 'Date created', title: 'Title' }[s.sort]} onClick={async () => {
            const v = await choose('Sort notes', [['custom', 'Custom order (drag to arrange)'], ['modified', 'Last edited'], ['created', 'Date created'], ['title', 'Title']], s.sort);
            if (v) set({ sort: v });
          }} />
        </section>

        <section class="settings-group">
          <h2>Writing</h2>
          <Toggle title="Add new notes to the bottom" value={s.newNotesAtBottom} onChange={(v) => set({ newNotesAtBottom: v })} />
          <Toggle title="Move checked items to bottom" value={s.checkedToBottom} onChange={(v) => set({ checkedToBottom: v })} />
          <Toggle title="Typing shortcuts" desc="**bold**, *italic*, __underline__, ~~strike~~, ||spoiler||, # heading, - list, [] checkbox" value={s.markdownShortcuts} onChange={(v) => set({ markdownShortcuts: v })} />
          <Toggle title="Emoji shortcodes" desc="Type :smile: or : and a name to pick an emoji" value={s.emojiShortcodes} onChange={(v) => set({ emojiShortcodes: v })} />
          <Toggle title="Spell check" value={s.spellcheck} onChange={(v) => set({ spellcheck: v })} />
        </section>

        <section class="settings-group">
          <h2>Reminders</h2>
          {['morning', 'afternoon', 'evening'].map((k) => (
            <label key={k} class="setting">
              <span class="text"><div class="title">{k[0].toUpperCase() + k.slice(1)}</div><div class="desc">Used by "Tomorrow", "Later today" and "Next week"</div></span>
              <input class="field" style={{ width: '120px' }} type="time" value={s[k]} onChange={(e) => set({ [k]: e.currentTarget.value })} aria-label={`${k} time`} />
            </label>
          ))}
          {device.notif !== 'granted' ? <Row icon="bell-off" title="Notifications are off" desc="Tap to allow Notebound to show reminders" onClick={async () => { await native.notificationPermission(true); loadDevice(); }} /> : null}
          {!device.exact ? <Row icon="alarm" title="Allow exact alarms" desc={'Reminders may come late until you turn on "Alarms & reminders" for Notebound. Tap to open that setting.'} onClick={() => native.openAlarmSettings()} /> : (
            <Row icon="alarm" title="Reminders arrive on time" desc="Android lets Notebound set exact alarms" />
          )}
          <Row icon="bell-ring" title="Send a test reminder" desc="Arrives in 10 seconds. Try it with the app open, in the background and with the screen off." onClick={async () => {
            const perm = await native.notificationPermission(true).catch(() => 'granted');
            if (perm !== 'granted') { snack('Notifications are off for Notebound. Allow them in Android settings first.'); loadDevice(); return; }
            await runAction('Test reminder', () => native.testReminder(10000, 'Test reminder', 'Reminders work on this phone.'));
            snack('Test reminder set for 10 seconds from now');
          }} />
        </section>

        <section class="settings-group">
          <h2>Privacy and security</h2>
          <Toggle icon="fingerprint" title="App lock" desc={device.auth && !device.auth.available ? device.auth.reason : 'Unlock with your fingerprint, face or phone PIN'} value={device.appLock} onChange={setAppLock} />
          {device.appLock ? (
            <Row title="Lock after leaving the app" value={LOCK_TIMEOUTS.find(([v]) => v === device.lockTimeout)?.[1] || 'Immediately'} onClick={async () => {
              const v = await choose('Lock after leaving the app', LOCK_TIMEOUTS, device.lockTimeout);
              if (v != null) { await native.prefsSet('lockTimeout', v); loadDevice(); }
            }} />
          ) : null}
          <Toggle icon="shield" title="Block screenshots" desc="Also hides note content in the recent apps screen" value={device.secureScreen} onChange={async (v) => { await native.prefsSet('secureScreen', v ? '1' : null); await applySecureFlags(); loadDevice(); }} />
          {vaultRows}
        </section>

        <section class="settings-group">
          <h2>Notes</h2>
          <Row icon="trash" title="Empty trash automatically" value={Number(s.trashDays) ? `After ${plural(Number(s.trashDays), 'day', 'days')}` : 'Never'} onClick={async () => {
            const v = await choose('Delete notes in trash', [['7', 'After 7 days'], ['14', 'After 14 days'], ['30', 'After 30 days'], ['0', 'Never']], String(s.trashDays));
            if (v != null) set({ trashDays: Number(v) });
          }} />
          <Toggle icon="history" title="Version history" desc="Keep earlier versions of notes in the history folder" value={s.history} onChange={(v) => set({ history: v })} />
          {s.history ? <Row title="Versions kept per note" value={String(s.historyMax)} onClick={async () => {
            const v = await choose('Versions kept per note', [['10', '10'], ['30', '30'], ['100', '100']], String(s.historyMax));
            if (v) set({ historyMax: Number(v) });
          }} /> : null}
          <Row icon="tags" title="Edit labels" onClick={() => pushPage({ type: 'labels' })} />
        </section>

        <section class="settings-group">
          <h2>About</h2>
          <Row icon="info" title="About Notebound" desc={`Version ${info.appVersion || ''}. Free software under the GPL-3.0 license.`} onClick={() => pushPage({ type: 'about' })} />
        </section>
      </div>
    </div>
  );
}

export function LabelsPage() {
  const [name, setName] = useState('');
  const labels = vault.config.labels;
  const counts = new Map();
  for (const e of vault.all()) if (!e.meta.trashed) for (const l of e.meta.labels) counts.set(l, (counts.get(l) || 0) + 1);
  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (!vault.addLabel(n)) snack('That label already exists');
    setName('');
  };
  return (
    <div class="page-layer">
      <div class="page-top">
        <button class="icon-btn" onClick={popPage} aria-label="Back"><Icon name="back" /></button>
        <h1>Edit labels</h1>
      </div>
      <div class="page-scroll">
        <div style={{ display: 'flex', gap: '8px', margin: '4px 0 12px' }}>
          <input class="field" placeholder="Create new label" value={name} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="New label name" />
          <button class="btn primary" onClick={add} disabled={!name.trim()}>Add</button>
        </div>
        <section class="settings-group">
          {labels.length ? labels.map((l) => (
            <div key={l} class="setting">
              <Icon name="tag" />
              <button class="text" style={{ textAlign: 'left' }} onClick={() => { popPage(); setView({ name: 'label', id: l }); }}>
                <div class="title">{l}</div>
                <div class="desc">{plural(counts.get(l) || 0, 'note', 'notes')}</div>
              </button>
              <button class="icon-btn" aria-label={`Rename ${l}`} onClick={async () => {
                const n = await ask({ title: 'Rename label', input: l, confirm: 'Rename' });
                if (n && n.trim() && n.trim() !== l) runAction('Rename label', () => vault.renameLabel(l, n.trim()));
              }}><Icon name="square-pen" /></button>
              <button class="icon-btn" aria-label={`Delete ${l}`} onClick={async () => {
                if (await ask({ title: `Delete label "${l}"?`, message: 'The label is removed from all notes. Your notes are not deleted.', confirm: 'Delete', danger: true })) {
                  runAction('Delete label', () => vault.deleteLabel(l));
                }
              }}><Icon name="trash" /></button>
            </div>
          )) : <p class="muted" style={{ padding: '16px 18px', margin: 0 }}>No labels yet.</p>}
        </section>
      </div>
    </div>
  );
}

export function AboutPage() {
  const [licenses, setLicenses] = useState('');
  useEffect(() => {
    fetch('third-party-licenses.txt').then((r) => r.text()).then(setLicenses).catch(() => {});
  }, []);
  const info = ui.get().info;
  return (
    <div class="page-layer">
      <div class="page-top">
        <button class="icon-btn" onClick={popPage} aria-label="Back"><Icon name="back" /></button>
        <h1>About</h1>
      </div>
      <div class="page-scroll">
        <div class="about-logo">
          <Logo size={72} />
          <h2>Notebound</h2>
          <p class="muted" style={{ margin: 0 }}>Version {info.appVersion}</p>
          <p class="muted" style={{ maxWidth: '340px' }}>
            Notes that stay on your phone, in a folder you choose. No account, no internet access, no tracking.
          </p>
        </div>
        <section class="settings-group">
          <Row icon="scale" title="License" desc="GNU General Public License v3.0 or later. You may use, study, share and change this app." />
          <Row icon="external" title="Source code" desc={SOURCE_URL.replace('https://', '')} onClick={() => native.openUrl(SOURCE_URL).catch(() => {})} />
          <Row icon="share" title="Share diagnostic info" desc="App version, phone model and recent errors, to report a problem" onClick={() => native.shareText('Notebound diagnostics', diagnosticsText(info.appVersion)).catch(() => {})} />
        </section>
        <h3 class="muted" style={{ fontSize: '13px', margin: '20px 6px 8px' }}>Open-source software used in Notebound</h3>
        <div class="license-text">{licenses || 'Loading…'}</div>
      </div>
    </div>
  );
}
