import React, { useState } from 'react';
import { call, todayLocal } from '../lib/api';
import { useToasts } from '../components/ui';

export function Exports(): React.ReactElement {
  const [from, setFrom] = useState(todayLocal());
  const [to, setTo] = useState(todayLocal());
  const [lastDir, setLastDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToasts();

  async function pack(label: string, f: string, t: string): Promise<void> {
    setBusy(true);
    try {
      const r = await call<{ dir: string; images: number; manifest: string }>('exports:pack', { from: f, to: t, label });
      setLastDir(r.dir);
      push('ok', `Pack exported: ${r.images} pins → ${r.dir}`);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function weekRange(): [string, string] {
    const d = new Date(from + 'T12:00:00');
    const day = (d.getDay() + 6) % 7;
    const mon = new Date(d);
    mon.setDate(d.getDate() - day);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const iso = (x: Date): string => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return [iso(mon), iso(sun)];
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-3xl">Exports</h1>
        <p className="text-sm" style={{ color: '#84776D' }}>Day / week / custom packs: images + manifest.csv + manifest.json + offline posting sheets. Exporting never marks pins posted.</p>
      </div>
      <div className="card flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="ex-from">From</label><input id="ex-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label" htmlFor="ex-to">To</label><input id="ex-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button type="button" className="btn btn-clay" disabled={busy} onClick={() => pack(`day-${from}`, from, from)}>Export day</button>
        <button type="button" className="btn btn-clay" disabled={busy} onClick={() => { const [a, b] = weekRange(); pack(`week-${a}`, a, b); }}>Export week</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => pack(`range-${from}_to_${to}`, from, to)}>Export range</button>
      </div>
      {lastDir && (
        <div className="card">
          <h2 className="mb-1 text-xl">Last export</h2>
          <p className="mb-2 break-all text-sm">{lastDir}</p>
          <button type="button" className="btn btn-ghost" onClick={async () => { try { await call('exports:revealDir', { dir: lastDir }); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Open folder</button>
        </div>
      )}
    </div>
  );
}
