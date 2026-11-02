import { app, BrowserWindow, ipcMain, clipboard, nativeImage, shell, dialog, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Store, openStore, uid, nowUtc } from './db';
import { ensureDirs } from './paths';
import { upsertShopifyProducts, reconcileMedia, importFolder, bulkReview, rebuildThumbs, resetLibraryData, syncBoardsFromCollections, shopProductId } from './catalog';
import { buildSeoMessages, enhanceWithOpenAI, validateOpenAIKey, isSupportedModel as isSupportedAiModel, DEFAULT_MODEL as DEFAULT_AI_MODEL } from './aiCopy';
import { fetchAllShopifyProducts, fetchAllShopifyMedia, testConnection, testClientCredentials, getClientCredentialsToken } from './shopifyClient';
import { storefrontUrl } from '../shared/shopify';
import { previewSchedule, applySchedule, undoBatch, coverageReport } from './scheduleApply';
import { pinsForRange, exportPack } from './packExporter';
import { createBackup, inspectBackup } from './backup';
import { renderPin } from './images';
import { autoAlt, autoDescription, autoTitle } from '../shared/textgen';
import { isHttpsUrl, isAdminUrl, PINTEREST_CREATE_URL, type SchedulerSettings } from '../shared/types';

// Crash diagnostics: every startup step is logged to a file so a silent
// failure can be diagnosed without devtools. Never throws.
function diagLog(msg: string): void {
  try {
    const stamp = new Date().toISOString();
    const line = `[${stamp}] ${msg}\n`;
    try {
      console.log(line.trim());
    } catch { /* ignore */ }
    const dir = (() => {
      try {
        return app.getPath('userData');
      } catch {
        return null;
      }
    })();
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'startup.log'), line);
    }
  } catch { /* ignore */ }
}

process.on('uncaughtException', (e) => {
  diagLog(`UNCAUGHT: ${e?.stack ?? String(e)}`);
  try {
    dialog.showErrorBox('Pin Studio failed to start', `Something went wrong during startup:\n${e?.message ?? String(e)}\n\nDetails were written to startup.log in the app-data folder.`);
  } catch { /* ignore */ }
});

let win: BrowserWindow | null = null;
let store: Store;
let DIRS: ReturnType<typeof ensureDirs>;
let DB_PATH = '';

const SECRET_KEY = 'shopify_token_enc'; // legacy static token (old-style custom apps)
const CC_SECRET_KEY = 'shopify_client_secret_enc'; // Dev Dashboard client secret
const AI_KEY = 'openai_api_key_enc'; // user's own OpenAI API key (separately billed, never in renderer)

function getSecret(key: string): string | null {
  try {
    const row = store.db.prepare(`SELECT typed_json FROM app_settings WHERE key=?`).get(key) as { typed_json: string } | undefined;
    if (!row) return null;
    const payload = JSON.parse(row.typed_json) as { enc: string };
    if (!safeStorage.isEncryptionAvailable()) return Buffer.from(payload.enc, 'base64').toString('utf-8');
    return safeStorage.decryptString(Buffer.from(payload.enc, 'base64'));
  } catch {
    return null;
  }
}

function setSecret(key: string, value: string | null): void {
  if (!value) {
    store.db.prepare(`DELETE FROM app_settings WHERE key=?`).run(key);
    return;
  }
  let enc: string;
  if (safeStorage.isEncryptionAvailable()) enc = safeStorage.encryptString(value).toString('base64');
  else enc = Buffer.from(value, 'utf-8').toString('base64');
  store.db.prepare(`INSERT OR REPLACE INTO app_settings(key, typed_json, updated_at) VALUES (?, ?, ?)`).run(key, JSON.stringify({ enc }), nowUtc());
}

interface ResolvedShopCreds {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

/** Resolve a usable access token for the stored connection (both auth modes). */
async function resolveShopCreds(conn: { shop_domain: string; api_version: string; auth_mode: string; client_id: string | null }): Promise<ResolvedShopCreds> {
  if (conn.auth_mode === 'client_credentials') {
    if (!conn.client_id) throw new Error('Client ID is missing. Reconnect in Settings.');
    const secret = getSecret(CC_SECRET_KEY);
    if (!secret) throw new Error('Client secret is missing. Reconnect in Settings.');
    const { accessToken } = await getClientCredentialsToken({ shopDomain: conn.shop_domain, clientId: conn.client_id, clientSecret: secret });
    return { shopDomain: conn.shop_domain, accessToken, apiVersion: conn.api_version };
  }
  const token = getSecret(SECRET_KEY);
  if (!token) throw new Error('Access token is missing. Reconnect in Settings.');
  return { shopDomain: conn.shop_domain, accessToken: token, apiVersion: conn.api_version };
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 740,
    backgroundColor: '#F7F4F0',
    title: 'Pin Studio',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.maximize(); // open maximized by default; standard min/max/close buttons stay visible
  const devUrl = process.env.VITE_DEV_URL || 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    win.loadURL(devUrl).catch(() => {
      win?.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
    });
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }
}

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}
function fail(message: string): { ok: false; error: string } {
  // Never leak tokens: scrub anything resembling one.
  return { ok: false, error: message.replace(/shpat_[A-Za-z0-9_-]+/g, 'shpat_***').replace(/shpss_[A-Za-z0-9_-]+/g, 'shpss_***').replace(/xoxo-[A-Za-z0-9-]+/g, 'xoxo-***').replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***') };
}

function dataUrl(filePath: string | null): string | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch {
    return null;
  }
}

