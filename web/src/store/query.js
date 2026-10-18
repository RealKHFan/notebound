// Filtering and sorting shared by the home screen, search, widgets and tests.
import { normalizeForSearch } from './note-format.js';
import { nextOccurrence } from './recurrence.js';

export function sortEntries(list, sort = 'custom') {
  const arr = [...list];
  const byOrder = (a, b) => (b.meta.order - a.meta.order) || (Date.parse(b.meta.created) - Date.parse(a.meta.created));
  switch (sort) {
    case 'modified':
      arr.sort((a, b) => Date.parse(b.meta.modified) - Date.parse(a.meta.modified) || byOrder(a, b));
      break;
    case 'created':
      arr.sort((a, b) => Date.parse(b.meta.created) - Date.parse(a.meta.created) || byOrder(a, b));
      break;
    case 'title':
      arr.sort((a, b) => (a.title || '￿').localeCompare(b.title || '￿', undefined, { sensitivity: 'base', numeric: true }) || byOrder(a, b));
      break;
    default:
      arr.sort(byOrder);
  }
  return arr;
}

/** Notes that belong to a notebook or any of its sub-notebooks. */
export function notebookAndDescendants(notebooks, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const nb of notebooks) {
      if (nb.parent && out.has(nb.parent) && !out.has(nb.id)) { out.add(nb.id); grew = true; }
    }
  }
  return out;
}

export function matchesQuery(entry, q) {
  if (!q) return true;
  const terms = normalizeForSearch(q).split(/\s+/).filter(Boolean);
  return terms.every((t) => entry.search.includes(t));
}

/**
 * view: { name: 'notes'|'reminders'|'favorites'|'archive'|'trash'|'label'|'notebook'|'search', id? }
 * filters (search only): { type?, label?, color?, notebook? }
 */
export function selectNotes(entries, view, { query = '', filters = {}, notebooks = [], now = Date.now() } = {}) {
  let list = [...entries];
  const live = (e) => !e.meta.trashed;
  switch (view.name) {
    case 'notes': list = list.filter((e) => live(e) && !e.meta.archived); break;
    case 'reminders': list = list.filter((e) => live(e) && e.meta.reminder); break;
    case 'favorites': list = list.filter((e) => live(e) && e.meta.favorite); break;
    case 'archive': list = list.filter((e) => live(e) && e.meta.archived); break;
    case 'trash': list = list.filter((e) => !!e.meta.trashed); break;
    case 'label': list = list.filter((e) => live(e) && e.meta.labels.includes(view.id)); break;
    case 'notebook': {
      const ids = notebookAndDescendants(notebooks, view.id);
      list = list.filter((e) => live(e) && e.meta.notebooks.some((n) => ids.has(n)));
      break;
    }
    case 'search': list = list.filter(live); break;
    default: list = list.filter(live);
  }
  if (view.name === 'search') {
    const f = filters;
    if (f.type) list = list.filter((e) => matchesType(e, f.type));
    if (f.label) list = list.filter((e) => e.meta.labels.includes(f.label));
    if (f.color) list = list.filter((e) => e.meta.color === f.color);
    if (f.notebook) {
      const ids = notebookAndDescendants(notebooks, f.notebook);
      list = list.filter((e) => e.meta.notebooks.some((n) => ids.has(n)));
    }
  }
  if (query) list = list.filter((e) => matchesQuery(e, query));
  return list;
}

export const TYPE_FILTERS = [
  { id: 'reminders', name: 'Reminders', icon: 'bell' },
  { id: 'lists', name: 'Lists', icon: 'list-checks' },
  { id: 'images', name: 'Images', icon: 'image' },
  { id: 'drawings', name: 'Drawings', icon: 'brush' },
  { id: 'links', name: 'Links', icon: 'link' },
  { id: 'files', name: 'Files', icon: 'paperclip' },
  { id: 'locked', name: 'Locked', icon: 'lock' },
  { id: 'favorites', name: 'Favorites', icon: 'star' },
];

export function matchesType(e, type) {
  switch (type) {
    case 'reminders': return !!e.meta.reminder;
    case 'lists': return e.items.length > 0;
    case 'images': return e.images.some((i) => !i.d);
    case 'drawings': return e.images.some((i) => i.d);
    case 'links': return e.hasLinks;
    case 'files': return e.attachments.length > 0;
    case 'locked': return !!e.meta.locked;
    case 'favorites': return e.meta.favorite;
    default: return true;
  }
}

/** Split a sorted list into pinned/others the way the home screen shows it. */
export function splitPinned(list, view) {
  if (view.name === 'trash' || view.name === 'reminders') return { pinned: [], others: list };
  return { pinned: list.filter((e) => e.meta.pinned), others: list.filter((e) => !e.meta.pinned) };
}

export function reminderBuckets(list, now = Date.now()) {
  const upcoming = [];
  const past = [];
  for (const e of list) {
    const next = nextOccurrence(e.meta.reminder.at, e.meta.reminder.repeat, now);
    if (next) upcoming.push({ e, next });
    else past.push({ e, next: Date.parse(e.meta.reminder.at) });
  }
  upcoming.sort((a, b) => a.next - b.next);
  past.sort((a, b) => b.next - a.next);
  return { upcoming: upcoming.map((x) => x.e), past: past.map((x) => x.e) };
}
