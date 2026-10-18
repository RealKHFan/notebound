// Find and replace inside the open note.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const findKey = new PluginKey('find');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findMatches(doc, term, caseSensitive = false) {
  const out = [];
  if (!term) return out;
  const re = new RegExp(escapeRe(term), caseSensitive ? 'g' : 'gi');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Text of this block with a map back to document positions.
    let text = '';
    const map = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        map.push(-1);
        text += '￼';
      }
    });
    let m;
    while ((m = re.exec(text))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      const from = map[m.index];
      const to = map[m.index + m[0].length - 1];
      if (from >= 0 && to >= 0) out.push({ from, to: to + 1 });
    }
    return false;
  });
  return out;
}

export const FindReplace = Extension.create({
  name: 'findReplace',
  addStorage() {
    return { term: '', caseSensitive: false, index: 0, matches: [] };
  },
  addCommands() {
    return {
      setFindTerm: (term, caseSensitive = false) => ({ editor, tr, dispatch }) => {
        this.storage.term = term;
        this.storage.caseSensitive = caseSensitive;
        this.storage.index = 0;
        if (dispatch) tr.setMeta(findKey, { refresh: true });
        return true;
      },
      findNext: () => ({ editor, tr, dispatch }) => gotoMatch(editor, this.storage, 1, tr, dispatch),
      findPrev: () => ({ editor, tr, dispatch }) => gotoMatch(editor, this.storage, -1, tr, dispatch),
      replaceCurrent: (replacement) => ({ tr, dispatch }) => {
        const s = this.storage;
        const m = s.matches[s.index];
        if (!m) return false;
        if (dispatch) {
          if (replacement) tr.insertText(replacement, m.from, m.to);
          else tr.delete(m.from, m.to);
          tr.setMeta(findKey, { refresh: true });
        }
        return true;
      },
      replaceAll: (replacement) => ({ state, tr, dispatch }) => {
        const s = this.storage;
        const matches = findMatches(state.doc, s.term, s.caseSensitive);
        if (!matches.length) return false;
        if (dispatch) {
          for (const m of [...matches].reverse()) {
            if (replacement) tr.insertText(replacement, m.from, m.to);
            else tr.delete(m.from, m.to);
          }
          tr.setMeta(findKey, { refresh: true });
        }
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key: findKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old, _oldState, newState) {
            if (!tr.docChanged && !tr.getMeta(findKey)) return old.map(tr.mapping, tr.doc);
            const matches = findMatches(newState.doc, storage.term, storage.caseSensitive);
            storage.matches = matches;
            if (storage.index >= matches.length) storage.index = Math.max(0, matches.length - 1);
            return DecorationSet.create(newState.doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === storage.index ? 'find-hit current' : 'find-hit' })));
          },
        },
        props: {
          decorations(state) {
            return findKey.getState(state);
          },
        },
      }),
    ];
  },
});

function gotoMatch(editor, s, dir, tr, dispatch) {
  const n = s.matches.length;
  if (!n) return false;
  if (!dispatch) return true;
  s.index = ((s.index + dir) % n + n) % n;
  const m = s.matches[s.index];
  tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).setMeta(findKey, { refresh: true }).scrollIntoView();
  requestAnimationFrame(() => {
    try {
      const dom = editor.view.domAtPos(m.from)?.node;
      (dom?.nodeType === 3 ? dom.parentElement : dom)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    } catch { /* position changed */ }
  });
  return true;
}
