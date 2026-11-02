import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/db';
import { bulkReview, rebuildThumbs } from '../src/main/catalog';
import { generatePlaceholder } from '../src/main/images';

function seedStore(): { s: Store; dirs: { originalsDir: string; thumbsDir: string } } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bpb-'));
  const dirs = { originalsDir: path.join(base, 'orig'), thumbsDir: path.join(base, 'thumbs') };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const s = new Store(path.join(base, 'test.db'));
  const n = new Date().toISOString();
  s.db.prepare(`INSERT INTO products(id, handle, title, description, status, canonical_url, first_seen_at, last_seen_at, demo, product_type) VALUES ('p1', 'a', 'Dress A', '', 'ACTIVE', 'https://example.com/a', ?, ?, 1, '')`).run(n, n);
  s.db.prepare(`INSERT INTO products(id, handle, title, description, status, canonical_url, first_seen_at, last_seen_at, demo, product_type) VALUES ('p2', 'b', 'Dress B', '', 'ACTIVE', 'https://example.com/b', ?, ?, 1, '')`).run(n, n);
  const ins = s.db.prepare(`INSERT INTO product_images(id, product_id, source_order, review_state, download_state, created_at, updated_at) VALUES (?, ?, ?, ?, 'ready', ?, ?)`);
  ['a1', 'a2', 'a3'].forEach((id, i) => ins.run(id, 'p1', i + 1, 'new', n, n));
  ['b1', 'b2'].forEach((id, i) => ins.run(id, 'p2', i + 1, 'approved', n, n));
  return { s, dirs };
}

describe('bulkReview', () => {
  it('approves all new photos across products', () => {
    const { s } = seedStore();
    const r = bulkReview(s, { state: 'approved', review: 'new' });
    expect(r.updated).toBe(3);
    expect((s.db.prepare(`SELECT COUNT(*) c FROM product_images WHERE review_state='approved'`).get() as { c: number }).c).toBe(5);
    s.close();
  });

  it('scopes to one product', () => {
    const { s } = seedStore();
    const r = bulkReview(s, { state: 'rejected', productId: 'p2' });
    expect(r.updated).toBe(2);
    expect((s.db.prepare(`SELECT review_state r FROM product_images WHERE id='a1'`).get() as { r: string }).r).toBe('new');
    s.close();
  });

  it('returns zero when nothing matches', () => {
    const { s } = seedStore();
    expect(bulkReview(s, { state: 'approved', review: 'rejected' }).updated).toBe(0);
    s.close();
  });
});

describe('rebuildThumbs', () => {
  it('regenerates sharper thumbnails where originals exist', async () => {
    const { s, dirs } = seedStore();
    const orig = path.join(dirs.originalsDir, 'a1.jpg');
    await generatePlaceholder(orig, 'Dress A', 'a1');
    s.db.prepare(`UPDATE product_images SET original_local_path=?, thumb_local_path=? WHERE id='a1'`).run(orig, path.join(dirs.thumbsDir, 'a1.jpg'));
    // stale tiny thumb simulating the old 320px pipeline
    fs.writeFileSync(path.join(dirs.thumbsDir, 'a1.jpg'), Buffer.from('stale'));
    const r = await rebuildThumbs(s, dirs);
    expect(r.rebuilt).toBe(1);
    expect(r.missing).toBe(4);
    expect(fs.statSync(path.join(dirs.thumbsDir, 'a1.jpg')).size).toBeGreaterThan(1000);
    s.close();
  }, 30000);
});
