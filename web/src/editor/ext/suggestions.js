// "/" commands, ":" emoji (Discord style) and "[[" links to other notes.
import { Extension, InputRule } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import Link from '@tiptap/extension-link';
import EMOJI from 'virtual:emoji-data';
import { createSuggestionRenderer, escapeHtml } from '../suggestion-menu.js';
import { iconSvg } from '../../ui/icons.jsx';

// ---------- emoji ----------
// EMOJI rows: [emoji, shortcodes[], tags[]]
const byCode = new Map();
for (const row of EMOJI) for (const code of row[1]) if (!byCode.has(code)) byCode.set(code, row[0]);

export function searchEmoji(query, limit = 8) {
  const q = String(query || '').toLowerCase();
  if (q.length < 2) return [];
  const exact = [];
  const starts = [];
  const contains = [];
  const tagged = [];
  for (const [emoji, codes, tags] of EMOJI) {
    let rank = -1;
    let code = codes[0];
    for (const c of codes) {
      if (c === q) { rank = 0; code = c; break; }
      if (c.startsWith(q) && (rank === -1 || rank > 1)) { rank = 1; code = c; } else if (c.includes(q) && rank === -1) { rank = 2; code = c; }
    }
    if (rank === -1 && tags.some((t) => t.startsWith(q))) rank = 3;
    if (rank === -1) continue;
    [exact, starts, contains, tagged][rank].push({ emoji, code });
    if (exact.length + starts.length >= limit * 2) break;
  }
  return [...exact, ...starts, ...contains, ...tagged].slice(0, limit);
}
export function emojiForCode(code) {
  return byCode.get(String(code).toLowerCase()) || null;
}

export const EmojiShortcodes = Extension.create({
  name: 'emojiShortcodes',
  addOptions() {
    return { enabled: () => true };
  },
  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|\s)(:([a-z0-9_+-]{2,40}):)$/,
        handler: ({ state, range, match }) => {
          if (!this.options.enabled()) return null;
          const emoji = emojiForCode(match[2]);
          if (!emoji) return null;
          const start = range.from + match[0].indexOf(match[1]);
          state.tr.insertText(emoji, start, range.to);
          return undefined;
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    const enabled = this.options.enabled;
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('emojiSuggest'),
        char: ':',
        allow: () => enabled(),
        items: ({ query }) => searchEmoji(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, props.emoji + ' ').run();
        },
        render: createSuggestionRenderer({
          className: 'emoji-menu',
          emptyText: null,
          renderItem: (it) => `<span class="emo">${it.emoji}</span><span class="label">:${escapeHtml(it.code)}:</span>`,
        }),
      }),
    ];
  },
});

// ---------- slash commands ----------
export const SlashCommands = Extension.create({
  name: 'slashCommands',
  addOptions() {
    return { commands: () => [] };
  },
  addProseMirrorPlugins() {
    const list = this.options.commands;
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('slashSuggest'),
        char: '/',
        allowSpaces: false,
        items: ({ query }) => {
          const q = query.toLowerCase();
          return list().filter((c) => !q || c.title.toLowerCase().includes(q) || (c.keywords || '').includes(q)).slice(0, 30);
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: createSuggestionRenderer({
          className: 'slash-menu',
          emptyText: 'No matching command',
          renderItem: (c) => `<span class="ic">${iconSvg(c.icon, 20)}</span><span class="label">${escapeHtml(c.title)}</span>`,
        }),
      }),
    ];
  },
});

// ---------- links between notes ----------
export const NbLink = Link.extend({
  inclusive: false,
  addAttributes() {
    return {
      ...this.parent?.(),
      noteId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-note-id'),
        renderHTML: (attrs) => (attrs.noteId ? { 'data-note-id': attrs.noteId } : {}),
      },
    };
  },
});

export const NoteLinks = Extension.create({
  name: 'noteLinks',
  addOptions() {
    return { search: () => [] };
  },
  addProseMirrorPlugins() {
    const search = this.options.search;
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('noteLinkSuggest'),
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        items: ({ query }) => search(query).slice(0, 8),
        command: ({ editor, range, props }) => {
          const title = props.title || 'Untitled';
          editor.chain().focus().insertContentAt(range, [
            { type: 'text', text: title, marks: [{ type: 'link', attrs: { href: props.href, noteId: props.id } }] },
            { type: 'text', text: ' ' },
          ]).run();
        },
        render: createSuggestionRenderer({
          className: 'note-link-menu',
          emptyText: 'No notes found',
          renderItem: (n) => `<span class="ic">${iconSvg('file', 18)}</span><span class="label">${escapeHtml(n.title || 'Untitled')}</span>`,
        }),
      }),
    ];
  },
});

// ---------- #labels while typing (Keep style) ----------
// "#travel" + Enter (or a tap on the suggestion) removes the word and puts the note
// under the label "travel". "# " at the start of a line is still a heading.
const LABEL_RE = /^[\p{L}\p{N}_\-./&+]{1,40}$/u;

export function labelSuggestions(query, labels, limit = 6) {
  const q = String(query || '').trim();
  if (!q || !LABEL_RE.test(q)) return [];
  const lq = q.toLowerCase();
  const starts = labels.filter((l) => l.toLowerCase().startsWith(lq));
  const contains = labels.filter((l) => !l.toLowerCase().startsWith(lq) && l.toLowerCase().includes(lq));
  const out = [...starts, ...contains].slice(0, limit).map((name) => ({ name, create: false }));
  if (!labels.some((l) => l.toLowerCase() === lq)) out.push({ name: q, create: true });
  return out;
}

export const HashtagLabels = Extension.create({
  name: 'hashtagLabels',
  addOptions() {
    return { labels: () => [], onPick: null };
  },
  addProseMirrorPlugins() {
    const { labels, onPick } = this.options;
    if (!onPick) return [];
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('hashtagSuggest'),
        char: '#',
        allowSpaces: false,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name !== 'codeBlock' && !$from.marks().some((m) => m.type.name === 'code');
        },
        items: ({ query }) => labelSuggestions(query, labels()),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          onPick(props.name);
        },
        render: createSuggestionRenderer({
          className: 'label-menu',
          emptyText: null,
          renderItem: (it) => `<span class="ic">${iconSvg('tag', 18)}</span><span class="label">${it.create ? `Create label "${escapeHtml(it.name)}"` : escapeHtml(it.name)}</span>`,
        }),
      }),
    ];
  },
});
