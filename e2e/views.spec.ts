import { expect, test, type Page } from '@playwright/test';
import {
  LAKES,
  mapCenter,
  shot,
  waitForMap,
  waitForMapIdle,
  waitForScene,
  watchConsole,
} from './helpers';

const VIEWS = [
  { key: 'raised', label: 'Terrain' },
  { key: 'underwater', label: 'Underwater' },
  { key: 'section', label: 'Section' },
  { key: 'pollutants', label: 'Pollutants' },
] as const;

async function pick(page: Page, label: string) {
  await page.getByRole('radiogroup', { name: 'View' }).getByText(label, { exact: true }).click();
}

test.describe('3D views', () => {
  test('switches through all five views; each renders a canvas without console errors', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await waitForMap(page);
    await page.getByTestId('marker-lake-champlain').click();
    await expect(page.getByTestId('wb-name')).toHaveText('Lake Champlain');
    await waitForMapIdle(page);
    const before = await mapCenter(page);

    for (const v of VIEWS) {
      await pick(page, v.label);
      await waitForScene(page, v.key);
      await expect(page).toHaveURL(new RegExp(`view=${v.key}`));
      await expect(page.getByTestId('scene-summary')).not.toHaveText('Preparing the 3D scene…');
      await expect(page.getByTestId('modelled-badge')).toBeVisible();
      await expect(page.getByTestId('scene-badges').getByText('Demo data')).toBeVisible();
      await shot(page, `view-${v.key}-champlain`);
    }

    // Map button returns to the map at the same camera position.
    await pick(page, 'Map');
    await expect(page.getByTestId('scene-layer')).toHaveCount(0);
    const after = await mapCenter(page);
    expect(after.lng).toBeCloseTo(before.lng, 4);
    expect(after.lat).toBeCloseTo(before.lat, 4);
    expect(after.zoom).toBeCloseTo(before.zoom, 3);
    expect(errors).toEqual([]);
  });

  test('keys 1 to 5 switch views and Esc returns to the map', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/?wb=nhd:demo-lake-tahoe');
    await waitForMap(page);
    await expect(page.getByTestId('wb-name')).toHaveText('Lake Tahoe');
    await page.getByTestId('wb-name').click(); // focus the page without clicking the map
    const keys: Array<[string, string]> = [
      ['2', 'raised'],
      ['3', 'underwater'],
      ['4', 'section'],
      ['5', 'pollutants'],
    ];
    for (const [k, view] of keys) {
      await page.keyboard.press(k);
      await waitForScene(page, view);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('scene-layer')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Map' })).toBeChecked();
    await page.keyboard.press('3');
    await waitForScene(page, 'underwater');
    await page.keyboard.press('1');
    await expect(page.getByTestId('scene-layer')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Raised Terrain: exaggeration slider, auto reset, water toggle', async ({ page }) => {
    await page.goto(`/?wb=${LAKES.crater}&view=raised`);
    await waitForScene(page, 'raised');
    const value = page.getByTestId('exaggeration-value');
    const auto = await value.textContent();
    // Crater Lake is deep (594 m) relative to its block, so auto exaggeration is near the minimum.
    expect(Number.parseFloat(auto ?? '0')).toBeGreaterThanOrEqual(1);
    const slider = page.getByRole('slider', { name: 'Vertical exaggeration' });
    await slider.fill('12');
    await expect(value).toHaveText('12.0x');
    await expect(page.getByTestId('scene-canvas')).toHaveAttribute('data-exaggeration', '12.0');
    await page.getByRole('button', { name: 'Auto' }).click();
    await expect(value).toHaveText(auto ?? '');
    await page.getByRole('button', { name: 'Hide water' }).click();
    await expect(page.getByTestId('scene-canvas')).toHaveAttribute('data-water', 'false');
    await page.getByRole('button', { name: 'Show water' }).click();
    await expect(page.getByTestId('scene-canvas')).toHaveAttribute('data-water', 'true');
  });

  test('Cross-Section: DO overlay when a profile exists, a clear note when it does not', async ({
    page,
  }) => {
    await page.goto(`/?wb=${LAKES.champlain}&view=section`);
    await waitForScene(page, 'section');
    await expect(page.getByTestId('do-legend')).toContainText('below 2');
    await expect(page.getByTestId('thermocline-label')).toContainText('Thermocline');
    await expect(page.getByTestId('depth-tick').first()).toBeVisible();
    await expect(page.getByTestId('distance-tick').first()).toBeVisible();
    await page.getByRole('button', { name: 'Metres and kilometres' }).click();
    await expect(page.getByTestId('depth-tick').first()).toContainText('ft');
    await shot(page, 'view-section-do-profile');

    await page.goto(`/?wb=${LAKES.crater}&view=section`);
    await waitForScene(page, 'section');
    await expect(page.getByTestId('no-do-note')).toContainText('No depth profile measured');
    await expect(page.getByTestId('no-do-note')).toContainText('Surface dissolved oxygen');
    await expect(page.getByTestId('do-legend')).toHaveCount(0);
    await shot(page, 'view-section-no-profile-crater');
  });

  test('Pollutants: legend with thresholds; over-threshold flagged; empty volume message when nothing is measured', async ({
    page,
  }) => {
    await page.goto(`/?wb=${LAKES.erie}&view=pollutants`);
    await waitForScene(page, 'pollutants');
    const micro = page.getByTestId('pollutant-microcystins');
    await expect(micro).toContainText('Above screening reference');
    await expect(micro).toContainText('Threshold 8');
    await expect(page.getByTestId('listed-impairments')).toContainText(
      'listed impairment, no recent measurement',
    );
    await shot(page, 'view-pollutants-erie');

    // A waterbody with no pollutant measurements shows an empty, clear volume and says so.
    await page.route('**/api/waterbody/*/quality', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'empty',
          data: null,
          provenance: { source: 'test', url: '', retrievedAt: '2026-09-30T00:00:00Z' },
        }),
      }),
    );
    await page.goto(`/?wb=${LAKES.potomac}&view=pollutants`);
    await waitForScene(page, 'pollutants');
    await expect(page.getByTestId('no-pollutants')).toContainText('volume is shown empty');
    await expect(page.getByTestId('scene-canvas')).toHaveAttribute('data-pollutants', '0');
  });

  test('Underwater: species count, visibility from water clarity and the highlight chip', async ({
    page,
  }) => {
    await page.goto(`/?wb=${LAKES.tahoe}&view=underwater`);
    await waitForScene(page, 'underwater');
    const canvas = page.getByTestId('scene-canvas');
    await expect(canvas).toHaveAttribute('data-species', '12');
    const vis = Number(await canvas.getAttribute('data-visibility'));
    expect(vis).toBeGreaterThan(20); // Tahoe is very clear
    const animals = Number(await canvas.getAttribute('data-animals'));
    expect(animals).toBeGreaterThan(20);
    expect(animals).toBeLessThanOrEqual(250);
    await expect(page.getByTestId('scene-summary')).toHaveText(
      /12 species shown.*visibility about/,
    );
    await expect(page.getByRole('button', { name: 'Free swim' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByRole('button', { name: 'Free swim' }).click();
    await expect(page.getByRole('button', { name: 'Free swim' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Free swim' }).click();
    await shot(page, 'view-underwater-tahoe');

    await page.goto(`/?wb=${LAKES.erie}&view=underwater`);
    await waitForScene(page, 'underwater');
    const murky = Number(await page.getByTestId('scene-canvas').getAttribute('data-visibility'));
    expect(murky).toBeLessThan(3);
    expect(murky).toBeLessThan(vis);
  });

  test('rivers render in every view (Potomac uses the Area polygon path)', async ({ page }) => {
    const errors = watchConsole(page);
    for (const v of VIEWS) {
      await page.goto(`/?wb=${LAKES.potomac}&view=${v.key}`);
      await waitForScene(page, v.key);
    }
    await shot(page, 'view-pollutants-potomac');
    expect(errors).toEqual([]);
  });
});

test('hovering a fish shows its label card (common name, scientific name, native or introduced, records)', async ({
  page,
}) => {
  await page.goto(`/?wb=${LAKES.tahoe}&view=underwater&sp=Oncorhynchus%20nerka`);
  await waitForScene(page, 'underwater');
  let shown = false;
  for (let attempt = 0; attempt < 12 && !shown; attempt++) {
    const fish = await page.evaluate(
      () =>
        (
          window as unknown as {
            __wiFish?: Array<{ actor: number; x: number; y: number; dist: number }>;
          }
        ).__wiFish ?? [],
    );
    const target = fish.find((f) => f.dist < 40);
    if (target) {
      await page.mouse.move(target.x - 40, target.y - 40);
      await page.mouse.move(target.x, target.y, { steps: 3 });
      shown = await page
        .getByTestId('fish-card')
        .waitFor({ state: 'visible', timeout: 1500 })
        .then(() => true)
        .catch(() => false);
    }
    if (!shown) await page.waitForTimeout(400);
  }
  expect(shown).toBe(true);
  const card = page.getByTestId('fish-card');
  await expect(card).toContainText(/Introduced|Native/);
  await expect(card).toContainText(/records/);
  await expect(card.locator('.italic')).toHaveText(/^[A-Z][a-z]+ [a-z]+$/);
  await shot(page, 'view-underwater-fish-card');
});
