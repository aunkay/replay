import { test, expect, savedSession } from './helpers/workspace';
for (const server of [false, true])
  test(`checkpoint retries exact account state ${server ? 'in a new server session' : 'in browser'} across reload`, async ({
    page,
    isMobile,
  }) => {
    await page.goto('/');
    const initial = await savedSession(page);
    const open = () =>
      page
        .getByRole('button', { name: 'Practice & research', exact: true })
        .click();
    const close = () =>
      page.getByRole('button', { name: 'Close practice workspace' }).click();
    await open();
    if (server) {
      await page
        .getByLabel('Session name', { exact: true })
        .fill(`Checkpoint run ${Date.now()}`);
      await page.getByRole('button', { name: 'Save as new session' }).click();
      await expect(page.locator('.server-save-status')).toContainText(
        'Saved on server',
      );
    }
    await page
      .getByLabel('Checkpoint name', { exact: true })
      .fill('Before entry');
    await page
      .getByRole('button', { name: 'Save checkpoint', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Checkpoint saved.' }),
    ).toBeVisible();
    const originalServer = await page.evaluate(() =>
      localStorage.getItem('replay-server-session'),
    );
    await close();
    if (isMobile)
      await page
        .getByRole('button', { name: 'Go to order ticket', exact: true })
        .click();
    await page.getByRole('button', { name: /^Buy AAPL/ }).click();
    if (server)
      await expect
        .poll(async () => {
          const id = await page.evaluate(() =>
            localStorage.getItem('replay-server-session'),
          );
          return (await (await page.request.get(`/api/sessions/${id}`)).json())
            .payload.session.account.position.quantity;
        })
        .toBeGreaterThan(0);
    else
      await expect
        .poll(async () => (await savedSession(page)).account.position.quantity)
        .toBeGreaterThan(0);
    await page
      .getByRole('button', {
        name: isMobile ? 'Next candle from mobile toolbar' : 'Next candle',
        exact: true,
      })
      .click();
    await page.reload();
    await open();
    await page
      .getByRole('button', { name: 'Restore checkpoint', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Checkpoint restored.' }),
    ).toBeVisible();
    const restored = await savedSession(page);
    expect(restored.cursor).toBe(initial.cursor);
    expect(restored.account).toEqual(initial.account);
    if (server) {
      const retryId = await page.evaluate(() =>
        localStorage.getItem('replay-server-session'),
      );
      expect(retryId).not.toBe(originalServer);
      const original = await (
        await page.request.get(`/api/sessions/${originalServer}`)
      ).json();
      expect(
        original.payload.session.account.position.quantity,
      ).toBeGreaterThan(0);
    }
    await page
      .getByRole('button', { name: 'Delete checkpoint', exact: true })
      .click();
    await expect(
      page.getByText('No checkpoints yet.', { exact: false }),
    ).toBeVisible();
  });
