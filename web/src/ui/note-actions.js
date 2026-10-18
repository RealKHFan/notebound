// Actions on one or more notes, shared by the home screen selection bar and the editor.
import { vault, snack, ui, ask, openSheet, runAction } from './app-state.js';
import { plural } from './format.js';
import { exportNotes } from '../io/exporters.js';

function snapshotMeta(ids) {
  return ids.map((id) => [id, { ...vault.get(id)?.meta }]);
}
function restoreMeta(prev, keys) {
  return Promise.all(prev.map(([id, m]) => vault.updateMeta(id, Object.fromEntries(keys.map((k) => [k, m[k]])))));
}

export function pinNotes(ids, pinned) {
  return runAction('Pin', () => vault.updateMeta(ids, pinned ? { pinned: true, archived: false } : { pinned: false }));
}

export function archiveNotes(ids, archived = true) {
  const prev = snapshotMeta(ids);
  return runAction('Archive', async () => {
    await vault.archive(ids, archived);
    snack(archived ? (ids.length > 1 ? `${plural(ids.length, 'note', 'notes')} archived` : 'Note archived') : (ids.length > 1 ? `${plural(ids.length, 'note', 'notes')} unarchived` : 'Note unarchived'), {
      action: 'Undo',
      onAction: () => restoreMeta(prev, ['archived', 'pinned']),
    });
  });
}

export function trashNotes(ids) {
  const prev = snapshotMeta(ids);
  return runAction('Delete', async () => {
    await vault.trash(ids);
    snack(ids.length > 1 ? `${plural(ids.length, 'note', 'notes')} moved to trash` : 'Note moved to trash', {
      action: 'Undo',
      onAction: () => restoreMeta(prev, ['trashed', 'pinned']),
    });
  });
}

export function restoreNotes(ids) {
  return runAction('Restore', async () => {
    await vault.restore(ids);
    snack(ids.length > 1 ? `${plural(ids.length, 'note', 'notes')} restored` : 'Note restored');
  });
}

export async function deleteForever(ids) {
  const ok = await ask({
    title: ids.length > 1 ? `Delete ${ids.length} notes forever?` : 'Delete this note forever?',
    message: 'The files are removed from your folder. This cannot be undone.',
    confirm: 'Delete forever',
    danger: true,
  });
  if (!ok) return false;
  await runAction('Delete', async () => {
    await vault.deleteForever(ids);
    snack(ids.length > 1 ? `${plural(ids.length, 'note', 'notes')} deleted` : 'Note deleted');
  });
  return true;
}

export async function emptyTrash() {
  const n = vault.all().filter((e) => e.meta.trashed).length;
  if (!n) return;
  const ok = await ask({
    title: 'Empty trash?',
    message: `${plural(n, 'note', 'notes')} will be deleted from your folder. This cannot be undone.`,
    confirm: 'Empty trash',
    danger: true,
  });
  if (!ok) return;
  await runAction('Empty trash', async () => {
    await vault.emptyTrash();
    snack('Trash emptied');
  });
}

export function duplicateNotes(ids) {
  return runAction('Copy', async () => {
    for (const id of ids) await vault.duplicate(id);
    snack(ids.length > 1 ? `${plural(ids.length, 'copy', 'copies')} made` : 'Copy made');
  });
}

export function favoriteNotes(ids, favorite) {
  return runAction('Favorite', () => vault.updateMeta(ids, { favorite }));
}

export function exportSelection(ids) {
  openSheet('export', { ids });
}

export { exportNotes };
export const selectionIds = () => ui.get().selection;
