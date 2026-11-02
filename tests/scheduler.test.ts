import { describe, expect, it } from 'vitest';
import { planSchedule, validateMove, type EligibleImage, type ExistingEntry } from '../src/shared/scheduler';
import type { SchedulerSettings } from '../src/shared/types';

function base(over: Partial<SchedulerSettings> = {}): SchedulerSettings {
  return {
    pinsPerDay: 5,
    timeSlots: ['09:00', '12:00', '15:00', '18:00', '21:00'],
    timezone: 'America/Bogota',
    minProductGapDays: 14,
    seed: 20261102,
    startDate: '2026-11-02',
    days: 10,
    ...over,
  };
}

function imgs(products: number, per: number): EligibleImage[] {
  const out: EligibleImage[] = [];
  for (let p = 1; p <= products; p++) {
    for (let i = 1; i <= per; i++) {
      out.push({ image_id: `p${p}-i${i}`, product_id: `p${p}`, product_title: `Dress ${p}`, priority: 'Normal', source_order: i });
    }
  }
  return out;
}

describe('scheduler hard rules', () => {
  it('uses each image at most once across plan + history', () => {
    const eligible = imgs(3, 2);
    const existing: ExistingEntry[] = [{ product_id: 'p1', image_id: 'p1-i1', date: '2026-10-20' }];
    const { placed } = planSchedule(eligible, existing, base({ days: 30 }));
    const ids = placed.map((p) => p.product_image_id);
    expect(ids).not.toContain('p1-i1');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('enforces the same-product gap against past and future entries', () => {
    const eligible = imgs(2, 10);
    const existing: ExistingEntry[] = [{ product_id: 'p1', image_id: 'p1-i1', date: '2026-11-05' }];
    const { placed } = planSchedule(eligible, existing, base({ days: 6, minProductGapDays: 14, pinsPerDay: 5 }));
    const p1 = placed.filter((p) => p.product_id === 'p1').map((p) => p.date);
    for (const d of p1) {
      const day = (s: string): number => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
      expect(Math.abs(day(d) - day('2026-11-05'))).toBeGreaterThanOrEqual(14);
    }
  });

  it('7 products x 1 photo at 5/day with 14d gap places at most 7 and explains the rest', () => {
    const eligible = imgs(7, 1);
    const { placed, empty } = planSchedule(eligible, [], base({ days: 6 }));
    expect(placed.length).toBeLessThanOrEqual(7);
    expect(empty.length).toBeGreaterThan(0);
    expect(empty[0].reason).toMatch(/spacing|approved|scheduled/i);
  });

  it('rotates fairly: every dress gets a first photo before any second', () => {
    const eligible: EligibleImage[] = [
      ...[1, 2, 3, 4, 5].map((i) => ({ image_id: `pa-i${i}`, product_id: 'pa', product_title: 'A', priority: 'Normal' as const, source_order: i })),
      { image_id: 'pb-i1', product_id: 'pb', product_title: 'B', priority: 'Normal' as const, source_order: 1 },
    ];
    const { placed } = planSchedule(eligible, [], base({ days: 2, minProductGapDays: 0 }));
    const firstTwo = placed.slice(0, 2).map((p) => p.product_id);
    expect(new Set(firstTwo).size).toBe(2); // fair, not pa twice
  });

  it('is deterministic for same snapshot + seed; seed never violates rules', () => {
    const eligible = imgs(10, 4);
    const a = planSchedule(eligible, [], base({ seed: 7 }));
    const b = planSchedule(eligible, [], base({ seed: 7 }));
    expect(a.placed).toEqual(b.placed);
    const c = planSchedule(eligible, [], base({ seed: 999 }));
    const ids = c.placed.map((p) => p.product_image_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('counts actual inventory, not products x 10', () => {
    const eligible = imgs(120, 3); // 360 real photos, uneven in practice
    const { placed } = planSchedule(eligible, [], base({ days: 30, minProductGapDays: 0 }));
    expect(placed.length).toBeLessThanOrEqual(360);
    expect(placed.length).toBeGreaterThan(0);
  });

  it('auto-length places every eligible photo and reports the days needed', () => {
    const eligible = imgs(3, 4); // 12 photos
    const r = planSchedule(eligible, [], base({ days: 0, minProductGapDays: 0 }));
    expect(r.placed.length).toBe(12);
    expect(r.empty.length).toBe(0);
    expect(r.leftover).toBe(0);
    expect(r.daysUsed).toBe(3); // 12 photos at 5/day, gap 0
    expect(r.endDate).toBe('2026-11-04');
    expect(r.idleDays).toBe(0);
  });

  it('auto-length honors the same-product gap and counts idle days', () => {
    const eligible = imgs(2, 3); // 6 photos, 2 products
    const r = planSchedule(eligible, [], base({ days: 0, minProductGapDays: 7, pinsPerDay: 5 }));
    expect(r.placed.length).toBe(6);
    expect(r.leftover).toBe(0);
    const day = (s: string): number => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
    for (const pid of ['p1', 'p2']) {
      const ds = r.placed.filter((p) => p.product_id === pid).map((p) => day(p.date)).sort((a, b) => a - b);
      for (let i = 1; i < ds.length; i++) expect(ds[i] - ds[i - 1]).toBeGreaterThanOrEqual(7);
    }
    expect(r.idleDays).toBeGreaterThan(0);
    expect(r.daysUsed + r.idleDays).toBe(day(r.endDate!) - day('2026-11-02') + 1);
  });

  it('auto-length with nothing eligible places nothing and reports null end', () => {
    const r = planSchedule([], [], base({ days: 0 }));
    expect(r.placed.length).toBe(0);
    expect(r.daysUsed).toBe(0);
    expect(r.endDate).toBeNull();
  });

  it('fixed-window mode still emits explained empty slots (legacy behavior)', () => {
    const r = planSchedule([], [], base({ days: 3 }));
    expect(r.empty.length).toBeGreaterThan(0);
  });

  it('validateMove rejects gap violations and double-use', () => {
    const entries: ExistingEntry[] = [{ product_id: 'p1', image_id: 'p1-i1', date: '2026-11-10' }];
    expect(validateMove('p1', 'p1-i2', '2026-11-12', entries, 14)).toMatch(/gap/);
    expect(validateMove('p2', 'p1-i1', '2026-12-01', entries, 14)).toMatch(/already scheduled/);
    expect(validateMove('p2', 'p2-i9', '2026-12-01', entries, 14)).toBeNull();
  });
});
