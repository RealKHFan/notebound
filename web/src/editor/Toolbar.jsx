// Formatting toolbar shown above the keyboard while writing (Notesnook style).
import { useState } from 'preact/hooks';
import { closeHistory } from '@tiptap/pm/history';
import { Icon } from '../ui/icons.jsx';
import { editLink } from './insert.js';
import { CODE_LANGUAGES } from './extensions.js';

export const TEXT_COLORS = [
  ['', 'Default'], ['#6b7280', 'Gray'], ['#d93a3a', 'Red'], ['#d9731a', 'Orange'], ['#b8860b', 'Gold'], ['#2f9e5b', 'Green'],
  ['#0f8f86', 'Teal'], ['#2e6bd6', 'Blue'], ['#7a4fd0', 'Purple'], ['#d0458f', 'Pink'],
];
export const HIGHLIGHTS = [
  ['', 'None'], ['rgba(255, 214, 10, 0.42)', 'Yellow'], ['rgba(52, 199, 89, 0.32)', 'Green'], ['rgba(10, 132, 255, 0.28)', 'Blue'],
  ['rgba(255, 55, 95, 0.26)', 'Pink'], ['rgba(175, 82, 222, 0.28)', 'Purple'], ['rgba(255, 149, 0, 0.34)', 'Orange'], ['rgba(142, 142, 147, 0.3)', 'Gray'],
];

function B({ icon, label, active, onClick, disabled }) {
  return (
    <button
      class={'tb-btn' + (active ? ' on' : '')}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active ? 'true' : 'false'}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} size={21} />
    </button>
  );
}

