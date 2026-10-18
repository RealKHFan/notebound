import { useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { Logo } from './Logo.jsx';
import { ui, vault, setView, pushPage, ask } from './app-state.js';
import { notebookTree } from './sheets.jsx';

function Item({ icon, label, active, onClick, count }) {
  return (
    <button class={'drawer-item' + (active ? ' active' : '')} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} />
      <span class="label">{label}</span>
      {count ? <span class="count">{count}</span> : null}
    </button>
  );
}

export function Drawer() {
  const { view } = ui.get();
  const [nbOpen, setNbOpen] = useState(true);
  const go = (v) => setView(v);
  const is = (name, id) => view.name === name && (id === undefined || view.id === id);
  const labels = vault.config.labels;
  const tree = notebookTree(vault.config.notebooks);
  const entries = vault.all();
  const countReminders = entries.filter((e) => !e.meta.trashed && e.meta.reminder).length;
  const countTrash = entries.filter((e) => e.meta.trashed).length;
  const close = () => ui.set({ drawer: false });
  const openPage = (type) => { close(); pushPage({ type }); };
  return (
    <>
      <div class="scrim" onClick={close} />
      <nav class="drawer" aria-label="Main menu">
        <div class="drawer-head">
          <Logo size={34} />
          <span class="wordmark">Notebound</span>
        </div>
        <div class="drawer-scroll">
          <Item icon="notebook-pen" label="Notes" active={is('notes')} onClick={() => go({ name: 'notes' })} />
          <Item icon="bell" label="Reminders" active={is('reminders')} onClick={() => go({ name: 'reminders' })} count={countReminders || null} />
          <Item icon="star" label="Favorites" active={is('favorites')} onClick={() => go({ name: 'favorites' })} />
          <div class="drawer-sep" />
          <div class="drawer-section">
            <button style={{ color: 'inherit', display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }} onClick={() => setNbOpen(!nbOpen)} aria-expanded={nbOpen}>
              Notebooks <Icon name={nbOpen ? 'chevron-up' : 'chevron-down'} size={16} />
            </button>
            <button onClick={async () => {
              const name = await ask({ title: 'New notebook', input: '', placeholder: 'Name', confirm: 'Create' });
              if (name && name.trim()) {
                const nb = vault.addNotebook(name.trim());
                go({ name: 'notebook', id: nb.id });
              }
            }}
            >New</button>
          </div>
          {nbOpen ? tree.map(({ nb, depth }) => (
            <div key={nb.id} style={{ paddingLeft: `${depth * 18}px` }}>
              <Item icon={depth ? 'corner-down-right' : 'notebook'} label={nb.name} active={is('notebook', nb.id)} onClick={() => go({ name: 'notebook', id: nb.id })} />
            </div>
          )) : null}
          {nbOpen && !tree.length ? <p class="muted" style={{ padding: '2px 16px 6px', margin: 0, fontSize: '13.5px' }}>Group notes into notebooks and sub-notebooks.</p> : null}
          <div class="drawer-sep" />
          <div class="drawer-section">
            <span>Labels</span>
            <button onClick={() => openPage('labels')}>Edit</button>
          </div>
          {labels.map((l) => (
            <Item key={l} icon="tag" label={l} active={is('label', l)} onClick={() => go({ name: 'label', id: l })} />
          ))}
          {!labels.length ? <Item icon="plus" label="Create new label" onClick={() => openPage('labels')} /> : null}
          <div class="drawer-sep" />
          <Item icon="archive" label="Archive" active={is('archive')} onClick={() => go({ name: 'archive' })} />
          <Item icon="trash" label="Trash" active={is('trash')} onClick={() => go({ name: 'trash' })} count={countTrash || null} />
          <div class="drawer-sep" />
          <Item icon="settings" label="Settings" onClick={() => openPage('settings')} />
        </div>
      </nav>
    </>
  );
}
