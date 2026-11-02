import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/db';
import { resetLibraryData } from '../src/main/catalog';

function seedStore(): { s: Store; dirs: { originalsDir: string; thumbsDir: string; rendersDir: string } } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bpr-'));
  const dirs = {
    originalsDir: path.join(base, 'orig'),
    thumbsDir: path.join(base, 'thumbs'),
    rendersDir: path.join(base, 'renders'),
  };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const s = new Store(path.join(base, 'test.db'));
  const n = new Date().toISOString();
  s.db.prepare(`INSERT INTO shop_connections(id, shop_domain, storefront_domain, auth_mode, credential_ref, api_version)
    VALUES ('sh1', 'x.myshopify.com', 'https://x.example', 'token', 'safeStorage', '2026-10')`).run();
  s.db.prepare(`INSERT INTO products(id, handle, title, description, status, canonical_url, first_seen_at, last_seen_at, demo, product_type)
    VALUES ('p1', 'a', 'Dress A', '', 'ACTIVE', 'https://example.com/a', ?, ?, 0, '')`).run(n, n);
  fs.writeFileSync(path.join(dirs.originalsDir, 'a1.jpg'), Buffer.from('orig-bytes'));
  fs.writeFileSync(path.join(dirs.thumbsDir, 'a1.jpg'), Buffer.from('thumb-bytes'));
  fs.writeFileSync(path.join(dirs.rendersDir, 'pin.jpg'), Buffer.from('render-bytes'));
  s.db.prepare(`INSERT INTO product_images(id, product_id, source_order, review_state, download_state, original_local_path, thumb_local_path, created_at, updated_at)
    VALUES ('a1', 'p1', 1, 'approved', 'ready', ?, ?, ?, ?)`)
    .run(path.join(dirs.originalsDir, 'a1.jpg'), path.join(dirs.thumbsDir, 'a1.jpg'), n, n);
  s.db.prepare(`INSERT INTO pin_drafts(id, product_id, title, description, destination_url, board_name, template_id, design_json, created_at, updated_at)
    VALUES ('d1', 'p1', 'T', 'D', 'https://example.com/a', 'Evening Looks', 'original', '{}', ?, ?)`).run(n, n);
  s.db.prepare(`INSERT INTO schedule_entries(id, pin_draft_id, planned_utc, timezone, local_date, local_time, created_at, updated_at)
    VALUES ('s1', 'd1', ?, 'America/Bogota', '2026-11-01', '09:00', ?, ?)`).run(n, n, n);
  s.db.prepare(`INSERT INTO export_assets(id, pin_draft_id, output_path, created_at) VALUES ('e1', 'd1', '/tmp/x.jpg', ?)`).run(n);
  s.activity('sync', 'pretend sync happened');
  return { s, dirs };
}

describe('resetLibraryData', () => {
  it('wipes catalog/pins/schedule/history + cached files but keeps connection, settings and boards', () => {
    const { s, dirs } = seedStore();
    const out = resetLibraryData(s, dirs);
    expect(out).toEqual({ products: 1, images: 1, pins: 1, entries: 1 });

    for (const t of ['products', 'product_images', 'pin_drafts', 'schedule_entries', 'export_assets', 'sync_runs', 'sync_errors', 'copy_actions', 'manual_post_records', 'image_review_notes']) {
      expect((s.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c, t).toBe(0);
    }
    // kept: connection, settings, seeded boards
    expect((s.db.prepare(`SELECT COUNT(*) c FROM shop_connections`).get() as { c: number }).c).toBe(1);
    expect(s.getSetting('scheduler', null)).not.toBeNull();
    expect((s.db.prepare(`SELECT COUNT(*) c FROM local_boards`).get() as { c: number }).c).toBe(3);
    // cached files gone
    for (const d of Object.values(dirs)) {
      expect(fs.readdirSync(d)).toEqual([]);
    }
    // reset itself is logged as the single remaining activity row
    expect((s.db.prepare(`SELECT COUNT(*) c FROM activity_events`).get() as { c: number }).c).toBe(1);
    s.close();
  });
});
