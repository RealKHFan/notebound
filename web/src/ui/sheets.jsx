import { createContext } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { attachSheetDrag } from './sheet-drag.js';
import { Icon } from './icons.jsx';
import { closeSheet, vault, ui, snack } from './app-state.js';
import { COLORS, PATTERNS } from '../store/note-format.js';
import { nextOccurrence } from '../store/recurrence.js';
import { REPEAT_LABELS, parseHm, reminderLabel, toDateInput, toTimeInput } from './format.js';
import { native } from '../native.js';

/** Set by the sheet host: whether the current sheet is sliding away. */
export const SheetState = createContext({ closing: false });

export function Sheet({ title, children, onClose = closeSheet, label }) {
  const { closing } = useContext(SheetState);
  const sheetRef = useRef(null);
  const scrimRef = useRef(null);
  const bodyRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => attachSheetDrag({
    sheet: sheetRef.current,
    scrim: scrimRef.current,
    body: bodyRef.current,
    onClose: () => closeRef.current(),
  }), []);
  return (
    <div class={'sheet-root' + (closing ? ' closing' : '')} aria-hidden={closing ? 'true' : undefined}>
      <div class="scrim" ref={scrimRef} onClick={() => onClose()} />
      <div class="sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label={label || title}>
        <div class="sheet-grip" aria-hidden="true" />
        {title ? <div class="sheet-title">{title}</div> : null}
        <div class="sheet-body" ref={bodyRef}>{children}</div>
      </div>
    </div>
  );
}

/** items: [{ icon, label, sub, onClick, danger, checked, keepOpen }] */
export function MenuSheet({ title, items }) {
  return (
    <Sheet title={title} label={title || 'Menu'}>
      {items.filter(Boolean).map((it) => (
        <button
          key={it.label}
          class={'menu-item' + (it.danger ? ' danger' : '')}
          onClick={() => { if (!it.keepOpen) closeSheet(); it.onClick?.(); }}
          role="menuitem"
        >
          {it.icon ? <Icon name={it.icon} /> : null}
          <span class="grow">
            {it.label}
            {it.sub ? <div class="sub">{it.sub}</div> : null}
          </span>
          {it.checked ? <Icon name="check" class="check" /> : null}
        </button>
      ))}
    </Sheet>
  );
}

/** A target lets the same sheet edit selected notes on the home screen or the open note. */
export function idsTarget(ids) {
  return {
    metas: () => ids.map((id) => vault.get(id)?.meta).filter(Boolean),
    patch: (p) => vault.updateMeta(ids, p),
  };
}

