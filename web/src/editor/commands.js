// The list behind the "/" menu and the + (insert) sheet.
import { insertImages, insertPhoto, insertFiles, drawInto, insertMath, insertDateTime } from './insert.js';
import { toggleChecklist } from './ext/task.js';

export function blockCommands() {
  return [
    { id: 'text', title: 'Text', icon: 'paragraph', keywords: 'paragraph plain', run: (e) => e.chain().focus().setParagraph().run() },
    { id: 'h1', title: 'Heading 1', icon: 'h1', keywords: 'title big #', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { id: 'h2', title: 'Heading 2', icon: 'h2', keywords: 'subtitle ##', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: 'h3', title: 'Heading 3', icon: 'h3', keywords: '###', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
    { id: 'checklist', title: 'Checklist', icon: 'list-checks', keywords: 'todo task checkbox list', run: (e) => e.chain().focus().toggleTaskList().run() },
    { id: 'bullets', title: 'Bulleted list', icon: 'list-bullet', keywords: 'unordered ul -', run: (e) => e.chain().focus().toggleBulletList().run() },
    { id: 'numbers', title: 'Numbered list', icon: 'list-ordered', keywords: 'ordered ol 1.', run: (e) => e.chain().focus().toggleOrderedList().run() },
    { id: 'quote', title: 'Quote', icon: 'quote', keywords: 'blockquote >', run: (e) => e.chain().focus().toggleBlockquote().run() },
    { id: 'callout', title: 'Callout', icon: 'info', keywords: 'note info box', run: (e) => e.chain().focus().setCallout('info').run() },
    { id: 'warning', title: 'Warning callout', icon: 'warning', keywords: 'caution alert', run: (e) => e.chain().focus().setCallout('warning').run() },
    { id: 'tip', title: 'Tip callout', icon: 'tip', keywords: 'idea hint', run: (e) => e.chain().focus().setCallout('tip').run() },
    { id: 'code', title: 'Code block', icon: 'code-block', keywords: 'pre ``` snippet', run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { id: 'table', title: 'Table', icon: 'table', keywords: 'grid rows columns', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'details', title: 'Collapsible section', icon: 'details', keywords: 'toggle fold details spoiler', run: (e) => e.chain().focus().setDetails().run() },
    { id: 'divider', title: 'Divider', icon: 'minus', keywords: 'hr line ---', run: (e) => e.chain().focus().setHorizontalRule().run() },
    { id: 'math', title: 'Math block', icon: 'math', keywords: 'latex formula equation', run: (e) => insertMath(e, true) },
    { id: 'inline-math', title: 'Inline math', icon: 'math', keywords: 'latex formula', run: (e) => insertMath(e, false) },
    { id: 'image', title: 'Image', icon: 'image', keywords: 'picture photo gallery', run: (e) => insertImages(e) },
    { id: 'photo', title: 'Take photo', icon: 'camera', keywords: 'camera picture', run: (e) => insertPhoto(e) },
    { id: 'drawing', title: 'Drawing', icon: 'brush', keywords: 'sketch draw pen', run: (e) => drawInto(e) },
    { id: 'file', title: 'File', icon: 'paperclip', keywords: 'attachment pdf document', run: (e) => insertFiles(e) },
    { id: 'note-link', title: 'Link to note', icon: 'file', keywords: 'wiki [[ backlink', run: (e) => e.chain().focus().insertContent('[[').run() },
    { id: 'emoji', title: 'Emoji', icon: 'smile', keywords: 'emoji :', run: (e) => e.chain().focus().insertContent(' :').run() },
    { id: 'small', title: 'Small text', icon: 'text-size', keywords: 'subtext -#', run: (e) => e.chain().focus().toggleSmallText().run() },
    { id: 'date', title: 'Date', icon: 'calendar', keywords: 'today', run: (e) => insertDateTime(e, 'date') },
    { id: 'time', title: 'Time', icon: 'clock', keywords: 'now', run: (e) => insertDateTime(e, 'time') },
    { id: 'datetime', title: 'Date and time', icon: 'calendar-clock', keywords: 'now timestamp', run: (e) => insertDateTime(e, 'datetime') },
  ];
}

export { toggleChecklist };
