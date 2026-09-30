import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cache } from './cache';

describe('Cache', () => {
  it('expires entries after their TTL', () => {
    let t = 1000;
    const c = new Cache({ now: () => t });
    c.set('a', 1, 500);
    expect(c.get('a')).toBe(1);
    t += 499;
    expect(c.get('a')).toBe(1);
    t += 2;
    expect(c.get('a')).toBeUndefined();
  });
  it('evicts the least recently used entry', () => {
    const c = new Cache({ maxEntries: 2 });
    c.set('a', 1, 1e6);
    c.set('b', 2, 1e6);
    c.get('a'); // a is now most recent
    c.set('c', 3, 1e6);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
  });
  it('de-duplicates concurrent loads', async () => {
    const c = new Cache();
    let calls = 0;
    const load = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    };
    const [x, y, z] = await Promise.all([
      c.wrap('k', 1e6, load),
      c.wrap('k', 1e6, load),
      c.wrap('k', 1e6, load),
    ]);
    expect([x, y, z]).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
    await c.wrap('k', 1e6, load);
    expect(calls).toBe(1);
  });
  it('does not cache values rejected by shouldCache, and does not cache thrown errors', async () => {
    const c = new Cache();
    let n = 0;
    await c.wrap(
      'e',
      1e6,
      async () => ({ status: 'error', n: ++n }),
      (v) => v.status !== 'error',
    );
    await c.wrap(
      'e',
      1e6,
      async () => ({ status: 'error', n: ++n }),
      (v) => v.status !== 'error',
    );
    expect(n).toBe(2);
    await expect(c.wrap('t', 1e6, async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await c.wrap('t', 1e6, async () => 'ok')).toBe('ok');
  });
  it('persists to disk and reloads in a new instance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wi-cache-'));
    const a = new Cache({ dir });
    a.set('k', { hello: 'world' }, 60_000);
    const b = new Cache({ dir });
    expect(b.get('k')).toEqual({ hello: 'world' });
  });
  it('ignores expired disk entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wi-cache-'));
    let t = 0;
    const a = new Cache({ dir, now: () => t });
    a.set('k', 1, 100);
    t = 1000;
    expect(new Cache({ dir, now: () => t }).get('k')).toBeUndefined();
  });
});
