import { describe, expect, it } from 'vitest';
import { parseUrl, serializeUrl } from './urlState';

describe('URL state', () => {
  it('parses the shareable form from the spec', () => {
    expect(parseUrl('?wb=nhd:123&view=underwater')).toEqual({
      wb: 'nhd:123',
      view: 'underwater',
      tab: 'overview',
      species: null,
    });
    expect(parseUrl('?wb=nhd%3Ademo-lake-tahoe&view=section&tab=life&sp=Esox%20lucius')).toEqual({
      wb: 'nhd:demo-lake-tahoe',
      view: 'section',
      tab: 'life',
      species: 'Esox lucius',
    });
  });
  it('ignores invalid values and views without a waterbody', () => {
    expect(parseUrl('?view=underwater')).toMatchObject({ wb: null, view: 'map' });
    expect(parseUrl('?wb=bogus&view=raised').wb).toBeNull();
    expect(parseUrl('?wb=osm:way/1&view=nope&tab=nope')).toMatchObject({
      view: 'map',
      tab: 'overview',
    });
  });
  it('round-trips and keeps the colon readable', () => {
    const s = {
      wb: 'nhd:demo-crater-lake',
      view: 'pollutants' as const,
      tab: 'sources' as const,
      species: null,
    };
    const q = serializeUrl(s);
    expect(q).toBe('?wb=nhd:demo-crater-lake&view=pollutants&tab=sources');
    expect(parseUrl(q)).toEqual(s);
  });
  it('omits defaults and everything when nothing is selected', () => {
    expect(serializeUrl({ wb: 'nhd:1', view: 'map', tab: 'overview', species: null })).toBe(
      '?wb=nhd:1',
    );
    expect(serializeUrl({ wb: null, view: 'raised', tab: 'life', species: 'x' })).toBe('');
  });
  it('encodes osm ids with slashes', () => {
    const q = serializeUrl({ wb: 'osm:way/42', view: 'map', tab: 'overview', species: null });
    expect(parseUrl(q).wb).toBe('osm:way/42');
  });
});
