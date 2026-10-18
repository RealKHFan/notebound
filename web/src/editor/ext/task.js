// Checklists that behave like Google Keep: checked items drop to the bottom
// under a "N checked items" divider that can be collapsed, and items can be
// dragged by their handle.
import { Extension } from '@tiptap/core';
import { TaskItem } from '@tiptap/extension-list';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { iconSvg } from '../../ui/icons.jsx';

/** Reorder children of the list containing `pos` so `pos`'s item lands at `targetIndex`. */
export function moveListChild(tr, itemPos, targetIndex) {
  const $pos = tr.doc.resolve(itemPos);
  const list = $pos.parent;
  const index = $pos.index();
  const node = list.child(index);
  const others = [];
  list.forEach((child, _off, i) => { if (i !== index) others.push(child); });
  const t = Math.max(0, Math.min(others.length, targetIndex));
  if (t === index) return false;
  others.splice(t, 0, node);
  tr.replaceWith($pos.start(), $pos.end(), Fragment.from(others));
  return true;
}

/** Keep-style: a newly checked item goes to the top of the checked group, an unchecked one to the end of the open items. */
export function settleCheckedItem(tr, itemPos) {
  const $pos = tr.doc.resolve(itemPos);
  const list = $pos.parent;
  if (list.type.name !== 'taskList') return false;
  const index = $pos.index();
  const others = [];
  list.forEach((child, _off, i) => { if (i !== index) others.push(child); });
  let firstChecked = others.findIndex((c) => c.attrs.checked);
  if (firstChecked === -1) firstChecked = others.length;
  return moveListChild(tr, itemPos, firstChecked);
}

export const KeepTaskItem = TaskItem.extend({
  addOptions() {
    return { ...this.parent?.(), nested: true, checkedToBottom: () => true };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const li = document.createElement('li');
      li.dataset.type = 'taskItem';
      const handle = document.createElement('span');
      handle.className = 'task-handle';
      handle.contentEditable = 'false';
      handle.setAttribute('aria-hidden', 'true');
      handle.innerHTML = iconSvg('grip', 18);
      const label = document.createElement('label');
      label.contentEditable = 'false';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.setAttribute('aria-label', 'Done');
      label.appendChild(box);
      const content = document.createElement('div');
      li.append(handle, label, content);
      let current = node;
      const apply = (n) => {
        li.dataset.checked = String(!!n.attrs.checked);
        box.checked = !!n.attrs.checked;
      };
      apply(node);

      box.addEventListener('mousedown', (e) => e.preventDefault());
      box.addEventListener('change', () => {
        if (!editor.isEditable || typeof getPos !== 'function') {
          box.checked = !!current.attrs.checked;
          return;
        }
        const pos = getPos();
        const { tr } = editor.state;
        const cur = tr.doc.nodeAt(pos);
        if (!cur) return;
        tr.setNodeMarkup(pos, undefined, { ...cur.attrs, checked: box.checked });
        if (this.options.checkedToBottom()) settleCheckedItem(tr, pos);
        editor.view.dispatch(tr);
      });

      // Drag to reorder within the same list.
      handle.addEventListener('pointerdown', (e) => {
        if (!editor.isEditable || typeof getPos !== 'function') return;
        e.preventDefault();
        const list = li.parentElement;
        let target = null;
        let after = false;
        handle.setPointerCapture(e.pointerId);
        li.classList.add('task-dragging');
        const clear = () => list.querySelectorAll(':scope > li.drop-before, :scope > li.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
        const move = (ev) => {
          const el = document.elementFromPoint(ev.clientX, ev.clientY);
          const hit = el?.closest?.('li[data-type="taskItem"]');
          clear();
          target = null;
          if (!hit || hit === li) {
            // allow dropping at the very end/start when outside items
            return;
          }
          let candidate = hit;
          while (candidate && candidate.parentElement !== list) candidate = candidate.parentElement?.closest?.('li[data-type="taskItem"]');
          if (!candidate || candidate === li) return;
          const r = candidate.getBoundingClientRect();
          after = ev.clientY > r.top + r.height / 2;
          target = candidate;
          candidate.classList.add(after ? 'drop-after' : 'drop-before');
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          li.classList.remove('task-dragging');
          clear();
          if (!target) return;
          const items = [...list.children].filter((x) => x.matches('li[data-type="taskItem"]'));
          const from = items.indexOf(li);
          let to = items.indexOf(target) + (after ? 1 : 0);
          if (from < to) to -= 1;
          const { tr } = editor.state;
          if (moveListChild(tr, getPos(), to)) editor.view.dispatch(tr);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });

      return {
        dom: li,
        contentDOM: content,
        update(updated) {
          if (updated.type.name !== 'taskItem') return false;
          current = updated;
          apply(updated);
          return true;
        },
        ignoreMutation: (m) => m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'style'),
      };
    };
  },
});

const dividerKey = new PluginKey('checkedDivider');

