// Many notes: the home screen and search must stay quick.
import { test, expect, seedNote, hostEvent } from './fixtures.js';

test('600 notes load, search and open quickly', async ({ app, srv, page }) => {
  test.setTimeout(90000);
  const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda omicron'.split(' ');
  for (let i = 0; i < 600; i++) {
    const w = words[i % words.length];
    const html = i % 3 === 0
      ? `<ul data-type="taskList">${Array.from({ length: 5 }, (_, k) => `<li data-type="taskItem" data-checked="${k % 2 === 0}"><p>${w} item ${k}</p></li>`).join('')}</ul>`
      : `<p>${(w + ' text ').repeat(20 + (i % 40))}</p>`;
    seedNote(srv, { title: `Note ${i} ${w}`, html, color: ['default', 'rose', 'mint', 'sky'][i % 4], pinned: i % 50 === 0, labels: i % 7 === 0 ? ['Seven'] : [] });
  }
  const t0 = Date.now();
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(app.locator('.card')).toHaveCount(600, { timeout: 30000 });
  const scanMs = Date.now() - t0;
  // second start uses the index cache
  await app.waitForTimeout(1600);
  const t1 = Date.now();
  await page.reload();
  await expect(app.locator('.card')).toHaveCount(600, { timeout: 30000 });
  const cachedMs = Date.now() - t1;
  const t2 = Date.now();
  await app.getByRole('button', { name: 'Search your notes' }).click();
  await app.getByRole('searchbox', { name: 'Search' }).fill('omicron');
  await expect(app.locator('.card')).toHaveCount(50);
  const searchMs = Date.now() - t2;
  const t3 = Date.now();
  await app.locator('.card').first().click();
  await expect(app.locator('.nb-editor-content')).toContainText('omicron');
  const openMs = Date.now() - t3;
  console.log(JSON.stringify({ scanMs, cachedMs, searchMs, openMs }));
  // Generous limits: they catch work that grows badly with the number of notes, not a slow test machine.
  expect(cachedMs).toBeLessThan(15000);
  expect(searchMs).toBeLessThan(8000);
  expect(openMs).toBeLessThan(6000);
});
