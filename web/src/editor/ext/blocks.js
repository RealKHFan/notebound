// Custom block nodes: callouts, images (photos and drawings) and file attachments.
import { Node, mergeAttributes } from '@tiptap/core';
import { iconSvg } from '../../ui/icons.jsx';
import { formatBytes } from '../../ui/format.js';

export const CALLOUT_TYPES = ['info', 'tip', 'success', 'warning', 'danger'];
const CALLOUT_ICON = { info: 'info', tip: 'tip', success: 'success', warning: 'warning', danger: 'danger' };

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      type: {
        default: 'info',
        parseHTML: (el) => (CALLOUT_TYPES.includes(el.getAttribute('data-callout')) ? el.getAttribute('data-callout') : 'info'),
        renderHTML: (attrs) => ({ 'data-callout': attrs.type }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div.callout' }, { tag: 'aside[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0];
  },
  addCommands() {
    return {
      setCallout: (type = 'info') => ({ commands }) => commands.wrapIn(this.name, { type }),
      toggleCallout: (type = 'info') => ({ commands, editor }) => (editor.isActive(this.name) ? commands.lift(this.name) : commands.wrapIn(this.name, { type })),
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'callout';
      dom.dataset.callout = node.attrs.type;
      const icon = document.createElement('button');
      icon.type = 'button';
      icon.className = 'callout-icon';
      icon.contentEditable = 'false';
      icon.setAttribute('aria-label', 'Change callout style');
      icon.innerHTML = iconSvg(CALLOUT_ICON[node.attrs.type] || 'info', 20);
      icon.addEventListener('mousedown', (e) => e.preventDefault());
      icon.addEventListener('click', (e) => {
        e.preventDefault();
        if (!editor.isEditable || typeof getPos !== 'function') return;
        const pos = getPos();
        const cur = editor.state.doc.nodeAt(pos);
        if (!cur) return;
        const next = CALLOUT_TYPES[(CALLOUT_TYPES.indexOf(cur.attrs.type) + 1) % CALLOUT_TYPES.length];
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, type: next }));
      });
      const content = document.createElement('div');
      content.className = 'callout-content';
      dom.append(icon, content);
      return {
        dom,
        contentDOM: content,
        update(updated) {
          if (updated.type.name !== 'callout') return false;
          dom.dataset.callout = updated.attrs.type;
          icon.innerHTML = iconSvg(CALLOUT_ICON[updated.attrs.type] || 'info', 20);
          return true;
        },
      };
    };
  },
});

/** Resolve the src stored in the note file (../attachments/x.png) to a URL the app can load. */
export function displaySrc(src) {
  if (!src) return '';
  if (src.startsWith('../')) return '/vault/' + src.slice(3);
  if (src.startsWith('attachments/')) return '/vault/' + src;
  return src;
}

export const NbImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { onOpen: null };
  },
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      title: { default: null },
      width: { default: null, parseHTML: (el) => el.getAttribute('width') || null },
      height: { default: null, parseHTML: (el) => el.getAttribute('height') || null },
      size: {
        default: 100,
        parseHTML: (el) => {
          const m = /width:\s*(\d+)%/.exec(el.getAttribute('style') || '');
          return m ? Number(m[1]) : 100;
        },
        renderHTML: (attrs) => (attrs.size && attrs.size < 100 ? { style: `width:${attrs.size}%` } : {}),
      },
      drawing: {
        default: false,
        parseHTML: (el) => el.hasAttribute('data-drawing'),
        renderHTML: (attrs) => (attrs.drawing ? { 'data-drawing': '' } : {}),
      },
      // small JPEG copy shown by the note file when ../attachments cannot be reached (see store/previews.js)
      preview: {
        default: null,
        parseHTML: (el) => (/^data:image\/(jpeg|png|webp);base64,/.test(el.getAttribute('data-preview') || '') ? el.getAttribute('data-preview') : null),
        renderHTML: (attrs) => (attrs.preview ? { 'data-preview': attrs.preview } : {}),
      },
    };
  },
  parseHTML() {
    return [{
      tag: 'img[src]',
      getAttrs: (el) => {
        const src = el.getAttribute('src') || '';
        // Only local files and inline data images: notes never load anything from the internet.
        if (/^(https?:)?\/\//i.test(src)) return false;
        return null;
      },
    }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { loading: 'lazy' })];
  },
  addCommands() {
    return {
      insertImage: (attrs) => ({ commands }) => commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('figure');
      dom.className = 'nb-image';
      const img = document.createElement('img');
      img.draggable = false;
      const apply = (n) => {
        img.src = displaySrc(n.attrs.src);
        img.alt = n.attrs.alt || '';
        img.classList.toggle('drawing', !!n.attrs.drawing);
        dom.style.width = n.attrs.size && n.attrs.size < 100 ? `${n.attrs.size}%` : '';
        if (n.attrs.width && n.attrs.height) img.style.aspectRatio = `${n.attrs.width} / ${n.attrs.height}`;
        else img.style.aspectRatio = '';
      };
      apply(node);
      dom.appendChild(img);
      let current = node;
      dom.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof getPos === 'function') this.options.onOpen?.(current, getPos(), editor);
      });
      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'image') return false;
          current = updated;
          apply(updated);
          return true;
        },
        selectNode() { dom.classList.add('selected'); },
        deselectNode() { dom.classList.remove('selected'); },
      };
    };
  },
});

export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return { onOpen: null };
  },
  addAttributes() {
    return {
      href: { default: null },
      name: { default: 'file', parseHTML: (el) => el.getAttribute('data-name') || el.textContent.replace(/^📎\s*/, '').trim() || 'file' },
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-size')) || 0 },
      mime: { default: '', parseHTML: (el) => el.getAttribute('data-mime') || '' },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-attachment]', priority: 1000 }];
  },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['a', {
      class: 'attachment', 'data-attachment': '', href: a.href, 'data-name': a.name, 'data-size': String(a.size || 0), 'data-mime': a.mime || '', download: a.name,
    }, `📎 ${a.name}`];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'nb-attachment';
      dom.contentEditable = 'false';
      let current = node;
      const draw = (n) => {
        dom.innerHTML = `${iconSvg('paperclip', 20)}<span class="name"></span><span class="size"></span>`;
        dom.querySelector('.name').textContent = n.attrs.name;
        dom.querySelector('.size').textContent = n.attrs.size ? formatBytes(n.attrs.size) : '';
      };
      draw(node);
      dom.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof getPos === 'function') this.options.onOpen?.(current, getPos(), editor);
      });
      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'attachment') return false;
          current = updated;
          draw(updated);
          return true;
        },
        selectNode() { dom.classList.add('selected'); },
        deselectNode() { dom.classList.remove('selected'); },
      };
    };
  },
});
