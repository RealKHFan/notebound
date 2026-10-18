import { test, expect, noteFiles, readNoteByTitle, metaOf, waitForSave } from './fixtures.js';

test.describe('first run', () => {
  test.use({ srvOptions: { hasFolder: false } });
  test('onboarding picks a folder and creates the vault layout', async ({ app, srv }) => {
    await expect(app.getByRole('heading', { name: 'Your notes, in a folder you own' })).toBeVisible();
    await app.getByRole('button', { name: 'Choose folder' }).click();
    await expect(app.getByRole('button', { name: 'Search your notes' })).toBeVisible();
    expect(srv.listVault('').sort()).toEqual(['attachments', 'history', 'notebound.json', 'notes']);
    const conf = JSON.parse(srv.readVault('notebound.json'));
    expect(conf.format).toBe('notebound');
    expect(conf.settings.theme).toBe('system');
  });
});

test('create a text note and it is saved as an html file', async ({ app, srv }) => {
  await app.getByRole('button', { name: 'New note' }).click();
  await app.getByRole('textbox', { name: 'Title' }).fill('Shopping list');
  await app.locator('.nb-editor-content').click();
  await app.keyboard.type('Milk and bread');
  await expect.poll(() => readNoteByTitle(srv, 'Shopping list') || '').toContain('<p>Milk and bread</p>');
  const files = noteFiles(srv);
  expect(files.length).toBe(1);
  expect(files[0]).toMatch(/^Shopping list_[a-z0-9]{8}\.html$/);
  const html = readNoteByTitle(srv, 'Shopping list');
  expect(html).toContain('<title>Shopping list</title>');
  expect(html).toContain('<p>Milk and bread</p>');
  expect(metaOf(html).color).toBe('default');
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(app.locator('.card-title', { hasText: 'Shopping list' })).toBeVisible();
});
