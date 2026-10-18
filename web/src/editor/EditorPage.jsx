import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { buildExtensions } from './extensions.js';
import { EditorSession, NeedsPassword } from './session.js';
import { Toolbar } from './Toolbar.jsx';
import { blockCommands } from './commands.js';
import { toggleChecklist, uncheckAll, deleteCheckedItems } from './ext/task.js';
import {
  insertImages, insertPhoto, drawInto, editMath, editLink, storeImageFiles, insertStoredImages,
} from './insert.js';
import { Icon } from '../ui/icons.jsx';
import {
  ui, vault, popPage, pushPage, openSheet, closeSheet, ask, snack, useBackHandler, openNote, runAction,
  closePage, registerEditor, unregisterEditor, markLockedEditor, releaseLockedEditor,
} from '../ui/app-state.js';
import { native } from '../native.js';
import { escapeHtml, noteFileName } from '../store/note-format.js';
import { nextOccurrence } from '../store/recurrence.js';
import { editedLabel, reminderLabel, fullDate, plural } from '../ui/format.js';
import { pinNotes, archiveNotes, trashNotes, duplicateNotes } from '../ui/note-actions.js';
import { linkify } from '../io/text.js';
import { imageInfo } from '../store/previews.js';

/** The editor always keeps an empty paragraph at the end for typing; the file does not need it. */
export function cleanHtml(html) {
  return html.replace(/(<p><\/p>)+$/, '');
}

function isDocEmpty(editor) {
  const doc = editor.state.doc;
  if (doc.textContent.trim()) return false;
  let atom = false;
  doc.descendants((n) => {
    if (atom) return false;
    if (n.isAtom && n.type.name !== 'hardBreak') atom = true;
    if (['table', 'horizontalRule', 'codeBlock', 'image', 'attachment'].includes(n.type.name)) atom = true;
    return !atom;
  });
  return !atom;
}

/** Note links store a file name; refresh it in case the target note was renamed. */
function refreshNoteLinks(html) {
  if (!html.includes('data-note-id')) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('a[data-note-id]').forEach((a) => {
    const e = vault.get(a.getAttribute('data-note-id'));
    if (e) a.setAttribute('href', encodeURIComponent(e.file));
  });
  return doc.body.innerHTML;
}

function initialContent(page) {
  if (page.kind === 'list') return '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>';
  if (page.kind === 'shared' && page.shared) {
    const parts = [];
    if (page.shared.text) parts.push(linkify(page.shared.text));
    for (const f of page.shared.attachments || []) {
      if (/^image\//.test(f.mime || '')) {
        const size = f.width && f.height ? ` width="${f.width}" height="${f.height}"` : '';
        const preview = f.preview ? ` data-preview="${escapeHtml(f.preview)}"` : '';
        parts.push(`<img src="../${escapeHtml(f.path)}" alt=""${size}${preview}>`);
      }
      else parts.push(`<a class="attachment" data-attachment="" href="../${escapeHtml(f.path)}" data-name="${escapeHtml(f.name)}" data-size="${f.size || 0}" data-mime="${escapeHtml(f.mime || '')}">📎 ${escapeHtml(f.name)}</a>`);
    }
    return parts.join('') || '<p></p>';
  }
  return '';
}

