import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Store, uid, nowUtc } from './db';

function sha256File(p: string): string {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function copyDir(src: string, dest: string): number {
  let count = 0;
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) count += copyDir(s, d);
    else {
      fs.copyFileSync(s, d);
      count++;
    }
  }
  return count;
}

export interface BackupResult {
  id: string;
  path: string;
  sha256: string;
  files: number;
}

/** Create a timestamped backup: DB snapshot + manifest + optional image copies. */
export async function createBackup(
  store: Store,
  dbPath: string,
  dirs: { originalsDir: string; thumbsDir: string; rendersDir: string },
  backupsDir: string,
  includeImages: boolean,
): Promise<BackupResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(backupsDir, `backup-${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  // Checkpoint WAL so the db file is self-contained, then copy.
  try {
    store.db.pragma('wal_checkpoint(TRUNCATE)');
  } catch { /* ignore */ }
  fs.copyFileSync(dbPath, path.join(dest, 'pinstudio.db'));
  let files = 1;
  if (includeImages) {
    files += copyDir(dirs.originalsDir, path.join(dest, 'originals'));
    files += copyDir(dirs.rendersDir, path.join(dest, 'renders'));
  }
  const settings = store.db.prepare(`SELECT key, typed_json FROM app_settings`).all();
  const manifest = {
    created_at: nowUtc(),
    app: 'pin-studio',
    version: 1,
    includes_images: includeImages,
    settings,
    counts: {
      products: (store.db.prepare(`SELECT COUNT(*) c FROM products`).get() as { c: number }).c,
      images: (store.db.prepare(`SELECT COUNT(*) c FROM product_images`).get() as { c: number }).c,
      pins: (store.db.prepare(`SELECT COUNT(*) c FROM pin_drafts`).get() as { c: number }).c,
      schedule: (store.db.prepare(`SELECT COUNT(*) c FROM schedule_entries`).get() as { c: number }).c,
      posted: (store.db.prepare(`SELECT COUNT(*) c FROM pin_drafts WHERE posting_state='posted'`).get() as { c: number }).c,
    },
  };
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  const sha = sha256File(path.join(dest, 'pinstudio.db'));
  const id = uid('bak');
  store.db.prepare(`INSERT INTO backup_history(id, path, sha256, created_at, includes_images) VALUES (?, ?, ?, ?, ?)`)
    .run(id, dest, sha, nowUtc(), includeImages ? 1 : 0);
  // Keep only the 7 most recent backups by default.
  const keep = (store.getSetting('backups', { keep: 7 }) as { keep: number }).keep ?? 7;
  const all = store.db.prepare(`SELECT id, path FROM backup_history ORDER BY created_at DESC`).all() as Array<{ id: string; path: string }>;
  for (const old of all.slice(keep)) {
    try {
      fs.rmSync(old.path, { recursive: true, force: true });
    } catch { /* ignore */ }
    store.db.prepare(`DELETE FROM backup_history WHERE id = ?`).run(old.id);
  }
  store.activity('backup', `Backup created at ${dest} (${files} files, images ${includeImages ? 'included' : 'excluded'}).`);
  return { id, path: dest, sha256: sha, files };
}

/** Validate a backup folder before restore. */
export function inspectBackup(backupPath: string): { ok: boolean; manifest: Record<string, unknown>; error?: string } {
  try {
    const dbFile = path.join(backupPath, 'pinstudio.db');
    if (!fs.existsSync(dbFile)) return { ok: false, manifest: {}, error: 'pinstudio.db not found in backup folder.' };
    const manifestPath = path.join(backupPath, 'manifest.json');
    const manifest = fs.existsSync(manifestPath) ? (JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>) : {};
    return { ok: true, manifest };
  } catch (e) {
    return { ok: false, manifest: {}, error: e instanceof Error ? e.message : String(e) };
  }
}
