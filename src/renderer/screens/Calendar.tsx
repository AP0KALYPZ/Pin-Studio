import React, { useCallback, useEffect, useState } from 'react';
import { call, todayLocal } from '../lib/api';
import { Empty, Skeleton, useToasts } from '../components/ui';
import type { SchedulerSettings } from '../../shared/types';

const DEFAULTS: SchedulerSettings = {
  pinsPerDay: 5,
  timeSlots: ['09:00', '12:00', '15:00', '18:00', '21:00'],
  timezone: 'America/Bogota',
  minProductGapDays: 14,
  seed: 20261102,
  startDate: todayLocal(),
  days: 0, // auto-length: the scheduler decides how many days are needed
};

interface Coverage {
  remaining: number; pinsPerDay: number; daysNeeded: number;
  endDate: string | null; idleDays: number; leftover: number; startDate: string;
}

interface Entry {
  entry_id: string; local_date: string; local_time: string; timezone: string;
  locked: number; moved_manually: number; generation_batch_id: string | null;
  id: string; title: string; product_title: string; posting_state: string;
}

export default function Calendar({ go }: { go: (s: string) => void }): React.ReactElement {
  const [settings, setSettings] = useState<SchedulerSettings>(DEFAULTS);
  const [preview, setPreview] = useState<Array<Record<string, unknown>>>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastBatch, setLastBatch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cov, setCov] = useState<Coverage | null>(null);
  const { push } = useToasts();

  const reloadEntries = useCallback(async (s: SchedulerSettings) => {
    const r = await call<{ entries: Entry[] }>('schedule:list', { from: s.startDate, to: '2100-01-01' });
    setEntries(r.entries);
  }, []);

  const reloadCoverage = useCallback(async (s: SchedulerSettings) => {
    try {
      const c = await call<Coverage>('schedule:coverage', { settings: { ...s, days: 0 } });
      setCov(c);
    } catch {
      setCov(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const saved = await call<Partial<SchedulerSettings>>('schedule:settings:get');
        // Auto-length is the only mode now: ignore any legacy saved duration.
        const merged = { ...DEFAULTS, ...saved, startDate: (saved.startDate as string) || todayLocal(), days: 0 };
        setSettings(merged);
        await reloadEntries(merged);
        await reloadCoverage(merged);
      } catch (e) {
        push('err', e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [push, reloadEntries, reloadCoverage]);

  // Refresh the days-left banner whenever the knobs change (debounced).
  useEffect(() => {
    if (loading) return;
    const t = window.setTimeout(() => void reloadCoverage(settings), 400);
    return () => window.clearTimeout(t);
  }, [settings, loading, reloadCoverage]);

  async function update(patch: Partial<SchedulerSettings>): Promise<void> {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await call('schedule:settings:set', { settings: next });
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function doPreview(): Promise<void> {
    setBusy(true);
    try {
      const r = await call<{ slots: Array<Record<string, unknown>> }>('schedule:preview', { settings: { ...settings, days: 0 } });
      setPreview(r.slots);
      const placedSlots = r.slots.filter((s) => s.product_id);
      const span = [...new Set(placedSlots.map((s) => String(s.date)))].sort();
      const end = span.length ? span[span.length - 1] : null;
      push('ok', placedSlots.length
        ? `Preview: ${placedSlots.length} pins across ${span.length} day(s), finishing ${end} (nothing written yet)`
        : 'Preview: nothing placeable — approve more photos or loosen the same-product gap.');
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doApply(): Promise<void> {
    if (preview.length === 0) {
      push('err', 'Run Preview first — Apply writes the exact preview you inspected.');
      return;
    }
    setBusy(true);
    try {
      const r = await call<{ placed: number; empty: number; batchId: string }>('schedule:apply', { settings: { ...settings, days: 0 }, slots: preview });
      setLastBatch(r.batchId);
      setPreview([]);
      await reloadEntries(settings);
      await reloadCoverage(settings);
      push('ok', `Applied: ${r.placed} pins placed${r.empty ? `, ${r.empty} empty slots explained in preview` : ''}`);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doUndo(): Promise<void> {
    if (!lastBatch) return;
    try {
      const r = await call<{ removed: number }>('schedule:undo', { batchId: lastBatch });
      push('ok', `Undid batch — removed ${r.removed} entries`);
      setLastBatch(null);
      await reloadEntries(settings);
      await reloadCoverage(settings);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function move(entry: Entry, dir: 1 | -1): Promise<void> {
    const [y, m, d] = entry.local_date.split('-').map(Number);
    const t = new Date(y, m - 1, d + dir);
    const nd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    try {
      await call('schedule:move', { entryId: entry.entry_id, date: nd, time: entry.local_time });
      push('ok', `Moved to ${nd}`);
      await reloadEntries(settings);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleLock(entry: Entry): Promise<void> {
    try {
      await call('schedule:lock', { entryId: entry.entry_id, locked: !entry.locked });
      await reloadEntries(settings);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(entry: Entry): Promise<void> {
    if (!window.confirm(`Delete the ${entry.local_date} ${entry.local_time} pin "${entry.title}"?`)) return;
    try {
      await call('schedule:delete', { entryId: entry.entry_id });
      push('ok', 'Entry deleted');
      await reloadEntries(settings);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <Skeleton lines={6} />;

  const byDate = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = byDate.get(e.local_date) ?? [];
    arr.push(e);
    byDate.set(e.local_date, arr);
  }
  const allDates = [...byDate.keys()].sort();
  const dates = allDates.slice(0, 60);
  const hiddenDays = allDates.length - dates.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl">Calendar</h1>
          <p className="text-sm" style={{ color: '#84776D' }}>Local plan only — nothing is published to Pinterest from here.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={doPreview}>Preview</button>
          <button type="button" className="btn btn-primary" disabled={busy || preview.length === 0} onClick={doApply}>Apply preview</button>
          {lastBatch && <button type="button" className="btn btn-ghost" onClick={doUndo}>Undo last batch</button>}
        </div>
      </div>

      <div className="card" style={{ borderColor: '#B48E78', background: '#faf3e3' }}>
        <h2 className="mb-1 text-xl">📅 {cov == null ? 'Counting your pinning days…' : cov.remaining === 0 ? 'All caught up — every approved photo is already scheduled or posted.' : `${cov.remaining} photo${cov.remaining === 1 ? '' : 's'} left to schedule → ${cov.daysNeeded} day${cov.daysNeeded === 1 ? '' : 's'} of pinning at ${cov.pinsPerDay}/day${cov.endDate ? `, finishing ≈ ${cov.endDate}` : ''}.`}</h2>
        {cov != null && cov.remaining > 0 && (
          <p className="text-sm" style={{ color: '#84776D' }}>
            You choose the pace (pins/day, times, start, same-product gap) — the scheduler decides how many days it takes and places every remaining photo.
            {cov.idleDays > 0 ? ` Includes ${cov.idleDays} idle day${cov.idleDays === 1 ? '' : 's'} forced by the ${settings.minProductGapDays}-day same-product gap.` : ' No idle days — the gap fits your pace.'}
            {cov.leftover > 0 ? ` ${cov.leftover} photo${cov.leftover === 1 ? '' : 's'} still unplaced (safety cap).` : ''}
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="mb-1 text-xl">How scheduling works</h2>
        <ol className="list-decimal pl-5 text-sm" style={{ color: '#84776D' }}>
          <li><strong>Approve photos</strong> in the Image Library (Approve all, or per product in Products). Only approved photos can be scheduled.</li>
          <li><strong>Set your pace below</strong> — pins per day, posting times, start date, and the minimum gap between two pins of the same product. No duration to pick: the scheduler keeps generating days until every remaining photo is placed, and tells you above how many days that takes.</li>
          <li><strong>Preview</strong> — writes nothing. It shows every pin across every day it needs, finishing on the date above.</li>
          <li><strong>Apply preview</strong> — writes the entries in one go. <strong>Undo last batch</strong> removes them again if you change your mind.</li>
          <li><strong>Fine-tune:</strong> ◀ ▶ moves a pin a day (gap rules enforced), Lock protects a pin, Delete removes it. Posting itself happens in <strong>Today's Pins</strong> — nothing here publishes anything.</li>
        </ol>
      </div>

      <div className="card grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
        <div><label className="label" htmlFor="s-start">Start date</label><input id="s-start" type="date" className="input" value={settings.startDate} onChange={(e) => update({ startDate: e.target.value })} /></div>
        <div><label className="label" htmlFor="s-ppd">Pins / day (1–20)</label><input id="s-ppd" type="number" min={1} max={20} className="input" value={settings.pinsPerDay} onChange={(e) => update({ pinsPerDay: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} /></div>
        <div><label className="label" htmlFor="s-gap">Min same-product gap (days)</label><input id="s-gap" type="number" min={0} max={90} className="input" value={settings.minProductGapDays} onChange={(e) => update({ minProductGapDays: Math.min(90, Math.max(0, Number(e.target.value) || 0)) })} /></div>
        <div><label className="label" htmlFor="s-seed">Seed</label><input id="s-seed" type="number" className="input" value={settings.seed} onChange={(e) => update({ seed: Number(e.target.value) || 0 })} /></div>
        <div><label className="label" htmlFor="s-tz">Timezone</label><input id="s-tz" className="input" value={settings.timezone} onChange={(e) => update({ timezone: e.target.value })} /></div>
        <div className="col-span-2 md:col-span-4 xl:col-span-5">
          <label className="label" htmlFor="s-times">Posting times (comma separated)</label>
          <input id="s-times" className="input" value={settings.timeSlots.join(', ')} onChange={(e) => update({ timeSlots: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) })} />
        </div>
      </div>

      {preview.length > 0 && (() => {
        const span = [...new Set(preview.filter((s) => s.product_id).map((s) => String(s.date)))].sort();
        return (
        <div className="card">
          <h2 className="mb-2 text-xl">Preview (not yet applied){span.length > 0 ? ` — ${span.length} day${span.length === 1 ? '' : 's'}, finishing ${span[span.length - 1]}` : ''}</h2>
          <ul className="grid max-h-64 grid-cols-1 gap-1.5 overflow-auto scroll-thin text-sm md:grid-cols-2 xl:grid-cols-3">
            {preview.map((s, i) => (
              <li key={i} className="rounded-lg border px-2 py-1" style={{ borderColor: '#E5DDD5' }}>
                <strong>{String(s.date)} {String(s.time)}</strong> — {s.product_id ? `${String(s.product_title)}` : `empty: ${String(s.reason)}`}
              </li>
            ))}
          </ul>
        </div>
        );
      })()}

      {dates.length === 0 ? (
        <Empty title="No pins scheduled yet" hint="Approve photos in the Image Library, then Preview and Apply a schedule. Empty slots always come with a reason — the scheduler never invents photos." action={<button type="button" className="btn btn-clay" onClick={() => go('library')}>Review photos</button>} />
      ) : (
        <div className="flex flex-col gap-3">
          {dates.map((d) => (
            <div key={d} className="card !p-4">
              <div className="mb-2 text-sm font-semibold">{d} — {(byDate.get(d) ?? []).length} pin(s)</div>
              <ul className="flex flex-col gap-1.5">
                {(byDate.get(d) ?? []).map((e) => (
                  <li key={e.entry_id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#E5DDD5' }}>
                    <span className="font-semibold">{e.local_time}</span>
                    <span className="min-w-0 flex-1 truncate">{e.title || e.product_title}</span>
                    <span className="badge badge-planned">{e.posting_state.replace('_', ' ')}</span>
                    {e.locked ? <span className="badge badge-review">locked</span> : null}
                    {e.moved_manually ? <span className="badge badge-planned">moved</span> : null}
                    <span className="flex gap-1">
                      <button type="button" className="btn btn-ghost !px-2 !py-1 !text-xs" onClick={() => move(e, -1)} aria-label="Move one day earlier">◀</button>
                      <button type="button" className="btn btn-ghost !px-2 !py-1 !text-xs" onClick={() => move(e, 1)} aria-label="Move one day later">▶</button>
                      <button type="button" className="btn btn-ghost !px-2 !py-1 !text-xs" onClick={() => toggleLock(e)}>{e.locked ? 'Unlock' : 'Lock'}</button>
                      <button type="button" className="btn btn-danger !px-2 !py-1 !text-xs" onClick={() => remove(e)}>Delete</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {hiddenDays > 0 && <p className="text-sm" style={{ color: '#84776D' }}>…plus {hiddenDays} more scheduled day{hiddenDays === 1 ? '' : 's'} (showing first {dates.length}). Refine with search in Today's Pins per date.</p>}
        </div>
      )}
    </div>
  );
}
