import { describe, expect, it } from 'vitest';
import { causeToParameter, groupCause, normalizeUse } from './impairments';

describe('impairment helpers', () => {
  it('groups causes', () => {
    expect(groupCause('Phosphorus, Total')).toBe('nutrients');
    expect(groupCause('MERCURY IN FISH TISSUE')).toBe('metals');
    expect(groupCause('Escherichia coli (E. coli)')).toBe('pathogens');
    expect(groupCause('Polychlorinated biphenyls (PCBs)')).toBe('organics');
    expect(groupCause('Non-native Aquatic Plants')).toBe('other');
  });
  it('maps causes to measured parameters', () => {
    expect(causeToParameter('Phosphorus, Total')).toBe('total_phosphorus');
    expect(causeToParameter('Mercury')).toBe('mercury');
    expect(causeToParameter('Escherichia coli (E. coli)')).toBe('e_coli');
    expect(causeToParameter('Non-native Aquatic Plants')).toBeUndefined();
  });
  it('normalises designated uses', () => {
    expect(normalizeUse('Primary Contact Recreation')).toBe('swimming');
    expect(normalizeUse('Fish Consumption')).toBe('fish_consumption');
    expect(normalizeUse('Aquatic Life Use')).toBe('aquatic_life');
    expect(normalizeUse('Public Water Supply')).toBe('drinking_water');
    expect(normalizeUse('Agriculture')).toBe('other');
  });
});
