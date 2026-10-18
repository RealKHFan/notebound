// Inserting things into the open note: images, photos, files, drawings, tables, math...
import { native } from '../native.js';
import { vault, ask, snack, pushPage } from '../ui/app-state.js';
import { newId } from '../store/note-format.js';
import { toB64 } from '../store/crypto.js';
import { imageInfo } from '../store/previews.js';
import { locale } from '../ui/format.js';

export { imageInfo } from '../store/previews.js';

async function insertPicked(editor, picked, pos) {
  if (!picked?.length) return 0;
  const nodes = [];
  for (const f of picked) {
    if (/^image\//.test(f.mime || '') || /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif|svg)$/i.test(f.path)) {
      const { width, height, preview } = await imageInfo(f.path);
      nodes.push({ type: 'image', attrs: { src: '../' + f.path, alt: '', width, height, preview } });
    } else {
      nodes.push({ type: 'attachment', attrs: { href: '../' + f.path, name: f.name || f.path.split('/').pop(), size: f.size || 0, mime: f.mime || '' } });
    }
  }
  nodes.push({ type: 'paragraph' });
  const chain = editor.chain().focus();
  if (pos != null) chain.insertContentAt(pos, nodes);
  else chain.insertContent(nodes);
  chain.run();
  return picked.length;
}

export async function insertImages(editor, pos) {
  try {
    return await insertPicked(editor, await native.pickImages(true), pos);
  } catch (e) {
    snack('Could not add the image: ' + (e.message || e));
    return 0;
  }
}

export async function insertPhoto(editor, pos) {
  try {
    const p = await native.capturePhoto();
    return await insertPicked(editor, p ? [p] : [], pos);
  } catch (e) {
    snack('Could not take a photo: ' + (e.message || e));
    return 0;
  }
}

export async function insertFiles(editor) {
  try {
    const picked = await native.pickFiles(true);
    if (!picked?.length) return 0;
    const nodes = picked.map((f) => ({ type: 'attachment', attrs: { href: '../' + f.path, name: f.name || f.path.split('/').pop(), size: f.size || 0, mime: f.mime || '' } }));
    nodes.push({ type: 'paragraph' });
    editor.chain().focus().insertContent(nodes).run();
    return picked.length;
  } catch (e) {
    snack('Could not attach the file: ' + (e.message || e));
    return 0;
  }
}

/** Opens the drawing canvas; resolves after the drawing was inserted (true) or cancelled (false). */
export function drawInto(editor, { pos = null, existing = null } = {}) {
  // Close the keyboard so the whole screen is free for drawing.
  try { editor.commands.blur(); } catch { /* destroyed */ }
  document.activeElement?.blur?.();
  return new Promise((resolve) => {
    pushPage({
      type: 'drawing',
      src: existing?.attrs.src ? existing.attrs.src.replace(/^\.\.\//, '') : null,
      onCancel: () => resolve(false),
      onDone: async ({ svg, width, height }) => {
        try {
          const name = `drawing-${newId(10)}.svg`;
          const path = await vault.writeAttachmentText(name, svg);
          const { preview } = await imageInfo(path);
          const attrs = { src: '../' + path, alt: 'Drawing', width, height, drawing: true, preview };
          if (existing && pos != null) {
            const node = editor.state.doc.nodeAt(pos);
            if (node?.type.name === 'image') {
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
              const old = existing.attrs.src.replace(/^\.\.\//, '');
              if (old.startsWith('attachments/drawing-')) native.remove(old).catch(() => {});
            }
          } else {
            const chain = editor.chain().focus();
            if (pos != null) chain.insertContentAt(pos, [{ type: 'image', attrs }, { type: 'paragraph' }]);
            else chain.insertContent([{ type: 'image', attrs }, { type: 'paragraph' }]);
            chain.run();
          }
          resolve(true);
        } catch (e) {
          snack('Could not save the drawing: ' + (e.message || e));
          resolve(false);
        }
      },
    });
  });
}

export async function insertMath(editor, block) {
  const latex = await ask({
    title: block ? 'Math block' : 'Inline math',
    message: 'Write a formula in LaTeX, for example a^2 + b^2 = c^2',
    input: block ? '\\int_0^1 x^2\\,dx' : 'E = mc^2',
    confirm: 'Insert',
    mono: true,
  });
  if (!latex || !latex.trim()) return;
  if (block) editor.chain().focus().insertBlockMath({ latex: latex.trim() }).run();
  else editor.chain().focus().insertInlineMath({ latex: latex.trim() }).run();
}

export async function editMath(editor, node, pos, kind) {
  const latex = await ask({ title: 'Edit formula', input: node.attrs.latex, confirm: 'Save', mono: true, extra: { label: 'Remove', value: '__remove__' } });
  if (latex == null) return;
  if (latex === '__remove__' || !latex.trim()) {
    editor.chain().focus().command(({ tr }) => { tr.delete(pos, pos + node.nodeSize); return true; }).run();
    return;
  }
  if (kind === 'block') editor.chain().updateBlockMath({ latex: latex.trim(), pos }).run();
  else editor.chain().updateInlineMath({ latex: latex.trim(), pos }).run();
}

export async function editLink(editor) {
  const { from, to, empty } = editor.state.selection;
  const current = editor.getAttributes('link');
  let text = editor.state.doc.textBetween(from, to, ' ');
  if (editor.isActive('link') && empty) {
    editor.chain().extendMarkRange('link').run();
    const sel = editor.state.selection;
    text = editor.state.doc.textBetween(sel.from, sel.to, ' ');
  }
  const res = await ask({
    title: current.href ? 'Edit link' : 'Add link',
    fields: [
      { name: 'text', label: 'Text', value: text },
      { name: 'url', label: 'Link', value: current.href || '', placeholder: 'https://', inputMode: 'url' },
    ],
    confirm: 'Save',
  });
  if (!res) return;
  let url = (res.url || '').trim();
  if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('#')) url = 'https://' + url;
  const label = (res.text || '').trim() || url;
  if (!url) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  const sel = editor.state.selection;
  editor.chain().focus().insertContentAt({ from: sel.from, to: sel.to }, [{ type: 'text', text: label, marks: [{ type: 'link', attrs: { href: url } }] }]).run();
}

export function insertDateTime(editor, what = 'datetime') {
  const d = new Date();
  const loc = locale();
  const text = what === 'date' ? d.toLocaleDateString(loc, { dateStyle: 'long' })
    : what === 'time' ? d.toLocaleTimeString(loc, { timeStyle: 'short' })
      : d.toLocaleString(loc, { dateStyle: 'long', timeStyle: 'short' });
  editor.chain().focus().insertContent(text + ' ').run();
}

/** Images pasted or dropped into the editor are stored as attachments. */
export async function storeImageFiles(files) {
  const out = [];
  for (const file of files) {
    if (!/^image\//.test(file.type)) continue;
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
    const path = `attachments/pasted-${newId(10)}.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    await native.writeBase64(path, toB64(buf));
    out.push({ path, name: file.name || path.split('/').pop(), mime: file.type, size: buf.length });
  }
  return out;
}
export async function insertStoredImages(editor, stored, pos) {
  return insertPicked(editor, stored, pos);
}
