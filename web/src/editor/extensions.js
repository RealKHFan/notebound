import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-list';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import { mergeAttributes } from '@tiptap/core';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import dart from 'highlight.js/lib/languages/dart';
import lua from 'highlight.js/lib/languages/lua';
import ini from 'highlight.js/lib/languages/ini';
import diff from 'highlight.js/lib/languages/diff';
import { DiscordBold, DiscordUnderline, Spoiler, SmallText, MaskedLinks, FenceOnEnter } from './ext/discord.js';
import { Callout, NbImage, Attachment } from './ext/blocks.js';
import { KeepTaskItem, CheckedDivider } from './ext/task.js';
import { FindReplace } from './ext/find.js';
import { LateShortcuts } from './ext/late-shortcuts.js';
import { EmojiShortcodes, SlashCommands, NoteLinks, NbLink, HashtagLabels } from './ext/suggestions.js';

export const lowlight = createLowlight({
  javascript, typescript, python, java, kotlin, c, cpp, csharp, go, rust, bash, shell, json, xml, css, sql, yaml, markdown, php, ruby, swift, dart, lua, ini, diff,
});
export const CODE_LANGUAGES = [
  ['', 'Plain text'], ['bash', 'Bash'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['css', 'CSS'], ['dart', 'Dart'], ['diff', 'Diff'], ['go', 'Go'],
  ['xml', 'HTML / XML'], ['ini', 'INI / TOML'], ['java', 'Java'], ['javascript', 'JavaScript'], ['json', 'JSON'], ['kotlin', 'Kotlin'], ['lua', 'Lua'],
  ['markdown', 'Markdown'], ['php', 'PHP'], ['python', 'Python'], ['ruby', 'Ruby'], ['rust', 'Rust'], ['shell', 'Shell session'], ['sql', 'SQL'],
  ['swift', 'Swift'], ['typescript', 'TypeScript'], ['yaml', 'YAML'],
];

const katexOptions = { throwOnError: false, strict: false };

// Math keeps its LaTeX as visible text in the saved file so it stays readable outside the app.
const NbInlineMath = InlineMath.extend({
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' }), `$${node.attrs.latex}$`];
  },
});
const NbBlockMath = BlockMath.extend({
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' }), `$$${node.attrs.latex}$$`];
  },
});

export function buildExtensions(o) {
  return [
    StarterKit.configure({
      bold: false,
      underline: false,
      link: false,
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      undoRedo: { depth: 300, newGroupDelay: 600 },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    DiscordBold,
    DiscordUnderline,
    Spoiler,
    SmallText,
    MaskedLinks,
    FenceOnEnter,
    LateShortcuts.configure({ enabled: o.shortcutsEnabled || (() => true), emojiEnabled: o.emojiEnabled || (() => true) }),
    NbLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      enableClickSelection: false,
      defaultProtocol: 'https',
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
    }),
    TaskList,
    KeepTaskItem.configure({ checkedToBottom: o.checkedToBottom }),
    CheckedDivider.configure({ enabled: o.checkedToBottom }),
    Table.configure({ resizable: false, HTMLAttributes: { class: 'nb-table' } }),
    TableRow,
    TableHeader,
    TableCell,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    Subscript,
    Superscript,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null, HTMLAttributes: { class: 'nb-code' } }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'nb-details' } }),
    DetailsSummary,
    DetailsContent,
    NbInlineMath.configure({ katexOptions, onClick: (node, pos) => o.onMathEdit?.(node, pos, 'inline') }),
    NbBlockMath.configure({ katexOptions, onClick: (node, pos) => o.onMathEdit?.(node, pos, 'block') }),
    Callout,
    NbImage.configure({ onOpen: o.onImageOpen }),
    Attachment.configure({ onOpen: o.onAttachmentOpen }),
    FindReplace,
    EmojiShortcodes.configure({ enabled: o.emojiEnabled }),
    SlashCommands.configure({ commands: o.slashCommands }),
    NoteLinks.configure({ search: o.searchNotes }),
    HashtagLabels.configure({ labels: o.labels || (() => []), onPick: o.onLabel || null }),
    CharacterCount,
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ editor, node, pos }) => {
        if (node.type.name === 'detailsSummary') return 'Summary';
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return '';
        try {
          const $p = editor.state.doc.resolve(pos + 1);
          const parent = $p.node($p.depth - 1);
          if (parent.type.name === 'taskItem') return 'List item';
          if ($p.depth > 1) return '';
        } catch { /* ignore */ }
        return editor.state.doc.childCount === 1 ? o.placeholder || 'Note' : '';
      },
    }),
  ];
}
