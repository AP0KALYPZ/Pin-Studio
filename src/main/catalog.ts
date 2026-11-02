import fs from 'node:fs';
import path from 'node:path';
import { Store, uid, nowUtc } from './db';
import { generatePlaceholder, makeThumb, sha256File, downloadMany } from './images';

/** Import the bundled demo fixture (7 products, 66 images). Idempotent. */
export async function importDemoCatalog(store: Store, dirs: { originalsDir: string; thumbsDir: string }, fixturePath: string): Promise<{ products: number; images: number }> {
  const raw = fs.readFileSync(fixturePath, 'utf-8');
  const fixture = JSON.parse(raw) as {
    products: Array<{
      id: string; shopify_gid: string; handle: string; title: string; description: string;
      status: string; collections: string[]; canonical_url: string;
      images: Array<{ id: string; shopify_media_gid: string; source_order: number; alt_text: string }>;
    }>;
  };
  const n = nowUtc();
  const insP = store.db.prepare(`INSERT OR REPLACE INTO products
    (id, shop_connection_id, shopify_gid, handle, title, description, status, tags_json, collections_json, canonical_url, custom_url_override, include_in_schedule, priority, preferred_local_board_id, first_seen_at, last_seen_at, missing_source_at, demo, product_type)
    VALUES (@id, NULL, @gid, @handle, @title, @description, @status, '[]', @collections, @url, NULL,
      COALESCE((SELECT include_in_schedule FROM products WHERE id=@id), 1),
      COALESCE((SELECT priority FROM products WHERE id=@id), 'Normal'),
      (SELECT preferred_local_board_id FROM products WHERE id=@id),
      COALESCE((SELECT first_seen_at FROM products WHERE id=@id), @now),
      @now, NULL, 1, '')`);
  const insI = store.db.prepare(`INSERT OR IGNORE INTO product_images
    (id, product_id, shopify_media_gid, source_order, alt_text, source_url, width, height, sha256, perceptual_hash, original_local_path, thumb_local_path, review_state, download_state, missing_source_at, created_at, updated_at)
    VALUES (@id, @pid, @gid, @order, @alt, NULL, 1200, 1800, NULL, NULL, @orig, @thumb, COALESCE((SELECT review_state FROM product_images WHERE id=@id), 'new'), 'ready', NULL, @now, @now)`);

  let imageCount = 0;
  const txn = store.db.transaction(() => {
    for (const p of fixture.products) {
      insP.run({ id: p.id, gid: p.shopify_gid, handle: p.handle, title: p.title, description: p.description, status: p.status, collections: JSON.stringify(p.collections ?? []), url: p.canonical_url, now: n });
      for (const img of p.images) {
        const orig = path.join(dirs.originalsDir, `${img.id}.jpg`);
        const thumb = path.join(dirs.thumbsDir, `${img.id}.jpg`);
        insI.run({ id: img.id, pid: p.id, gid: img.shopify_media_gid, order: img.source_order, alt: img.alt_text, orig, thumb, now: n });
        imageCount++;
      }
    }
  });
  txn();

  // Generate placeholder artwork offline for any missing originals
  for (const p of fixture.products) {
    for (const img of p.images) {
      const orig = path.join(dirs.originalsDir, `${img.id}.jpg`);
      const thumb = path.join(dirs.thumbsDir, `${img.id}.jpg`);
      if (!fs.existsSync(orig)) {
        await generatePlaceholder(orig, `${p.title} · Photo ${img.source_order}`, img.id);
      }
      if (!fs.existsSync(thumb)) {
        try {
          await makeThumb(orig, thumb);
        } catch { /* ignore */ }
      }
    }
  }
  store.setSetting('general', { ...(store.getSetting('general', {}) as object), demoMode: true });
  store.activity('demo-import', `Demo catalog imported: ${fixture.products.length} products, ${imageCount} images.`);
  return { products: fixture.products.length, images: imageCount };
}

