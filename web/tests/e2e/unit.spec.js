// Unit tests of the pure modules, run inside Chromium (they need DOMParser and WebCrypto).
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startMockServer } from '../mock-server.mjs';

const cases = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/recurrence-cases.json'), 'utf8'));

const test = base.extend({
  u: async ({ page }, use) => {
    const srv = await startMockServer({ hasFolder: true });
    page.on('pageerror', (e) => { throw e; });
    await page.goto(srv.url + '/app/units.html');
    await page.waitForFunction(() => !!window.__units);
    await use(page);
    await srv.close();
  },
});

test.describe('note file format', () => {
  test('serialize and parse round-trip keeps title, content and metadata', async ({ u }) => {
    const r = await u.evaluate(() => {
      const { noteFormat: nf } = window.__units;
      const meta = nf.defaultMeta({ color: 'sage', pinned: true, labels: ['Home', 'Work'], reminder: { at: '2026-10-20T06:00:00.000Z', repeat: 'weekly' } });
      const text = nf.serializeNote({ meta, title: 'Tom & Jerry <3', html: '<p>Hello <strong>world</strong></p>' });
      const back = nf.parseNote(text, nf.noteFileName('Tom & Jerry <3', meta.id));
      return { text, meta, back: { meta: back.meta, title: back.title, html: back.html, foreign: back.foreign } };
    });
    expect(r.text.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(r.text).toContain('<title>Tom &amp; Jerry &lt;3</title>');
    expect(r.text).toContain('data-color="sage"');
    expect(r.back.title).toBe('Tom & Jerry <3');
    expect(r.back.html).toBe('<p>Hello <strong>world</strong></p>');
    expect(r.back.foreign).toBe(false);
    expect(r.back.meta).toEqual(r.meta);
  });

  test('metadata cannot break out of its script block', async ({ u }) => {
    const r = await u.evaluate(() => {
      const { noteFormat: nf } = window.__units;
      const meta = nf.defaultMeta({ labels: ['</script><script>alert(1)</script>'] });
      const text = nf.serializeNote({ meta, title: 'x', html: '<p>x</p>' });
      return { text, labels: nf.parseNote(text, 'x.html').meta.labels };
    });
    expect(r.text).not.toContain('</script><script>');
    expect(r.labels).toEqual(['</script><script>alert(1)</script>']);
  });

  test('plain HTML files without metadata become notes', async ({ u }) => {
    const r = await u.evaluate(() => {
      const { noteFormat: nf } = window.__units;
      const p = nf.parseNote('<html><head><title>Recipe</title><script>alert(1)</script></head><body><h1>Recipe</h1><p>Mix it.</p></body></html>', 'Recipe.html');
      const again = nf.parseNote('<p>Mix it.</p>', 'Recipe.html');
      return { title: p.title, html: p.html, foreign: p.foreign, id: p.meta.id, id2: again.meta.id };
    });
    expect(r.title).toBe('Recipe');
    expect(r.html).toBe('<p>Mix it.</p>');
    expect(r.foreign).toBe(true);
    expect(r.id).toBe(r.id2); // stable id from the file name
  });

  test('hand-edited metadata is normalized and unknown keys are kept', async ({ u }) => {
    const m = await u.evaluate(() => window.__units.noteFormat.normalizeMeta({ id: 'abc12345', color: 'neon', pinned: 'yes', labels: ['a', 'a', ' b ', 3], reminder: { at: 'nope' }, future: { x: 1 } }));
    expect(m.color).toBe('default');
    expect(m.pinned).toBe(false);
    expect(m.labels).toEqual(['a', 'b']);
    expect(m.reminder).toBe(null);
    expect(m.future).toEqual({ x: 1 });
  });

  test('file names are readable, safe and end with the id', async ({ u }) => {
    const r = await u.evaluate(() => {
      const nf = window.__units.noteFormat;
      return [
        nf.noteFileName('Shopping list', 'ab12cd34'),
        nf.noteFileName('a/b:c*d?"e<f>g|h', 'ab12cd34'),
        nf.noteFileName('   ', 'ab12cd34'),
        nf.noteFileName('...hidden', 'ab12cd34'),
        nf.noteFileName('x'.repeat(200), 'ab12cd34').length,
        nf.idFromFileName('Shopping list_ab12cd34.html'),
        nf.idFromFileName('Shopping list_ab12cd34 (1).html'),
      ];
    });
    expect(r[0]).toBe('Shopping list_ab12cd34.html');
    expect(r[1]).toBe('a b c d e f g h_ab12cd34.html');
    expect(r[2]).toBe('Untitled_ab12cd34.html');
    expect(r[3]).toBe('hidden_ab12cd34.html');
    expect(r[4]).toBeLessThanOrEqual(62);
    expect(r[5]).toBe('ab12cd34');
    expect(r[6]).toBe(null);
  });

  test('preview info: checklist items, images, links and words', async ({ u }) => {
    const info = await u.evaluate(() => {
      const { noteFormat: nf } = window.__units;
      const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Milk</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>Oat</p></div></li></ul></div></li></ul><p><img src="../attachments/a.png" width="40" height="20"><a href="https://example.com">x</a> <a data-note-id="n2" href="Other_n2.html">Other</a></p><img src="../attachments/d.svg" data-drawing="">';
      const doc = new DOMParser().parseFromString(`<div class="nb-content">${html}</div>`, 'text/html');
      return nf.extractInfo(doc.querySelector('.nb-content'), 'T');
    });
    expect(info.isList).toBe(true);
    expect(info.items).toEqual([{ t: 'Milk', c: false, d: 0 }, { t: 'Oat', c: true, d: 1 }]);
    expect(info.images).toEqual([{ p: 'attachments/a.png', w: 40, h: 20, d: 0 }, { p: 'attachments/d.svg', w: 0, h: 0, d: 1 }]);
    expect(info.noteLinks).toEqual(['n2']);
    expect(info.hasLinks).toBe(true);
  });
});

test.describe('recurrence (same cases as Recurrence.java)', () => {
  for (const c of cases) {
    test(c.note, async ({ u }) => {
      const got = await u.evaluate(({ base, repeat, after }) => {
        const parse = (s) => { const [d, t] = s.split('T'); const [y, mo, da] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, mo - 1, da, h, mi); };
        const r = window.__units.recurrence.nextOccurrence(parse(base).toISOString(), repeat, parse(after).getTime());
        if (!r) return null;
        const d = new Date(r);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
      }, c);
      expect(got).toBe(c.expect);
    });
  }
});

