import { memo } from 'preact/compat';
import { Icon } from './icons.jsx';
import { nextOccurrence } from '../store/recurrence.js';
import { reminderLabel } from './format.js';

export function vaultUrl(path) {
  return '/vault/' + String(path).split('/').map(encodeURIComponent).join('/');
}

function CardImages({ images, onlyImages }) {
  const shown = images.slice(0, 3);
  if (!shown.length) return null;
  if (shown.length === 1) {
    const im = shown[0];
    let ratio = im.w && im.h ? im.w / im.h : 4 / 3;
    ratio = Math.max(0.6, Math.min(2.4, ratio));
    return (
      <div class={'card-images' + (onlyImages ? ' only-images' : '')}>
        <img src={vaultUrl(im.p)} class={im.d ? 'drawing' : ''} style={{ aspectRatio: String(ratio) }} loading="lazy" alt="" draggable={false} />
      </div>
    );
  }
  return (
    <div class={'card-images' + (onlyImages ? ' only-images' : '')} style={{ '--cols': shown.length }}>
      {shown.map((im) => (
        <img key={im.p} src={vaultUrl(im.p)} class={im.d ? 'drawing' : ''} style={{ height: '104px' }} loading="lazy" alt="" draggable={false} />
      ))}
    </div>
  );
}

function ListPreview({ items, lines }) {
  const unchecked = items.filter((i) => !i.c);
  const checked = items.length - unchecked.length;
  const max = Math.max(3, lines - 1);
  const shown = unchecked.slice(0, max);
  const hidden = unchecked.length - shown.length;
  return (
    <ul class="card-items">
      {shown.map((it, i) => (
        <li key={i} style={it.d ? { paddingLeft: `${it.d * 18}px` } : null}>
          <span class="box" />
          <span>{it.t || ' '}</span>
        </li>
      ))}
      {hidden > 0 || checked > 0 ? (
        <li class="more">
          {[hidden > 0 ? `+${hidden} more` : '', checked > 0 ? `${checked} checked` : ''].filter(Boolean).join(', ')}
        </li>
      ) : null}
    </ul>
  );
}

function NoteCardInner({ entry, selected, lines, labelsShown = 3, showNotebook }) {
  const m = entry.meta;
  const now = Date.now();
  let reminder = null;
  if (m.reminder) {
    const next = nextOccurrence(m.reminder.at, m.reminder.repeat, now);
    reminder = { past: !next, text: reminderLabel(next || Date.parse(m.reminder.at)), repeat: !!m.reminder.repeat };
  }
  const visibleImages = m.locked ? [] : entry.images;
  const hasText = !m.locked && (entry.isList ? entry.items.length > 0 : !!entry.preview);
  const onlyImages = visibleImages.length > 0 && !entry.title && !hasText && !m.labels.length && !reminder;
  return (
    <div
      class={'card' + (selected ? ' selected' : '') + (m.pinned ? ' has-ribbon' : '')}
      data-color={m.color}
      data-pattern={m.pattern && m.pattern !== 'none' ? m.pattern : undefined}
      data-id={entry.id}
      role="button"
      tabIndex={0}
      aria-label={entry.title || entry.preview.slice(0, 40) || 'Empty note'}
      aria-pressed={selected ? 'true' : undefined}
    >
      {m.pinned ? <span class="ribbon" aria-label="Pinned" /> : null}
      <CardImages images={visibleImages} onlyImages={onlyImages} />
      {entry.title ? <div class="card-title">{entry.title}</div> : null}
      {m.locked ? (
        <div class="locked-line"><Icon name="lock" size={16} /> Locked</div>
      ) : entry.isList ? (
        <ListPreview items={entry.items} lines={lines} />
      ) : entry.preview ? (
        <div class="card-body" style={{ WebkitLineClamp: String(lines) }}>{entry.preview}</div>
      ) : null}
      {!entry.title && !hasText && !visibleImages.length && !m.locked ? <div class="card-body muted">Empty note</div> : null}
      {reminder || m.labels.length || entry.attachments.length || (showNotebook && m.notebooks.length) || m.favorite ? (
        <div class="card-chips">
          {reminder ? (
            <span class={'chip' + (reminder.past ? ' past' : '')}>
              <Icon name={reminder.repeat ? 'repeat' : 'bell'} size={13} />
              <span>{reminder.text}</span>
            </span>
          ) : null}
          {m.favorite ? <span class="chip" aria-label="Favorite"><Icon name="star" size={13} /></span> : null}
          {entry.attachments.length ? <span class="chip"><Icon name="paperclip" size={13} /><span>{entry.attachments.length}</span></span> : null}
          {m.labels.slice(0, labelsShown).map((l) => <span key={l} class="chip"><span>{l}</span></span>)}
          {m.labels.length > labelsShown ? <span class="chip"><span>+{m.labels.length - labelsShown}</span></span> : null}
        </div>
      ) : null}
    </div>
  );
}

export const NoteCard = memo(NoteCardInner);
