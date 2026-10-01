import { expect, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCREENSHOT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'docs',
  'screenshots',
);
mkdirSync(SCREENSHOT_DIR, { recursive: true });

export const LAKES = {
  champlain: 'nhd:demo-lake-champlain',
  tahoe: 'nhd:demo-lake-tahoe',
  crater: 'nhd:demo-crater-lake',
  erie: 'nhd:demo-lake-erie-western-basin',
  onondaga: 'nhd:demo-onondaga-lake',
  potomac: 'nhd:demo-potomac-river-dc',
} as const;

/** Collects console errors and uncaught exceptions so tests can assert there are none. */
export function watchConsole(page: Page) {
  const errors: string[] = [];
  const onConsole = (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return errors;
}

export async function waitForMap(page: Page) {
  await expect(page.getByTestId('map-layer')).toHaveAttribute('data-loaded', 'true');
}

export async function waitForScene(page: Page, view: string) {
  const canvasWrap = page.getByTestId('scene-canvas');
  await expect(canvasWrap).toHaveAttribute('data-view', view);
  await expect(canvasWrap.locator('canvas')).toBeVisible();
  await expect(canvasWrap).toHaveAttribute('data-scene-ready', 'true');
  // let a few frames settle so screenshots show the scene
  await page.waitForTimeout(1500);
}

/** Wait for any camera animation (fitBounds, flyTo) to finish. */
export async function waitForMapIdle(page: Page) {
  await page.waitForFunction(() => {
    const m = (window as unknown as { __wiMap?: { isMoving: () => boolean } }).__wiMap;
    return !!m && !m.isMoving();
  });
  await page.waitForTimeout(300);
}

export async function mapCenter(page: Page): Promise<{ lng: number; lat: number; zoom: number }> {
  return page.evaluate(() => {
    const m = (
      window as unknown as {
        __wiMap: { getCenter: () => { lng: number; lat: number }; getZoom: () => number };
      }
    ).__wiMap;
    const c = m.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: m.getZoom() };
  });
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });
}
