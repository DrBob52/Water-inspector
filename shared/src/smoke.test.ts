import { describe, expect, it } from 'vitest';
import { SHARED_VERSION } from './index';

describe('shared', () => {
  it('exports a version', () => {
    expect(SHARED_VERSION).toBe('1.0.0');
  });
});