/** Shows "N checked items" above the checked group and lets the user fold it. */
export const CheckedDivider = Extension.create({
  name: 'checkedDivider',
  addOptions() {
    return { enabled: () => true };
  },
  addProseMirrorPlugins() {
    const enabled = this.options.enabled;
    return [
      new Plugin({
        key: dividerKey,
        state: {
          init: () => ({ collapsed: false }),
          apply(tr, value) {
            const meta = tr.getMeta(dividerKey);
            return meta ? { ...value, ...meta } : value;
          },
        },
        props: {
          decorations(state) {
            if (!enabled()) return null;
            const { collapsed } = dividerKey.getState(state);
            const decos = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'taskList') return true;
              let firstCheckedPos = null;
              let checked = 0;
              let open = 0;
              node.forEach((child, offset) => {
                if (child.attrs.checked) {
                  checked++;
                  if (firstCheckedPos === null) firstCheckedPos = pos + 1 + offset;
                  if (collapsed) decos.push(Decoration.node(pos + 1 + offset, pos + 1 + offset + child.nodeSize, { class: 'checked-hidden' }));
                } else open++;
              });
              if (checked && firstCheckedPos !== null && (open || collapsed)) {
                decos.push(Decoration.widget(firstCheckedPos, (view) => {
                  const li = document.createElement('li');
                  li.className = 'checked-divider' + (collapsed ? ' collapsed' : '');
                  li.contentEditable = 'false';
                  const b = document.createElement('button');
                  b.type = 'button';
                  b.innerHTML = `${iconSvg(collapsed ? 'chevron-right' : 'chevron-down', 18)}<span>${checked} checked item${checked === 1 ? '' : 's'}</span>`;
                  b.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                  b.addEventListener('mousedown', (e) => e.preventDefault());
                  b.addEventListener('click', (e) => {
                    e.preventDefault();
                    const cur = dividerKey.getState(view.state);
                    view.dispatch(view.state.tr.setMeta(dividerKey, { collapsed: !cur.collapsed }));
                  });
                  li.appendChild(b);
                  return li;
                }, { side: -1, key: `div-${checked}-${collapsed}`, ignoreSelection: true }));
              }
              return true;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

/** Turn a text note into a checklist and back (Keep's "Show checkboxes"). */
export function toggleChecklist(editor) {
  const { state } = editor;
  const hasTasks = (() => {
    let found = false;
    state.doc.descendants((n) => { if (n.type.name === 'taskList') found = true; return !found; });
    return found;
  })();
  const schema = state.schema;
  const tr = state.tr;
  if (hasTasks) {
    // Hide checkboxes: every task item becomes a plain paragraph (checked ones keep their text).
    const blocks = [];
    state.doc.forEach((node) => {
      if (node.type.name === 'taskList') {
        node.descendants((child) => {
          if (child.type.name === 'paragraph') { blocks.push(child); return false; }
          return true;
        });
      } else blocks.push(node);
    });
    tr.replaceWith(0, state.doc.content.size, Fragment.from(blocks.length ? blocks : [schema.nodes.paragraph.create()]));
  } else {
    // Show checkboxes: each top-level paragraph becomes an item; other blocks stay.
    const out = [];
    let run = [];
    const flush = () => {
      if (run.length) out.push(schema.nodes.taskList.create(null, run));
      run = [];
    };
    state.doc.forEach((node) => {
      if (node.type.name === 'paragraph') {
        if (!node.content.size) return; // empty lines do not become empty items
        run.push(schema.nodes.taskItem.create({ checked: false }, schema.nodes.paragraph.create(null, node.content)));
      } else if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
        node.forEach((li) => {
          const first = li.firstChild?.type.name === 'paragraph' ? li.firstChild : schema.nodes.paragraph.create();
          run.push(schema.nodes.taskItem.create({ checked: false }, schema.nodes.paragraph.create(null, first.content)));
        });
      } else {
        flush();
        out.push(node);
      }
    });
    flush();
    tr.replaceWith(0, state.doc.content.size, Fragment.from(out.length ? out : [schema.nodes.taskList.create(null, [schema.nodes.taskItem.create({ checked: false }, schema.nodes.paragraph.create())])]));
  }
  editor.view.dispatch(tr);
  return !hasTasks;
}

export function uncheckAll(editor) {
  const { tr } = editor.state;
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'taskItem' && n.attrs.checked) tr.setNodeMarkup(pos, undefined, { ...n.attrs, checked: false });
  });
  editor.view.dispatch(tr);
}

export function deleteCheckedItems(editor) {
  const { tr } = editor.state;
  const ranges = [];
  let count = 0;
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'taskItem' && n.attrs.checked) return false; // removed as a whole
    if (n.type.name !== 'taskList') return true;
    const children = [];
    n.forEach((child, offset) => children.push({ child, pos: pos + 1 + offset }));
    const checked = children.filter((c) => c.child.attrs.checked);
    count += checked.length;
    if (checked.length && checked.length === children.length) {
      ranges.push([pos, pos + n.nodeSize]); // the whole list would be empty: remove it
      return false;
    }
    for (const c of checked) ranges.push([c.pos, c.pos + c.child.nodeSize]);
    return true; // nested lists inside unchecked items
  });
  ranges.sort((a, b) => b[0] - a[0]);
  for (const [from, to] of ranges) tr.delete(from, to);
  if (tr.doc.childCount === 0) tr.insert(0, editor.state.schema.nodes.paragraph.create());
  editor.view.dispatch(tr);
  return count;
}
