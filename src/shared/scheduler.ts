import type { ScheduleEmptySlot, SchedulePreviewItem, ScheduleSlot, SchedulerSettings } from './types';

export interface EligibleImage {
  image_id: string;
  product_id: string;
  product_title: string;
  priority: 'High' | 'Normal' | 'Low';
  source_order: number;
}

export interface ExistingEntry {
  product_id: string;
  image_id: string;
  /** local calendar date YYYY-MM-DD in the schedule timezone */
  date: string;
}

/** Mulberry32 seeded PRNG — deterministic per seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toDayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

function priorityWeight(p: string): number {
  if (p === 'High') return 0;
  if (p === 'Low') return 2;
  return 1;
}

export interface PlanResult {
  slots: ScheduleSlot[];
  placed: SchedulePreviewItem[];
  empty: ScheduleEmptySlot[];
  /** Distinct local dates that received at least one placed pin. */
  daysUsed: number;
  /** Last local date with a placed pin, or null when nothing was placed. */
  endDate: string | null;
  /** Auto mode only: dates skipped with zero placements (same-product gap forced idle days). */
  idleDays: number;
  /** Auto mode only: eligible images still unplaced when the safety cap was hit (0 normally). */
  leftover: number;
}

/**
 * Deterministic fair scheduler.
 * HARD rules:
 *  - each source image used at most once (incl. existing entries)
 *  - same product >= minProductGapDays local calendar days apart (past + future + new)
 *  - fair rotation: every eligible product gets 1st image before any 2nd (priority-weighted, seeded)
 *  - shortage => empty slot with reason, never fabricate
 */
