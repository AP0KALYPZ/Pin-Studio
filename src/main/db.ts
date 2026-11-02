import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA_VERSION = 4;

const MIGRATIONS: string[] = [
  // v1 — full initial schema per PRODUCT_SPEC §6
  `
  CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, typed_json TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS shop_connections(id TEXT PRIMARY KEY, shop_domain TEXT NOT NULL, storefront_domain TEXT NOT NULL, auth_mode TEXT NOT NULL DEFAULT 'token', credential_ref TEXT, scopes TEXT, last_sync_at TEXT, api_version TEXT NOT NULL DEFAULT '2026-10');
  CREATE TABLE IF NOT EXISTS products(
    id TEXT PRIMARY KEY, shop_connection_id TEXT, shopify_gid TEXT, handle TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ACTIVE',
    tags_json TEXT NOT NULL DEFAULT '[]', collections_json TEXT NOT NULL DEFAULT '[]',
    canonical_url TEXT NOT NULL DEFAULT '', custom_url_override TEXT,
    include_in_schedule INTEGER NOT NULL DEFAULT 1, priority TEXT NOT NULL DEFAULT 'Normal',
    preferred_local_board_id TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, missing_source_at TEXT, demo INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS product_images(
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
    shopify_media_gid TEXT, source_order INTEGER NOT NULL DEFAULT 0, alt_text TEXT,
    source_url TEXT, width INTEGER, height INTEGER, sha256 TEXT, perceptual_hash TEXT,
    original_local_path TEXT, thumb_local_path TEXT,
    review_state TEXT NOT NULL DEFAULT 'new', download_state TEXT NOT NULL DEFAULT 'pending',
    missing_source_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(product_id, shopify_media_gid)
  );
  CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id);
  CREATE TABLE IF NOT EXISTS local_boards(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pin_drafts(
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
    product_image_id TEXT REFERENCES product_images(id),
    title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', alt_text TEXT,
    destination_url TEXT NOT NULL DEFAULT '', local_board_id TEXT REFERENCES local_boards(id),
    board_name TEXT NOT NULL DEFAULT '', template_id TEXT NOT NULL DEFAULT 'original',
    design_json TEXT NOT NULL DEFAULT '{}', metadata_revision INTEGER NOT NULL DEFAULT 1,
    reviewed_revision INTEGER NOT NULL DEFAULT 0, posting_state TEXT NOT NULL DEFAULT 'not_posted',
    review_state TEXT NOT NULL DEFAULT 'draft', notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_drafts_product ON pin_drafts(product_id);
  CREATE TABLE IF NOT EXISTS schedule_entries(
    id TEXT PRIMARY KEY, pin_draft_id TEXT NOT NULL REFERENCES pin_drafts(id) ON DELETE CASCADE,
    planned_utc TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'America/Bogota',
    local_date TEXT NOT NULL, local_time TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0, moved_manually INTEGER NOT NULL DEFAULT 0,
    generation_batch_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(pin_draft_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sched_date ON schedule_entries(local_date);
  CREATE TABLE IF NOT EXISTS manual_post_records(
    id TEXT PRIMARY KEY, pin_draft_id TEXT NOT NULL REFERENCES pin_drafts(id) ON DELETE CASCADE,
    actual_posted_utc TEXT NOT NULL, pin_url TEXT, notes TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS copy_actions(id TEXT PRIMARY KEY, pin_draft_id TEXT, field_name TEXT NOT NULL, at_utc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS export_assets(id TEXT PRIMARY KEY, pin_draft_id TEXT NOT NULL REFERENCES pin_drafts(id), metadata_revision INTEGER NOT NULL DEFAULT 1, design_checksum TEXT NOT NULL DEFAULT '', output_path TEXT NOT NULL, sha256 TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sync_runs(id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, product_count INTEGER DEFAULT 0, image_count INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'running', detail TEXT);
  CREATE TABLE IF NOT EXISTS sync_errors(id TEXT PRIMARY KEY, run_id TEXT, message TEXT NOT NULL, at_utc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS activity_events(id TEXT PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, at_utc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS backup_history(id TEXT PRIMARY KEY, path TEXT NOT NULL, sha256 TEXT, created_at TEXT NOT NULL, includes_images INTEGER NOT NULL DEFAULT 0);
  `,
  // v2 — image review notes
  `
  CREATE TABLE IF NOT EXISTS image_review_notes(id TEXT PRIMARY KEY, image_id TEXT NOT NULL REFERENCES product_images(id) ON DELETE CASCADE, note TEXT NOT NULL, at_utc TEXT NOT NULL);
  `,
  // v3 — product type column (for Auto Fill) + full-text helper columns
  `
  ALTER TABLE products ADD COLUMN product_type TEXT NOT NULL DEFAULT '';
  `,
  // v4 — Dev Dashboard client-credentials auth (client ID on the row, secret in safeStorage)
  `
  ALTER TABLE shop_connections ADD COLUMN client_id TEXT;
  `,
];

