import React, { useEffect, useState } from 'react';
import { call, todayLocal } from '../lib/api';
import { Empty, Skeleton, Stat, useToasts } from '../components/ui';

interface Stats {
  products: number; images: number; approved: number; drafts: number;
  dueToday: number; posted: number; upcoming7: number; upcoming30: number;
  unusedApproved: number; lastSync: string | null;
}

export default function Overview({ go }: { go: (s: string) => void }): React.ReactElement {
  const [stats, setStats] = useState<Stats | null>(null);
  const [next, setNext] = useState<Array<Record<string, unknown>>>([]);
  const [activity, setActivity] = useState<Array<{ message: string; at_utc: string; kind: string }>>([]);
  const [cov, setCov] = useState<{ remaining: number; pinsPerDay: number; daysNeeded: number; endDate: string | null } | null>(null);
  const { push } = useToasts();

  useEffect(() => {
    call<Stats>('catalog:stats').then(setStats).catch((e: Error) => push('err', e.message));
    call<{ entries: Array<Record<string, unknown>> }>('schedule:list', { from: todayLocal(), to: '2100-01-01' })
      .then((r) => setNext(r.entries.slice(0, 5))).catch(() => undefined);
    call<Array<{ message: string; at_utc: string; kind: string }>>('activity:list', { limit: 12 }).then(setActivity).catch(() => undefined);
    call<Record<string, unknown>>('schedule:settings:get')
      .then((s) => call<typeof cov>('schedule:coverage', { settings: { ...(s as object), days: 0 } }).then(setCov).catch(() => undefined))
      .catch(() => undefined);
  }, [push]);

  if (!stats) return <Skeleton lines={6} />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl">Overview</h1>
          <p className="text-sm" style={{ color: '#84776D' }}>
            Your local Pin studio.
            {stats.lastSync ? ` Last Shopify sync: ${new Date(stats.lastSync).toLocaleString()}.` : ' No Shopify sync yet.'}
          </p>
        </div>
        <div className="flex gap-2">
          {stats.products === 0 && <button type="button" className="btn btn-clay" onClick={() => go('settings')}>Connect Shopify</button>}
          <button type="button" className="btn btn-ghost" onClick={() => go('calendar')}>Generate schedule</button>
          <button type="button" className="btn btn-primary" onClick={() => go('today')}>Today's Pins</button>
        </div>
      </div>

      {stats.products === 0 && (
        <Empty
          title="Welcome to Pin Studio"
          hint="Connect your Shopify store in Settings and sync — or import a folder of your own photos. Nothing here talks to Pinterest: you post everything manually, one click at a time."
          action={(
            <div className="flex flex-col gap-2 text-left">
              <span className="text-sm font-semibold">How it works:</span>
              <ol className="list-decimal pl-5 text-sm" style={{ color: '#84776D' }}>
                <li><strong>Settings → Shopify → Sync</strong> (or Folder import) to bring in your products.</li>
                <li><strong>Image Library → Approve all</strong> (or approve per product in Products).</li>
                <li><strong>Calendar → Preview → Apply</strong> to generate your posting plan.</li>
                <li><strong>Today's Pins</strong>: copy image + text, paste into Pinterest, Mark Posted.</li>
              </ol>
              <button type="button" className="btn btn-clay" onClick={() => go('settings')}>Go to Settings</button>
            </div>
          )}
        />
      )}

      <div className="card" style={{ borderColor: '#B48E78', background: '#faf3e3' }} aria-live="polite">
        <h2 className="text-xl">📅 {cov == null
          ? 'Counting your remaining pinning days…'
          : cov.remaining === 0
            ? 'All caught up — every approved photo is scheduled or posted.'
            : `${cov.daysNeeded} day${cov.daysNeeded === 1 ? '' : 's'} of pinning left — ${cov.remaining} photo${cov.remaining === 1 ? '' : 's'} at ${cov.pinsPerDay}/day${cov.endDate ? `, finishing ≈ ${cov.endDate}` : ''}.`}</h2>
        {cov != null && cov.remaining > 0 && (
          <p className="mt-1 text-sm" style={{ color: '#84776D' }}>Same pace as Calendar — approve more photos or Apply a new plan there to bring the number down.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Products" value={stats.products} sub={`${stats.images} imported photos (actual count)`} />
        <Stat label="Photos approved" value={stats.approved} sub={`${stats.unusedApproved} approved & unscheduled`} />
        <Stat label="Due today" value={stats.dueToday} sub={`${stats.upcoming7} in next 7 days · ${stats.upcoming30} in 30`} />
        <Stat label="Posted (manual)" value={stats.posted} sub={`${stats.drafts} drafts total`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl">Next 5 scheduled Pins</h2>
            <button type="button" className="btn btn-ghost" onClick={() => go('today')}>Open Today's Pins</button>
          </div>
          {next.length === 0 ? (
            <p className="text-sm" style={{ color: '#84776D' }}>No upcoming pins. Approve photos, then generate a schedule in Calendar.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {next.map((e) => (
                <li key={String(e.entry_id)} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#E5DDD5' }}>
                  <span className="truncate font-medium">{String(e.title || '(untitled)')}</span>
                  <span style={{ color: '#84776D' }}>{String(e.local_date)} · {String(e.local_time)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2 className="mb-3 text-xl">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm" style={{ color: '#84776D' }}>Imports, approvals, exports and manual postings appear here. No Pinterest metrics — only your own actions.</p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1.5 overflow-auto scroll-thin text-sm">
              {activity.map((a, i) => (
                <li key={i} className="flex justify-between gap-3 border-b pb-1.5" style={{ borderColor: '#F0EBE5' }}>
                  <span className="truncate">{a.message}</span>
                  <span className="shrink-0 text-xs" style={{ color: '#84776D' }}>{new Date(a.at_utc).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