export function planSchedule(
  eligible: EligibleImage[],
  existing: ExistingEntry[],
  settings: SchedulerSettings,
  opts?: { protectedSlots?: { date: string; time: string }[] },
): PlanResult {
  const slots: ScheduleSlot[] = [];
  const placed: SchedulePreviewItem[] = [];
  const empty: ScheduleEmptySlot[] = [];

  const usedImages = new Set(existing.map((e) => e.image_id));
  // product -> list of local dates already used (existing) + newly placed
  const productDates = new Map<string, number[]>();
  for (const e of existing) {
    const arr = productDates.get(e.product_id) ?? [];
    arr.push(toDayNumber(e.date));
    productDates.set(e.product_id, arr);
  }

  const protectedKeys = new Set((opts?.protectedSlots ?? []).map((s) => `${s.date} ${s.time}`));
  const rng = mulberry32(settings.seed);

  // Group eligible images per product (excluding already-used), sorted by source_order
  const byProduct = new Map<string, EligibleImage[]>();
  for (const img of eligible) {
    if (usedImages.has(img.image_id)) continue;
    const arr = byProduct.get(img.product_id) ?? [];
    arr.push(img);
    byProduct.set(img.product_id, arr);
  }
  for (const arr of byProduct.values()) arr.sort((a, b) => a.source_order - b.source_order);

  // Fair rounds: round 0 = first image of each product, round 1 = second, ...
  // Within a round, order by priority then seeded shuffle (deterministic).
  type Candidate = EligibleImage & { round: number; draw: number };
  const rounds: Candidate[][] = [];
  const maxDepth = Math.max(0, ...[...byProduct.values()].map((a) => a.length));
  // Precompute deterministic draw per image
  const draws = new Map<string, number>();
  for (const img of eligible) {
    if (!draws.has(img.image_id)) draws.set(img.image_id, rng());
  }
  for (let r = 0; r < maxDepth; r++) {
    const cands: Candidate[] = [];
    for (const [, arr] of byProduct) {
      if (r < arr.length) {
        const img = arr[r];
        cands.push({ ...img, round: r, draw: draws.get(img.image_id) ?? 0 });
      }
    }
    cands.sort((a, b) => {
      const pw = priorityWeight(a.priority) - priorityWeight(b.priority);
      if (pw !== 0) return pw;
      return a.draw - b.draw;
    });
    rounds.push(cands);
  }
  const queue: Candidate[] = rounds.flat();

  if (eligible.length === 0) {
    // every slot empty with reason
  }

  const gap = Math.max(0, settings.minProductGapDays);
  const pinsPerDay = Math.min(20, Math.max(1, settings.pinsPerDay));

  // Auto-length mode (days <= 0): keep generating day by day until every eligible
  // image is placed. Each day always places at least one pin while the queue is
  // non-empty (the candidate whose product least recently appeared eventually ages
  // out of the gap), so this terminates after at most queue.length days.
  // Gap-blocked days emit no slots at all — they are counted as idleDays.
  const auto = settings.days <= 0;
  const maxDays = auto ? Math.max(730, queue.length + 32) : Math.max(0, settings.days);
  let idleDays = 0;

  for (let d = 0; d < maxDays; d++) {
    if (auto && queue.length === 0) break;
    const date = addDays(settings.startDate, d);
    const dayNum = toDayNumber(date);
    let placedToday = false;
    for (let s = 0; s < pinsPerDay; s++) {
      const time = settings.timeSlots[s % settings.timeSlots.length] ?? '09:00';
      if (protectedKeys.has(`${date} ${time}`)) continue; // locked/manual slots stay untouched
      // find first queue candidate satisfying gap
      let idx = -1;
      let blockedAll = false;
      for (let i = 0; i < queue.length; i++) {
        const c = queue[i];
        const dates = productDates.get(c.product_id) ?? [];
        const ok = dates.every((dd) => Math.abs(dayNum - dd) >= gap || (gap === 0 ? true : Math.abs(dayNum - dd) >= gap));
        if (ok) {
          idx = i;
          break;
        }
      }
      if (idx === -1 && queue.length > 0) {
        // check whether queue exhausted vs gap-blocked
        blockedAll = true;
      }
      if (idx >= 0) {
        const [c] = queue.splice(idx, 1);
        usedImages.add(c.image_id);
        const arr = productDates.get(c.product_id) ?? [];
        arr.push(dayNum);
        productDates.set(c.product_id, arr);
        const item: SchedulePreviewItem = {
          date,
          time,
          product_id: c.product_id,
          product_title: c.product_title,
          product_image_id: c.image_id,
        };
        slots.push(item);
        placed.push(item);
        placedToday = true;
      } else if (auto) {
        // Nothing placeable in this slot (same-product gap blocks everything left).
        // The day is counted once below; the date simply advances.
      } else {
        let reason: string;
        if (eligible.length === 0) reason = 'No approved images. Approve photos in Image Library first.';
        else if (queue.length === 0) reason = 'No new approved images left — every approved photo is already scheduled or posted.';
        else if (blockedAll) reason = `Same-product spacing (${gap}d) blocks every remaining product on this date.`;
        else reason = 'No eligible image for this slot.';
        const e: ScheduleEmptySlot = { date, time, product_id: null, reason };
        slots.push(e);
        empty.push(e);
      }
    }
    // Auto mode: a day with zero placements is a gap-forced idle day — counted
    // once, with no empty slots emitted, instead of flooding the plan.
    if (auto && !placedToday && queue.length > 0) idleDays++;
  }
  const placedDates = [...new Set(placed.map((p) => p.date))].sort();
  return {
    slots,
    placed,
    empty,
    daysUsed: placedDates.length,
    endDate: placedDates.length ? placedDates[placedDates.length - 1] : null,
    idleDays,
    leftover: queue.length,
  };
}

/** Validate a manual move against gap + reuse rules. Returns error string or null. */
export function validateMove(
  product_id: string,
  image_id: string,
  targetDate: string,
  entries: ExistingEntry[],
  minGapDays: number,
  movingEntry?: { product_id: string; image_id: string },
): string | null {
  const dayNum = toDayNumber(targetDate);
  for (const e of entries) {
    if (movingEntry && e.image_id === movingEntry.image_id && e.date === targetDate) continue;
    if (e.product_id === product_id && e.image_id !== image_id) {
      if (Math.abs(dayNum - toDayNumber(e.date)) < Math.max(0, minGapDays)) {
        return `Same-product gap: ${product_id} already appears within ${minGapDays} days of ${targetDate}.`;
      }
    }
    if (e.image_id === image_id && !(movingEntry && movingEntry.image_id === image_id)) {
      return 'That photo is already scheduled elsewhere. Each photo is used once.';
    }
  }
  return null;
}
