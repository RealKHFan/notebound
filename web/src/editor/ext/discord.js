// Discord-style typing shortcuts:
//   **bold**  *italic*  _italic_  __underline__  ~~strike~~  ||spoiler||  `code`
//   # heading  > quote  - list  -# small text  [text](https://link)  :emoji:
// Bold normally also accepts __x__ in Markdown editors; here __x__ means
// underline like in Discord, so Bold only keeps the ** rules.
import { Mark, Extension, InputRule, markInputRule, markPasteRule, mergeAttributes, getMarkRange } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Bold, { starInputRegex as boldStarInput, starPasteRegex as boldStarPaste } from '@tiptap/extension-bold';
import Underline from '@tiptap/extension-underline';

export const underlineInputRegex = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))$/;
export const underlinePasteRegex = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))/g;
export const spoilerInputRegex = /(?:^|\s)(\|\|(?!\s+\|\|)((?:[^|]+))\|\|(?!\s+\|\|))$/;
export const spoilerPasteRegex = /(?:^|\s)(\|\|(?!\s+\|\|)((?:[^|]+))\|\|(?!\s+\|\|))/g;

export const DiscordBold = Bold.extend({
  addInputRules() {
    return [markInputRule({ find: boldStarInput, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: boldStarPaste, type: this.type })];
  },
});

export const DiscordUnderline = Underline.extend({
  addInputRules() {
    return [markInputRule({ find: underlineInputRegex, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: underlinePasteRegex, type: this.type })];
  },
});

const spoilerKey = new PluginKey('spoilerReveal');

/** All spoiler ranges in the document. */
function spoilerRanges(doc, type) {
  const out = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !type.isInSet(node.marks)) return;
    const last = out[out.length - 1];
    if (last && last.to === pos) last.to = pos + node.nodeSize;
    else out.push({ from: pos, to: pos + node.nodeSize });
  });
  return out;
}

// Discord-style spoilers: the text stays covered until you tap it. While
// writing, a spoiler opens as long as the cursor is inside it.
export const Spoiler = Mark.create({
  name: 'spoiler',
  inclusive: false,
  addProseMirrorPlugins() {
    const type = this.type;
    const editor = this.editor;
    const toggleOnTap = (view, pos, event) => {
      if (view.editable) return false;
      if (!event.target?.closest?.('.spoiler')) return false;
      const range = getMarkRange(view.state.doc.resolve(pos), type);
      if (!range) return false;
      view.dispatch(view.state.tr.setMeta(spoilerKey, { toggle: range.from }));
      return true;
    };
    return [
      new Plugin({
        key: spoilerKey,
        state: {
          init: () => [],
          apply(tr, revealed) {
            const meta = tr.getMeta(spoilerKey);
            let next = revealed.map((p) => tr.mapping.map(p));
            if (meta && typeof meta.toggle === 'number') {
              next = next.includes(meta.toggle) ? next.filter((p) => p !== meta.toggle) : [...next, meta.toggle];
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const revealed = spoilerKey.getState(state) || [];
            const { from, to } = state.selection;
            const decos = [];
            let writing = false;
            try { writing = editor.isEditable && !!editor.view && editor.view.hasFocus(); } catch { writing = false; }
            for (const r of spoilerRanges(state.doc, type)) {
              // open when tapped (read-only) or when the cursor or selection touches it (writing)
              const writingIn = writing && from <= r.to && to >= r.from;
              const open = revealed.includes(r.from) || writingIn;
              if (open) decos.push(Decoration.inline(r.from, r.to, { class: 'spoiler-open' }));
            }
            return decos.length ? DecorationSet.create(state.doc, decos) : null;
          },
          // Quick taps count as double clicks in ProseMirror, so every click kind toggles.
          handleClick: toggleOnTap,
          handleDoubleClick: toggleOnTap,
          handleTripleClick: toggleOnTap,
        },
      }),
    ];
  },
  parseHTML() {
    return [{ tag: 'span.spoiler' }, { tag: 'span[data-spoiler]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'spoiler', 'data-spoiler': '' }), 0];
  },
  addCommands() {
    return {
      toggleSpoiler: () => ({ commands }) => commands.toggleMark(this.name),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleSpoiler() };
  },
  addInputRules() {
    return [markInputRule({ find: spoilerInputRegex, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: spoilerPasteRegex, type: this.type })];
  },
});

/** Paragraph attribute for Discord's "-# " small grey text. */
export const SmallText = Extension.create({
  name: 'smallText',
  addGlobalAttributes() {
    return [{
      types: ['paragraph'],
      attributes: {
        small: {
          default: false,
          keepOnSplit: false,
          parseHTML: (el) => el.classList.contains('nb-small') || el.classList.contains('pb-small'), // pb-: first builds
          renderHTML: (attrs) => (attrs.small ? { class: 'nb-small' } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      toggleSmallText: () => ({ editor, commands }) => {
        const on = editor.getAttributes('paragraph').small;
        if (!editor.isActive('paragraph')) commands.setParagraph();
        return commands.updateAttributes('paragraph', { small: !on });
      },
    };
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^-#\s$/,
        handler: ({ state, range, chain }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== 'paragraph') return null;
          chain().deleteRange(range).updateAttributes('paragraph', { small: true }).run();
          return undefined;
        },
      }),
    ];
  },
});

/** Discord: a line with ``` (optionally ```lang) followed by Enter starts a code block. */
export const FenceOnEnter = Extension.create({
  name: 'fenceOnEnter',
  priority: 200,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false;
        const m = /^```([a-z0-9+#-]*)$/i.exec($from.parent.textContent);
        if (!m || !editor.schema.nodes.codeBlock) return false;
        const start = $from.before();
        return editor.chain()
          .command(({ tr }) => { tr.replaceWith(start, $from.after(), editor.schema.nodes.codeBlock.create({ language: m[1] ? m[1].toLowerCase() : null })); return true; })
          .setTextSelection(start + 1)
          .run();
      },
    };
  },
});

/** [text](https://example.com) becomes a link while typing. */
export const MaskedLinks = Extension.create({
  name: 'maskedLinks',
  addInputRules() {
    return [
      new InputRule({
        find: /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:|tel:)[^)\s]+)\)$/,
        handler: ({ state, range, match }) => {
          const linkType = state.schema.marks.link;
          if (!linkType) return null;
          const [, text, href] = match;
          const { tr } = state;
          tr.replaceWith(range.from, range.to, state.schema.text(text, [linkType.create({ href })]));
          tr.removeStoredMark(linkType);
          return undefined;
        },
      }),
    ];
  },
});
