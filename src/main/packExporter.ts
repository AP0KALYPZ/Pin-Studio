import fs from 'node:fs';
import path from 'node:path';
import { Store, uid, nowUtc } from './db';
import { renderPin } from './images';
import { buildExportFilename, csvCell, escapeHtml, toCsv } from '../shared/files';
import type { PinDraft } from '../shared/types';

export interface PackPin {
  pin: PinDraft;
  handle: string;
  imageOrder: number;
  sourcePath: string;
}

export function pinsForRange(store: Store, from: string, to: string): PackPin[] {
  const rows = store.db.prepare(`
    SELECT d.*, p.handle, p.title AS product_title, COALESCE(pi.source_order, 1) AS imageOrder, pi.original_local_path AS sourcePath,
      se.local_date AS scheduled_date, se.local_time AS scheduled_time, se.timezone AS timezone
    FROM schedule_entries se
    JOIN pin_drafts d ON d.id = se.pin_draft_id
    JOIN products p ON p.id = d.product_id
    LEFT JOIN product_images pi ON pi.id = d.product_image_id
    WHERE se.local_date >= ? AND se.local_date <= ?
    ORDER BY se.local_date, se.local_time
  `).all(from, to) as Array<PinDraft & { handle: string; imageOrder: number; sourcePath: string | null }>;
  return rows.map((r) => ({ pin: r, handle: r.handle, imageOrder: r.imageOrder, sourcePath: r.sourcePath ?? '' }));
}

const MANIFEST_HEADERS = ['local_pin_id', 'scheduled_date', 'scheduled_time', 'timezone', 'product_id', 'product_title', 'source_image_id', 'image_filename', 'image_relative_path', 'title', 'description', 'alt_text', 'board_name', 'product_url', 'review_state', 'posting_state', 'exported_at'];

