// Dates and small text helpers, using the phone's locale.
let cachedLocale = null;
/** The phone's language for dates, or the default when the system reports one Intl does not accept (e.g. "en-US@posix"). */
export function locale() {
  if (cachedLocale !== null) return cachedLocale || undefined;
  const raw = (typeof navigator !== 'undefined' && navigator.language) || '';
  let ok = '';
  try { ok = raw && Intl.DateTimeFormat.supportedLocalesOf([raw])[0] ? raw : ''; } catch { ok = ''; }
  if (!ok && raw) {
    const base = raw.split(/[@.]/)[0].replace('_', '-');
    try { ok = Intl.DateTimeFormat.supportedLocalesOf([base])[0] ? base : ''; } catch { ok = ''; }
  }
  cachedLocale = ok;
  return ok || undefined;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function timeOf(d) {
  return d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
}

export function shortDate(d, withYear) {
  return d.toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined });
}

/** "10:32", "Yesterday", "Oct 3", "Oct 3, 2024" — the Keep style "Edited …" time. */
export function editedLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  if (sameDay(d, now)) return timeOf(d);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  return shortDate(d, d.getFullYear() !== now.getFullYear());
}

/** Reminder chip: "Today, 18:00", "Tomorrow, 08:00", "Fri, 08:00", "Oct 20, 08:00". */
export function reminderLabel(ms, now = new Date()) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  const t = timeOf(d);
  if (sameDay(d, now)) return `Today, ${t}`;
  const tm = new Date(now);
  tm.setDate(now.getDate() + 1);
  if (sameDay(d, tm)) return `Tomorrow, ${t}`;
  const yd = new Date(now);
  yd.setDate(now.getDate() - 1);
  if (sameDay(d, yd)) return `Yesterday, ${t}`;
  const diffDays = (d - now) / 86400000;
  if (diffDays > 0 && diffDays < 6) return `${d.toLocaleDateString(locale(), { weekday: 'short' })}, ${t}`;
  return `${shortDate(d, d.getFullYear() !== now.getFullYear())}, ${t}`;
}

export const REPEAT_LABELS = { none: 'Does not repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

export function fullDate(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "HH:MM" settings string -> {h, m} */
export function parseHm(s, fallback = '08:00') {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || fallback) || /^(\d{1,2}):(\d{2})$/.exec(fallback);
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

export function toDateInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function toTimeInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