test.describe('markdown and text conversion', () => {
  test('markdown with tasks and front matter imports correctly', async ({ u }) => {
    const r = await u.evaluate(() => window.__units.text.markdownToHtml('---\ntitle: Groceries\ntags: [home, food]\npinned: true\n---\n# Heading\n\n- [ ] milk\n- [x] eggs\n\nSome **bold** and ==marked== and ||secret||.\n\n<script>alert(1)</script>'));
    expect(r.front.title).toBe('Groceries');
    expect(r.front.tags).toEqual(['home', 'food']);
    expect(r.html).toContain('<ul data-type="taskList">');
    expect(r.html).toContain('data-checked="true"><p>eggs</p>');
    expect(r.html).toContain('<mark>marked</mark>');
    expect(r.html).toContain('<span class="spoiler">secret</span>');
    expect(r.html).not.toContain('<script');
  });

  test('html exports to markdown and plain text', async ({ u }) => {
    const r = await u.evaluate(() => {
      const { text } = window.__units;
      const html = '<h2>Plan</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Book</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Pack</p></div></li></ul><p><u>under</u> <mark>hi</mark> <span class="spoiler">s</span> <span data-type="inline-math" data-latex="x^2">$x^2$</span></p><div class="callout" data-callout="warning"><p>Careful</p></div><ol><li><p>one</p></li><li><p>two</p></li></ol>';
      return { md: text.htmlToMarkdown('Trip', html), txt: text.htmlToText('Trip', html) };
    });
    expect(r.md).toContain('# Trip');
    expect(r.md).toContain('## Plan');
    expect(r.md).toContain('- [x] Book');
    expect(r.md).toContain('- [ ] Pack');
    expect(r.md).toContain('<u>under</u>');
    expect(r.md).toContain('==hi==');
    expect(r.md).toContain('||s||');
    expect(r.md).toContain('$x^2$');
    expect(r.md).toContain('> [!WARNING]');
    expect(r.txt).toContain('☑ Book');
    expect(r.txt).toContain('☐ Pack');
    expect(r.txt).toContain('1. one');
    expect(r.txt).toContain('2. two');
  });

  test('plain text becomes paragraphs with links, and nothing executable', async ({ u }) => {
    const html = await u.evaluate(() => window.__units.text.linkify('See https://example.com/a?b=1.\n<b>not bold</b>'));
    expect(html).toBe('<p>See <a href="https://example.com/a?b=1">https://example.com/a?b=1</a>.</p><p>&lt;b&gt;not bold&lt;/b&gt;</p>');
  });
});

