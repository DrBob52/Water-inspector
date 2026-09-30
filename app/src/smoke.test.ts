import { describe, expect, it } from 'vitest';

describe('app', () => {
  it('runs tests in jsdom', () => {
    expect(document.createElement('div').tagName).toBe('DIV');
  });
});
