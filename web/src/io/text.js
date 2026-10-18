// Converting between plain text, Markdown and the editor's HTML.
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { escapeHtml, blockText } from '../store/note-format.js';

const URL_RE = /\b(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g;

/** Plain text -> paragraphs, with web addresses turned into links. */
export function linkify(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => {
      const safe = escapeHtml(line).replace(URL_RE, (u) => `<a href="${u}">${u}</a>`);
      return `<p>${safe}</p>`;
    })
    .join('');
}

export function sanitizeHtml(html) {
  return DOMPurify.sanitize(String(html || ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
    ADD_ATTR: ['data-type', 'data-checked', 'data-callout', 'data-latex', 'data-note-id', 'data-attachment', 'data-name', 'data-size', 'data-mime', 'data-drawing', 'data-color', 'open'],
  });
}

/** Turn GitHub-style "- [ ] task" lists and other common shapes into what the editor understands. */
export function normalizeImportedHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = [...ul.children].filter((c) => c.tagName === 'LI');
    if (!items.length) return;
    const isTasks = items.every((li) => {
      const first = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
      return !!first || li.getAttribute('data-type') === 'taskItem';
    });
    if (!isTasks) return;
    ul.setAttribute('data-type', 'taskList');
    for (const li of items) {
      const box = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
      const checked = box ? box.checked || box.hasAttribute('checked') : li.getAttribute('data-checked') === 'true';
      box?.remove();
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', checked ? 'true' : 'false');
      // content must start with a paragraph
      const nested = [...li.childNodes];
      const p = doc.createElement('p');
      const rest = [];
      for (const n of nested) {
        if (n.nodeType === 1 && ['UL', 'OL', 'P', 'DIV'].includes(n.tagName)) {
          if (n.tagName === 'P' && !p.childNodes.length && !rest.length) { p.append(...n.childNodes); continue; }
          rest.push(n);
        } else if (!rest.length) p.appendChild(n);
        else rest.push(n);
      }
      if (p.firstChild && p.firstChild.nodeType === 3) p.firstChild.nodeValue = p.firstChild.nodeValue.replace(/^\s+/, '');
      li.replaceChildren(p, ...rest);
    }
  });
  // <input> boxes left anywhere else are dropped
  doc.querySelectorAll('input').forEach((i) => i.remove());
  return doc.body.innerHTML;
}

marked.setOptions({ gfm: true, breaks: false });

/** Markdown (with optional YAML front matter) -> { html, front } */
export function markdownToHtml(md) {
  let text = String(md || '').replace(/^﻿/, '');
  let front = {};
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (fm) {
    front = parseFrontMatter(fm[1]);
    text = text.slice(fm[0].length);
  }
  // Discord/Notesnook style extensions marked does not know: ==highlight==, ||spoiler||, __underline__ is bold in Markdown, keep it bold.
  let html = marked.parse(text);
  html = html.replace(/==([^=\n]+)==/g, '<mark>$1</mark>').replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler">$1</span>');
  return { html: sanitizeHtml(normalizeImportedHtml(html)), front };
}

export function parseFrontMatter(src) {
  const out = {};
  let key = null;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (m) {
      key = m[1].toLowerCase();
      const v = m[2].trim();
      if (v === '') out[key] = [];
      else if (/^\[.*\]$/.test(v)) out[key] = v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
      else out[key] = unquote(v);
    } else if (key && /^\s*-\s+/.test(line)) {
      if (!Array.isArray(out[key])) out[key] = out[key] ? [out[key]] : [];
      out[key].push(unquote(line.replace(/^\s*-\s+/, '').trim()));
    }
  }
  return out;
}
function unquote(s) {
  return s.replace(/^["']|["']$/g, '');
}

// ---------- HTML -> Markdown ----------
let td = null;
function turndown() {
  if (td) return td;
  td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**' });
  td.use(gfm);
  td.addRule('taskItem', {
    filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
    replacement: (content, node) => {
      const checked = node.getAttribute('data-checked') === 'true';
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n/gm, '\n    ');
      return `- [${checked ? 'x' : ' '}] ${body}\n`;
    },
  });
  td.addRule('taskList', {
    filter: (node) => node.nodeName === 'UL' && node.getAttribute('data-type') === 'taskList',
    replacement: (content, node) => (node.parentNode?.nodeName === 'LI' ? '\n' + content : '\n\n' + content + '\n'),
  });
  td.addRule('underline', { filter: ['u'], replacement: (c) => `<u>${c}</u>` });
  td.addRule('mark', { filter: ['mark'], replacement: (c) => `==${c}==` });
  td.addRule('spoiler', { filter: (n) => n.nodeName === 'SPAN' && n.classList.contains('spoiler'), replacement: (c) => `||${c}||` });
  td.addRule('inlineMath', { filter: (n) => n.getAttribute?.('data-type') === 'inline-math', replacement: (_c, n) => `$${n.getAttribute('data-latex')}$` });
  td.addRule('blockMath', { filter: (n) => n.getAttribute?.('data-type') === 'block-math', replacement: (_c, n) => `\n\n$$\n${n.getAttribute('data-latex')}\n$$\n\n` });
  td.addRule('callout', {
    filter: (n) => n.nodeName === 'DIV' && n.classList.contains('callout'),
    replacement: (content, n) => {
      const type = { info: 'NOTE', tip: 'TIP', success: 'TIP', warning: 'WARNING', danger: 'CAUTION' }[n.getAttribute('data-callout')] || 'NOTE';
      return `\n\n> [!${type}]\n${content.trim().split('\n').map((l) => '> ' + l).join('\n')}\n\n`;
    },
  });
  td.addRule('attachment', {
    filter: (n) => n.nodeName === 'A' && n.hasAttribute('data-attachment'),
    replacement: (_c, n) => `\n\n[📎 ${n.getAttribute('data-name') || 'file'}](${encodeURI(n.getAttribute('href') || '')})\n\n`,
  });
  td.addRule('details', {
    filter: ['details'],
    replacement: (_c, n) => {
      const summary = n.querySelector('summary')?.textContent || 'Details';
      const inner = n.querySelector('[data-type="detailsContent"]') || n;
      const body = turndown().turndown(inner.innerHTML.replace(/<summary[\s\S]*?<\/summary>/i, ''));
      return `\n\n<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>\n\n`;
    },
  });
  td.addRule('image', {
    filter: 'img',
    replacement: (_c, n) => `![${n.getAttribute('alt') || ''}](${encodeURI(n.getAttribute('src') || '')})`,
  });
  return td;
}

export function htmlToMarkdown(title, html) {
  const body = turndown().turndown(html || '');
  return (title ? `# ${title}\n\n` : '') + body.trim() + '\n';
}

export function htmlToText(title, html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  doc.querySelectorAll('li[data-type="taskItem"]').forEach((li) => {
    const p = li.querySelector('p');
    if (p) p.insertBefore(doc.createTextNode(li.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ '), p.firstChild);
  });
  doc.querySelectorAll('ul:not([data-type]) > li > p:first-child').forEach((p) => p.insertBefore(doc.createTextNode('• '), p.firstChild));
  doc.querySelectorAll('ol > li > p:first-child').forEach((p, i) => p.insertBefore(doc.createTextNode(`${[...p.parentElement.parentElement.children].indexOf(p.parentElement) + 1}. `), p.firstChild));
  const text = blockText(doc.body);
  return (title ? `${title}\n\n` : '') + text + '\n';
}