function registerIpc(): void {
  ipcMain.handle('app:state', () =>
    ok({
      version: app.getVersion(),
      dataDir: app.getPath('userData'),
      demoMode: (store.getSetting('general', { demoMode: false }) as { demoMode: boolean }).demoMode === true,
    }),
  );

  // ---------- catalog ----------
  ipcMain.handle('catalog:stats', () => {
    const q = (sql: string) => (store.db.prepare(sql).get() as { c: number }).c;
    return ok({
      products: q(`SELECT COUNT(*) c FROM products`),
      images: q(`SELECT COUNT(*) c FROM product_images`),
      approved: q(`SELECT COUNT(*) c FROM product_images WHERE review_state='approved'`),
      drafts: q(`SELECT COUNT(*) c FROM pin_drafts`),
      dueToday: q(`SELECT COUNT(*) c FROM schedule_entries WHERE local_date = date('now','localtime')`),
      posted: q(`SELECT COUNT(*) c FROM pin_drafts WHERE posting_state='posted'`),
      upcoming7: q(`SELECT COUNT(*) c FROM schedule_entries WHERE local_date BETWEEN date('now','localtime') AND date('now','+7 days','localtime')`),
      upcoming30: q(`SELECT COUNT(*) c FROM schedule_entries WHERE local_date BETWEEN date('now','localtime') AND date('now','+30 days','localtime')`),
      unusedApproved: q(`SELECT COUNT(*) c FROM product_images pi WHERE pi.review_state='approved' AND NOT EXISTS (SELECT 1 FROM pin_drafts d WHERE d.product_image_id = pi.id)`),
      lastSync: (store.db.prepare(`SELECT last_sync_at FROM shop_connections ORDER BY last_sync_at DESC LIMIT 1`).get() as { last_sync_at: string } | undefined)?.last_sync_at ?? null,
    });
  });

  ipcMain.handle('catalog:importFolder', async (_e, args: { folder: string; title: string; url: string }) => {
    try {
      if (!args.folder || !fs.existsSync(args.folder)) return fail('Folder not found.');
      const r = await importFolder(store, DIRS, args.folder, args.title || 'Manual product', args.url || '');
      return ok(r);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  // ---------- products ----------
  ipcMain.handle('products:list', (_e, args: { search?: string; stock?: string } = {}) => {
    let sql = `SELECT p.*, (SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) AS image_count,
      (SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id AND i.review_state='approved') AS approved_count,
      (SELECT COUNT(*) FROM pin_drafts d JOIN schedule_entries s ON s.pin_draft_id=d.id WHERE d.product_id = p.id) AS scheduled_count,
      (SELECT COUNT(*) FROM pin_drafts d WHERE d.product_id = p.id AND d.posting_state='posted') AS posted_count
      FROM products p`;
    const where: string[] = [];
    const params: unknown[] = [];
    if (args.search) {
      where.push(`(p.title LIKE ? OR p.handle LIKE ?)`);
      params.push(`%${args.search}%`, `%${args.search}%`);
    }
    if (args.stock === 'zero') where.push(`NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)`);
    if (args.stock === '1-4') where.push(`(SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) BETWEEN 1 AND 4`);
    if (args.stock === '5-9') where.push(`(SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) BETWEEN 5 AND 9`);
    if (args.stock === '10plus') where.push(`(SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) >= 10`);
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY p.title';
    return ok(store.db.prepare(sql).all(...params));
  });

  ipcMain.handle('products:get', (_e, args: { id: string }) => {
    const p = store.db.prepare(`SELECT * FROM products WHERE id = ?`).get(args.id);
    if (!p) return fail('Product not found.');
    const images = store.db.prepare(`SELECT * FROM product_images WHERE product_id = ? ORDER BY source_order`).all(args.id);
    return ok({ product: p, images });
  });

  ipcMain.handle('products:update', (_e, args: { id: string; patch: Record<string, unknown> }) => {
    const allowed = ['include_in_schedule', 'priority', 'custom_url_override', 'preferred_local_board_id', 'title'] as const;
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of allowed) {
      if (k in args.patch) {
        sets.push(`${k} = ?`);
        params.push(args.patch[k]);
      }
    }
    if (!sets.length) return fail('Nothing to update.');
    params.push(args.id);
    store.db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    store.activity('product-edit', `Product ${args.id} updated.`);
    return ok({ updated: true });
  });

  // ---------- images ----------
  ipcMain.handle('images:list', (_e, args: { review?: string; productId?: string; search?: string; limit?: number; offset?: number } = {}) => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (args.review && args.review !== 'all') {
      where.push(`pi.review_state = ?`);
      params.push(args.review);
    }
    if (args.productId) {
      where.push(`pi.product_id = ?`);
      params.push(args.productId);
    }
    if (args.search) {
      where.push(`(p.title LIKE ? OR pi.alt_text LIKE ?)`);
      params.push(`%${args.search}%`, `%${args.search}%`);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (store.db.prepare(`SELECT COUNT(*) c FROM product_images pi JOIN products p ON p.id = pi.product_id ${w}`).get(...params) as { c: number }).c;
    const rows = store.db.prepare(`SELECT pi.*, p.title AS product_title FROM product_images pi JOIN products p ON p.id = pi.product_id ${w} ORDER BY p.title, pi.source_order LIMIT ? OFFSET ?`)
      .all(...params, Math.min(500, args.limit ?? 200), args.offset ?? 0);
    return ok({ rows, total });
  });

  ipcMain.handle('images:thumb', (_e, args: { id: string }) => ok({ dataUrl: dataUrl((store.db.prepare(`SELECT thumb_local_path FROM product_images WHERE id=?`).get(args.id) as { thumb_local_path: string } | undefined)?.thumb_local_path ?? null) }));
  ipcMain.handle('images:original', (_e, args: { id: string }) => ok({ dataUrl: dataUrl((store.db.prepare(`SELECT original_local_path FROM product_images WHERE id=?`).get(args.id) as { original_local_path: string } | undefined)?.original_local_path ?? null) }));

  ipcMain.handle('images:review', (_e, args: { ids: string[]; state: string }) => {
    if (!['new', 'approved', 'rejected'].includes(args.state)) return fail('Bad review state.');
    if (!Array.isArray(args.ids) || args.ids.length === 0) return fail('No images selected.');
    if (args.ids.length > 2000) return fail('Too many at once — select fewer than 2000, or use Approve all.');
    const stmt = store.db.prepare(`UPDATE product_images SET review_state = ?, updated_at = ? WHERE id = ?`);
    const txn = store.db.transaction(() => {
      for (const id of args.ids) stmt.run(args.state, nowUtc(), id);
    });
    txn();
    store.activity('review', `${args.ids.length} image(s) marked ${args.state}.`);
    return ok({ updated: args.ids.length });
  });

  // Bulk review: approve/reject everything matching the current Library filter.
  ipcMain.handle('images:reviewFiltered', (_e, args: { state: string; review?: string; productId?: string; search?: string }) => {
    try {
      const r = bulkReview(store, { state: args.state as 'new' | 'approved' | 'rejected', review: args.review, productId: args.productId, search: args.search });
      return ok(r);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  // Regenerate sharper thumbnails (e.g. after the thumbnail size upgrade).
  ipcMain.handle('images:rebuildThumbs', async (event) => {
    try {
      const send = (done: number, total: number): void => {
        event.sender.send('thumbs:progress', { done, total });
      };
      const r = await rebuildThumbs(store, DIRS, send);
      return ok(r);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  // ---------- boards ----------
  ipcMain.handle('boards:list', () => ok(store.db.prepare(`SELECT * FROM local_boards ORDER BY is_default DESC, name`).all()));
  ipcMain.handle('boards:create', (_e, args: { name: string }) => {
    const name = (args.name || '').trim();
    if (!name) return fail('Board name is required.');
    if (name.length > 80) return fail('Board name is too long (max 80).');
    try {
      const id = uid('board');
      store.db.prepare(`INSERT INTO local_boards(id, name, color, is_default, created_at, updated_at) VALUES (?, ?, '#B48E78', 0, ?, ?)`).run(id, name, nowUtc(), nowUtc());
      return ok({ id, name });
    } catch {
      return fail('That board name already exists.');
    }
  });
  ipcMain.handle('boards:delete', (_e, args: { id: string }) => {
    store.db.prepare(`DELETE FROM local_boards WHERE id = ?`).run(args.id);
    return ok({ deleted: true });
  });

  // ---------- schedule ----------
  ipcMain.handle('schedule:settings:get', () => ok(store.getSetting('scheduler', {})));
  ipcMain.handle('schedule:settings:set', (_e, args: { settings: SchedulerSettings }) => {
    store.setSetting('scheduler', args.settings);
    return ok({ saved: true });
  });
  ipcMain.handle('schedule:preview', (_e, args: { settings: SchedulerSettings }) => {
    try {
      return ok({ slots: previewSchedule(store, args.settings) });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
  ipcMain.handle('schedule:coverage', (_e, args: { settings: SchedulerSettings }) => {
    try {
      return ok(coverageReport(store, args.settings));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
  ipcMain.handle('schedule:apply', (_e, args: { settings: SchedulerSettings; slots: Array<{ date: string; time: string; product_id: string | null; product_image_id?: string | null }> }) => {
    try {
      const r = applySchedule(store, args.settings, args.slots);
      return ok(r);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
  ipcMain.handle('schedule:undo', (_e, args: { batchId: string }) => ok(undoBatch(store, args.batchId)));

  ipcMain.handle('schedule:list', (_e, args: { from: string; to: string } = { from: '2000-01-01', to: '2100-01-01' }) => {
    const rows = store.db.prepare(`
      SELECT se.id AS entry_id, se.local_date, se.local_time, se.timezone, se.planned_utc, se.locked, se.moved_manually, se.generation_batch_id,
        d.*, p.handle, COALESCE(pi.source_order, 1) AS image_order, pi.original_local_path AS source_path
      FROM schedule_entries se JOIN pin_drafts d ON d.id = se.pin_draft_id
      JOIN products p ON p.id = d.product_id LEFT JOIN product_images pi ON pi.id = d.product_image_id
      WHERE se.local_date BETWEEN ? AND ? ORDER BY se.local_date, se.local_time
    `).all(args.from, args.to);
    return ok({ entries: rows });
  });

  ipcMain.handle('schedule:move', (_e, args: { entryId: string; date: string; time: string }) => {
    const entry = store.db.prepare(`SELECT se.*, d.product_id, d.product_image_id FROM schedule_entries se JOIN pin_drafts d ON d.id = se.pin_draft_id WHERE se.id = ?`).get(args.entryId) as { product_id: string; product_image_id: string; timezone: string } | undefined;
    if (!entry) return fail('Entry not found.');
    // Gap check against all other entries
    const others = store.db.prepare(`SELECT d.product_id, d.product_image_id AS image_id, se.local_date AS date FROM schedule_entries se JOIN pin_drafts d ON d.id = se.pin_draft_id WHERE se.id != ?`).all(args.entryId) as Array<{ product_id: string; image_id: string; date: string }>;
    const settings = store.getSetting('scheduler', { minProductGapDays: 14 }) as { minProductGapDays: number };
    const gap = settings.minProductGapDays ?? 14;
    const toDay = (s: string): number => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
    const target = toDay(args.date);
    for (const o of others) {
      if (o.product_id === entry.product_id && Math.abs(target - toDay(o.date)) < gap) {
        return fail(`Same-product gap: this product already appears within ${gap} days of ${args.date}.`);
      }
      if (o.image_id && o.image_id === entry.product_image_id) return fail('That photo is already scheduled elsewhere.');
    }
    store.db.prepare(`UPDATE schedule_entries SET local_date=?, local_time=?, moved_manually=1, updated_at=? WHERE id=?`).run(args.date, args.time, nowUtc(), args.entryId);
    store.activity('schedule-move', `Moved entry ${args.entryId} to ${args.date} ${args.time}.`);
    return ok({ moved: true });
  });

  ipcMain.handle('schedule:lock', (_e, args: { entryId: string; locked: boolean }) => {
    store.db.prepare(`UPDATE schedule_entries SET locked=?, updated_at=? WHERE id=?`).run(args.locked ? 1 : 0, nowUtc(), args.entryId);
    return ok({ locked: args.locked });
  });

  ipcMain.handle('schedule:delete', (_e, args: { entryId: string }) => {
    const e = store.db.prepare(`SELECT pin_draft_id FROM schedule_entries WHERE id=?`).get(args.entryId) as { pin_draft_id: string } | undefined;
    if (!e) return fail('Entry not found.');
    store.db.prepare(`DELETE FROM schedule_entries WHERE id=?`).run(args.entryId);
    if (!store.db.prepare(`SELECT id FROM schedule_entries WHERE pin_draft_id=?`).get(e.pin_draft_id)) {
      store.db.prepare(`DELETE FROM pin_drafts WHERE id=?`).run(e.pin_draft_id);
    }
    store.activity('schedule-delete', `Deleted schedule entry ${args.entryId}.`);
    return ok({ deleted: true });
  });

  // ---------- pins ----------
  ipcMain.handle('pins:get', (_e, args: { id: string }) => {
    const d = store.db.prepare(`SELECT d.*, p.handle, COALESCE(pi.source_order,1) AS image_order, pi.original_local_path AS source_path, pi.thumb_local_path AS thumb_path, se.local_date, se.local_time, se.timezone, se.planned_utc, se.locked
      FROM pin_drafts d JOIN products p ON p.id=d.product_id LEFT JOIN product_images pi ON pi.id=d.product_image_id LEFT JOIN schedule_entries se ON se.pin_draft_id=d.id WHERE d.id=?`).get(args.id);
    if (!d) return fail('Pin not found.');
    return ok({ pin: d });
  });

  ipcMain.handle('pins:update', (_e, args: { id: string; patch: Record<string, unknown> }) => {
    const allowed = ['title', 'description', 'alt_text', 'destination_url', 'board_name', 'template_id', 'notes', 'review_state'] as const;
    const cur = store.db.prepare(`SELECT * FROM pin_drafts WHERE id=?`).get(args.id) as Record<string, unknown> | undefined;
    if (!cur) return fail('Pin not found.');
    if (cur['posting_state'] === 'posted') return fail('Posted pins are read-only history. Duplicate it to make changes.');
    const sets: string[] = [];
    const params: unknown[] = [];
    let bump = false;
    for (const k of allowed) {
      if (k in args.patch) {
        if (k === 'destination_url') {
          const u = String(args.patch[k] ?? '');
          if (u && (!isHttpsUrl(u) || isAdminUrl(u))) return fail('Destination must be a public https product URL (never a Shopify admin URL).');
        }
        if (k === 'board_name' && !String(args.patch[k] ?? '').trim()) return fail('Board name is required.');
        sets.push(`${k} = ?`);
        params.push(args.patch[k]);
        if (['title', 'description', 'alt_text', 'destination_url', 'template_id'].includes(k)) bump = true;
      }
    }
    if (!sets.length) return fail('Nothing to update.');
    if (bump) {
      sets.push(`metadata_revision = metadata_revision + 1`);
      // content changed after review → needs review
      if (cur['review_state'] === 'reviewed') sets.push(`review_state = 'needs_review'`);
    }
    sets.push(`updated_at = ?`);
    params.push(nowUtc(), args.id);
    store.db.prepare(`UPDATE pin_drafts SET ${sets.join(', ')} WHERE id=?`).run(...params);
    return ok({ updated: true });
  });

  ipcMain.handle('pins:autofill', (_e, args: { id: string }) => {
    const d = store.db.prepare(`SELECT d.*, p.title AS pt, p.description AS pd, p.product_type, p.tags_json, p.collections_json FROM pin_drafts d JOIN products p ON p.id=d.product_id WHERE d.id=?`).get(args.id) as Record<string, string> | undefined;
    if (!d) return fail('Pin not found.');
    const facts = { title: d['pt'], description: d['pd'], productType: d['product_type'] ?? '', tags: JSON.parse(d['tags_json'] || '[]') as string[], collections: JSON.parse(d['collections_json'] || '[]') as string[] };
    const url = d['destination_url'] as string;
    store.db.prepare(`UPDATE pin_drafts SET title=?, description=?, alt_text=?, metadata_revision=metadata_revision+1, updated_at=? WHERE id=?`)
      .run(autoTitle(facts), autoDescription(facts, url), autoAlt(facts), nowUtc(), args.id);
    return ok({ filled: true });
  });

  // ---------- AI copy (user's own OpenAI key, main-process only) ----------
  ipcMain.handle('ai:status', () => {
    const cfg = store.getSetting('ai', { model: DEFAULT_AI_MODEL }) as { model: string };
    return ok({ hasKey: getSecret(AI_KEY) !== null, model: cfg.model });
  });
  ipcMain.handle('ai:setKey', async (_e, args: { key: string; model: string }) => {
    const key = (args.key ?? '').trim();
    if (!key) return fail('Paste your OpenAI API key first (platform.openai.com → API keys).');
    if (!isSupportedAiModel(args.model)) return fail('Unsupported model.');
    try {
      await validateOpenAIKey(key);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    setSecret(AI_KEY, key);
    store.setSetting('ai', { model: args.model });
    store.activity('ai-key', `AI copy key saved (model ${args.model}). Key stays in OS-protected storage.`);
    return ok({ saved: true });
  });
  ipcMain.handle('ai:clearKey', () => {
    setSecret(AI_KEY, null);
    store.activity('ai-key', 'AI copy key removed.');
    return ok({ cleared: true });
  });
  ipcMain.handle('ai:enhance', async (_e, args: { pinId: string }) => {
    const key = getSecret(AI_KEY);
    if (!key) return fail('No OpenAI API key. Add one in Settings → AI copy first.');
    const cfg = store.getSetting('ai', { model: DEFAULT_AI_MODEL }) as { model: string };
    const d = store.db.prepare(`SELECT d.title, d.description, d.board_name, p.title AS pt, p.description AS pd, p.product_type, p.tags_json, p.collections_json
      FROM pin_drafts d JOIN products p ON p.id=d.product_id WHERE d.id=?`).get(args.pinId) as Record<string, string> | undefined;
    if (!d) return fail('Pin not found.');
    const facts = {
      productTitle: d['pt'] ?? '',
      productDescription: d['pd'] ?? '',
      productType: d['product_type'] ?? '',
      collections: JSON.parse(d['collections_json'] || '[]') as string[],
      tags: JSON.parse(d['tags_json'] || '[]') as string[],
      boardName: d['board_name'] ?? '',
      currentTitle: d['title'] ?? '',
      currentDescription: d['description'] ?? '',
    };
    try {
      const r = await enhanceWithOpenAI(key, cfg.model, buildSeoMessages(facts));
      store.activity('ai-enhance', `AI SEO suggestions generated for pin ${args.pinId} (shown for review, nothing auto-saved).`);
      return ok({ ...r, model: cfg.model });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle('pins:markPosted', (_e, args: { id: string; pinUrl?: string; notes?: string }) => {
    if (args.pinUrl && args.pinUrl.trim()) {
      try {
        const u = new URL(args.pinUrl.trim());
        if (u.protocol !== 'https:' || !/pinterest\./i.test(u.hostname)) return fail('Pin URL must be an https Pinterest link (or leave empty).');
      } catch {
        return fail('Pin URL is not a valid URL.');
      }
    }
    const n = nowUtc();
    store.db.prepare(`UPDATE pin_drafts SET posting_state='posted', updated_at=? WHERE id=?`).run(n, args.id);
    store.db.prepare(`INSERT INTO manual_post_records(id, pin_draft_id, actual_posted_utc, pin_url, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uid('post'), args.id, n, args.pinUrl?.trim() || null, args.notes?.trim() || null, n);
    store.activity('posted', `Pin ${args.id} marked posted by user.`);
    return ok({ posted: true, at: n });
  });

  ipcMain.handle('pins:undoPosted', (_e, args: { id: string }) => {
    store.db.prepare(`UPDATE pin_drafts SET posting_state='not_posted', updated_at=? WHERE id=?`).run(nowUtc(), args.id);
    store.db.prepare(`DELETE FROM manual_post_records WHERE pin_draft_id=?`).run(args.id);
    store.activity('unposted', `Pin ${args.id} posting undone by user.`);
    return ok({ undone: true });
  });

  ipcMain.handle('pins:skip', (_e, args: { id: string; notes?: string }) => {
    store.db.prepare(`UPDATE pin_drafts SET posting_state='skipped', notes=?, updated_at=? WHERE id=?`).run(args.notes ?? null, nowUtc(), args.id);
    store.activity('skipped', `Pin ${args.id} skipped by user.`);
    return ok({ skipped: true });
  });

  ipcMain.handle('pins:restore', (_e, args: { id: string }) => {
    store.db.prepare(`UPDATE pin_drafts SET posting_state='not_posted', updated_at=? WHERE id=?`).run(nowUtc(), args.id);
    return ok({ restored: true });
  });

  // ---------- copy desk ----------
  async function ensureRender(pinId: string): Promise<string> {
    const d = store.db.prepare(`SELECT d.*, pi.original_local_path AS source_path FROM pin_drafts d LEFT JOIN product_images pi ON pi.id=d.product_image_id WHERE d.id=?`).get(pinId) as { source_path: string | null; template_id: string; title: string; metadata_revision: number } | undefined;
    if (!d || !d.source_path || !fs.existsSync(d.source_path)) throw new Error('Original photo is missing — re-sync or restore from backup first.');
    const exp = store.getSetting('exports', { format: 'jpg', quality: 88, background: '#F7F4F0' }) as { format: string; quality: number; background: string };
    const format = exp.format === 'png' ? 'png' : 'jpg';
    const out = path.join(DIRS.rendersDir, `${pinId}_r${d.metadata_revision}_${d.template_id}.${format}`);
    const existing = store.db.prepare(`SELECT output_path FROM export_assets WHERE pin_draft_id=? AND metadata_revision=? AND design_checksum=?`).get(pinId, d.metadata_revision, `${d.template_id}:${d.metadata_revision}`) as { output_path: string } | undefined;
    if (existing && fs.existsSync(existing.output_path)) return existing.output_path;
    if (fs.existsSync(out)) return out;
    const r = await renderPin(d.source_path, out, { template: d.template_id, title: d.title, format: format as 'jpg' | 'png', quality: exp.quality ?? 88, background: exp.background ?? '#F7F4F0' });
    store.db.prepare(`INSERT INTO export_assets(id, pin_draft_id, metadata_revision, design_checksum, output_path, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(uid('exp'), pinId, d.metadata_revision, `${d.template_id}:${d.metadata_revision}`, r.path, r.sha256, nowUtc());
    return r.path;
  }

  ipcMain.handle('desk:prepareImage', async (_e, args: { pinId: string }) => {
    try {
      const p = await ensureRender(args.pinId);
      return ok({ path: p });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle('desk:copyImage', async (_e, args: { pinId: string }) => {
    try {
      const p = await ensureRender(args.pinId);
      const img = nativeImage.createFromBuffer(fs.readFileSync(p));
      if (img.isEmpty()) return fail('Rendered image is empty — use Save / Reveal File instead.');
      clipboard.writeImage(img);
      store.db.prepare(`INSERT INTO copy_actions(id, pin_draft_id, field_name, at_utc) VALUES (?, ?, 'image', ?)`).run(uid('copy'), args.pinId, nowUtc());
      const check = clipboard.readImage();
      if (check.isEmpty()) return fail('OS clipboard refused the image — use Save / Reveal File instead.');
      return ok({ copied: true });
    } catch (e) {
      return fail((e instanceof Error ? e.message : String(e)) + ' — use Save / Reveal File instead.');
    }
  });

  ipcMain.handle('desk:copyText', (_e, args: { pinId?: string; field?: string; text: string }) => {
    if (!args.text) return fail('Nothing to copy — this field is empty.');
    clipboard.writeText(args.text);
    if (args.pinId && args.field) {
      store.db.prepare(`INSERT INTO copy_actions(id, pin_draft_id, field_name, at_utc) VALUES (?, ?, ?, ?)`).run(uid('copy'), args.pinId, args.field, nowUtc());
    }
    return ok({ copied: true });
  });

  ipcMain.handle('desk:openPinterest', async () => {
    await shell.openExternal(PINTEREST_CREATE_URL);
    return ok({ opened: true });
  });

  ipcMain.handle('desk:reveal', (_e, args: { filePath: string }) => {
    try {
      const p = path.normalize(args.filePath);
      const allowed = [DIRS.rendersDir, DIRS.exportsDir, app.getPath('userData')].some((base) => p.startsWith(path.normalize(base)));
      if (!allowed || !fs.existsSync(p)) return fail('File not found or outside the app workspace.');
      shell.showItemInFolder(p);
      return ok({ revealed: true });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle('desk:saveAs', async (_e, args: { pinId: string }) => {
    try {
      const p = await ensureRender(args.pinId);
      const d = store.db.prepare(`SELECT title FROM pin_drafts WHERE id=?`).get(args.pinId) as { title: string } | undefined;
      const res = await dialog.showSaveDialog(win!, {
        defaultPath: (d?.title || 'pin').replace(/[^a-z0-9]+/gi, '-').slice(0, 60) + path.extname(p),
        filters: [{ name: 'Images', extensions: ['jpg', 'png'] }],
      });
      if (res.canceled || !res.filePath) return ok({ saved: false });
      fs.copyFileSync(p, res.filePath);
      return ok({ saved: true, path: res.filePath });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  // ---------- exports ----------
  ipcMain.handle('exports:pack', async (_e, args: { from: string; to: string; label: string }) => {
    try {
      const pins = pinsForRange(store, args.from, args.to);
      if (!pins.length) return fail('No scheduled pins in that range.');
      const exp = store.getSetting('exports', { format: 'jpg' }) as { format: string };
      const r = await exportPack(store, DIRS, DIRS.exportsDir, args.label, pins, exp.format === 'png' ? 'png' : 'jpg');
      return ok(r);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle('exports:revealDir', (_e, args: { dir: string }) => {
    const p = path.normalize(args.dir);
    if (!p.startsWith(path.normalize(DIRS.exportsDir)) || !fs.existsSync(p)) return fail('Export folder not found.');
    shell.openPath(p);
    return ok({ opened: true });
  });

  // ---------- backups ----------
  ipcMain.handle('backup:create', async (_e, args: { includeImages?: boolean }) => {
    try {
      return ok(await createBackup(store, DB_PATH, DIRS, path.join(app.getPath('userData'), 'backups'), args.includeImages !== false));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
  ipcMain.handle('backup:list', () => ok(store.db.prepare(`SELECT * FROM backup_history ORDER BY created_at DESC`).all()));
  ipcMain.handle('backup:inspect', (_e, args: { backupPath: string }) => ok(inspectBackup(args.backupPath)));

  // ---------- settings ----------
  ipcMain.handle('settings:get', (_e, args: { key: string }) => ok(store.getSetting(args.key, null)));
  ipcMain.handle('settings:set', (_e, args: { key: string; value: unknown }) => {
    store.setSetting(args.key, args.value);
    return ok({ saved: true });
  });

  // ---------- shopify ----------
  ipcMain.handle('shopify:status', () => {
    const conns = store.db.prepare(`SELECT id, shop_domain, storefront_domain, auth_mode, client_id, scopes, last_sync_at, api_version FROM shop_connections`).all() as Array<Record<string, unknown>>;
    const publicConns = conns.map((c) => ({
      ...c,
      client_id: c.client_id ? `${String(c.client_id).slice(0, 6)}…` : null,
      hasCredentials: c.auth_mode === 'client_credentials' ? getSecret(CC_SECRET_KEY) !== null : getSecret(SECRET_KEY) !== null,
    }));
    return ok({ connections: publicConns });
  });

  ipcMain.handle('shopify:connect', async (_e, args: { shopDomain: string; storefrontDomain: string; authMode: string; token?: string; clientId?: string; clientSecret?: string; apiVersion?: string }) => {
    try {
      const shop = args.shopDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(shop)) return fail('Shop domain must look like your-store.myshopify.com.');
      const apiVersion = args.apiVersion || '2026-10';
      const storefront = args.storefrontDomain.trim() || `https://${shop}`;
      const id = uid('shop');
      if (args.authMode === 'client_credentials') {
        const clientId = (args.clientId ?? '').trim();
        const clientSecret = (args.clientSecret ?? '').trim();
        if (!clientId) return fail('Client ID is required. Find it in the Dev Dashboard → your app → Settings.');
        if (!clientSecret) return fail('Client secret is required. Find it in the Dev Dashboard → your app → Settings.');
        const t = await testClientCredentials({ shopDomain: shop, clientId, clientSecret }, apiVersion);
        store.db.prepare(`INSERT INTO shop_connections(id, shop_domain, storefront_domain, auth_mode, credential_ref, client_id, scopes, last_sync_at, api_version) VALUES (?, ?, ?, 'client_credentials', 'safeStorage', ?, ?, NULL, ?)`)
          .run(id, shop, storefront, clientId, t.scope || 'read_products', apiVersion);
        setSecret(CC_SECRET_KEY, clientSecret);
        setSecret(SECRET_KEY, null);
        store.activity('shopify-connect', `Shopify connected (Dev Dashboard app): ${shop} (${t.shopName}).`);
        return ok({ id, shopName: t.shopName });
      }
      if (!(args.token ?? '').trim()) return fail('Access token is required.');
      const creds = { shopDomain: shop, accessToken: args.token!.trim(), apiVersion };
      const t = await testConnection(creds);
      store.db.prepare(`INSERT INTO shop_connections(id, shop_domain, storefront_domain, auth_mode, credential_ref, client_id, scopes, last_sync_at, api_version) VALUES (?, ?, ?, 'token', 'safeStorage', NULL, 'read_products', NULL, ?)`)
        .run(id, shop, storefront, apiVersion);
      setSecret(SECRET_KEY, creds.accessToken);
      setSecret(CC_SECRET_KEY, null);
      store.activity('shopify-connect', `Shopify connected (custom app token): ${shop} (${t.shopName}).`);
      return ok({ id, shopName: t.shopName });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle('shopify:disconnect', () => {
    setSecret(SECRET_KEY, null);
    setSecret(CC_SECRET_KEY, null);
    store.db.prepare(`DELETE FROM shop_connections`).run();
    store.activity('shopify-disconnect', 'Shopify disconnected; local data kept.');
    return ok({ disconnected: true });
  });

  ipcMain.handle('shopify:sync', async (event) => {
    const send = (msg: string, done?: number, total?: number): void => {
      event.sender.send('shopify:progress', { msg, done, total });
    };
    try {
      const conn = store.db.prepare(`SELECT * FROM shop_connections ORDER BY rowid DESC LIMIT 1`).get() as { id: string; shop_domain: string; storefront_domain: string; api_version: string; auth_mode: string; client_id: string | null } | undefined;
      if (!conn) return fail('No Shopify connection. Connect in Settings first, or import a folder in Settings.');
      let creds: { shopDomain: string; accessToken: string; apiVersion: string };
      try {
        creds = await resolveShopCreds(conn);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
      const runId = uid('run');
      store.db.prepare(`INSERT INTO sync_runs(id, started_at, status) VALUES (?, ?, 'running')`).run(runId, nowUtc());
      send('Fetching products…');
      const products = await fetchAllShopifyProducts(creds, (c) => send(`Fetching products… (${c} pages)`));
      const mapped = products.map((p) => ({
        gid: p.id,
        handle: p.handle,
        title: p.title,
        descriptionHtml: p.descriptionHtml ?? '',
        status: p.status ?? 'ACTIVE',
        tags: p.tags ?? [],
        collections: p.collections ?? [],
        productType: p.productType ?? '',
        storefrontUrl: p.onlineStoreUrl && !isAdminUrl(p.onlineStoreUrl) ? p.onlineStoreUrl : storefrontUrl(conn.storefront_domain, p.handle),
      }));
      const { added, updated } = upsertShopifyProducts(store, conn.id, mapped);
      const { created: boardsCreated } = syncBoardsFromCollections(store, mapped);
      send(`Syncing photos for ${mapped.length} products…`, 0, mapped.length);
      let mediaTotal = 0;
      let failed = 0;
      for (let i = 0; i < mapped.length; i++) {
        const m = mapped[i];
        const id = shopProductId(m.gid);
        try {
          const media = await fetchAllShopifyMedia(creds, m.gid);
          const usable = media
            .map((x, idx) => ({ gid: x.id, alt: x.alt ?? null, url: x.image?.url ?? null, width: x.image?.width ?? null, height: x.image?.height ?? null, order: idx + 1 }))
            .filter((x) => x.url);
          const r = await reconcileMedia(store, DIRS, id, usable, true);
          mediaTotal += r.downloaded;
        } catch (e) {
          failed++;
          store.db.prepare(`INSERT INTO sync_errors(id, run_id, message, at_utc) VALUES (?, ?, ?, ?)`).run(uid('err'), runId, `${m.handle}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500), nowUtc());
        }
        if (i % 5 === 0) send(`Syncing photos… ${i + 1}/${mapped.length}`, i + 1, mapped.length);
      }
      store.db.prepare(`UPDATE sync_runs SET finished_at=?, product_count=?, image_count=?, status=? WHERE id=?`).run(nowUtc(), mapped.length, mediaTotal, failed ? 'partial' : 'done', runId);
      store.db.prepare(`UPDATE shop_connections SET last_sync_at=? WHERE id=?`).run(nowUtc(), conn.id);
      store.activity('shopify-sync', `Shopify sync: ${mapped.length} products (${added} new, ${updated} updated), ${mediaTotal} photos downloaded${boardsCreated ? `, ${boardsCreated} new boards from your collections` : ''}${failed ? `, ${failed} product(s) with errors` : ''}.`);
      send('Sync complete.');
      return ok({ products: mapped.length, added, updated, downloaded: mediaTotal, failed, boardsCreated });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        store.db.prepare(`UPDATE sync_runs SET finished_at=?, status='failed', detail=? WHERE status='running'`).run(nowUtc(), msg.slice(0, 500));
      } catch { /* ignore */ }
      send(`Sync failed: ${msg}`);
      return fail(msg);
    }
  });

  // ---------- danger zone: reset library but keep connection + settings ----------
  ipcMain.handle('data:resetLibrary', (_e, args: { confirm: string }) => {
    try {
      if (args.confirm !== 'RESET') return fail('Type RESET to confirm. Nothing was deleted.');
      const r = resetLibraryData(store, DIRS);
      return ok(r);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  // ---------- dialogs / misc ----------
  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    return ok({ path: r.canceled ? null : r.filePaths[0] ?? null });
  });
  ipcMain.handle('activity:list', (_e, args: { limit?: number } = {}) =>
    ok(store.db.prepare(`SELECT * FROM activity_events ORDER BY at_utc DESC LIMIT ?`).all(Math.min(200, args.limit ?? 60))));
  ipcMain.handle('insights:get', () => {
    const q = (sql: string) => (store.db.prepare(sql).get() as { c: number }).c;
    const perWeek = store.db.prepare(`
      SELECT strftime('%Y-W%W', se.local_date) AS wk, COUNT(*) AS c
      FROM schedule_entries se GROUP BY wk ORDER BY wk DESC LIMIT 12`).all();
    return ok({
      approved: q(`SELECT COUNT(*) c FROM product_images WHERE review_state='approved'`),
      products: q(`SELECT COUNT(DISTINCT product_id) c FROM product_images WHERE review_state='approved'`),
      dresses: q(`SELECT COUNT(DISTINCT product_id) c FROM product_images WHERE review_state='approved'`),
      drafted: q(`SELECT COUNT(*) c FROM pin_drafts`),
      posted: q(`SELECT COUNT(*) c FROM pin_drafts WHERE posting_state='posted'`),
      skipped: q(`SELECT COUNT(*) c FROM pin_drafts WHERE posting_state='skipped'`),
      unused: q(`SELECT COUNT(*) c FROM product_images pi WHERE pi.review_state='approved' AND NOT EXISTS (SELECT 1 FROM pin_drafts d WHERE d.product_image_id = pi.id)`),
      perWeek,
    });
  });
}

async function init(): Promise<void> {
  diagLog(`starting (packaged=${app.isPackaged}) argv=${process.argv.slice(1).join(' ')}`);
  await app.whenReady();
  diagLog('app ready');
  if (process.argv.includes('--smoke')) {
    // Headless self-check: DB + dirs initialise, then quit without opening a window.
    try {
      const d = ensureDirs();
      const s = openStore(path.join(app.getPath('userData'), 'pinstudio.db'));
      const v = (s.db.prepare(`SELECT value FROM schema_meta WHERE key='version'`).get() as { value: string }).value;
      const msg = `SMOKE-MAIN-OK schema=${v} dirs=${Object.keys(d).join(',')}`;
      console.log(msg);
      try {
        fs.writeFileSync(path.join(app.getPath('temp'), 'bp-smoke-main.txt'), `${msg}\n`);
      } catch { /* ignore */ }
    } catch (e) {
      console.error('SMOKE-MAIN-FAIL', e);
      process.exitCode = 1;
    }
    app.quit();
    return;
  }
  try {
    DIRS = ensureDirs();
    diagLog(`dirs ok: ${app.getPath('userData')}`);
    DB_PATH = path.join(app.getPath('userData'), 'pinstudio.db');
    store = openStore(DB_PATH);
    diagLog('store ok');
    registerIpc();
    createWindow();
    diagLog('window created');
  } catch (e) {
    diagLog(`INIT-FAIL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    try {
      dialog.showErrorBox('Pin Studio failed to start', `Startup failed:\n${e instanceof Error ? e.message : String(e)}\n\nSee startup.log in the app-data folder (%APPDATA%/Pin Studio).`);
    } catch { /* ignore */ }
    app.quit();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

void init();
