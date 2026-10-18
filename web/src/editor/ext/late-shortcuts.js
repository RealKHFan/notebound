// Typing shortcuts that also work with Android keyboards.
//
// Normal input rules fire on the character that completes a pattern. Android
// keyboards often "compose" a whole word (markers included) and send it
// together with the space after it, so the rule never sees the moment the
// pattern was complete. This extension looks at every space that was just
// typed and checks the word right before it, wherever the cursor is by then.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { emojiForCode } from './suggestions.js';

const key = new PluginKey('lateShortcuts');

// Inline patterns on the text before a typed space.
// Each: [mark name, regex]; group 1 = whole token incl. markers, group 2 = inner text.
export const INLINE_PATTERNS = [
  ['bold', /(?:^|\s)(\*\*(?!\s)([^*\n]*[^*\s])\*\*)$/],
  ['underline', /(?:^|\s)(__(?!\s)([^_\n]*[^_\s])__)$/],
  ['spoiler', /(?:^|\s)(\|\|(?!\s)([^|\n]*[^|\s])\|\|)$/],
  ['strike', /(?:^|\s)(~~(?!\s)([^~\n]*[^~\s])~~)$/],
  ['highlight', /(?:^|\s)(==(?!\s)([^=\n]*[^=\s])==)$/],
  ['italic', /(?:^|\s)(\*(?![\s*])([^*\n]*[^*\s])\*)$/],
  ['italic', /(?:^|\s)(_(?![\s_])([^_\n]*[^_\s])_)$/],
  ['code', /(?:^|[^`])(`([^`\n]+)`)$/],
];
const EMOJI = /(?:^|\s)(:([a-z0-9_+-]{2,40}):)$/;
const LINK = /(\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:|tel:)[^)\s]+)\))$/;
const SPACE = /[  ]/;

/** What to do with `text`, the text of a paragraph right before a typed space. */
export function findShortcut(text, marks = null) {
  for (const [mark, re] of INLINE_PATTERNS) {
    if (marks && !marks[mark]) continue;
    const m = re.exec(text);
    if (m) return { kind: 'mark', mark, token: m[1], inner: m[2], start: text.length - m[1].length };
  }
  const e = EMOJI.exec(text);
  if (e) {
    const emoji = emojiForCode(e[2]);
    if (emoji) return { kind: 'emoji', emoji, token: e[1], start: text.length - e[1].length };
  }
  const l = LINK.exec(text);
  if (l) return { kind: 'link', label: l[2], href: l[3], token: l[1], start: text.length - l[1].length };
  return null;
}

/** Line markers handled here too: "# " to "#### " headings and Discord's "-# " small text. */
export function findBlockShortcut(text) {
  if (/^#{1,4}$/.test(text)) return { kind: 'heading', level: text.length };
  if (text === '-#' || text === '–#' || text === '—#') return { kind: 'small' };
  return null;
}

/** Ranges (in the final document) that the transactions inserted. */
function insertedRanges(trs) {
  const out = [];
  trs.forEach((tr, ti) => {
    tr.steps.forEach((step, si) => {
      const slice = step.slice;
      if (!slice || !slice.size || typeof step.from !== 'number') return;
      let from = step.from;
      let to = step.from + slice.size;
      const rest = tr.mapping.slice(si + 1);
      from = rest.map(from, -1);
      to = rest.map(to, 1);
      for (let k = ti + 1; k < trs.length; k++) {
        from = trs[k].mapping.map(from, -1);
        to = trs[k].mapping.map(to, 1);
      }
      if (to > from) out.push([from, to]);
    });
  });
  return out;
}

export const LateShortcuts = Extension.create({
  name: 'lateShortcuts',
  addOptions() {
    return { enabled: () => true, emojiEnabled: () => true };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const options = this.options;
    return [
      new Plugin({
        key,
        appendTransaction(trs, _old, state) {
          if (!options.enabled() || !editor.isEditable) return null;
          if (editor.view && editor.view.composing) return null;
          const typed = trs.filter((tr) => tr.docChanged && !tr.getMeta('inputRule') && !tr.getMeta(key)
            && !tr.getMeta('history$') && tr.getMeta('uiEvent') !== 'paste' && tr.getMeta('uiEvent') !== 'drop'
            && !tr.getMeta('preventUpdate'));
          if (!typed.length || typed.length !== trs.filter((t) => t.docChanged).length) return null;

          // Every space inside the inserted text is a place to check.
          const spaces = [];
          for (const [from, to] of insertedRanges(trs)) {
            if (from < 0 || to > state.doc.content.size) continue;
            const $a = state.doc.resolve(from);
            const $b = state.doc.resolve(to);
            if (!$a.sameParent($b) || !$a.parent.isTextblock || $a.parent.type.spec.code) continue;
            const text = $a.parent.textBetween($a.parentOffset, $b.parentOffset, undefined, '￼');
            for (let i = 0; i < text.length; i++) if (SPACE.test(text[i])) spaces.push(from + i);
          }
          if (!spaces.length) return null;
          spaces.sort((x, y) => y - x); // right to left keeps earlier positions valid

          const tr = state.tr;
          let changed = false;
          for (const w of spaces) {
            const $w = tr.doc.resolve(w);
            const parent = $w.parent;
            if (!parent.isTextblock || parent.type.spec.code) continue;
            if ($w.marks().some((m) => m.type.spec.code)) continue;
            const start = w - $w.parentOffset;
            const before = parent.textBetween(0, $w.parentOffset, undefined, '￼');

            if (parent.type.name === 'paragraph' && $w.depth >= 1) {
              const b = findBlockShortcut(before);
              if (b) {
                const pos = $w.before();
                tr.delete(start, w + 1);
                if (b.kind === 'heading' && state.schema.nodes.heading) {
                  tr.setBlockType(pos + 1, pos + 1, state.schema.nodes.heading, { level: b.level });
                } else if (b.kind === 'small') {
                  const node = tr.doc.nodeAt(pos);
                  if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, small: true });
                }
                changed = true;
                continue;
              }
            }

            const hit = findShortcut(before, state.schema.marks);
            if (!hit) continue;
            if (hit.kind === 'emoji' && !options.emojiEnabled()) continue;
            const from = start + hit.start;
            const to = start + before.length;
            if (hit.kind === 'mark') {
              const type = state.schema.marks[hit.mark];
              const open = hit.token.indexOf(hit.inner);
              const close = hit.token.length - open - hit.inner.length;
              tr.delete(to - close, to);
              tr.delete(from, from + open);
              tr.addMark(from, from + hit.inner.length, type.create());
              tr.removeStoredMark(type);
            } else if (hit.kind === 'emoji') {
              tr.insertText(hit.emoji, from, to);
            } else if (hit.kind === 'link' && state.schema.marks.link) {
              tr.replaceWith(from, to, state.schema.text(hit.label, [state.schema.marks.link.create({ href: hit.href })]));
            } else continue;
            changed = true;
          }
          if (!changed) return null;
          tr.setMeta(key, true);
          tr.setMeta('inputRule', true);
          return tr;
        },
      }),
    ];
  },
});
