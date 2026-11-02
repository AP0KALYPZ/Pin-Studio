import { DateTime } from 'luxon';
import { Store, uid, nowUtc } from './db';
import { planSchedule, type EligibleImage, type ExistingEntry } from '../shared/scheduler';
import type { SchedulerSettings } from '../shared/types';
import { autoAlt, autoDescription, autoTitle } from '../shared/textgen';
import { stripHtml } from '../shared/textgen';

export interface PreviewSlot {
  date: string;
  time: string;
  product_id: string | null;
  product_title?: string;
  product_image_id?: string | null;
  reason?: string;
}

/** Collect eligible images: approved, downloaded, live included products, valid URL. */
export function collectEligible(store: Store): EligibleImage[] {
  const rows = store.db.prepare(`
    SELECT pi.id AS image_id, pi.product_id, p.title AS product_title, p.priority, pi.source_order
    FROM product_images pi
    JOIN products p ON p.id = pi.product_id
    WHERE pi.review_state = 'approved'
      AND pi.download_state = 'ready'
      AND pi.missing_source_at IS NULL
      AND p.include_in_schedule = 1
      AND p.missing_source_at IS NULL
      AND COALESCE(p.canonical_url, '') != ''
  `).all() as EligibleImage[];
  return rows;
}

export function collectExisting(store: Store): ExistingEntry[] {
  return store.db.prepare(`
    SELECT se.pin_draft_id, d.product_image_id AS image_id, d.product_id, se.local_date AS date
    FROM schedule_entries se JOIN pin_drafts d ON d.id = se.pin_draft_id
  `).all() as ExistingEntry[];
}

export function previewSchedule(store: Store, settings: SchedulerSettings): PreviewSlot[] {
  const { slots } = planSchedule(collectEligible(store), collectExisting(store), settings, {
    protectedSlots: store.db.prepare(`SELECT local_date AS date, local_time AS time FROM schedule_entries WHERE locked = 1`).all() as Array<{ date: string; time: string }>,
  });
  return slots.map((s) => ('reason' in s && s.reason ? { date: s.date, time: s.time, product_id: null, product_image_id: null, reason: s.reason } : { date: s.date, time: s.time, product_id: s.product_id, product_title: (s as { product_title: string }).product_title, product_image_id: (s as { product_image_id: string }).product_image_id }));
}

export interface CoverageReport {
  /** Approved, ready, unscheduled images that the scheduler can place. */
  remaining: number;
  pinsPerDay: number;
  /** Distinct pinning days the auto-plan needs to place everything remaining. */
  daysNeeded: number;
  /** Last pinning date in the auto-plan (YYYY-MM-DD), or null when nothing remains. */
  endDate: string | null;
  /** Gap-forced idle dates inside the span (no pin that day, spacing rule). */
  idleDays: number;
  /** Images the auto-plan could not place within its safety cap (0 normally). */
  leftover: number;
  /** Effective start date used (never in the past). */
  startDate: string;
}

/** How many days of pinning remain: auto-plan everything left and report the span. Never writes anything. */
export function coverageReport(store: Store, settings: SchedulerSettings): CoverageReport {
  const zone = settings.timezone || 'America/Bogota';
  const today = DateTime.now().setZone(zone).toISODate() ?? new Date().toISOString().slice(0, 10);
  const startDate = settings.startDate && settings.startDate >= today ? settings.startDate : today;
  const pinsPerDay = Math.min(20, Math.max(1, settings.pinsPerDay));
  const eligible = collectEligible(store);
  const existing = collectExisting(store);
  const used = new Set(existing.map((e) => e.image_id));
  const { daysUsed, endDate, idleDays, leftover } = planSchedule(eligible, existing, { ...settings, startDate, days: 0 }, {
    protectedSlots: store.db.prepare(`SELECT local_date AS date, local_time AS time FROM schedule_entries WHERE locked = 1`).all() as Array<{ date: string; time: string }>,
  });
  return { remaining: eligible.filter((e) => !used.has(e.image_id)).length, pinsPerDay, daysNeeded: daysUsed, endDate, idleDays, leftover, startDate };
}