/** Stable local product id derived from the permanent Shopify gid. */
export function shopProductId(gid: string): string {
  return `shop_${gid.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

const BOARD_COLORS = ['#B48E78', '#84776D', '#5C8069', '#8A6FA8', '#C8A06A', '#7FA3B5'];

/** Collection titles that must never become local boards (matched case-insensitively). */
const BOARD_BLOCKLIST = new Set(['new arrivals', 'featured', 'frontpage', 'home page', 'all products', 'all']);

function normalizeBoardName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 80);
  return name || null;
}

/** Create local boards from the shop's own organization (Shopify collection titles).
 * Idempotent: existing names (case-insensitive) are reused, never duplicated.
 * Each product's preferred board is set to its first collection — but only when the
 * product has none yet, so a manual choice is never overwritten by a re-sync. */
export function syncBoardsFromCollections(
  store: Store,
  products: Array<{ gid: string; collections?: string[] }>,
): { created: number; total: number } {
  const n = nowUtc();
  let created = 0;
  const getByName = store.db.prepare(`SELECT id FROM local_boards WHERE LOWER(name) = LOWER(?)`);
  const ins = store.db.prepare(`INSERT INTO local_boards(id, name, color, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`);
  const setPref = store.db.prepare(`UPDATE products SET preferred_local_board_id = ? WHERE id = ? AND preferred_local_board_id IS NULL`);
  const txn = store.db.transaction(() => {
    // Pass 1: mirror EVERY collection title as a board (dedupe case-insensitively,
    // skipping generic catch-alls ("New Arrivals", "Featured", "Frontpage", "Home page", "All products").
    const seen = new Set<string>();
    for (const p of products) {
      for (const raw of p.collections ?? []) {
        const name = normalizeBoardName(raw);
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key) || BOARD_BLOCKLIST.has(key)) continue;
        seen.add(key);
        if (!getByName.get(name)) {
          ins.run(uid('board'), name, BOARD_COLORS[created % BOARD_COLORS.length], n, n);
          created++;
        }
      }
    }
    // Pass 2: point each product at its first collection's board (manual picks kept,
    // blocklisted catch-all collections never assign a board).
    for (const p of products) {
      const first = (p.collections ?? []).map(normalizeBoardName).find((x) => x && !BOARD_BLOCKLIST.has((x as string).toLowerCase())) as string | undefined;
      if (!first) continue;
      const row = getByName.get(first) as { id: string } | undefined;
      if (row) setPref.run(row.id, shopProductId(p.gid));
    }
  });
  txn();
  const total = (store.db.prepare(`SELECT COUNT(*) c FROM local_boards`).get() as { c: number }).c;
  if (created > 0) store.activity('boards-sync', `Boards created from your Shopify collections: ${created} new (shop organization mirrored).`);
  return { created, total };
}

/** Upsert Shopify products, preserving reviews / edits / schedule / posted history. */
export function upsertShopifyProducts(
  store: Store,
  connectionId: string,
  products: Array<{ gid: string; handle: string; title: string; descriptionHtml: string; status: string; tags: string[]; collections?: string[]; productType: string; storefrontUrl: string }>,
): { added: number; updated: number } {
  const n = nowUtc();
  let added = 0;
  let updated = 0;
  const txn = store.db.transaction(() => {
    for (const p of products) {
      const id = shopProductId(p.gid);
      const existing = store.db.prepare(`SELECT id FROM products WHERE id=?`).get(id) as { id: string } | undefined;
      store.db.prepare(`INSERT INTO products
        (id, shop_connection_id, shopify_gid, handle, title, description, status, tags_json, collections_json, canonical_url, custom_url_override, include_in_schedule, priority, preferred_local_board_id, first_seen_at, last_seen_at, missing_source_at, demo, product_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT custom_url_override FROM products WHERE id=?), COALESCE((SELECT include_in_schedule FROM products WHERE id=?), 1), COALESCE((SELECT priority FROM products WHERE id=?), 'Normal'), (SELECT preferred_local_board_id FROM products WHERE id=?), COALESCE((SELECT first_seen_at FROM products WHERE id=?), ?), ?, NULL, 0, ?)
        ON CONFLICT(id) DO UPDATE SET shopify_gid=excluded.shopify_gid, handle=excluded.handle, title=excluded.title, description=excluded.description, status=excluded.status, tags_json=excluded.tags_json, collections_json=excluded.collections_json, canonical_url=excluded.canonical_url, last_seen_at=excluded.last_seen_at, missing_source_at=NULL, product_type=excluded.product_type`).run(
        id, connectionId, p.gid, p.handle, p.title, p.descriptionHtml, p.status, JSON.stringify(p.tags ?? []), JSON.stringify(p.collections ?? []), p.storefrontUrl, id, id, id, id, id, n, n, p.productType ?? '',
      );
      if (existing) updated++;
      else added++;
    }
  });
  txn();
  return { added, updated };
}

/** Reconcile media for one product: add new, flag removed as missing (never delete reviews/history). */
export async function reconcileMedia(
  store: Store,
  dirs: { originalsDir: string; thumbsDir: string },
  productId: string,
  media: Array<{ gid: string; alt: string | null; url: string | null; width: number | null; height: number | null; order: number }>,
  download: boolean,
): Promise<{ added: number; removed: number; downloaded: number }> {
  const n = nowUtc();
  const seen = new Set<string>();
  let added = 0;
  const toDownload: Array<{ url: string; dest: string }> = [];
  const txn = store.db.transaction(() => {
    for (const m of media) {
      const id = `img_${m.gid.replace(/[^a-zA-Z0-9]/g, '_')}`;
      seen.add(id);
      const existing = store.db.prepare(`SELECT id, original_local_path FROM product_images WHERE id=?`).get(id) as { id: string; original_local_path: string | null } | undefined;
      const orig = path.join(dirs.originalsDir, `${id}.jpg`);
      const thumb = path.join(dirs.thumbsDir, `${id}.jpg`);
      store.db.prepare(`INSERT INTO product_images
        (id, product_id, shopify_media_gid, source_order, alt_text, source_url, width, height, original_local_path, thumb_local_path, review_state, download_state, missing_source_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT review_state FROM product_images WHERE id=?), 'new'), 'pending', NULL, ?, ?)
        ON CONFLICT(product_id, shopify_media_gid) DO UPDATE SET source_order=excluded.source_order, alt_text=excluded.alt_text, source_url=excluded.source_url, width=excluded.width, height=excluded.height, missing_source_at=NULL, updated_at=excluded.updated_at`).run(
        id, productId, m.gid, m.order, m.alt, m.url, m.width, m.height, orig, thumb, id, n, n,
      );
      if (!existing) {
        added++;
        if (m.url && download) toDownload.push({ url: m.url, dest: orig });
      } else if (existing && m.url && download && !fs.existsSync(orig)) {
        toDownload.push({ url: m.url, dest: orig });
      }
    }
    // Flag removed media as missing (keep rows + history)
    const rows = store.db.prepare(`SELECT id, shopify_media_gid FROM product_images WHERE product_id=? AND missing_source_at IS NULL`).all(productId) as Array<{ id: string; shopify_media_gid: string | null }>;
    for (const r of rows) {
      if (r.shopify_media_gid && ![...media.map((m) => m.gid)].includes(r.shopify_media_gid)) {
        // Check by gid mapping
      }
    }
    void seen;
  });
  txn();

  // Removed = media rows whose gid no longer present
  const currentGids = new Set(media.map((m) => m.gid));
  const allRows = store.db.prepare(`SELECT id, shopify_media_gid FROM product_images WHERE product_id=? AND missing_source_at IS NULL`).all(productId) as Array<{ id: string; shopify_media_gid: string | null }>;
  let removed = 0;
  for (const r of allRows) {
    if (r.shopify_media_gid && !currentGids.has(r.shopify_media_gid)) {
      store.db.prepare(`UPDATE product_images SET missing_source_at=?, updated_at=? WHERE id=?`).run(n, n, r.id);
      // Flag future pins for review
      store.db.prepare(`UPDATE pin_drafts SET review_state='needs_review', updated_at=? WHERE product_image_id=? AND posting_state='not_posted'`).run(n, r.id);
      removed++;
    }
  }

  let downloaded = 0;
  if (download && toDownload.length > 0) {
    const results = await downloadMany(toDownload);
    for (let i = 0; i < toDownload.length; i++) {
      const dest = toDownload[i].dest;
      const id = `img_${path.basename(dest, '.jpg').replace(/^img_/, 'img_')}`;
      if (results[i].ok) {
        downloaded++;
        try {
          const thumb = path.join(dirs.thumbsDir, path.basename(dest));
          await makeThumb(dest, thumb);
          const hash = sha256File(dest);
          store.db.prepare(`UPDATE product_images SET download_state='ready', sha256=?, updated_at=? WHERE original_local_path=?`).run(hash, nowUtc(), dest);
        } catch (e) {
          store.db.prepare(`UPDATE product_images SET download_state='failed', updated_at=? WHERE original_local_path=?`).run(nowUtc(), dest);
        }
        void id;
      } else {
        store.db.prepare(`UPDATE product_images SET download_state='failed', updated_at=? WHERE original_local_path=?`).run(nowUtc(), dest);
      }
    }
  }
  return { added, removed, downloaded };
}

/** Import a user-selected folder of photos, mapping files to a manual product. */
export async function importFolder(
  store: Store,
  dirs: { originalsDir: string; thumbsDir: string },
  folder: string,
  productTitle: string,
  productUrl: string,
): Promise<{ productId: string; count: number }> {
  const files = fs.readdirSync(folder).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  if (files.length === 0) throw new Error('No image files found in that folder.');
  const n = nowUtc();
  const productId = uid('manual');
  const handle = productTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || productId;
  store.db.prepare(`INSERT INTO products(id, shop_connection_id, shopify_gid, handle, title, description, status, tags_json, collections_json, canonical_url, custom_url_override, include_in_schedule, priority, first_seen_at, last_seen_at, demo, product_type)
    VALUES (?, NULL, NULL, ?, ?, '', 'ACTIVE', '[]', '[]', ?, NULL, 1, 'Normal', ?, ?, 0, '')`).run(productId, handle, productTitle, productUrl, n, n);
  let count = 0;
  for (const [i, f] of files.sort().entries()) {
    const src = path.join(folder, f);
    const id = uid('img');
    const dest = path.join(dirs.originalsDir, `${id}.jpg`);
    fs.copyFileSync(src, dest);
    try {
      await makeThumb(dest, path.join(dirs.thumbsDir, `${id}.jpg`));
    } catch { /* ignore */ }
    store.db.prepare(`INSERT INTO product_images(id, product_id, shopify_media_gid, source_order, alt_text, source_url, original_local_path, thumb_local_path, review_state, download_state, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, 'new', 'ready', ?, ?)`).run(id, productId, i + 1, f, dest, path.join(dirs.thumbsDir, `${id}.jpg`), n, n);
    count++;
  }
  store.activity('folder-import', `Folder import: "${productTitle}" — ${count} photos from ${folder}.`);
  return { productId, count };
}

export interface BulkReviewFilter {
  state: 'new' | 'approved' | 'rejected';
  review?: string; // only change photos currently in this state ('all' = any)
  productId?: string;
  search?: string;
}

/** Hard reset of catalog data: wipes products, photos, pins, schedule, posting
 * history and cached renders — but keeps the Shopify connection, secrets,
 * settings and local boards. The on-disk originals/thumbs/renders are deleted;
 * user export packs and backups are left alone. */
export function resetLibraryData(store: Store, dirs: { originalsDir: string; thumbsDir: string; rendersDir: string }): { products: number; images: number; pins: number; entries: number } {
  const count = (t: string): number => (store.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
  const out = { products: count('products'), images: count('product_images'), pins: count('pin_drafts'), entries: count('schedule_entries') };
  const txn = store.db.transaction(() => {
    for (const t of ['copy_actions', 'manual_post_records', 'schedule_entries', 'export_assets', 'pin_drafts', 'image_review_notes', 'product_images', 'products', 'sync_errors', 'sync_runs', 'activity_events']) {
      store.db.prepare(`DELETE FROM ${t}`).run();
    }
  });
  txn();
  for (const d of [dirs.originalsDir, dirs.thumbsDir, dirs.rendersDir]) {
    try {
      for (const f of fs.readdirSync(d)) {
        fs.rmSync(path.join(d, f), { recursive: true, force: true });
      }
    } catch { /* ignore missing dirs */ }
  }
  store.activity('reset', `Library reset by user: removed ${out.products} products, ${out.images} photos, ${out.pins} pins, ${out.entries} schedule entries. Connection and settings kept.`);
  return out;
}

/** Review every photo matching a filter in one UPDATE (no ID list needed). */
export function bulkReview(store: Store, f: BulkReviewFilter): { updated: number } {
  if (!['new', 'approved', 'rejected'].includes(f.state)) throw new Error('Bad review state.');
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.review && f.review !== 'all') {
    where.push(`pi.review_state = ?`);
    params.push(f.review);
  }
  if (f.productId) {
    where.push(`pi.product_id = ?`);
    params.push(f.productId);
  }
  if (f.search) {
    where.push(`(p.title LIKE ? OR pi.alt_text LIKE ?)`);
    params.push(`%${f.search}%`, `%${f.search}%`);
  }
  const w = where.length ? 'AND ' + where.join(' AND ') : '';
  const ids = store.db.prepare(`SELECT pi.id FROM product_images pi JOIN products p ON p.id = pi.product_id WHERE 1=1 ${w}`).all(...params) as Array<{ id: string }>;
  if (ids.length === 0) return { updated: 0 };
  const stmt = store.db.prepare(`UPDATE product_images SET review_state = ?, updated_at = ? WHERE id = ?`);
  const n = nowUtc();
  const txn = store.db.transaction(() => {
    for (const r of ids) stmt.run(f.state, n, r.id);
  });
  txn();
  store.activity('review', `${ids.length} photo(s) marked ${f.state} (bulk).`);
  return { updated: ids.length };
}

/** Regenerate thumbnails for all photos that still have their original file. */
export async function rebuildThumbs(
  store: Store,
  dirs: { originalsDir: string; thumbsDir: string },
  onProgress?: (done: number, total: number) => void,
): Promise<{ rebuilt: number; missing: number }> {
  const rows = store.db.prepare(`SELECT id, original_local_path, thumb_local_path FROM product_images`).all() as Array<{ id: string; original_local_path: string | null; thumb_local_path: string | null }>;
  let rebuilt = 0;
  let missing = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.original_local_path && fs.existsSync(r.original_local_path) && r.thumb_local_path) {
      try {
        await makeThumb(r.original_local_path, r.thumb_local_path);
        rebuilt++;
      } catch {
        missing++;
      }
    } else {
      missing++;
    }
    if (onProgress && (i % 25 === 0 || i === rows.length - 1)) onProgress(i + 1, rows.length);
  }
  store.activity('thumbs-rebuild', `Thumbnails rebuilt: ${rebuilt} ok, ${missing} missing originals.`);
  return { rebuilt, missing };
}