export function uid(prefix = 'id'): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function nowUtc(): string {
  return new Date().toISOString();
}

export class Store {
  db: Database.Database;
  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    this.seedDefaults();
  }

  private migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const row = this.db.prepare(`SELECT value FROM schema_meta WHERE key='version'`).get() as { value: string } | undefined;
    let version = row ? parseInt(row.value, 10) : 0;
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.db.exec(MIGRATIONS[i]);
      version = i + 1;
      this.db.prepare(`INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('version', ?)`).run(String(version));
    }
  }

  private seedDefaults(): void {
    const n = nowUtc();
    const hasBoards = this.db.prepare(`SELECT COUNT(*) c FROM local_boards`).get() as { c: number };
    if (hasBoards.c === 0) {
      const defaults = ['Everyday Style', 'Season Favorites', 'Special Occasions'];
      const ins = this.db.prepare(`INSERT INTO local_boards(id, name, color, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
      defaults.forEach((name, i) => ins.run(uid('board'), name, ['#B48E78', '#84776D', '#5C8069'][i], i === 0 ? 1 : 0, n, n));
    }
    const get = (k: string): { typed_json: string } | undefined => this.db.prepare(`SELECT typed_json FROM app_settings WHERE key=?`).get(k) as { typed_json: string } | undefined;
    const set = (k: string, v: unknown) => this.db.prepare(`INSERT OR REPLACE INTO app_settings(key, typed_json, updated_at) VALUES (?, ?, ?)`).run(k, JSON.stringify(v), n);
    if (!get('scheduler')) {
      set('scheduler', { pinsPerDay: 5, timeSlots: ['09:00', '12:00', '15:00', '18:00', '21:00'], timezone: 'America/Bogota', minProductGapDays: 14, seed: 20261102, startDate: new Date().toISOString().slice(0, 10), days: 30 });
    }
    if (!get('exports')) set('exports', { format: 'jpg', quality: 88, background: '#F7F4F0', template: 'original' });
    if (!get('general')) set('general', { demoMode: false });
  }

  // ---- settings ----
  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare(`SELECT typed_json FROM app_settings WHERE key=?`).get(key) as { typed_json: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.typed_json) as T;
    } catch {
      return fallback;
    }
  }
  setSetting(key: string, value: unknown): void {
    this.db.prepare(`INSERT OR REPLACE INTO app_settings(key, typed_json, updated_at) VALUES (?, ?, ?)`).run(key, JSON.stringify(value), nowUtc());
  }

  activity(kind: string, message: string): void {
    this.db.prepare(`INSERT INTO activity_events(id, kind, message, at_utc) VALUES (?, ?, ?, ?)`).run(uid('evt'), kind, message, nowUtc());
  }

  close(): void {
    this.db.close();
  }
}

let INSTANCE: Store | null = null;

export function openStore(dbPath: string): Store {
  if (INSTANCE) return INSTANCE;
  INSTANCE = new Store(dbPath);
  return INSTANCE;
}

export function getStore(): Store {
  if (!INSTANCE) throw new Error('Store not initialised');
  return INSTANCE;
}
