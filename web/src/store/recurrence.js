// Repeating reminders. Mirrors android/.../Recurrence.java; both are tested
// against the same cases so the app and the alarm scheduler always agree.
// Occurrences are computed from the original time (never cumulatively), so a
// reminder on the 31st stays on the 31st in long months and the last day otherwise.

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function occurrence(base, repeat, k) {
  const y = base.getFullYear();
  const m = base.getMonth();
  const d = base.getDate();
  const hh = base.getHours();
  const mm = base.getMinutes();
  const ss = base.getSeconds();
  switch (repeat) {
    case 'daily':
      return new Date(y, m, d + k, hh, mm, ss);
    case 'weekly':
      return new Date(y, m, d + 7 * k, hh, mm, ss);
    case 'monthly': {
      const tm = m + k;
      const ty = y + Math.floor(tm / 12);
      const tmm = ((tm % 12) + 12) % 12;
      return new Date(ty, tmm, Math.min(d, daysInMonth(ty, tmm)), hh, mm, ss);
    }
    case 'yearly': {
      const ty = y + k;
      return new Date(ty, m, Math.min(d, daysInMonth(ty, m)), hh, mm, ss);
    }
    default:
      return new Date(base.getTime());
  }
}

/**
 * Next time the reminder fires strictly after `afterMs`, or null when a
 * one-time reminder is already in the past.
 */
export function nextOccurrence(baseIso, repeat, afterMs = Date.now()) {
  const base = new Date(baseIso);
  const t = base.getTime();
  if (!Number.isFinite(t)) return null;
  if (t > afterMs) return t;
  if (!repeat || repeat === 'none') return null;
  const diff = afterMs - t;
  let k;
  switch (repeat) {
    case 'daily': k = Math.floor(diff / 86400000) - 1; break;
    case 'weekly': k = Math.floor(diff / 604800000) - 1; break;
    case 'monthly': {
      const a = new Date(afterMs);
      k = (a.getFullYear() - base.getFullYear()) * 12 + (a.getMonth() - base.getMonth()) - 1;
      break;
    }
    case 'yearly': k = new Date(afterMs).getFullYear() - base.getFullYear() - 1; break;
    default: return null;
  }
  if (k < 1) k = 1;
  for (let i = 0; i < 1000; i++, k++) {
    const c = occurrence(base, repeat, k).getTime();
    if (c > afterMs) return c;
  }
  return null;
}
