import { useRef, useMemo } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { Masonry } from './Masonry.jsx';
import { Drawer } from './Drawer.jsx';
import { SearchHeader, SearchCategories } from './Search.jsx';
import {
  ui, vault, setView, openSearch, openNote, newNote, openSheet, ask, runAction, snack, pushPage,
} from './app-state.js';
import { selectNotes, sortEntries, splitPinned, reminderBuckets } from '../store/query.js';
import { archiveNotes, pinNotes, trashNotes, restoreNotes, deleteForever, emptyTrash, duplicateNotes, favoriteNotes } from './note-actions.js';
import { idsTarget } from './sheets.jsx';
import { native } from '../native.js';
import { plural } from './format.js';
import { Logo } from './Logo.jsx';

const VIEW_TITLES = { reminders: 'Reminders', favorites: 'Favorites', archive: 'Archive', trash: 'Trash' };

function viewTitle(view) {
  if (view.name === 'label') return view.id;
  if (view.name === 'notebook') return vault.config.notebooks.find((n) => n.id === view.id)?.name || 'Notebook';
  return VIEW_TITLES[view.name] || 'Notes';
}

const EMPTY = {
  notes: { icon: 'notebook-pen', title: 'Notes you add appear here', text: 'Tap + to write something, or start a list, a drawing or a photo note from the bar below.' },
  reminders: { icon: 'bell', title: 'Notes with reminders appear here', text: 'Open a note and tap the bell to be reminded about it.' },
  favorites: { icon: 'star', title: 'Starred notes appear here', text: 'Mark a note as a favorite from its menu.' },
  archive: { icon: 'archive', title: 'Your archived notes appear here', text: 'Archive notes to keep them out of the way without deleting them.' },
  trash: { icon: 'trash', title: 'No notes in trash', text: '' },
  label: { icon: 'tag', title: 'No notes with this label yet', text: 'Tap + to add a note with this label.' },
  notebook: { icon: 'notebook', title: 'This notebook is empty', text: 'Tap + to add a note to this notebook.' },
  search: { icon: 'search', title: 'No matching notes', text: '' },
};

function Empty({ kind }) {
  const e = EMPTY[kind] || EMPTY.notes;
  return (
    <div class="empty">
      <Icon name={e.icon} size={72} stroke={1.2} />
      <h2>{e.title}</h2>
      {e.text ? <p>{e.text}</p> : null}
    </div>
  );
}

