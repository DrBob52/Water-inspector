import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses headers, quotes, embedded commas, escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y",3\r\n"he said ""hi""",,\r\n');
    expect(rows).toEqual([
      { a: '1', b: 'x, y', c: '3' },
      { a: 'he said "hi"', b: '', c: '' },
    ]);
  });
  it('handles embedded newlines and a missing trailing newline', () => {
    expect(parseCsv('a,b\n"l1\nl2",2')).toEqual([{ a: 'l1\nl2', b: '2' }]);
  });
  it('returns an empty list for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b\n')).toEqual([]);
  });
});
