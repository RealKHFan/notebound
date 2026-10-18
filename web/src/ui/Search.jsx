import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { ui, vault } from './app-state.js';
import { TYPE_FILTERS, matchesType } from '../store/query.js';
import { COLORS } from '../store/note-format.js';
import { notebookTree } from './sheets.jsx';

function setFilter(patch) {
  ui.set((s) => ({ search: { ...s.search, filters: { ...s.search.filters, ...patch } } }));
}

function filterLabel(filters) {
  if (filters.type) return TYPE_FILTERS.find((t) => t.id === filters.type)?.name;
  if (filters.label) return filters.label;
  if (filters.color) return COLORS.find((c) => c.id === filters.color)?.name;
  if (filters.notebook) return vault.config.notebooks.find((n) => n.id === filters.notebook)?.name;
  return null;
}

export function SearchHeader() {
  const { search } = ui.get();
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const active = filterLabel(search.filters || {});
  return (
    <div class="searchbar">
      <button class="icon-btn" onClick={() => ui.set({ search: null })} aria-label="Close search"><Icon name="back" /></button>
      {active ? (
        <button class="chip selected filter-chip" onClick={() => ui.set((s) => ({ search: { ...s.search, filters: {} } }))} aria-label={`Remove filter ${active}`}>
          <span>{active}</span><Icon name="x" size={14} />
        </button>
      ) : null}
      <input
        ref={input}
        type="search"
        placeholder={active ? 'Search within' : 'Search your notes'}
        value={search.query}
        onInput={(e) => ui.set((s) => ({ search: { ...s.search, query: e.currentTarget.value } }))}
        aria-label="Search"
        enterkeyhint="search"
      />
      {search.query ? (
        <button class="icon-btn" onClick={() => ui.set((s) => ({ search: { ...s.search, query: '' } }))} aria-label="Clear search"><Icon name="x" /></button>
      ) : null}
    </div>
  );
}

export function SearchCategories() {
  const live = vault.all().filter((e) => !e.meta.trashed);
  const types = TYPE_FILTERS.filter((t) => live.some((e) => matchesType(e, t.id)));
  const colors = COLORS.filter((c) => c.id !== 'default' && live.some((e) => e.meta.color === c.id));
  const labels = vault.config.labels;
  const notebooks = notebookTree(vault.config.notebooks);
  return (
    <div class="search-cats">
      {types.length ? (
        <>
          <h3>Types</h3>
          <div class="type-grid">
            {types.map((t) => (
              <button key={t.id} onClick={() => setFilter({ type: t.id })}>
                <Icon name={t.icon} size={26} />
                {t.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {labels.length ? (
        <>
          <h3>Labels</h3>
          <div class="chip-wrap">
            {labels.map((l) => (
              <button key={l} class="chip outline" onClick={() => setFilter({ label: l })}><Icon name="tag" size={15} /><span>{l}</span></button>
            ))}
          </div>
        </>
      ) : null}
      {notebooks.length ? (
        <>
          <h3>Notebooks</h3>
          <div class="chip-wrap">
            {notebooks.map(({ nb }) => (
              <button key={nb.id} class="chip outline" onClick={() => setFilter({ notebook: nb.id })}><Icon name="notebook" size={15} /><span>{nb.name}</span></button>
            ))}
          </div>
        </>
      ) : null}
      {colors.length ? (
        <>
          <h3>Colors</h3>
          <div class="swatches" style={{ flexWrap: 'wrap', padding: '0 4px' }}>
            {colors.map((c) => (
              <button key={c.id} class={'swatch sw-' + c.id} aria-label={c.name} title={c.name} onClick={() => setFilter({ color: c.id })} />
            ))}
          </div>
        </>
      ) : null}
      {!types.length && !labels.length && !colors.length && !notebooks.length ? (
        <p class="muted" style={{ textAlign: 'center', padding: '40px 20px' }}>Type to search titles, text, checklists and labels.</p>
      ) : null}
    </div>
  );
}
