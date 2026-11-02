import { describe, expect, it } from 'vitest';
import { assertSafeRelativePath, buildExportFilename, csvCell, escapeHtml, sanitizeStem, toCsv } from '../src/shared/files';

describe('filenames', () => {
  it('builds the documented pattern 2026-11-02_0900_handle_img03_hash.jpg', () => {
    expect(buildExportFilename('2026-11-02', '09:00', 'satin-evening-dress', 3, 'a14c2f99', 'jpg'))
      .toBe('2026-11-02_0900_satin-evening-dress_img03_a14c2f99.jpg');
  });

  it('rejects reserved names, traversal and drive paths', () => {
    expect(sanitizeStem('CON')).toBe('con-pin');
    expect(() => assertSafeRelativePath('../evil.jpg')).toThrow();
    expect(() => assertSafeRelativePath('C:\\temp\\x.jpg')).toThrow();
    expect(() => assertSafeRelativePath('ok/sub/dir.jpg')).not.toThrow();
  });

  it('sanitises unicode and punctuation to a safe stem', () => {
    expect(sanitizeStem('Satin Évèning Dress! 100%')).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('csv + html safety', () => {
  it('quotes commas/quotes/newlines and neutralises formulas', () => {
    expect(csvCell('=cmd|evil')).toBe("'=cmd|evil");
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    const csv = toCsv(['a', 'b'], [['x', '=1+1']]);
    expect(csv.startsWith('﻿')).toBe(true); // BOM
    expect(csv).toContain("'=1+1");
  });

  it('escapes html in sheets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
