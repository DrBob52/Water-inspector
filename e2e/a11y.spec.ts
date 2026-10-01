import { expect, test } from '@playwright/test';
import { LAKES, waitForMap, waitForScene } from './helpers';

test.describe('accessibility and preferences', () => {
  test('view switcher is a radiogroup; tabs follow the tablist pattern with arrow keys', async ({
    page,
  }) => {
    await page.goto(`/?wb=${LAKES.crater}`);
    await expect(page.getByRole('radiogroup', { name: 'View' })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(5);
    await expect(page.getByRole('tablist')).toBeVisible();
    await page.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Water Quality' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Water Quality' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Sources' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });

  test('every status chip carries text, never colour alone', async ({ page }) => {
    await page.goto(`/?wb=${LAKES.potomac}&tab=quality`);
    await expect(page.getByTestId('param-e_coli')).toBeVisible();
    const chips = page.getByTestId('quality-list').locator('.chip');
    const n = await chips.count();
    expect(n).toBeGreaterThan(5);
    for (let i = 0; i < n; i++)
      expect(((await chips.nth(i).textContent()) ?? '').trim().length).toBeGreaterThan(3);
    await expect(page.getByTestId('param-e_coli')).toContainText('Above screening reference');
    await expect(page.getByTestId('param-pfos')).toContainText('Above screening reference');
  });

  test('each 3D view has a text alternative in the panel', async ({ page }) => {
    const expected: Record<string, RegExp> = {
      raised: /Raised terrain block around Lake Champlain.*max depth 122 m/,
      underwater: /\d+ species shown.*visibility about .*max depth 122 m.*modelled/,
      section: /Vertical slice along the longest axis.*dissolved oxygen profile/,
      pollutants: /measured pollutants shown as particles/,
    };
    for (const [view, re] of Object.entries(expected)) {
      await page.goto(`/?wb=${LAKES.champlain}&view=${view}`);
      await waitForScene(page, view);
      await expect(page.getByTestId('scene-summary')).toHaveText(re);
    }
  });

  test('prefers-reduced-motion is honoured by the scenes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const view of ['underwater', 'pollutants']) {
      await page.goto(`/?wb=${LAKES.erie}&view=${view}`);
      await waitForScene(page, view);
      await expect(page.getByTestId('scene-canvas')).toHaveAttribute('data-reduced-motion', 'true');
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`/?wb=${LAKES.erie}&view=underwater`);
    await waitForScene(page, 'underwater');
    await expect(page.getByTestId('scene-canvas')).toHaveAttribute('data-reduced-motion', 'false');
  });

  test('light and dark themes follow the system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`/?wb=${LAKES.crater}`);
    await waitForMap(page);
    const light = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid=inspector]')!).backgroundColor,
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid=inspector]')!).backgroundColor,
    );
    expect(light).not.toBe(dark);
    expect(light).toBe('rgb(255, 255, 255)');
  });

  test('units toggle persists and switches the panel to imperial', async ({ page }) => {
    await page.goto(`/?wb=${LAKES.tahoe}`);
    await expect(page.getByTestId('key-facts')).toContainText('501 m');
    await page.getByLabel('Unit system').selectOption('imperial');
    await expect(page.getByTestId('key-facts')).toContainText('1,644 ft');
    await page.reload();
    await expect(page.getByTestId('key-facts')).toContainText('1,644 ft');
  });

  test('the panel is collapsible and the skip link exists', async ({ page }) => {
    await page.goto(`/?wb=${LAKES.crater}`);
    await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main-panel');
    await page.getByRole('button', { name: 'Collapse panel' }).click();
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand panel' }).click();
    await expect(page.getByRole('tablist')).toBeVisible();
  });

  test('phone-width layout keeps the panel usable with no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(`/?wb=${LAKES.crater}`);
    await expect(page.getByTestId('wb-name')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page
      .getByRole('radiogroup', { name: 'View' })
      .getByText('Raised Terrain', { exact: true })
      .click();
    await waitForScene(page, 'raised');
  });
});

test.describe('WebGL unavailable', () => {
  test('shows the Inspector panel only, with a message', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
        return (orig as (t: string, ...r: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto('/');
    await expect(page.getByTestId('no-webgl')).toContainText('WebGL is not available');
    await page.getByRole('button', { name: 'Open Crater Lake' }).click();
    await expect(page.getByTestId('wb-name')).toHaveText('Crater Lake');
    await expect(page.getByTestId('no-webgl-note')).toContainText('3D views are unavailable');
    await expect(page.getByRole('radiogroup', { name: 'View' })).toHaveCount(0);
    await expect(page.getByTestId('key-facts')).toContainText('594 m');
    await page.keyboard.press('3');
    await expect(page.getByTestId('scene-layer')).toHaveCount(0);
  });
});