export function Toolbar({ editor, onInsert, onHideKeyboard }) {
  const [panel, setPanel] = useState(null);
  if (!editor) return null;
  // Every toolbar action is its own undo step, even right after typing.
  const c = () => editor.chain().focus().command(({ tr }) => { closeHistory(tr); return true; });
  const toggle = (p) => setPanel(panel === p ? null : p);
  const inTable = editor.isActive('table');
  const inCode = editor.isActive('codeBlock');
  const inList = editor.isActive('taskItem') || editor.isActive('listItem');
  const listType = editor.isActive('taskItem') ? 'taskItem' : 'listItem';

  return (
    <div class="toolbar-wrap" onMouseDown={(e) => { if (e.target.tagName !== 'SELECT') e.preventDefault(); }}>
      {panel === 'text' ? (
        <div class="tb-panel" role="toolbar" aria-label="Text styles">
          <div class="tb-row">
            <button class={'tb-chip' + (editor.isActive('paragraph') && !editor.getAttributes('paragraph').small ? ' on' : '')} onClick={() => c().setParagraph().updateAttributes('paragraph', { small: false }).run()}>Text</button>
            <button class={'tb-chip h1' + (editor.isActive('heading', { level: 1 }) ? ' on' : '')} onClick={() => c().toggleHeading({ level: 1 }).run()}>Heading 1</button>
            <button class={'tb-chip h2' + (editor.isActive('heading', { level: 2 }) ? ' on' : '')} onClick={() => c().toggleHeading({ level: 2 }).run()}>Heading 2</button>
            <button class={'tb-chip h3' + (editor.isActive('heading', { level: 3 }) ? ' on' : '')} onClick={() => c().toggleHeading({ level: 3 }).run()}>Heading 3</button>
            <button class={'tb-chip small' + (editor.getAttributes('paragraph').small ? ' on' : '')} onClick={() => c().toggleSmallText().run()}>Small</button>
          </div>
          <div class="tb-row">
            <B icon="quote" label="Quote" active={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()} />
            <B icon="code" label="Inline code" active={editor.isActive('code')} onClick={() => c().toggleCode().run()} />
            <B icon="code-block" label="Code block" active={inCode} onClick={() => c().toggleCodeBlock().run()} />
            <B icon="eye-off" label="Spoiler" active={editor.isActive('spoiler')} onClick={() => c().toggleSpoiler().run()} />
            <B icon="subscript" label="Subscript" active={editor.isActive('subscript')} onClick={() => c().toggleSubscript().run()} />
            <B icon="superscript" label="Superscript" active={editor.isActive('superscript')} onClick={() => c().toggleSuperscript().run()} />
            <B icon="align-left" label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => c().setTextAlign('left').run()} />
            <B icon="align-center" label="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => c().setTextAlign('center').run()} />
            <B icon="align-right" label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => c().setTextAlign('right').run()} />
            <B icon="align-justify" label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => c().setTextAlign('justify').run()} />
            <B icon="ban" label="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().run()} />
          </div>
        </div>
      ) : null}
      {panel === 'color' ? (
        <div class="tb-panel" role="toolbar" aria-label="Colors">
          <div class="tb-label">Text color</div>
          <div class="tb-row colors">
            {TEXT_COLORS.map(([v, name]) => (
              <button key={name} class={'tb-color' + (!v ? ' none' : '')} style={v ? { color: v } : null} aria-label={`Text ${name}`} title={name}
                onClick={() => (v ? c().setColor(v).run() : c().unsetColor().run())}
              >A</button>
            ))}
          </div>
          <div class="tb-label">Highlight</div>
          <div class="tb-row colors">
            {HIGHLIGHTS.map(([v, name]) => (
              <button key={name} class={'tb-color hl' + (!v ? ' none' : '')} style={v ? { background: v } : null} aria-label={`Highlight ${name}`} title={name}
                onClick={() => (v ? c().setHighlight({ color: v }).run() : c().unsetHighlight().run())}
              >{v ? '' : <Icon name="ban" size={16} />}</button>
            ))}
          </div>
        </div>
      ) : null}
      {inTable ? (
        <div class="tb-row tb-context" role="toolbar" aria-label="Table">
          <B icon="rows-2" label="Add row below" onClick={() => c().addRowAfter().run()} />
          <B icon="columns" label="Add column right" onClick={() => c().addColumnAfter().run()} />
          <button class="tb-chip" onClick={() => c().deleteRow().run()}>Delete row</button>
          <button class="tb-chip" onClick={() => c().deleteColumn().run()}>Delete column</button>
          <button class="tb-chip" onClick={() => c().toggleHeaderRow().run()}>Header row</button>
          <B icon="merge" label="Merge cells" onClick={() => c().mergeCells().run()} disabled={!editor.can().mergeCells()} />
          <B icon="split" label="Split cell" onClick={() => c().splitCell().run()} disabled={!editor.can().splitCell()} />
          <button class="tb-chip danger" onClick={() => c().deleteTable().run()}>Delete table</button>
        </div>
      ) : null}
      {inCode ? (
        <div class="tb-row tb-context" role="toolbar" aria-label="Code block">
          <span class="tb-label inline">Language</span>
          <select
            class="tb-select"
            value={editor.getAttributes('codeBlock').language || ''}
            onChange={(e) => c().updateAttributes('codeBlock', { language: e.currentTarget.value || null }).run()}
            aria-label="Code language"
          >
            {CODE_LANGUAGES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        </div>
      ) : null}
      <div class="toolbar" role="toolbar" aria-label="Formatting">
        <B icon="plus" label="Insert" onClick={onInsert} />
        <B icon="case" label="Text styles" active={panel === 'text'} onClick={() => toggle('text')} />
        <B icon="bold" label="Bold" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()} />
        <B icon="italic" label="Italic" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()} />
        <B icon="underline" label="Underline" active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()} />
        <B icon="strike" label="Strikethrough" active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()} />
        <B icon="list-checks" label="Checklist" active={editor.isActive('taskList')} onClick={() => c().toggleTaskList().run()} />
        <B icon="list-bullet" label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()} />
        <B icon="list-ordered" label="Numbered list" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()} />
        <B icon="indent" label="Indent" disabled={!inList || !editor.can().sinkListItem(listType)} onClick={() => c().sinkListItem(listType).run()} />
        <B icon="outdent" label="Outdent" disabled={!inList || !editor.can().liftListItem(listType)} onClick={() => c().liftListItem(listType).run()} />
        <B icon="link" label="Link" active={editor.isActive('link')} onClick={() => editLink(editor)} />
        <B icon="highlight" label="Colors" active={panel === 'color'} onClick={() => toggle('color')} />
        <B icon="h2" label="Heading" active={editor.isActive('heading')} onClick={() => c().toggleHeading({ level: 2 }).run()} />
        <B icon="undo" label="Undo" disabled={!editor.can().undo()} onClick={() => c().undo().run()} />
        <B icon="redo" label="Redo" disabled={!editor.can().redo()} onClick={() => c().redo().run()} />
        <B icon="keyboard-off" label="Hide keyboard" onClick={onHideKeyboard} />
      </div>
    </div>
  );
}
