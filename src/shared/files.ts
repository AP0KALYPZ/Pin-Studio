// Filename sanitising, CSV escaping, manifest helpers — pure, fully tested.

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Make a safe file stem for Windows/macOS/Linux. */
export function sanitizeStem(input: string, maxLen = 80): string {
  let s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '');
  if (!s) s = 'pin';
  if (WINDOWS_RESERVED.test(s)) s = `${s}-pin`;
  return s;
}

/** Build export filename: 2026-11-02_0900_handle_img03_ab12cd.jpg */
export function buildExportFilename(
  date: string,
  time: string,
  handle: string,
  imageOrder: number,
  hash8: string,
  ext: 'jpg' | 'png',
): string {
  const d = date.replace(/-/g, '-');
  const t = time.replace(':', '');
  const stem = sanitizeStem(handle);
  const img = `img${String(imageOrder).padStart(2, '0')}`;
  return `${d}_${t}_${stem}_${img}_${hash8}.${ext}`;
}

/** Escape a CSV cell: quote when needed, prefix formula chars. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? '' : String(v);
  // Mitigate spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n'; // UTF-8 BOM, Excel-friendly
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Reject path traversal / absolute paths from renderer-supplied values. */
export function assertSafeRelativePath(p: string): void {
  if (!p || p.length > 500) throw new Error('Bad path');
  if (p.includes('..') || p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) {
    throw new Error('Unsafe path');
  }
}