export function ColorSheet({ target }) {
  const metas = target.metas();
  const color = metas.length && metas.every((m) => m.color === metas[0].color) ? metas[0].color : null;
  const pattern = metas.length && metas.every((m) => m.pattern === metas[0].pattern) ? metas[0].pattern : null;
  return (
    <Sheet title="Color" label="Color and background">
      <div class="swatches" role="radiogroup" aria-label="Note color">
        {COLORS.map((c) => (
          <button
            key={c.id}
            class={`swatch ${c.id === 'default' ? 'default' : 'sw-' + c.id}` + (color === c.id ? ' selected' : '')}
            aria-label={c.name}
            role="radio"
            aria-checked={color === c.id ? 'true' : 'false'}
            title={c.name}
            onClick={() => target.patch({ color: c.id })}
          >
            {c.id === 'default' ? <Icon name="ban" size={20} /> : null}
          </button>
        ))}
      </div>
      <div class="sheet-subtitle">Background</div>
      <div class="swatches" role="radiogroup" aria-label="Background pattern">
        {PATTERNS.map((p) => (
          <button
            key={p.id}
            class={'swatch pattern' + (pattern === p.id ? ' selected' : '')}
            data-pattern={p.id === 'none' ? undefined : p.id}
            aria-label={p.name}
            role="radio"
            aria-checked={pattern === p.id ? 'true' : 'false'}
            title={p.name}
            onClick={() => target.patch({ pattern: p.id })}
          >
            {p.id === 'none' ? <Icon name="ban" size={20} /> : null}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function triState(metas, key, value) {
  const n = metas.filter((m) => m[key].includes(value)).length;
  if (n === 0) return 'none';
  return n === metas.length ? 'all' : 'some';
}

function CheckBox({ state }) {
  return (
    <span class={'check-box ' + state} aria-hidden="true">
      {state === 'all' ? <Icon name="check" size={16} stroke={2.6} /> : state === 'some' ? <Icon name="minus" size={16} stroke={2.6} /> : null}
    </span>
  );
}

export function LabelSheet({ target }) {
  const [q, setQ] = useState('');
  const metas = target.metas();
  const all = vault.config.labels;
  const query = q.trim();
  const shown = all.filter((l) => l.toLowerCase().includes(query.toLowerCase()));
  const exact = all.some((l) => l.toLowerCase() === query.toLowerCase());
  const toggle = (label) => {
    const st = triState(metas, 'labels', label);
    target.patch((m) => ({ labels: st === 'all' ? m.labels.filter((x) => x !== label) : [...new Set([...m.labels, label])] }));
  };
  return (
    <Sheet title="Labels">
      <div style={{ padding: '0 6px 8px' }}>
        <input
          class="field"
          placeholder="Enter label name"
          value={q}
          onInput={(e) => setQ(e.currentTarget.value)}
          aria-label="Search or create label"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query && !exact) {
              vault.addLabel(query);
              target.patch((m) => ({ labels: [...new Set([...m.labels, query])] }));
              setQ('');
            }
          }}
        />
      </div>
      {query && !exact ? (
        <button
          class="menu-item"
          onClick={() => {
            vault.addLabel(query);
            target.patch((m) => ({ labels: [...new Set([...m.labels, query])] }));
            setQ('');
          }}
        >
          <Icon name="plus" />
          <span class="grow">Create "{query}"</span>
        </button>
      ) : null}
      {shown.map((l) => {
        const st = triState(metas, 'labels', l);
        return (
          <button key={l} class="menu-item" onClick={() => toggle(l)} role="menuitemcheckbox" aria-checked={st === 'all' ? 'true' : st === 'some' ? 'mixed' : 'false'}>
            <Icon name="tag" />
            <span class="grow">{l}</span>
            <CheckBox state={st} />
          </button>
        );
      })}
      {!all.length && !query ? <p class="muted" style={{ padding: '4px 14px' }}>No labels yet. Type a name to create one.</p> : null}
    </Sheet>
  );
}

export function notebookTree(notebooks) {
  const byParent = new Map();
  for (const nb of notebooks) {
    const p = nb.parent && notebooks.some((x) => x.id === nb.parent) ? nb.parent : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(nb);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const out = [];
  const walk = (parent, depth) => {
    for (const nb of byParent.get(parent) || []) {
      out.push({ nb, depth });
      walk(nb.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function NotebookSheet({ target }) {
  const metas = target.metas();
  const [name, setName] = useState('');
  const tree = notebookTree(vault.config.notebooks);
  const toggle = (id) => {
    const st = triState(metas, 'notebooks', id);
    target.patch((m) => ({ notebooks: st === 'all' ? m.notebooks.filter((x) => x !== id) : [...new Set([...m.notebooks, id])] }));
  };
  const create = () => {
    const n = name.trim();
    if (!n) return;
    const nb = vault.addNotebook(n);
    target.patch((m) => ({ notebooks: [...new Set([...m.notebooks, nb.id])] }));
    setName('');
  };
  return (
    <Sheet title="Notebooks">
      {tree.map(({ nb, depth }) => {
        const st = triState(metas, 'notebooks', nb.id);
        return (
          <button key={nb.id} class="menu-item" style={{ paddingLeft: `${14 + depth * 22}px` }} onClick={() => toggle(nb.id)} role="menuitemcheckbox" aria-checked={st === 'all' ? 'true' : st === 'some' ? 'mixed' : 'false'}>
            <Icon name={depth ? 'corner-down-right' : 'notebook'} />
            <span class="grow">{nb.name}</span>
            <CheckBox state={st} />
          </button>
        );
      })}
      <div style={{ display: 'flex', gap: '8px', padding: '10px 6px 4px' }}>
        <input class="field" placeholder="New notebook" value={name} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && create()} aria-label="New notebook name" />
        <button class="btn tonal" onClick={create} disabled={!name.trim()}>Add</button>
      </div>
    </Sheet>
  );
}

function atTime(base, hm) {
  const d = new Date(base);
  d.setHours(hm.h, hm.m, 0, 0);
  return d;
}

export function quickReminderOptions(now = new Date()) {
  const s = vault.settings;
  const morning = parseHm(s.morning, '08:00');
  const afternoon = parseHm(s.afternoon, '13:00');
  const evening = parseHm(s.evening, '18:00');
  const opts = [];
  const todayAfternoon = atTime(now, afternoon);
  const todayEvening = atTime(now, evening);
  if (todayAfternoon - now > 30 * 60000) opts.push({ label: 'Later today', when: todayAfternoon });
  else if (todayEvening - now > 30 * 60000) opts.push({ label: 'Later today', when: todayEvening });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  opts.push({ label: 'Tomorrow', when: atTime(tomorrow, morning) });
  const nextWeek = new Date(now);
  let daysToMonday = ((8 - now.getDay()) % 7) || 7;
  if (daysToMonday === 1) daysToMonday = 8; // "Tomorrow" already covers Monday
  nextWeek.setDate(now.getDate() + daysToMonday);
  opts.push({ label: 'Next week', when: atTime(nextWeek, morning) });
  return opts;
}

export function ReminderSheet({ target }) {
  const metas = target.metas();
  const current = metas.length === 1 ? metas[0].reminder : null;
  const initial = current ? new Date(nextOccurrence(current.at, current.repeat) || Date.parse(current.at)) : (() => {
    const d = new Date(Date.now() + 3600000);
    d.setMinutes(0, 0, 0);
    return d;
  })();
  const [custom, setCustom] = useState(!!current);
  const [date, setDate] = useState(toDateInput(initial));
  const [time, setTime] = useState(toTimeInput(initial));
  const [repeat, setRepeat] = useState(current?.repeat || 'none');
  const [warn, setWarn] = useState('');

  useEffect(() => {
    native.notificationPermission(false).then((st) => {
      if (st !== 'granted') setWarn('Notebound needs permission to show reminders. You will be asked when you save.');
    }).catch(() => {});
  }, []);

  const save = async (when, rep = repeat) => {
    const perm = await native.notificationPermission(true).catch(() => 'granted');
    target.patch({ reminder: { at: when.toISOString(), repeat: rep === 'none' ? null : rep } });
    closeSheet();
    if (perm !== 'granted') {
      snack('Reminder saved, but notifications are off. Allow them for Notebound in Android settings.', { duration: 7000 });
    }
  };
  const saveCustom = () => {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const when = new Date(y, mo - 1, d, h, mi, 0, 0);
    if (!Number.isFinite(when.getTime())) { setWarn('Choose a valid date and time.'); return; }
    if (repeat === 'none' && when.getTime() <= Date.now()) { setWarn('Choose a time in the future.'); return; }
    save(when);
  };
  return (
    <Sheet title="Remind me">
      {!custom ? (
        <>
          {quickReminderOptions().map((o) => (
            <button key={o.label} class="menu-item" onClick={() => save(o.when, 'none')}>
              <Icon name="clock" />
              <span class="grow">{o.label}</span>
              <span class="sub">{reminderLabel(o.when.getTime())}</span>
            </button>
          ))}
          <button class="menu-item" onClick={() => setCustom(true)}>
            <Icon name="calendar-clock" />
            <span class="grow">Pick a date and time</span>
          </button>
        </>
      ) : (
        <div style={{ display: 'grid', gap: '10px', padding: '4px 8px 8px' }}>
          <label class="muted" for="rem-date">Date</label>
          <input id="rem-date" class="field" type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
          <label class="muted" for="rem-time">Time</label>
          <input id="rem-time" class="field" type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} />
          <label class="muted" for="rem-repeat">Repeat</label>
          <select id="rem-repeat" class="field" value={repeat} onChange={(e) => setRepeat(e.currentTarget.value)}>
            {Object.entries(REPEAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button class="btn text" onClick={() => setCustom(false)}>Back</button>
            <button class="btn primary" onClick={saveCustom}>Save</button>
          </div>
        </div>
      )}
      {warn ? <p class="muted" style={{ padding: '4px 14px', fontSize: '13px' }}>{warn}</p> : null}
      {current ? (
        <button class="menu-item danger" onClick={() => { target.patch({ reminder: null }); closeSheet(); }}>
          <Icon name="bell-off" />
          <span class="grow">Remove reminder</span>
        </button>
      ) : null}
    </Sheet>
  );
}