/** Apply a preview: create pin_drafts + schedule_entries in one transaction. Idempotent-ish: skips slots whose image got used concurrently. */
export function applySchedule(store: Store, settings: SchedulerSettings, slots: PreviewSlot[]): { placed: number; empty: number; batchId: string } {
  const batchId = uid('batch');
  const n = nowUtc();
  const defaultBoard = (store.db.prepare(`SELECT name FROM local_boards WHERE is_default = 1`).get() as { name: string } | undefined)?.name
    ?? (store.db.prepare(`SELECT name FROM local_boards ORDER BY name LIMIT 1`).get() as { name: string } | undefined)?.name
    ?? 'Everyday Style';
  let placed = 0;
  let empty = 0;
  const txn = store.db.transaction(() => {
    for (const s of slots) {
      if (!s.product_id || !s.product_image_id) {
        empty++;
        continue;
      }
      // Reuse guard: image already scheduled/posted?
      const dup = store.db.prepare(`SELECT id FROM pin_drafts WHERE product_image_id = ?`).get(s.product_image_id) as { id: string } | undefined;
      if (dup) {
        empty++;
        continue;
      }
      const prod = store.db.prepare(`SELECT id, title, description, canonical_url, custom_url_override, product_type, tags_json, collections_json, preferred_local_board_id FROM products WHERE id = ?`).get(s.product_id) as {
        id: string; title: string; description: string; canonical_url: string; custom_url_override: string | null; product_type: string; tags_json: string; collections_json: string; preferred_local_board_id: string | null;
      } | undefined;
      if (!prod) {
        empty++;
        continue;
      }
      const url = (prod.custom_url_override && prod.custom_url_override.trim()) || prod.canonical_url;
      if (!url) {
        empty++;
        continue;
      }
      const facts = {
        title: prod.title,
        description: prod.description,
        productType: prod.product_type ?? '',
        tags: JSON.parse(prod.tags_json || '[]') as string[],
        collections: JSON.parse(prod.collections_json || '[]') as string[],
      };
      void stripHtml;
      const pinId = uid('pin');
      const preferredBoard = prod.preferred_local_board_id
        ? (store.db.prepare(`SELECT name FROM local_boards WHERE id = ?`).get(prod.preferred_local_board_id) as { name: string } | undefined)?.name
        : undefined;
      const boardName = preferredBoard ?? defaultBoard;
      const title = autoTitle(facts);
      const description = autoDescription(facts, url);
      const alt = autoAlt(facts);
      store.db.prepare(`INSERT INTO pin_drafts(id, product_id, product_image_id, title, description, alt_text, destination_url, board_name, template_id, design_json, metadata_revision, posting_state, review_state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'original', '{}', 1, 'not_posted', 'draft', ?, ?)`).run(pinId, s.product_id, s.product_image_id, title, description, alt, url, boardName, n, n);
      const dt = DateTime.fromISO(`${s.date}T${s.time}`, { zone: settings.timezone });
      const plannedUtc = dt.isValid ? dt.toUTC().toISO()! : new Date(`${s.date}T${s.time}:00Z`).toISOString();
      store.db.prepare(`INSERT INTO schedule_entries(id, pin_draft_id, planned_utc, timezone, local_date, local_time, locked, moved_manually, generation_batch_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`).run(uid('sched'), pinId, plannedUtc, settings.timezone, s.date, s.time, batchId, n, n);
      placed++;
    }
  });
  txn();
  store.activity('schedule-apply', `Schedule applied: ${placed} pins placed, ${empty} empty slots (batch ${batchId}).`);
  return { placed, empty, batchId };
}

/** Undo an applied batch: remove its non-locked, non-posted entries + orphan drafts. */
export function undoBatch(store: Store, batchId: string): { removed: number } {
  const entries = store.db.prepare(`SELECT se.id, se.pin_draft_id FROM schedule_entries se JOIN pin_drafts d ON d.id = se.pin_draft_id WHERE se.generation_batch_id = ? AND se.locked = 0 AND d.posting_state = 'not_posted'`).all(batchId) as Array<{ id: string; pin_draft_id: string }>;
  const txn = store.db.transaction(() => {
    for (const e of entries) {
      store.db.prepare(`DELETE FROM schedule_entries WHERE id = ?`).run(e.id);
      const still = store.db.prepare(`SELECT id FROM schedule_entries WHERE pin_draft_id = ?`).get(e.pin_draft_id);
      if (!still) store.db.prepare(`DELETE FROM pin_drafts WHERE id = ?`).run(e.pin_draft_id);
    }
  });
  txn();
  store.activity('schedule-undo', `Undid schedule batch ${batchId}: removed ${entries.length} entries.`);
  return { removed: entries.length };
}