function SelectionBar({ ids, view }) {
  const entries = ids.map((id) => vault.get(id)).filter(Boolean);
  const allPinned = entries.length && entries.every((e) => e.meta.pinned);
  const inTrash = view.name === 'trash';
  const clear = () => ui.set({ selection: [] });
  const done = (fn) => () => { clear(); fn(); };
  if (inTrash) {
    return (
      <div class="selection-bar">
        <button class="icon-btn" onClick={clear} aria-label="Clear selection"><Icon name="x" /></button>
        <span class="count">{ids.length}</span>
        <button class="icon-btn" onClick={done(() => restoreNotes(ids))} aria-label="Restore"><Icon name="unarchive" /></button>
        <button class="icon-btn" onClick={async () => { if (await deleteForever(ids)) clear(); }} aria-label="Delete forever"><Icon name="trash" /></button>
      </div>
    );
  }
  const archived = entries.length && entries.every((e) => e.meta.archived);
  return (
    <div class="selection-bar">
      <button class="icon-btn" onClick={clear} aria-label="Clear selection"><Icon name="x" /></button>
      <span class="count" aria-live="polite">{ids.length}</span>
      <button class="icon-btn" onClick={() => pinNotes(ids, !allPinned)} aria-label={allPinned ? 'Unpin' : 'Pin'}><Icon name={allPinned ? 'pin-off' : 'pin'} /></button>
      <button class="icon-btn" onClick={() => openSheet('reminder', { target: idsTarget(ids) })} aria-label="Remind me"><Icon name="bell" /></button>
      <button class="icon-btn" onClick={() => openSheet('color', { target: idsTarget(ids) })} aria-label="Color"><Icon name="palette" /></button>
      <button class="icon-btn" onClick={done(() => archiveNotes(ids, !archived))} aria-label={archived ? 'Unarchive' : 'Archive'}><Icon name={archived ? 'unarchive' : 'archive'} /></button>
      <button
        class="icon-btn"
        aria-label="More"
        onClick={() => openSheet('menu', {
          items: [
            { icon: 'tag', label: 'Labels', onClick: () => openSheet('labels', { target: idsTarget(ids) }) },
            { icon: 'notebook', label: 'Notebooks', onClick: () => openSheet('notebooks', { target: idsTarget(ids) }) },
            { icon: 'star', label: entries.every((e) => e.meta.favorite) ? 'Remove from favorites' : 'Add to favorites', onClick: () => favoriteNotes(ids, !entries.every((e) => e.meta.favorite)) },
            { icon: 'copy', label: 'Make a copy', onClick: () => { clear(); duplicateNotes(ids); } },
            { icon: 'download', label: 'Export', onClick: () => openSheet('export', { ids }) },
            { icon: 'trash', label: 'Delete', danger: true, onClick: () => { clear(); trashNotes(ids); } },
          ],
        })}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}

function ViewMenu({ view }) {
  if (view.name === 'trash') {
    return <button class="icon-btn" aria-label="Trash options" onClick={() => openSheet('menu', { items: [{ icon: 'trash', label: 'Empty trash', danger: true, onClick: emptyTrash }] })}><Icon name="more" /></button>;
  }
  if (view.name === 'label') {
    return (
      <button
        class="icon-btn"
        aria-label="Label options"
        onClick={() => openSheet('menu', {
          items: [
            { icon: 'square-pen', label: 'Rename label', onClick: async () => {
              const name = await ask({ title: 'Rename label', input: view.id, confirm: 'Rename' });
              if (name && name.trim() && name.trim() !== view.id) {
                await runAction('Rename', () => vault.renameLabel(view.id, name.trim()));
                setView({ name: 'label', id: name.trim() });
              }
            } },
            { icon: 'trash', label: 'Delete label', danger: true, onClick: async () => {
              if (await ask({ title: `Delete label "${view.id}"?`, message: 'The label is removed from all notes. Your notes are not deleted.', confirm: 'Delete', danger: true })) {
                await runAction('Delete label', () => vault.deleteLabel(view.id));
                setView({ name: 'notes' });
              }
            } },
          ],
        })}
      ><Icon name="more" /></button>
    );
  }
  if (view.name === 'notebook') {
    return (
      <button
        class="icon-btn"
        aria-label="Notebook options"
        onClick={() => openSheet('menu', {
          items: [
            { icon: 'folder-plus', label: 'Add sub-notebook', onClick: async () => {
              const name = await ask({ title: 'New sub-notebook', input: '', placeholder: 'Name', confirm: 'Create' });
              if (name && name.trim()) vault.addNotebook(name.trim(), view.id);
            } },
            { icon: 'square-pen', label: 'Rename notebook', onClick: async () => {
              const nb = vault.config.notebooks.find((n) => n.id === view.id);
              const name = await ask({ title: 'Rename notebook', input: nb?.name || '', confirm: 'Rename' });
              if (name && name.trim()) vault.renameNotebook(view.id, name.trim());
            } },
            { icon: 'trash', label: 'Delete notebook', danger: true, onClick: async () => {
              if (await ask({ title: 'Delete this notebook?', message: 'Sub-notebooks are deleted too. Notes stay in Notebound.', confirm: 'Delete', danger: true })) {
                await runAction('Delete notebook', () => vault.deleteNotebook(view.id));
                setView({ name: 'notes' });
              }
            } },
          ],
        })}
      ><Icon name="more" /></button>
    );
  }
  return null;
}

export function Home() {
  const s = ui.get();
  const { view, selection, search } = s;
  const settings = vault.settings;
  const scroller = useRef(null);
  const layout = settings.layout;
  const isSearch = !!search;
  const effView = isSearch ? { name: 'search' } : view;

  const list = useMemo(() => {
    const sel = selectNotes(vault.all(), effView, {
      query: search?.query || '',
      filters: search?.filters || {},
      notebooks: vault.config.notebooks,
    });
    return sortEntries(sel, settings.sort);
  }, [vault.version, effView.name, effView.id, search?.query, JSON.stringify(search?.filters || {}), settings.sort]);

  const searching = isSearch && (search.query || Object.values(search.filters || {}).some(Boolean));
  const canReorder = settings.sort === 'custom' && !isSearch && ['notes', 'label', 'notebook', 'favorites'].includes(view.name);
  const swipe = !isSearch && view.name !== 'trash' ? (id) => {
    const e = vault.get(id);
    if (!e) return;
    archiveNotes([id], !e.meta.archived);
  } : null;

  const gridProps = {
    layout,
    selection,
    lines: Number(settings.cardLines) || 10,
    onOpen: (id) => openNote(id),
    onToggleSelect: (id) => ui.set((st) => ({ selection: st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id] })),
    onLongPress: (id) => ui.set((st) => ({ selection: st.selection.includes(id) ? st.selection : [...st.selection, id] })),
    canReorder,
    onReorder: (id, before, after) => {
      ui.set({ selection: [] });
      runAction('Reorder', () => vault.reorder(id, before ? vault.get(before) : null, after ? vault.get(after) : null));
    },
    onSwipe: swipe,
    scrollerRef: scroller,
  };

  let content;
  if (isSearch && !searching) {
    content = <SearchCategories />;
  } else if (!list.length && !vault.hasScanned) {
    content = <div class="empty" aria-busy="true"><div class="spinner" /></div>;
  } else if (!list.length) {
    content = <Empty kind={isSearch ? 'search' : view.name} />;
  } else if (view.name === 'reminders' && !isSearch) {
    const { upcoming, past } = reminderBuckets(list);
    content = (
      <>
        {upcoming.length ? <div class="section-label">Upcoming</div> : null}
        {upcoming.length ? <Masonry key="up" entries={upcoming} {...gridProps} canReorder={false} /> : null}
        {past.length ? <div class="section-label">Sent</div> : null}
        {past.length ? <Masonry key="past" entries={past} {...gridProps} canReorder={false} /> : null}
      </>
    );
  } else {
    const { pinned, others } = splitPinned(list, effView);
    content = (
      <>
        {pinned.length ? <div class="section-label">Pinned</div> : null}
        {pinned.length ? <Masonry key="pinned" entries={pinned} {...gridProps} /> : null}
        {pinned.length && others.length ? <div class="section-label">Others</div> : null}
        {others.length ? <Masonry key="others" entries={others} {...gridProps} /> : null}
      </>
    );
  }

  const showCreate = !isSearch && ['notes', 'label', 'notebook', 'favorites'].includes(view.name);
  const childNotebooks = view.name === 'notebook' ? vault.config.notebooks.filter((n) => n.parent === view.id) : [];

  return (
    <div class="app">
      <div class="home-top">
        {selection.length ? (
          <SelectionBar ids={selection} view={effView} />
        ) : isSearch ? (
          <SearchHeader />
        ) : view.name === 'notes' ? (
          <div class="searchbar">
            <button class="icon-btn" onClick={() => ui.set({ drawer: true })} aria-label="Open menu"><Icon name="menu" /></button>
            <button class="search-hint" onClick={() => openSearch()} aria-label="Search your notes">Search your notes</button>
            <button class="icon-btn" onClick={() => vault.setSettings({ layout: layout === 'grid' ? 'list' : 'grid' })} aria-label={layout === 'grid' ? 'List view' : 'Grid view'}>
              <Icon name={layout === 'grid' ? 'rows' : 'grid'} />
            </button>
          </div>
        ) : (
          <div class="top-row">
            <button class="icon-btn" onClick={() => ui.set({ drawer: true })} aria-label="Open menu"><Icon name="menu" /></button>
            <div class="view-title">{viewTitle(view)}</div>
            <button class="icon-btn" onClick={() => openSearch()} aria-label="Search"><Icon name="search" /></button>
            <button class="icon-btn" onClick={() => vault.setSettings({ layout: layout === 'grid' ? 'list' : 'grid' })} aria-label={layout === 'grid' ? 'List view' : 'Grid view'}>
              <Icon name={layout === 'grid' ? 'rows' : 'grid'} />
            </button>
            <ViewMenu view={view} />
          </div>
        )}
      </div>
      <div class="home-scroll" ref={scroller}>
        {view.name === 'trash' && !isSearch && list.length ? (
          <div class="view-actions">
            <span class="muted" style={{ flex: 1, padding: '6px 4px', fontSize: '13.5px' }}>
              {Number(settings.trashDays) ? `Notes in trash are deleted after ${plural(Number(settings.trashDays), 'day', 'days')}.` : 'Notes stay in trash until you delete them.'}
            </span>
            <button class="btn text" onClick={emptyTrash}>Empty trash</button>
          </div>
        ) : null}
        {childNotebooks.length ? (
          <div class="chip-wrap" style={{ padding: '6px 6px 4px' }}>
            {childNotebooks.map((nb) => (
              <button key={nb.id} class="chip outline" onClick={() => setView({ name: 'notebook', id: nb.id })}>
                <Icon name="notebook" size={15} /><span>{nb.name}</span>
              </button>
            ))}
          </div>
        ) : null}
        {content}
      </div>
      {showCreate && !selection.length ? (
        <>
          <div class="bottom-bar" role="toolbar" aria-label="Create">
            <button class="icon-btn" onClick={() => newNote('list')} aria-label="New list"><Icon name="checklist" /></button>
            <button class="icon-btn" onClick={() => newNote('drawing')} aria-label="New drawing"><Icon name="brush" /></button>
            <button class="icon-btn" onClick={() => newNote('image')} aria-label="New image note"><Icon name="image" /></button>
            <button class="icon-btn" onClick={() => newNote('photo')} aria-label="New photo note"><Icon name="camera" /></button>
          </div>
          <button class="fab" onClick={() => newNote('text')} aria-label="New note"><Icon name="plus" size={28} stroke={2.2} /></button>
        </>
      ) : null}
      {s.drawer ? <Drawer /> : null}
    </div>
  );
}

export { Logo };
