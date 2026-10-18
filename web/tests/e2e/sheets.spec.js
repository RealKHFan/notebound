// Bottom sheets: no keyboard underneath, and they can be pulled down to close.
import { test, expect, seedNote, hostEvent } from './fixtures.js';

const editor = (page) => page.locator('.nb-editor-content');

/**
 * A finger on the touch screen: press, move in steps over `ms`, lift.
 * Each event carries its own time, like on a phone, so the speed of the
 * gesture does not depend on how fast this machine delivers the events.
 */
async function swipe(page, from, to, { steps = 10, ms = 160 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now() / 1000;
  const at = (i) => t0 + (ms / 1000) * (i / steps);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }], timestamp: at(0) });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }], timestamp: at(i) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: at(steps) + 0.005 });
  await cdp.detach();
}

async function openNoteAndType(app, srv) {
  seedNote(srv, { title: 'Groceries', html: '<p>milk</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Groceries' }).click();
  await editor(app).locator('p', { hasText: 'milk' }).click();
  await expect(editor(app)).toBeFocused();
}

test('opening the + sheet closes the keyboard, and adding a block brings it back', async ({ app, srv }) => {
  await openNoteAndType(app, srv);
  await app.getByRole('button', { name: 'Insert', exact: true }).click();
  const sheet = app.getByRole('dialog', { name: 'Add to note' });
  await expect(sheet).toBeVisible();
  // nothing is focused for typing, so Android hides the keyboard and the cursor handle
  expect(await app.evaluate(() => document.activeElement === document.body || !document.activeElement.isContentEditable)).toBe(true);
  await expect(editor(app)).not.toBeFocused();
  await sheet.getByRole('button', { name: 'Table' }).click();
  await expect(editor(app).locator('table')).toHaveCount(1);
  await expect(editor(app)).toBeFocused();
});

test('every sheet opened while typing closes the keyboard first', async ({ app, srv }) => {
  await openNoteAndType(app, srv);
  await app.getByRole('button', { name: 'More options' }).click();
  await expect(app.getByRole('dialog')).toBeVisible();
  await expect(editor(app)).not.toBeFocused();
});

test('pulling a sheet down closes it, a short pull lets it spring back', async ({ app, srv }) => {
  await openNoteAndType(app, srv);
  await app.getByRole('button', { name: 'Insert', exact: true }).click();
  const sheet = app.locator('.sheet');
  await expect(sheet).toBeVisible();
  await app.waitForTimeout(350); // let it finish sliding in
  const box = await sheet.boundingBox();
  const grip = { x: box.x + box.width / 2, y: box.y + 10 };

  // a short, slow pull: the sheet follows, then goes back up
  await swipe(app, grip, { x: grip.x, y: grip.y + 60 }, { steps: 12, ms: 600 });
  await app.waitForTimeout(400);
  await expect(sheet).toBeVisible();
  expect(Math.round((await sheet.boundingBox()).y)).toBe(Math.round(box.y));

  // a long pull closes it
  await swipe(app, grip, { x: grip.x, y: grip.y + box.height * 0.6 });
  await expect(app.locator('.sheet-root')).toHaveCount(0);
  // the note is still open and nothing was inserted
  await expect(editor(app)).toContainText('milk');
  await expect(editor(app).locator('table, pre, hr')).toHaveCount(0);
});

test('a quick flick down from the middle of the sheet closes it without pressing a button', async ({ app, srv }) => {
  await openNoteAndType(app, srv);
  await app.getByRole('button', { name: 'Insert', exact: true }).click();
  await app.waitForTimeout(350);
  const tile = app.getByRole('dialog', { name: 'Add to note' }).getByRole('button', { name: 'Divider' });
  const t = await tile.boundingBox();
  const from = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  await swipe(app, from, { x: from.x, y: from.y + 90 }, { steps: 4, ms: 60 });
  await expect(app.locator('.sheet-root')).toHaveCount(0);
  await expect(editor(app).locator('hr')).toHaveCount(0);
});

test('a sheet slides away when closed, and taps already reach the page behind it', async ({ app, srv }) => {
  seedNote(srv, { title: 'One', html: '<p>1</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'One' }).click({ delay: 600 });
  await app.getByRole('button', { name: 'More', exact: true }).click();
  await expect(app.getByRole('dialog')).toBeVisible();
  await hostEvent(app, 'back');
  // still on screen for a moment while it slides out, but no longer in the way
  await expect(app.locator('.sheet-root.closing')).toHaveCount(1);
  await expect(app.getByRole('dialog')).toHaveCount(0);
  await expect(app.locator('.sheet-root')).toHaveCount(0);
  // the selection is still there (back closed only the sheet)
  await expect(app.locator('.card.selected')).toHaveCount(1);
});

test('lists inside a sheet still scroll; a pull only closes it from the top', async ({ app, srv }) => {
  // the labels sheet with many labels is long enough to scroll
  for (let i = 0; i < 30; i++) seedNote(srv, { title: `N${i}`, html: '<p>x</p>', labels: [`label ${String(i).padStart(2, '0')}`] });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.getByRole('button', { name: 'N0', exact: true }).click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Labels' }).click();
  const body = app.locator('.sheet-body');
  await expect(body).toBeVisible();
  await app.waitForTimeout(350);
  const b = await body.boundingBox();
  // finger moves up: the list scrolls, the sheet stays
  await swipe(app, { x: b.x + b.width / 2, y: b.y + b.height - 40 }, { x: b.x + b.width / 2, y: b.y + 60 }, { steps: 10, ms: 200 });
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
  await expect(app.locator('.sheet-root')).toHaveCount(1);
  // finger moves down while the list is scrolled: it scrolls back, the sheet stays
  await swipe(app, { x: b.x + b.width / 2, y: b.y + 60 }, { x: b.x + b.width / 2, y: b.y + 200 }, { steps: 10, ms: 200 });
  await expect(app.locator('.sheet-root:not(.closing)')).toHaveCount(1);
});
