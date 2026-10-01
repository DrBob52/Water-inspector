import { expect, test } from '@playwright/test';
import { LAKES, shot, waitForScene, watchConsole } from './helpers';

test.describe('deep links and Life tab', () => {
  test('?wb=...&view=underwater restores state, including after a reload', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`/?wb=${LAKES.tahoe}&view=underwater`);
    await expect(page.getByTestId('wb-name')).toHaveText('Lake Tahoe');
    await expect(page.getByRole('radio', { name: 'Underwater' })).toBeChecked();
    await waitForScene(page, 'underwater');
    await page.reload();
    await expect(page.getByTestId('wb-name')).toHaveText('Lake Tahoe');
    await expect(page.getByRole('radio', { name: 'Underwater' })).toBeChecked();
    await waitForScene(page, 'underwater');
    await expect(page).toHaveURL(/wb=nhd:demo-lake-tahoe&view=underwater/);
    expect(errors).toEqual([]);
  });

  test('tab and species are part of the link too', async ({ page }) => {
    await page.goto(`/?wb=${LAKES.erie}&view=underwater&tab=life&sp=Sander%20vitreus`);
    await expect(page.getByRole('tab', { name: 'Life' })).toHaveAttribute('aria-selected', 'true');
    await waitForScene(page, 'underwater');
    await expect(page.getByTestId('highlight-chip')).toContainText('Highlighting Walleye');
  });

  test('an unknown waterbody id shows an error in the panel instead of a blank screen', async ({
    page,
  }) => {
    await page.goto('/?wb=nhd:demo-atlantis');
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('clicking a row in the Life tab opens Underwater with that species highlighted', async ({
    page,
  }) => {
    await page.goto(`/?wb=${LAKES.champlain}&tab=life`);
    await expect(page.getByTestId('species-row').first()).toBeVisible();
    const row = page.getByTestId('species-row').filter({ hasText: 'Smallmouth bass' });
    await row.click();
    await waitForScene(page, 'underwater');
    await expect(page.getByRole('radio', { name: 'Underwater' })).toBeChecked();
    await expect(page.getByTestId('highlight-chip')).toContainText('Highlighting Smallmouth bass');
    await expect(page).toHaveURL(/sp=Micropterus(%20|\+)dolomieu/);
    await shot(page, 'view-underwater-highlight');
    await page.getByRole('button', { name: 'Clear highlight' }).click();
    await expect(page.getByTestId('highlight-chip')).toHaveCount(0);
  });

  test('the Life tab filter shows only introduced species', async ({ page }) => {
    await page.goto(`/?wb=${LAKES.tahoe}&tab=life`);
    await expect(page.getByTestId('species-row').first()).toBeVisible();
    const all = await page.getByTestId('species-row').count();
    await page.getByLabel('Introduced only').check();
    const intro = await page.getByTestId('species-row').count();
    expect(intro).toBeGreaterThan(5);
    expect(intro).toBeLessThan(all + 1);
    for (const r of await page.getByTestId('species-row').all())
      await expect(r).toContainText('Introduced');
    await page.getByLabel('Sort by').selectOption('name');
    const first = await page.getByTestId('species-row').first().getAttribute('data-species');
    expect(first).toBeTruthy();
  });
});
