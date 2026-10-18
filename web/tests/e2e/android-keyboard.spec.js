// Android keyboards "compose" words and often send a finished word together
// with the space after it. These tests replay that through Chromium's IME
// emulation, so the typing shortcuts are checked the way a phone sends them.
import { test, expect } from './fixtures.js';

const CASES = [
  ['**bold** ', '<strong>bold</strong>'],
  ['*ital* ', '<em>ital</em>'],
  ['_also_ ', '<em>also</em>'],
  ['__under__ ', '<u>under</u>'],
  ['~~gone~~ ', '<s>gone</s>'],
  ['||secret|| ', 'class="spoiler"'],
  ['`code` ', '<code>code</code>'],
  ['==mark== ', '<mark>mark</mark>'],
  [':smile: ', '😄'],
  ['[site](https://example.com) ', 'href="https://example.com"'],
  ['\n# Head', '<h1>Head</h1>'],
  ['\n## Sub', '<h2>Sub</h2>'],
  ['\n-# small', 'class="nb-small"'],
  // a list item ends with Enter; the next line's Enter on the empty item leaves the list
  ['\n- item\n', '<ul><li><p>item</p></li></ul>'],
  ['\n1. one\n', '<ol><li><p>one</p></li></ol>'],
  ['\n[] task\n', '<p>task</p></div></li></ul>'],
  ['\n> quoted', '<blockquote><p>quoted</p></blockquote>'],
];

// G: letters composed, symbols sent on their own (Gboard-like).
// S: everything up to a space composed, then the space sent separately.
// C: everything up to a space composed and sent together with the space.
async function imeType(page, cdp, text, style) {
  let word = '';
  const inWord = (c) => (style === 'G' ? /[\p{L}\p{N}]/u.test(c) : c !== ' ' && c !== '\n');
  for (const c of text) {
    if (inWord(c)) {
      word += c;
      await cdp.send('Input.imeSetComposition', { text: word, selectionStart: word.length, selectionEnd: word.length });
      continue;
    }
    if (word && style === 'C' && c === ' ') { await cdp.send('Input.insertText', { text: word + ' ' }); word = ''; continue; }
    if (word) { await cdp.send('Input.insertText', { text: word }); word = ''; }
    if (c === '\n') await page.keyboard.press('Enter');
    else await cdp.send('Input.insertText', { text: c });
  }
  if (word) await cdp.send('Input.insertText', { text: word });
}

for (const style of ['G', 'S', 'C']) {
  test(`typing shortcuts work with an Android-style keyboard (${style})`, async ({ app, page }) => {
    const cdp = await page.context().newCDPSession(page);
    const editor = app.locator('.nb-editor-content');
    await app.getByRole('button', { name: 'New note', exact: true }).click();
    await expect(editor).toBeFocused();
    for (const [input] of CASES) await imeType(app, cdp, input, style);
    for (const [input, expected] of CASES) {
      await expect.poll(() => editor.innerHTML(), { message: `${JSON.stringify(input)} -> ${expected}` }).toContain(expected);
    }
    const html = await editor.innerHTML();
    for (const literal of ['**', '__', '||', '~~', '==', ':smile:', '-#', '[site]']) expect(html).not.toContain(literal);
  });
}