export function EditorPage({ page }) {
  const [session] = useState(() => new EditorSession(vault, { id: page.id, preset: page.preset }));
  const [initialTitle] = useState(() => session.title);
  const [editor, setEditor] = useState(null);
  const [status, setStatus] = useState('loading');
  const [, setTick] = useState(0);
  const [focused, setFocused] = useState(false);
  const [find, setFind] = useState(null);
  const holder = useRef(null);
  const titleRef = useRef(null);
  const scrollRef = useRef(null);
  const editorRef = useRef(null);
  const raf = useRef(0);
  const rerender = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setTick((t) => t + 1));
  }, []);
  const { insets } = ui.get();
  const keyboard = insets.ime > 0;
  const meta = session.meta;
  const settings = vault.settings;
  const readonly = !!meta.readonly;

  const autoGrow = () => {
    const t = titleRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  };

  const notifyChange = () => {
    const ed = editorRef.current;
    if (!ed) return;
    session.change(titleRef.current?.value || '', cleanHtml(ed.getHTML()), isDocEmpty(ed));
  };

  // ---------- load + create the editor ----------
  useEffect(() => {
    let alive = true;
    let ed = null;
    (async () => {
      for (;;) {
        try {
          await session.load();
          break;
        } catch (e) {
          if (e instanceof NeedsPassword) {
            if (!alive) return;
            setStatus('password');
            const pw = await ask({ title: 'Locked note', message: 'Enter your vault password to open this note.', input: '', password: true, confirm: 'Unlock' });
            if (!pw) { closePage(page.key); return; }
            if (!(await vault.unlockVault(pw))) { snack('Wrong password'); continue; }
            continue;
          }
          console.error(e);
          if (alive) { setStatus('error'); snack(e.message || 'Could not open the note'); closePage(page.key); }
          return;
        }
      }
      if (!alive) return;
      if (session.meta.locked) markLockedEditor(page.key, true);
      const s = vault.settings;
      ed = new Editor({
        element: holder.current,
        extensions: buildExtensions({
          placeholder: 'Note',
          checkedToBottom: () => !!vault.settings.checkedToBottom,
          emojiEnabled: () => vault.settings.emojiShortcodes !== false,
          shortcutsEnabled: () => vault.settings.markdownShortcuts !== false,
          slashCommands: () => blockCommands(),
          searchNotes: (q) => {
            const query = q.toLowerCase();
            return vault.all()
              .filter((e) => !e.meta.trashed && e.id !== session.id && (e.title || '').toLowerCase().includes(query))
              .sort((a, b) => Date.parse(b.meta.modified) - Date.parse(a.meta.modified))
              .map((e) => ({ id: e.id, title: e.title || 'Untitled', href: encodeURIComponent(e.file) }));
          },
          labels: () => vault.config.labels,
          onLabel: (name) => {
            vault.addLabel(name);
            target.patch((m) => (m.labels.includes(name) ? null : { labels: [...m.labels, name] }));
          },
          onImageOpen: (node, pos, editorInst) => openImageSheet(editorInst, node, pos),
          onAttachmentOpen: (node, pos, editorInst) => openAttachmentSheet(editorInst, node, pos),
          onMathEdit: (node, pos, kind) => { if (editorRef.current?.isEditable) editMath(editorRef.current, node, pos, kind); },
        }),
        content: session.id ? refreshNoteLinks(session.html) : initialContent(page),
        editable: !session.meta.readonly,
        enableInputRules: s.markdownShortcuts !== false,
        enablePasteRules: s.markdownShortcuts !== false,
        injectCSS: false,
        editorProps: {
          attributes: {
            class: 'nb-editor-content',
            spellcheck: s.spellcheck ? 'true' : 'false',
            autocapitalize: 'sentences',
            'aria-label': 'Note text',
            role: 'textbox',
            'aria-multiline': 'true',
          },
          handlePaste: (view, event) => {
            const files = [...(event.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
            if (!files.length) return false;
            storeImageFiles(files).then((stored) => insertStoredImages(editorRef.current, stored));
            return true;
          },
          handleDrop: (view, event) => {
            const files = [...(event.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type));
            if (!files.length) return false;
            event.preventDefault();
            storeImageFiles(files).then((stored) => insertStoredImages(editorRef.current, stored));
            return true;
          },
          handleClickOn: (view, pos, node, nodePos, event) => {
            const target = event.target;
            const a = target?.closest?.('a[href]');
            if (a && !view.editable) {
              openLinkTarget(a.getAttribute('data-note-id'), a.getAttribute('href'));
              return true;
            }
            return false;
          },
        },
        onUpdate: () => notifyChange(),
        onTransaction: () => rerender(),
        onFocus: () => setFocused(true),
        onBlur: () => setTimeout(() => {
          if (!document.activeElement?.closest?.('.toolbar-wrap, .suggest-menu')) setFocused(false);
        }, 120),
      });
      editorRef.current = ed;
      setEditor(ed);
      setStatus('ready');
      // Only replace the title if the user has not started typing in it while the note loaded.
      if (titleRef.current && titleRef.current.value === initialTitle) titleRef.current.value = session.title;
      autoGrow();
      // Start with the cursor after the last line, never on a picture at the top
      // (typing would replace a selected picture). This does not open the keyboard.
      if (session.id) {
        const end = Selection.atEnd(ed.state.doc);
        if (!ed.state.selection.eq(end)) ed.view.dispatch(ed.state.tr.setSelection(end).setMeta('addToHistory', false).setMeta('preventUpdate', true));
      }
      // Opening and reading a note must never rewrite its file.
      if (session.id) session.setBaseline(session.title, cleanHtml(ed.getHTML()));
      addMissingPreviews(ed);

      // What a brand-new note starts with.
      if (!session.id) {
        if (page.kind === 'shared') {
          if (titleRef.current && !titleRef.current.value) { titleRef.current.value = page.shared?.title || ''; autoGrow(); }
          notifyChange();
          await session.flush();
        } else if (page.kind === 'drawing') {
          const ok = await drawInto(ed);
          if (!ok && isDocEmpty(ed)) { closePage(page.key); return; }
        } else if (page.kind === 'photo') {
          const n = await insertPhoto(ed, 0);
          if (!n && isDocEmpty(ed)) { closePage(page.key); return; }
        } else if (page.kind === 'image') {
          const n = await insertImages(ed, 0);
          if (!n && isDocEmpty(ed)) { closePage(page.key); return; }
        } else if (page.kind === 'list') {
          let p = null;
          ed.state.doc.descendants((n, pos) => {
            if (p === null && n.type.name === 'paragraph') { p = pos + 1; return false; }
            return p === null;
          });
          ed.chain().focus().setTextSelection(p ?? 1).run();
        } else {
          ed.commands.focus('end');
        }
      }
    })();

    const flushOnPause = () => session.flush();
    window.addEventListener('nb-flush', flushOnPause);
    registerEditor(page.id, page.key);
    const off = session.onChange((type, data) => {
      if (type === 'created') registerEditor(data, page.key);
      if (type === 'external') snack('This note was changed outside Notebound. The other version is saved in its history.');
      if (type === 'error') snack('Could not save: ' + (session.lastError?.message || 'unknown error'));
      rerender();
    });
    return () => {
      alive = false;
      window.removeEventListener('nb-flush', flushOnPause);
      off();
      unregisterEditor(page.key);
      const edNow = editorRef.current;
      // Every edit is already queued by onUpdate / the title input; close() only writes if something changed.
      session.close()
        .then((r) => { if (r === 'discarded') snack('Empty note discarded'); })
        .catch((e) => snack('Could not save: ' + (e.message || e)))
        .finally(() => releaseLockedEditor(page.key));
      edNow?.destroy();
    };
  }, []);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!readonly);
  }, [editor, readonly]);

  // Another part of the app rewrote this note (e.g. a version was restored from history): show that text.
  useEffect(() => vault.subscribe(async (change) => {
    if (change.type !== 'save' || change.id !== session.id || change.source === session) return;
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed || session.pending) return;
    try {
      await session.load();
    } catch (e) {
      return;
    }
    if (ed.isDestroyed) return;
    ed.commands.setContent(refreshNoteLinks(session.html), { emitUpdate: false });
    if (titleRef.current) titleRef.current.value = session.title;
    autoGrow();
    session.setBaseline(session.title, cleanHtml(ed.getHTML()));
    rerender();
  }), []);

  // Keep the cursor visible when the keyboard opens.
  useEffect(() => {
    if (keyboard && editor && editor.isFocused) setTimeout(() => editor.commands.scrollIntoView(), 60);
  }, [keyboard]);

  useBackHandler(useCallback(() => {
    if (find) { setFind(null); editorRef.current?.commands.setFindTerm(''); return true; }
    return false;
  }, [find]));

  /**
   * Pictures added before previews existed get one now. It goes into the file
   * with the next real edit, so just opening a note still does not rewrite it.
   */
  async function addMissingPreviews(ed) {
    const wanted = new Set();
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'image' && !n.attrs.preview && String(n.attrs.src || '').startsWith('../attachments/')) wanted.add(n.attrs.src);
    });
    if (!wanted.size) return;
    const found = new Map();
    for (const src of wanted) {
      let path = src.slice(3);
      try { path = decodeURIComponent(path); } catch { /* keep */ }
      const info = await imageInfo(path);
      if (info.preview) found.set(src, info.preview);
    }
    if (!found.size || ed.isDestroyed) return;
    const clean = session.id && !session.pending && session.baseHtml === cleanHtml(ed.getHTML());
    const tr = ed.state.tr;
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'image' && !n.attrs.preview && found.has(n.attrs.src)) tr.setNodeMarkup(pos, undefined, { ...n.attrs, preview: found.get(n.attrs.src) });
    });
    if (!tr.docChanged) return;
    tr.setMeta('addToHistory', false).setMeta('preventUpdate', true);
    ed.view.dispatch(tr);
    if (clean) session.setBaseline(session.title, cleanHtml(ed.getHTML()));
    else notifyChange();
  }

  // ---------- helpers bound to this note ----------
  const openLinkTarget = (noteId, href) => {
    if (noteId && vault.get(noteId)) { openNote(noteId); return; }
    if (href && /^(https?:|mailto:|tel:)/i.test(href)) native.openUrl(href);
  };

  function openImageSheet(ed, node, pos) {
    // Tapping a picture should not bring up the keyboard behind the menu.
    ed.commands.blur();
    document.activeElement?.blur?.();
    const path = String(node.attrs.src || '').replace(/^\.\.\//, '');
    const editable = ed.isEditable;
    const setSize = (size) => ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, size }));
    openSheet('menu', {
      title: node.attrs.drawing ? 'Drawing' : 'Image',
      items: [
        { icon: 'maximize', label: 'View', onClick: () => pushPage({ type: 'image', src: path, drawing: node.attrs.drawing }) },
        editable && node.attrs.drawing ? { icon: 'brush', label: 'Edit drawing', onClick: () => drawInto(ed, { pos, existing: node }) } : null,
        editable ? { icon: 'scale', label: 'Small', checked: node.attrs.size === 33, onClick: () => setSize(33) } : null,
        editable ? { icon: 'scale', label: 'Medium', checked: node.attrs.size === 50, onClick: () => setSize(50) } : null,
        editable ? { icon: 'scale', label: 'Large', checked: node.attrs.size === 75, onClick: () => setSize(75) } : null,
        editable ? { icon: 'scale', label: 'Full width', checked: !node.attrs.size || node.attrs.size === 100, onClick: () => setSize(100) } : null,
        { icon: 'share', label: 'Share', onClick: () => native.shareFile(path, node.attrs.drawing ? 'image/svg+xml' : '', path.split('/').pop()).catch((e) => snack(e.message)) },
        editable ? { icon: 'trash', label: 'Remove from note', danger: true, onClick: () => ed.chain().focus().command(({ tr }) => { tr.delete(pos, pos + node.nodeSize); return true; }).run() } : null,
      ],
    });
  }

  function openAttachmentSheet(ed, node, pos) {
    const path = String(node.attrs.href || '').replace(/^\.\.\//, '');
    openSheet('menu', {
      title: node.attrs.name,
      items: [
        { icon: 'external', label: 'Open', onClick: () => native.openFile(path, node.attrs.mime).catch((e) => snack(e.message)) },
        { icon: 'share', label: 'Share', onClick: () => native.shareFile(path, node.attrs.mime, node.attrs.name).catch((e) => snack(e.message)) },
        ed.isEditable ? { icon: 'trash', label: 'Remove from note', danger: true, onClick: () => ed.chain().focus().command(({ tr }) => { tr.delete(pos, pos + node.nodeSize); return true; }).run() } : null,
      ],
    });
  }

  const target = {
    metas: () => [session.meta],
    patch: (p) => runAction('Update note', async () => { await session.updateMeta(p); rerender(); }),
  };

  const close = () => popPage();

  const togglePin = () => target.patch({ pinned: !meta.pinned, ...(meta.pinned ? {} : { archived: false }) });
  const toggleArchive = async () => {
    await session.flush();
    if (!session.id) { close(); return; }
    const id = session.id;
    const was = meta.archived;
    close();
    archiveNotes([id], !was);
  };
  const deleteNote = async () => {
    await session.flush();
    const id = session.id;
    close();
    if (id) trashNotes([id]);
  };

  const openInsert = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const cmds = blockCommands();
    const pick = (id) => cmds.find((c) => c.id === id);
    const order = ['photo', 'image', 'drawing', 'checklist', 'file', 'table', 'code', 'math', 'callout', 'details', 'divider', 'note-link', 'datetime', 'quote', 'h1', 'h2'];
    openSheet('insert', {
      items: order.map(pick).filter(Boolean).map((c) => ({
        icon: c.icon,
        label: c.id === 'checklist' ? 'Checkboxes' : c.title,
        onClick: () => { closeSheet(); c.run(ed); },
      })),
    });
  };

  const lockToggle = async () => {
    await session.flush();
    if (!session.id) { snack('Write something first'); return; }
    if (meta.locked) {
      const ok = await ask({ title: 'Remove lock?', message: 'The note is decrypted and saved as normal text.', confirm: 'Remove lock' });
      if (!ok) return;
      await runAction('Unlock', () => vault.unlockNote(session.id));
      session.meta = { ...vault.get(session.id).meta };
      markLockedEditor(page.key, false);
      rerender();
      snack('Lock removed');
      return;
    }
    if (!vault.hasVault) {
      const res = await ask({
        title: 'Create a vault password',
        message: 'Locked notes are encrypted with this password. If you forget it, nobody can recover those notes.',
        fields: [
          { name: 'pw', label: 'Password', type: 'password' },
          { name: 'pw2', label: 'Repeat password', type: 'password' },
        ],
        confirm: 'Create',
        validate: (v) => (!v.pw || v.pw.length < 4 ? 'Use at least 4 characters.' : v.pw !== v.pw2 ? 'The passwords do not match.' : null),
      });
      if (!res) return;
      await vault.createVault(res.pw);
    } else if (!vault.vaultUnlocked) {
      const pw = await ask({ title: 'Vault password', message: 'Enter your vault password to lock this note.', input: '', password: true, confirm: 'Unlock' });
      if (!pw) return;
      if (!(await vault.unlockVault(pw))) { snack('Wrong password'); return; }
    }
    await runAction('Lock', () => vault.lockNote(session.id));
    session.meta = { ...vault.get(session.id).meta };
    markLockedEditor(page.key, true);
    session.snapshotDone = true;
    session.originalText = null;
    rerender();
    snack('Note locked. Its text is now encrypted in the file.');
  };

  const showInfo = () => {
    const ed = editorRef.current;
    const e = session.id ? vault.get(session.id) : null;
    const words = ed ? ed.storage.characterCount.words() : 0;
    const chars = ed ? ed.storage.characterCount.characters() : 0;
    openSheet('info', {
      rows: [
        ['Created', fullDate(meta.created)],
        ['Edited', fullDate(meta.modified)],
        ['Words', String(words)],
        ['Characters', String(chars)],
        ['File', e ? `notes/${e.file}` : 'Not saved yet'],
        ['Folder', ui.get().info.folderName || ''],
      ],
    });
  };

  const backlinks = session.id ? vault.all().filter((e) => !e.meta.trashed && e.noteLinks.includes(session.id)) : [];
  const hasTasks = editor ? editor.isActive('taskList') || editor.getHTML().includes('data-type="taskList"') : false;

  const openMore = () => {
    const ed = editorRef.current;
    openSheet('menu', {
      items: [
        { icon: 'trash', label: 'Delete', onClick: deleteNote },
        { icon: 'palette', label: 'Color and background', onClick: () => openSheet('color', { target }) },
        { icon: 'copy', label: 'Make a copy', onClick: async () => { await session.flush(); if (session.id) { await duplicateNotes([session.id]); } } },
        { icon: 'share', label: 'Send', onClick: async () => {
          await session.flush();
          const text = [titleRef.current?.value || '', ed ? ed.getText({ blockSeparator: '\n' }) : ''].filter(Boolean).join('\n\n');
          native.shareText(titleRef.current?.value || '', text).catch((e) => snack(e.message));
        } },
        { icon: 'download', label: 'Export', onClick: async () => { await session.flush(); if (session.id) openSheet('export', { ids: [session.id] }); } },
        { icon: 'tag', label: 'Labels', onClick: () => openSheet('labels', { target }) },
        { icon: 'notebook', label: 'Notebooks', onClick: () => openSheet('notebooks', { target }) },
        { icon: 'star', label: meta.favorite ? 'Remove from favorites' : 'Add to favorites', onClick: () => target.patch({ favorite: !meta.favorite }) },
        ed ? { icon: 'checklist', label: hasTasks ? 'Hide checkboxes' : 'Show checkboxes', onClick: () => { toggleChecklist(ed); } } : null,
        hasTasks ? { icon: 'square', label: 'Uncheck all items', onClick: () => uncheckAll(ed) } : null,
        hasTasks ? { icon: 'trash', label: 'Delete checked items', onClick: () => { const n = deleteCheckedItems(ed); snack(n ? `${plural(n, 'item', 'items')} deleted` : 'No checked items'); } } : null,
        { icon: meta.locked ? 'unlock' : 'lock', label: meta.locked ? 'Remove lock' : 'Lock note', onClick: lockToggle },
        { icon: readonly ? 'pen' : 'pencil-off', label: readonly ? 'Allow editing' : 'Read only', onClick: () => target.patch({ readonly: !readonly }) },
        { icon: 'search', label: 'Find in note', onClick: () => setFind({ term: '', replace: '', showReplace: false }) },
        { icon: 'outline', label: 'Outline', onClick: () => openOutline() },
        session.id && !meta.locked ? { icon: 'history', label: 'Version history', onClick: async () => { await session.flush(); pushPage({ type: 'history', id: session.id }); } } : null,
        { icon: 'info', label: 'Info', onClick: showInfo },
      ],
    });
  };

  const openOutline = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const heads = [];
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'heading') heads.push({ level: n.attrs.level, text: n.textContent || 'Untitled heading', pos });
      return n.type.name !== 'heading';
    });
    if (!heads.length) { snack('Add headings to see an outline'); return; }
    openSheet('menu', {
      title: 'Outline',
      items: heads.map((h, i) => ({
        icon: `h${Math.min(h.level, 4)}`,
        label: h.text + '​'.repeat(i), // keep labels unique
        onClick: () => {
          const dom = ed.view.nodeDOM(h.pos);
          dom?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
          ed.commands.setTextSelection(h.pos + 1);
        },
      })),
    });
  };

  const hideKeyboard = () => {
    editorRef.current?.commands.blur();
    document.activeElement?.blur?.();
    setFocused(false);
  };

  // ---------- render ----------
  const reminderNext = meta.reminder ? nextOccurrence(meta.reminder.at, meta.reminder.repeat) : null;
  const nbNames = meta.notebooks.map((id) => vault.config.notebooks.find((n) => n.id === id)).filter(Boolean);
  const showToolbar = editor && !readonly && (focused || keyboard) && document.activeElement !== titleRef.current;

  return (
    <div class="page-layer editor-page" data-color={meta.color} data-pattern={meta.pattern && meta.pattern !== 'none' ? meta.pattern : undefined} data-font={settings.editorFont}>
      <div class="editor-top">
        <button class="icon-btn" onClick={close} aria-label="Back"><Icon name="back" /></button>
        <span class="spacer" />
        {meta.locked ? <span class="lock-badge" title="Encrypted"><Icon name="lock" size={18} /></span> : null}
        <button class={'icon-btn' + (meta.pinned ? ' on' : '')} onClick={togglePin} aria-label={meta.pinned ? 'Unpin' : 'Pin'} aria-pressed={meta.pinned ? 'true' : 'false'}>
          <Icon name="pin" fill={meta.pinned} />
        </button>
        <button class={'icon-btn' + (meta.reminder ? ' on' : '')} onClick={() => openSheet('reminder', { target })} aria-label="Remind me"><Icon name="bell" /></button>
        <button class="icon-btn" onClick={toggleArchive} aria-label={meta.archived ? 'Unarchive' : 'Archive'}><Icon name={meta.archived ? 'unarchive' : 'archive'} /></button>
        <button class="icon-btn" onClick={openMore} aria-label="More options"><Icon name="more" /></button>
      </div>
      {find ? (
        <div class="find-bar" role="search">
          <div class="find-row">
            <input
              class="field"
              autoFocus
              placeholder="Find in note"
              value={find.term}
              aria-label="Find"
              onInput={(e) => { const term = e.currentTarget.value; setFind({ ...find, term }); editor?.commands.setFindTerm(term); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.findNext(); } }}
            />
            <span class="find-count">{editor && find.term ? `${editor.storage.findReplace.matches.length ? editor.storage.findReplace.index + 1 : 0}/${editor.storage.findReplace.matches.length}` : ''}</span>
            <button class="icon-btn" onClick={() => editor?.commands.findPrev()} aria-label="Previous match"><Icon name="chevron-up" /></button>
            <button class="icon-btn" onClick={() => editor?.commands.findNext()} aria-label="Next match"><Icon name="chevron-down" /></button>
            {!readonly ? <button class={'icon-btn' + (find.showReplace ? ' on' : '')} onClick={() => setFind({ ...find, showReplace: !find.showReplace })} aria-label="Replace"><Icon name="replace" /></button> : null}
            <button class="icon-btn" onClick={() => { setFind(null); editor?.commands.setFindTerm(''); }} aria-label="Close find"><Icon name="x" /></button>
          </div>
          {find.showReplace ? (
            <div class="find-row">
              <input class="field" placeholder="Replace with" value={find.replace} aria-label="Replace with" onInput={(e) => setFind({ ...find, replace: e.currentTarget.value })} />
              <button class="btn text" onClick={() => editor?.commands.replaceCurrent(find.replace)}>Replace</button>
              <button class="btn text" onClick={() => editor?.commands.replaceAll(find.replace)}>All</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div class="editor-scroll" ref={scrollRef}>
        <div class="editor-inner">
          <textarea
            ref={titleRef}
            defaultValue={initialTitle}
            class="title-input"
            placeholder="Title"
            rows={1}
            readOnly={readonly}
            aria-label="Title"
            onInput={() => { autoGrow(); notifyChange(); }}
            onFocus={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); editorRef.current?.commands.focus('start'); }
            }}
          />
          {meta.reminder || meta.labels.length || nbNames.length || meta.readonly ? (
            <div class="note-chips">
              {meta.readonly ? <button class="chip" onClick={() => target.patch({ readonly: false })}><Icon name="pencil-off" size={14} /><span>Read only</span></button> : null}
              {meta.reminder ? (
                <button class={'chip' + (reminderNext ? '' : ' past')} onClick={() => openSheet('reminder', { target })}>
                  <Icon name={meta.reminder.repeat ? 'repeat' : 'bell'} size={14} />
                  <span>{reminderLabel(reminderNext || Date.parse(meta.reminder.at))}</span>
                </button>
              ) : null}
              {nbNames.map((nb) => <button key={nb.id} class="chip" onClick={() => openSheet('notebooks', { target })}><Icon name="notebook" size={14} /><span>{nb.name}</span></button>)}
              {meta.labels.map((l) => <button key={l} class="chip" onClick={() => openSheet('labels', { target })}><span>{l}</span></button>)}
            </div>
          ) : null}
          <div ref={holder} class={'nb-editor' + (readonly ? ' readonly' : '')} />
          {status === 'loading' ? <div class="editor-loading"><div class="spinner" /></div> : null}
          {backlinks.length ? (
            <div class="backlinks">
              <div class="backlinks-title">Linked from</div>
              {backlinks.map((b) => (
                <button key={b.id} class="chip outline" onClick={() => openNote(b.id)}><Icon name="file" size={14} /><span>{b.title || 'Untitled'}</span></button>
              ))}
            </div>
          ) : null}
          <div class="editor-tail" onClick={() => editorRef.current?.commands.focus('end')} />
        </div>
      </div>
      {showToolbar ? (
        <Toolbar editor={editor} onInsert={openInsert} onHideKeyboard={hideKeyboard} />
      ) : (
        <div class="editor-bottom">
          <button class="icon-btn" onClick={openInsert} aria-label="Insert" disabled={readonly}><Icon name="plus" /></button>
          <button class="icon-btn" onClick={() => openSheet('color', { target })} aria-label="Color and background"><Icon name="palette" /></button>
          <span class="edited">{session.id ? `Edited ${editedLabel(meta.modified)}` : ''}</span>
          <button class="icon-btn" onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo() || readonly} aria-label="Undo"><Icon name="undo" /></button>
          <button class="icon-btn" onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo() || readonly} aria-label="Redo"><Icon name="redo" /></button>
        </div>
      )}
      <LinkBubble editor={editor} onOpen={openLinkTarget} />
    </div>
  );
}

/** Small bar under a link the cursor is in: open, edit, remove. */
function LinkBubble({ editor, onOpen }) {
  if (!editor || editor.isDestroyed || !editor.isEditable || !editor.isFocused || !editor.isActive('link')) return null;
  const attrs = editor.getAttributes('link');
  let rect;
  try {
    rect = editor.view.coordsAtPos(editor.state.selection.from);
  } catch { return null; }
  const top = Math.min(rect.bottom + 8, window.innerHeight - 120);
  const label = attrs.noteId ? vault.get(attrs.noteId)?.title || 'Note' : attrs.href;
  return (
    <div class="link-bubble" style={{ top: `${top}px` }} onMouseDown={(e) => e.preventDefault()}>
      <span class="url">{label}</span>
      <button class="icon-btn" aria-label="Open link" onClick={() => onOpen(attrs.noteId, attrs.href)}><Icon name="external" size={19} /></button>
      {!attrs.noteId ? <button class="icon-btn" aria-label="Edit link" onClick={() => editLink(editor)}><Icon name="square-pen" size={19} /></button> : null}
      <button class="icon-btn" aria-label="Remove link" onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}><Icon name="unlink" size={19} /></button>
    </div>
  );
}

export { noteFileName };
