import { expect, test } from '@playwright/test';
import { mapCenter, shot, waitForMap, watchConsole } from './helpers';

test.describe('explore and inspect', () => {
  test('loads the tilted demo map with six markers, opens Lake Champlain and shows all five tabs', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await waitForMap(page);
    await expect(page.getByTestId('demo-banner')).toContainText(
      'Illustrative sample data, not live measurements',
    );
    for (const slug of [
      'lake-champlain',
      'lake-tahoe',
      'crater-lake',
      'lake-erie-western-basin',
      'onondaga-lake',
      'potomac-river-dc',
    ]) {
      await expect(page.getByTestId(`marker-${slug}`)).toBeVisible();
    }
    const pitch = await page.evaluate(() =>
      (window as unknown as { __wiMap: { getPitch: () => number } }).__wiMap.getPitch(),
    );
    expect(pitch).toBeGreaterThan(30);
    await shot(page, '01-map-overview');

    await page.getByTestId('marker-lake-champlain').click();
    await expect(page.getByTestId('wb-name')).toHaveText('Lake Champlain');
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(5);
    await expect(tabs).toHaveText(['Overview', 'Quality', 'Pollution', 'Life', 'Sources']);
    await expect(page.getByTestId('inspector').getByText('Demo data').first()).toBeVisible();
    await expect(page.getByTestId('demo-note')).toHaveText(
      'Illustrative sample data, not live measurements.',
    );
    await expect(page.getByTestId('key-facts')).toContainText('122 m');
    await expect(page.getByTestId('impairment-headline')).toContainText(
      'Listed as impaired for: phosphorus',
    );
    await expect(page).toHaveURL(/wb=nhd:demo-lake-champlain/);
    await page.waitForTimeout(1500);
    await shot(page, '02-map-inspector-overview');
    expect(errors).toEqual([]);
  });

  test('every tab loads its own content', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/?wb=nhd:demo-lake-champlain');
    await expect(page.getByTestId('wb-name')).toHaveText('Lake Champlain');

    await page.getByRole('tab', { name: 'Quality' }).click();
    await expect(page.getByTestId('param-water_temp')).toContainText('Water temperature');
    await expect(page.getByTestId('param-ph')).toContainText('Within screening reference');
    await expect(page.getByText(/Not measured here/)).toBeVisible();
    await shot(page, '03-tab-water-quality');

    await page.getByRole('tab', { name: 'Pollution' }).click();
    await expect(page.getByTestId('uses-list')).toContainText('Fish consumption');
    await expect(page.getByTestId('uses-list')).toContainText('Not supporting');
    await expect(page.getByText('TMDL').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Life' }).click();
    await expect(page.getByTestId('life-group-fish')).toBeVisible();
    await expect(page.getByTestId('life-group-lamprey')).toBeVisible();
    await expect(page.getByTestId('species-row').first()).toContainText('Yellow perch');
    await expect(page.getByText('Introduced').first()).toBeVisible();
    await shot(page, '04-tab-life');

    await page.getByRole('tab', { name: 'Sources' }).click();
    const rows = page.getByTestId('source-row');
    expect(await rows.count()).toBeGreaterThanOrEqual(7);
    await expect(page.getByTestId('sources-table')).toContainText('Water Quality Portal');
    await expect(
      page.getByText(/may be sparse or old|may be sparse, old or missing/),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('clicking the lake on the map resolves it; clicking elsewhere says live data is off', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForMap(page);
    // Click inside the Tahoe outline (projected from lon/lat).
    await page.evaluate(() =>
      (window as unknown as { __wiMap: { jumpTo: (o: object) => void } }).__wiMap.jumpTo({
        center: [-120.03, 39.07],
        zoom: 9,
        pitch: 0,
      }),
    );
    await page.waitForTimeout(1500);
    const pt = await page.evaluate(() => {
      const p = (
        window as unknown as {
          __wiMap: { project: (l: [number, number]) => { x: number; y: number } };
        }
      ).__wiMap.project([-120.03, 39.09]);
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(pt.x, pt.y);
    await expect(page.getByTestId('wb-name')).toHaveText('Lake Tahoe');

    await page.getByRole('button', { name: 'Close inspector' }).click();
    await expect(page.getByTestId('inspector')).toHaveCount(0);
    await page.mouse.click(120, 500);
    await expect(page.getByTestId('toast')).toHaveText('Live data is off in demo mode');
    await expect(page.getByTestId('inspector')).toHaveCount(0);
  });

  test('place search moves the camera', async ({ page }) => {
    await page.goto('/');
    await waitForMap(page);
    await page.getByRole('combobox', { name: 'Search for a place' }).fill('crater');
    await page.getByRole('option', { name: /Crater Lake/ }).click();
    await expect
      .poll(async () => (await mapCenter(page)).lat, { timeout: 15_000 })
      .toBeGreaterThan(42.8);
    const c = await mapCenter(page);
    expect(Math.abs(c.lng - -122.1)).toBeLessThan(0.3);
    expect(c.zoom).toBeGreaterThan(8);
  });

  test('a failing section shows its own error and does not blank the panel', async ({ page }) => {
    await page.route('**/api/waterbody/*/life', (r) =>
      r.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal', message: 'boom' }),
      }),
    );
    await page.goto('/?wb=nhd:demo-lake-tahoe&tab=life');
    await expect(page.getByRole('alert')).toContainText(/could not be loaded|unavailable/);
    await page.getByRole('tab', { name: 'Quality' }).click();
    await expect(page.getByTestId('param-water_temp')).toBeVisible();
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByTestId('key-facts')).toContainText('501 m');
  });
});