export async function exportPack(
  store: Store,
  dirs: { rendersDir: string },
  rootDir: string,
  label: string,
  pins: PackPin[],
  exportFormat: 'jpg' | 'png',
  onProgress?: (done: number, total: number) => void,
): Promise<{ dir: string; images: number; manifest: string }> {
  const safeLabel = label.replace(/[^a-zA-Z0-9-]+/g, '_');
  const dir = path.join(rootDir, safeLabel);
  fs.mkdirSync(dir, { recursive: true });
  const n = nowUtc();
  const rows: string[][] = [];
  let done = 0;

  for (const { pin, handle, imageOrder, sourcePath } of pins) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      rows.push([pin.id, pin.scheduled_date ?? '', pin.scheduled_time ?? '', pin.timezone ?? '', pin.product_id, pin.product_title, pin.product_image_id ?? '', '', '', pin.title, pin.description, pin.alt_text ?? '', pin.board_name, pin.destination_url, pin.review_state, pin.posting_state, n]);
      onProgress?.(++done, pins.length);
      continue;
    }
    const hash8 = (pin.product_image_id ?? pin.id).replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase() || 'a1b2c3d4';
    const filename = buildExportFilename(pin.scheduled_date ?? 'unscheduled', (pin.scheduled_time ?? '09:00').replace(':', ''), handle, imageOrder, hash8, exportFormat);
    const relDir = (pin.scheduled_date ?? 'unscheduled').slice(0, 10);
    const outDir = path.join(dir, relDir);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, filename);
    const exp = store.getSetting('exports', { format: 'jpg', quality: 88, background: '#F7F4F0', template: 'original' }) as { quality: number; background: string };
    await renderPin(sourcePath, outPath, { template: pin.template_id, title: pin.title, format: exportFormat, quality: exp.quality ?? 88, background: exp.background ?? '#F7F4F0' });
    const rel = path.join(relDir, filename);
    store.db.prepare(`INSERT INTO export_assets(id, pin_draft_id, metadata_revision, design_checksum, output_path, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uid('exp'), pin.id, pin.metadata_revision, `${pin.template_id}:${pin.metadata_revision}`, outPath, n);
    rows.push([pin.id, pin.scheduled_date ?? '', pin.scheduled_time ?? '', pin.timezone ?? '', pin.product_id, pin.product_title, pin.product_image_id ?? '', filename, rel, pin.title, pin.description, pin.alt_text ?? '', pin.board_name, pin.destination_url, pin.review_state, pin.posting_state, n]);
    onProgress?.(++done, pins.length);
  }

  const csv = toCsv(MANIFEST_HEADERS, rows);
  fs.writeFileSync(path.join(dir, 'manifest.csv'), csv, 'utf-8');
  const json = rows.map((r) => Object.fromEntries(MANIFEST_HEADERS.map((h, i) => [h, r[i]])));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ exported_at: n, count: rows.length, pins: json }, null, 2), 'utf-8');

  const txt: string[] = [`PIN STUDIO — POSTING PACK (${label})`, `Exported: ${n}`, `Pins: ${rows.length}`, '', '='.repeat(60), ''];
  const htmlCards: string[] = [];
  rows.forEach((r, i) => {
    const rec = Object.fromEntries(MANIFEST_HEADERS.map((h, idx) => [h, r[idx]]));
    txt.push(`--- PIN ${i + 1}/${rows.length} ---`, `Date: ${rec.scheduled_date} ${rec.scheduled_time} (${rec.timezone})`, `Title: ${rec.title}`, '', `${rec.description}`, '', `Product link: ${rec.product_url}`, `Board: ${rec.board_name}`, rec.alt_text ? `Alt: ${rec.alt_text}` : '', `Image file: ${rec.image_relative_path}`, '');
    htmlCards.push(`<article class="card">
      <div class="meta"><strong>Pin ${i + 1}/${rows.length}</strong> · ${escapeHtml(String(rec.scheduled_date))} ${escapeHtml(String(rec.scheduled_time))} (${escapeHtml(String(rec.timezone))})</div>
      ${rec.image_relative_path ? `<img src="${escapeHtml(String(rec.image_relative_path))}" alt="${escapeHtml(String(rec.alt_text || rec.title))}" loading="lazy"/>` : '<p><em>No image file (missing original).</em></p>'}
      <h2>${escapeHtml(String(rec.title))}</h2>
      <p class="desc">${escapeHtml(String(rec.description)).replace(/\n/g, '<br/>')}</p>
      <p><strong>Product link:</strong> <span class="copyable">${escapeHtml(String(rec.product_url))}</span></p>
      <p><strong>Board:</strong> <span class="copyable">${escapeHtml(String(rec.board_name))}</span></p>
      <p class="file">File: <code>${escapeHtml(String(rec.image_relative_path))}</code></p>
    </article>`);
  });
  fs.writeFileSync(path.join(dir, 'POSTING_SHEET.txt'), txt.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(dir, 'POSTING_SHEET.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Posting pack ${escapeHtml(label)}</title>
<style>body{font-family:Georgia,serif;background:#F7F4F0;color:#302925;max-width:860px;margin:0 auto;padding:24px}img{width:100%;max-width:420px;border-radius:12px}.card{background:#fff;border:1px solid #E5DDD5;border-radius:14px;padding:20px;margin:0 0 20px}.copyable{user-select:all;background:#F0EBE5;padding:2px 6px;border-radius:6px}.desc{white-space:pre-wrap}.meta{color:#84776D;font-size:13px;margin-bottom:8px}.file{color:#84776D;font-size:12px}</style>
</head><body><h1>Posting pack — ${escapeHtml(label)}</h1><p>${rows.length} pins · exported ${escapeHtml(n)} · works offline, no Pinterest connection.</p>${htmlCards.join('\n')}</body></html>`, 'utf-8');
  void csvCell;

  store.activity('export', `Exported pack "${label}": ${rows.length} pins to ${dir}.`);
  return { dir, images: rows.length, manifest: path.join(dir, 'manifest.csv') };
}
