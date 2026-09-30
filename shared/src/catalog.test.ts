import { describe, expect, it } from 'vitest';
import { SPECIES_CATALOG, findCatalogEntry, groupFromTaxonomy, resolveTraits } from './catalog';

describe('species catalog', () => {
  it('has at least 120 entries with unique ids', () => {
    expect(SPECIES_CATALOG.length).toBeGreaterThanOrEqual(120);
    expect(new Set(SPECIES_CATALOG.map((c) => c.id)).size).toBe(SPECIES_CATALOG.length);
  });
  it('has well-formed entries', () => {
    for (const c of SPECIES_CATALOG) {
      expect(c.lengthCm[0]).toBeLessThanOrEqual(c.lengthCm[1]);
      for (const col of [c.colors.back, c.colors.side, c.colors.belly, c.colors.fin])
        expect(col).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.scientificName.split(' ')).toHaveLength(2);
    }
  });
  it('covers the expected common species', () => {
    for (const n of [
      'Micropterus salmoides',
      'Esox masquinongy',
      'Dreissena polymorpha',
      'Chelydra serpentina',
      'Lithobates catesbeianus',
      'Petromyzon marinus',
    ]) {
      expect(findCatalogEntry(n)).toBeDefined();
    }
  });
  it('matches names that carry authorship', () => {
    expect(findCatalogEntry('Micropterus salmoides (Lacepède, 1802)')?.id).toBe(
      'micropterus-salmoides',
    );
  });
});

describe('resolveTraits', () => {
  it('uses the catalog when available', () => {
    const t = resolveTraits({ scientificName: 'Esox lucius', group: 'fish' });
    expect(t.matchedBy).toBe('catalog');
    expect(t.archetype).toBe('elongate');
  });
  it('falls back by family, then order, then class', () => {
    expect(
      resolveTraits({ scientificName: 'Xus yus', group: 'fish', family: 'Anguillidae' }).archetype,
    ).toBe('anguilliform');
    expect(
      resolveTraits({
        scientificName: 'Xus yus',
        group: 'fish',
        family: 'Nope',
        order: 'Siluriformes',
      }),
    ).toMatchObject({ archetype: 'benthic', matchedBy: 'order' });
    expect(
      resolveTraits({ scientificName: 'Xus yus', group: 'amphibian', taxClass: 'Amphibia' }),
    ).toMatchObject({ archetype: 'frog', matchedBy: 'class' });
    expect(resolveTraits({ scientificName: 'Xus yus', group: 'fish' }).archetype).toBe('fusiform');
  });
  it('picks an elongate body for the northern snakehead family if not catalogued', () => {
    expect(
      resolveTraits({ scientificName: 'Channa micropeltes', group: 'fish', family: 'Channidae' })
        .archetype,
    ).toBe('elongate');
  });
});

describe('groupFromTaxonomy', () => {
  it('maps classes to groups', () => {
    expect(groupFromTaxonomy({ class: 'Actinopterygii' })).toBe('fish');
    expect(groupFromTaxonomy({ class: 'Actinopterygii', order: 'Petromyzontiformes' })).toBe(
      'lamprey',
    );
    expect(groupFromTaxonomy({ class: 'Bivalvia' })).toBe('mollusc');
    expect(groupFromTaxonomy({ kingdom: 'Plantae' })).toBe('plant');
  });
});