test.describe('encryption', () => {
  test('vault password verifies and locked payloads round-trip', async ({ u }) => {
    const r = await u.evaluate(async () => {
      const c = window.__units.crypto;
      const vault = await c.createVault('correct horse');
      const ok = await c.verifyVault('correct horse', vault);
      const bad = await c.verifyVault('wrong', vault);
      const locked = await c.lockPayload('correct horse', vault, { html: '<p>secret text</p>' });
      const back = await c.unlockPayload('correct horse', locked);
      let wrongFails = false;
      try { c.forgetKeys(); await c.unlockPayload('nope', locked); } catch { wrongFails = true; }
      return { ok, bad, back, locked, vault };
    });
    expect(r.ok).toBe(true);
    expect(r.bad).toBe(false);
    expect(r.back).toEqual({ html: '<p>secret text</p>' });
    expect(JSON.stringify(r.locked)).not.toContain('secret');
    expect(r.locked.iter).toBe(310000);
    expect(JSON.stringify(r.vault)).not.toContain('correct horse');
  }, { timeout: 30000 });
});

test.describe('search, sort and layout helpers', () => {
  test('selectNotes filters views and search terms', async ({ u }) => {
    const r = await u.evaluate(() => {
      const { query, noteFormat: nf } = window.__units;
      const mk = (title, text, meta) => ({ id: title, title, text, search: nf.normalizeForSearch(`${title}\n${text}\n${(meta.labels || []).join(' ')}`), items: [], images: [], attachments: [], hasLinks: false, meta: nf.defaultMeta(meta) });
      const all = [
        mk('Café plans', 'meet at noon', { labels: ['Work'] }),
        mk('Archived', 'old', { archived: true }),
        mk('Trashed', 'gone', { trashed: new Date().toISOString() }),
        mk('Starred', 'x', { favorite: true, notebooks: ['nb1'] }),
      ];
      const names = (l) => l.map((e) => e.id).sort();
      return {
        notes: names(query.selectNotes(all, { name: 'notes' })),
        archive: names(query.selectNotes(all, { name: 'archive' })),
        trash: names(query.selectNotes(all, { name: 'trash' })),
        fav: names(query.selectNotes(all, { name: 'favorites' })),
        label: names(query.selectNotes(all, { name: 'label', id: 'Work' })),
        nb: names(query.selectNotes(all, { name: 'notebook', id: 'nbParent' }, { notebooks: [{ id: 'nbParent' }, { id: 'nb1', parent: 'nbParent' }] })),
        search: names(query.selectNotes(all, { name: 'search' }, { query: 'cafe NOON' })),
        searchLabel: names(query.selectNotes(all, { name: 'search' }, { query: 'work' })),
      };
    });
    expect(r.notes).toEqual(['Café plans', 'Starred']);
    expect(r.archive).toEqual(['Archived']);
    expect(r.trash).toEqual(['Trashed']);
    expect(r.fav).toEqual(['Starred']);
    expect(r.label).toEqual(['Café plans']);
    expect(r.nb).toEqual(['Starred']);
    expect(r.search).toEqual(['Café plans']);
    expect(r.searchLabel).toEqual(['Café plans']);
  });

  test('masonry puts each card in the shortest column', async ({ u }) => {
    const r = await u.evaluate(() => window.__units.masonry.computeLayout(['a', 'b', 'c', 'd'], { a: 100, b: 40, c: 30, d: 10 }, 2, 208));
    expect(r.pos.a).toMatchObject({ x: 0, y: 0, w: 100 });
    expect(r.pos.b).toMatchObject({ x: 108, y: 0 });
    expect(r.pos.c).toMatchObject({ x: 108, y: 48 });
    expect(r.pos.d).toMatchObject({ x: 108, y: 86 });
    expect(await u.evaluate(() => [300, 400, 600, 900, 1200].map((w) => window.__units.masonry.columnsFor(w, 'grid')))).toEqual([2, 2, 3, 4, 5]);
    // Android's font size setting: a phone keeps two columns at 130%, one at 150% and more
    expect(await u.evaluate(() => [1, 1.3, 1.5, 2].map((s) => window.__units.masonry.columnsFor(384, 'grid', s)))).toEqual([2, 2, 1, 1]);
  });

  test('emoji shortcodes like Discord', async ({ u }) => {
    const r = await u.evaluate(() => ({ smile: window.__units.emoji.emojiForCode('smile'), heart: window.__units.emoji.emojiForCode('heart'), list: window.__units.emoji.searchEmoji('thumbs').map((x) => x.emoji), short: window.__units.emoji.searchEmoji('t') }));
    expect(r.smile).toBe('😄');
    expect(r.heart).toBe('❤️');
    expect(r.list).toContain('👍');
    expect(r.short).toEqual([]);
  });

  test('drawings keep their strokes inside the SVG', async ({ u }) => {
    const r = await u.evaluate(() => {
      const d = window.__units.drawing;
      const strokes = [{ tool: 'pen', color: '#1d1f24', size: 6, pen: false, points: [[10, 10, 0.5], [20, 20, 0.5], [30, 25, 0.5], [40, 40, 0.5]] }];
      const svg = d.drawingToSvg(strokes, 300, 200);
      return { svg, back: d.parseDrawing(svg) };
    });
    expect(r.svg).toContain('viewBox="0 0 300 200"');
    expect(r.svg).toContain('<path d="M');
    expect(r.back.strokes.length).toBe(1);
    expect(r.back.w).toBe(300);
  });

  test('a drawing made on top of a picture keeps the picture inside the SVG', async ({ u }) => {
    const r = await u.evaluate(() => {
      const d = window.__units.drawing;
      const strokes = [{ tool: 'marker', color: '#e5484d', size: 6, pen: false, points: [[5, 5, 0.5], [50, 60, 0.5], [70, 65, 0.5], [90, 90, 0.5]] }];
      const bg = { href: 'data:image/png;base64,iVBORw0KGgo=', w: 300, h: 150 };
      const svg = d.drawingToSvg(strokes, 300, 200, bg);
      return { svg, back: d.parseDrawing(svg), plain: d.parseDrawing(d.drawingToSvg(strokes, 300, 200)) };
    });
    expect(r.svg).toContain('<image href="data:image/png;base64,iVBORw0KGgo="');
    expect(r.back.bg).toEqual({ href: 'data:image/png;base64,iVBORw0KGgo=', w: 300, h: 150 });
    expect(r.back.strokes[0].tool).toBe('marker');
    expect(r.plain.bg).toBeUndefined();
  });

  test('dates read naturally', async ({ u }) => {
    const r = await u.evaluate(() => {
      const f = window.__units.format;
      const now = new Date(2026, 9, 18, 12, 0);
      return {
        today: f.reminderLabel(new Date(2026, 9, 18, 18, 0).getTime(), now),
        tomorrow: f.reminderLabel(new Date(2026, 9, 19, 8, 0).getTime(), now),
        weekday: f.reminderLabel(new Date(2026, 9, 21, 8, 0).getTime(), now),
        edited: f.editedLabel(new Date(2026, 9, 17, 9, 0).toISOString(), now),
        bytes: [f.formatBytes(512), f.formatBytes(2048), f.formatBytes(5 * 1024 * 1024)],
      };
    });
    expect(r.today).toBe('Today, 6:00 PM');
    expect(r.tomorrow).toBe('Tomorrow, 8:00 AM');
    expect(r.weekday).toBe('Wed, 8:00 AM');
    expect(r.edited).toBe('Yesterday');
    expect(r.bytes).toEqual(['512 B', '2.0 KB', '5.0 MB']);
  });
});
