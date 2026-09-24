const { test, expect, TODAY, NOW, day } = require('./fixtures');

// Two Kenna windows on the same device share its storage: a box in one
// follows what's saved in the other, and never saves over it unasked.

/** A second Kenna window, open at `hash`, with the test clock. */
async function secondWindow(context, appURL, hash) {
  const other = await context.newPage();
  await other.clock.setFixedTime(NOW);
  other.on('dialog', (d) => {
    throw new Error(`Unexpected native dialog: ${d.message()}`);
  });
  await other.goto(`${appURL}/${hash}`);
  return other;
}

/** The page is hidden (another app or tab is switched to), then comes back. */
async function hideAndReturn(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
}

const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('kenna:entries') || '{}'));

test.describe('a meal saved in another window', () => {
  const exits = {
    'the page is hidden': async (b) => hideAndReturn(b),
    'the page is closed': async (b) => {
      const closed = new Promise((resolve) => b.once('close', resolve));
      await b.close({ runBeforeUnload: true });
      await closed;
    },
    'another meal is picked': async (b) => {
      await b.locator('[data-meal="dinner"]').click();
      await expect(b.getByLabel('Dinner calories')).toBeVisible();
    },
  };
  for (const [how, leave] of Object.entries(exits)) {
    test(`shows in a box nobody typed in, and stays saved when ${how}`, async ({ page, appURL, context }) => {
      const b = await secondWindow(context, appURL, '#/log');
      const bBox = b.getByLabel('Breakfast calories');
      await bBox.focus();
      await page.goto(`${appURL}/#/log/breakfast`);
      await page.getByLabel('Breakfast calories').fill('450');
      await page.getByLabel('Breakfast calories').blur();
      await expect(page.getByText('Breakfast saved')).toBeVisible();

      await expect(bBox).toHaveValue('450');
      await expect(b.locator('[data-meal="breakfast"]')).toContainText('450');
      await expect(b.locator('.running-total')).toHaveText('Day total: 450 cal');
      await expect(b.getByText('Breakfast changed to 450 cal in another window')).toBeVisible();

      await leave(b);
      if (!b.isClosed()) await expect(b.locator('[data-meal="breakfast"]')).toContainText('450');
      await page.waitForTimeout(100);
      expect((await stored(page))[TODAY].meals.breakfast).toBe(450);
    });
  }

  test('a number typed over it is not saved without asking', async ({ page, appURL, context }) => {
    const b = await secondWindow(context, appURL, '#/log/breakfast');
    const bBox = b.getByLabel('Breakfast calories');
    await bBox.fill('500');
    await page.goto(`${appURL}/#/log/breakfast`);
    await page.getByLabel('Breakfast calories').fill('450');
    await page.getByLabel('Breakfast calories').blur();

    // Said at once in the other window, with the typed number left as it is.
    await expect(b.getByText('Not saved yet. Breakfast was changed to 450 cal in another window.')).toBeVisible();
    await expect(bBox).toHaveValue('500');

    // Hidden: nothing is saved over it.
    await hideAndReturn(b);
    await b.waitForTimeout(100);
    expect((await stored(page))[TODAY].meals.breakfast).toBe(450);
    await expect(bBox).toHaveValue('500');

    // Leaving the box asks which to keep; Keep 450 puts it in the box.
    await bBox.blur();
    const question = b.getByRole('dialog', { name: 'Breakfast was changed in another window' });
    await expect(question).toContainText("It's saved as 450 cal now. You typed 500 cal here.");
    await question.getByRole('button', { name: 'Keep 450 cal' }).click();
    await expect(bBox).toHaveValue('450');
    await expect(b.getByText('Kept 450 cal')).toBeVisible();
    expect((await stored(page))[TODAY].meals.breakfast).toBe(450);
  });

  test('saving over it, when asked, saves the number typed', async ({ page, appURL, context }) => {
    const b = await secondWindow(context, appURL, '#/log/breakfast');
    const bBox = b.getByLabel('Breakfast calories');
    await bBox.fill('500');
    await page.goto(`${appURL}/#/log/breakfast`);
    await page.getByLabel('Breakfast calories').fill('450');
    await page.getByLabel('Breakfast calories').blur();
    await expect(b.getByText('Not saved yet. Breakfast was changed to 450 cal in another window.')).toBeVisible();

    // Picking another meal asks first, then moves on.
    await b.locator('[data-meal="dinner"]').click();
    await b.getByRole('dialog').getByRole('button', { name: 'Save 500 cal' }).click();
    await expect(b.getByLabel('Dinner calories')).toBeVisible();
    await expect.poll(async () => (await stored(page))[TODAY].meals.breakfast).toBe(500);
    await expect(page.getByLabel('Breakfast calories')).toHaveValue('500');
  });

  test('closing the window keeps the number typed over it, and asks on the next visit', async ({ page, appURL, context }) => {
    const b = await secondWindow(context, appURL, '#/log/breakfast');
    await b.getByLabel('Breakfast calories').fill('500');
    await page.goto(`${appURL}/#/log/breakfast`);
    await page.getByLabel('Breakfast calories').fill('450');
    await page.getByLabel('Breakfast calories').blur();
    await expect(b.getByText('Not saved yet. Breakfast was changed to 450 cal in another window.')).toBeVisible();
    // Sent to the background, then closed there.
    await b.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await b.close({ runBeforeUnload: true });
    expect((await stored(page))[TODAY].meals.breakfast).toBe(450);

    // This window being switched away from and back leaves the number the
    // other one kept where it is.
    await page.evaluate(() => {
      for (const state of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });
    await expect(page.getByLabel('Breakfast calories')).toHaveValue('450');

    // Kenna opened again.
    await page.goto(`${appURL}/#/`);
    await page.reload();
    await expect(page.locator('[data-meal="breakfast"]')).toContainText('500 cal not saved yet');
    await page.locator('[data-meal="breakfast"] a').click();
    const question = page.getByRole('dialog', { name: 'Breakfast was changed' });
    await expect(question).toContainText("It's saved as 450 cal now. You typed 500 cal here.");
    await question.getByRole('button', { name: 'Keep 450 cal' }).click();
    await expect(page.getByLabel('Breakfast calories')).toHaveValue('450');
    expect((await stored(page))[TODAY].meals.breakfast).toBe(450);
  });

  test('leaving the screen keeps the number typed over it, with a way back', async ({ page, appURL, context }) => {
    const b = await secondWindow(context, appURL, '#/log/breakfast');
    await b.getByLabel('Breakfast calories').fill('500');
    await page.goto(`${appURL}/#/log/breakfast`);
    await page.getByLabel('Breakfast calories').fill('450');
    await page.getByLabel('Breakfast calories').blur();
    await expect(b.getByText('Not saved yet. Breakfast was changed to 450 cal in another window.')).toBeVisible();

    await b.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click();
    await expect(b.getByRole('status').filter({ hasText: 'Breakfast not saved (“500”). Breakfast was changed to 450 cal in another window.' })).toBeVisible();
    expect((await stored(page))[TODAY].meals.breakfast).toBe(450);
  });

  test('a meal cleared in another window empties a box nobody typed in', async ({ page, appURL, context, data }) => {
    await data.seed({ [TODAY]: day(TODAY, { breakfast: 300, lunch: 600 }) });
    const b = await secondWindow(context, appURL, '#/log/breakfast');
    await expect(b.getByLabel('Breakfast calories')).toHaveValue('300');
    await page.goto(`${appURL}/#/log/breakfast`);
    await page.getByLabel('Breakfast calories').fill('');
    await page.getByLabel('Breakfast calories').blur();
    await expect(b.getByLabel('Breakfast calories')).toHaveValue('');
    await expect(b.getByText('Breakfast cleared in another window')).toBeVisible();
    await hideAndReturn(b);
    await b.waitForTimeout(100);
    expect((await stored(page))[TODAY].meals).toMatchObject({ breakfast: null, lunch: 600 });
  });
});

test.describe('a weight saved in another window', () => {
  test('shows in a box nobody typed in, and stays saved when the page is hidden', async ({ page, appURL, context }) => {
    const b = await secondWindow(context, appURL, '#/');
    const bBox = b.getByLabel('Weight (lbs)');
    await bBox.focus();
    await page.goto(appURL);
    await page.getByLabel('Weight (lbs)').fill('181.2');
    await page.getByLabel('Weight (lbs)').blur();
    await expect(bBox).toHaveValue('181.2');
    await hideAndReturn(b);
    await b.waitForTimeout(100);
    expect((await stored(page))[TODAY].weight).toBe(181.2);
  });

  test('a weight typed over it asks which to keep', async ({ page, appURL, context }) => {
    const b = await secondWindow(context, appURL, '#/');
    const bBox = b.getByLabel('Weight (lbs)');
    await bBox.fill('182');
    await page.goto(appURL);
    await page.getByLabel('Weight (lbs)').fill('181.2');
    await page.getByLabel('Weight (lbs)').blur();
    await expect(b.getByText('Not saved yet. Weight was changed to 181.2 lbs in another window.')).toBeVisible();
    await hideAndReturn(b);
    await b.waitForTimeout(100);
    expect((await stored(page))[TODAY].weight).toBe(181.2);

    await bBox.press('Enter');
    await b.getByRole('dialog', { name: 'Weight was changed in another window' }).getByRole('button', { name: 'Save 182 lbs' }).click();
    await expect.poll(async () => (await stored(page))[TODAY].weight).toBe(182);
    await expect(b.getByText('Saved', { exact: true })).toBeVisible();
  });

  test('the status line offers the saved weight instead', async ({ page, appURL, context }) => {
    const b = await secondWindow(context, appURL, '#/');
    const bBox = b.getByLabel('Weight (lbs)');
    await bBox.fill('182');
    await page.goto(appURL);
    await page.getByLabel('Weight (lbs)').fill('181.2');
    await page.getByLabel('Weight (lbs)').blur();
    await b.getByRole('button', { name: 'Use 181.2 lbs' }).click();
    await expect(bBox).toHaveValue('181.2');
    await hideAndReturn(b);
    await b.waitForTimeout(100);
    expect((await stored(page))[TODAY].weight).toBe(181.2);
  });
});
