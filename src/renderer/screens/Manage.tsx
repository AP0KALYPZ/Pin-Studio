import React, { useEffect, useState } from 'react';
import { call, onSyncProgress } from '../lib/api';
import { Skeleton, Stat, useToasts } from '../components/ui';

export function Insights(): React.ReactElement {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const { push } = useToasts();
  useEffect(() => {
    call<Record<string, unknown>>('insights:get').then(setData).catch((e: Error) => push('err', e.message));
  }, [push]);
  if (!data) return <Skeleton lines={4} />;
  const perWeek = (data.perWeek as Array<{ wk: string; c: number }>) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-3xl">Insights</h1>
        <p className="text-sm" style={{ color: '#84776D' }}>Your own local activity only — never Pinterest views, saves or revenue.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Photos approved" value={Number(data.approved)} />
        <Stat label="Products represented" value={Number((data as { products?: number }).products ?? 0)} />
        <Stat label="Drafts / Posted / Skipped" value={`${Number(data.drafted)} / ${Number(data.posted)} / ${Number(data.skipped)}`} />
        <Stat label="Unused approved photos" value={Number(data.unused)} sub="queue gaps live here" />
      </div>
      <div className="card">
        <h2 className="mb-3 text-xl">Pins per week (last 12 weeks)</h2>
        {perWeek.length === 0 ? <p className="text-sm" style={{ color: '#84776D' }}>Nothing scheduled yet.</p> : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {perWeek.map((w) => (
              <li key={w.wk} className="flex items-center gap-3">
                <span className="w-24 shrink-0" style={{ color: '#84776D' }}>{w.wk}</span>
                <span className="h-4 rounded" style={{ width: Math.max(8, w.c * 8), background: '#B48E78' }} />
                <span>{w.c}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Settings({ go }: { go: (s: string) => void }): React.ReactElement {
  const [shop, setShop] = useState({ shopDomain: '', storefrontDomain: '', token: '', clientId: '', clientSecret: '', apiVersion: '2026-10', authMode: 'client_credentials' });
  const [status, setStatus] = useState<{ connections: Array<Record<string, unknown>> } | null>(null);
  const [progress, setProgress] = useState('');
  const [exportsCfg, setExportsCfg] = useState<Record<string, unknown>>({});
  const [sched, setSched] = useState<Record<string, unknown>>({});
  const [boards, setBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [newBoard, setNewBoard] = useState('');
  const [backups, setBackups] = useState<Array<{ id: string; path: string; created_at: string }>>([]);
  const [folder, setFolder] = useState({ path: '', title: '', url: '' });
  const [aiKey, setAiKey] = useState('');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [aiStatus, setAiStatus] = useState<{ hasKey: boolean; model: string } | null>(null);
  const [resetText, setResetText] = useState('');
  const [resetAck, setResetAck] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const { push } = useToasts();

  async function refresh(): Promise<void> {
    try {
      setStatus(await call('shopify:status'));
      setExportsCfg((await call('settings:get', { key: 'exports' })) ?? {});
      setSched((await call('schedule:settings:get')) ?? {});
      setBoards(await call('boards:list'));
      setBackups(await call('backup:list'));
      try { setAiStatus(await call('ai:status')); } catch { /* AI unavailable in web preview */ }
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
    const off = onSyncProgress((p) => setProgress(p.total ? `${p.msg}` : p.msg));
    return off;
  }, []);

  async function connect(): Promise<void> {
    try {
      const r = await call<{ shopName: string }>('shopify:connect', shop);
      push('ok', shop.authMode === 'client_credentials'
        ? `Connected to ${r.shopName}. Tokens auto-refresh every 24h; secret stays in OS-protected storage.`
        : `Connected to ${r.shopName}. Token stored in OS-protected storage.`);
      setShop({ ...shop, token: '', clientSecret: '' });
      await refresh();
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function sync(): Promise<void> {
    setProgress('Starting sync…');
    try {
      const r = await call<{ products: number; added: number; updated: number; downloaded: number; failed: number; boardsCreated: number }>('shopify:sync');
      push('ok', `Sync done: ${r.products} products (${r.added} new), ${r.downloaded} photos${r.boardsCreated ? `, ${r.boardsCreated} new boards from your collections` : ''}${r.failed ? `, ${r.failed} errors (see activity)` : ''}`);
      setProgress('');
      await refresh();
    } catch (e) {
      setProgress('');
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-3xl">Settings</h1>

      <div className="card">
        <h2 className="mb-1 text-xl">Shopify connection (read-only)</h2>
        <p className="mb-3 text-sm" style={{ color: '#84776D' }}>Minimal <code>read_products</code> scope. Calls run in the Electron main process; secrets never enter this view or any export. No Pinterest connection exists or is needed.</p>
        {status && status.connections.length > 0 ? (
          <div className="flex flex-col gap-2">
            {(status.connections as Array<{ shop_domain: string; last_sync_at: string | null; auth_mode: string; client_id: string | null; hasCredentials: boolean }>).map((c) => (
              <p key={c.shop_domain} className="text-sm">Connected: <strong>{c.shop_domain}</strong> ({c.auth_mode === 'client_credentials' ? `Dev Dashboard app${c.client_id ? ` · client ${c.client_id}` : ''}, token auto-refreshes` : 'custom app token'}) · credentials {c.hasCredentials ? 'stored' : <strong style={{ color: '#B35B54' }}>missing — reconnect</strong>} · last sync {c.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : 'never'}</p>
            ))}
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary" onClick={sync}>Sync now</button>
              <button type="button" className="btn btn-danger" onClick={async () => { if (window.confirm('Disconnect Shopify? Local data is kept.')) { await call('shopify:disconnect'); push('ok', 'Disconnected'); await refresh(); } }}>Disconnect</button>
              <button type="button" className="btn btn-ghost" onClick={() => go('products')}>View products</button>
            </div>
            {progress && <p className="text-sm" style={{ color: '#84776D' }} role="status">{progress}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2" role="radiogroup" aria-label="Authentication method">
              <button type="button" className={`btn ${shop.authMode === 'client_credentials' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShop({ ...shop, authMode: 'client_credentials' })}>Dev Dashboard app (Client ID + secret)</button>
              <button type="button" className={`btn ${shop.authMode === 'token' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShop({ ...shop, authMode: 'token' })}>Legacy custom app (token)</button>
            </div>
            <div><label className="label">Shop domain</label><input className="input" placeholder="your-store.myshopify.com" value={shop.shopDomain} onChange={(e) => setShop({ ...shop, shopDomain: e.target.value })} autoComplete="off" /></div>
            <div><label className="label">Public storefront domain</label><input className="input" placeholder="https://your-store.com" value={shop.storefrontDomain} onChange={(e) => setShop({ ...shop, storefrontDomain: e.target.value })} autoComplete="off" /></div>
            {shop.authMode === 'client_credentials' ? (
              <>
                <div><label className="label">Client ID (Dev Dashboard → your app → Settings)</label><input className="input" placeholder="e.g. 7f3a2b…" value={shop.clientId} onChange={(e) => setShop({ ...shop, clientId: e.target.value })} autoComplete="off" /></div>
                <div><label className="label">Client secret (starts with shpss_…)</label><input className="input" type="password" placeholder="shpss_…" value={shop.clientSecret} onChange={(e) => setShop({ ...shop, clientSecret: e.target.value })} autoComplete="off" /></div>
                <p className="text-xs" style={{ color: '#84776D' }}>No static token exists for this app type — Pin Studio mints 24-hour tokens itself and refreshes them automatically. The app and store must be in the same Dev Dashboard organization.</p>
              </>
            ) : (
              <div><label className="label">Admin API access token (legacy custom apps only)</label><input className="input" type="password" placeholder="shpat_…" value={shop.token} onChange={(e) => setShop({ ...shop, token: e.target.value })} autoComplete="off" /></div>
            )}
            <div><label className="label">API version</label><input className="input" value={shop.apiVersion} onChange={(e) => setShop({ ...shop, apiVersion: e.target.value })} /></div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary" onClick={connect}>Test & Connect</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="mb-1 text-xl">AI copy (your own OpenAI key)</h2>
        <p className="mb-3 text-sm" style={{ color: '#84776D' }}>One-click SEO title + description per pin in Today's Pins, written from your Shopify facts — always shown as a suggestion you review, never auto-saved. Uses OpenAI's API, billed separately by OpenAI: a ChatGPT Plus subscription does <strong>not</strong> include API access, you need a key with a little credit (pennies per hundred pins on gpt-4o-mini). The key is tested on save and kept in OS-protected storage, never in exports or logs.</p>
        <p className="mb-2 text-sm">Status: {aiStatus ? (aiStatus.hasKey ? <span>key saved · model <strong>{aiStatus.model}</strong></span> : <span style={{ color: '#B35B54' }}><strong>No key saved</strong> — AI Enhance will ask for this.</span>) : 'checking…'}</p>
        <div className="flex flex-col gap-2">
          <div><label className="label">Model</label><select className="select" value={aiModel} onChange={(e) => setAiModel(e.target.value)}><option value="gpt-4o-mini">gpt-4o-mini (cheap, recommended)</option><option value="gpt-4o">gpt-4o (stronger, pricier)</option></select></div>
          <div><label className="label">API key (create one at platform.openai.com → API keys, starts with sk-)</label><input className="input" type="password" placeholder="sk-…" value={aiKey} onChange={(e) => setAiKey(e.target.value)} autoComplete="off" /></div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={async () => { try { await call('ai:setKey', { key: aiKey, model: aiModel }); setAiKey(''); setAiStatus(await call('ai:status')); push('ok', 'AI key saved and verified.'); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Save & test key</button>
            {aiStatus?.hasKey && <button type="button" className="btn btn-danger" onClick={async () => { if (window.confirm('Remove the saved OpenAI API key?')) { await call('ai:clearKey'); setAiStatus(await call('ai:status')); push('ok', 'AI key removed'); } }}>Remove key</button>}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-1 text-xl">Folder import (no Shopify needed)</h2>
        <p className="mb-3 text-sm" style={{ color: '#84776D' }}>Map a folder of your own product photos to a product. You confirm the destination URL before import.</p>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input className="input" placeholder="Photo folder…" value={folder.path} onChange={(e) => setFolder({ ...folder, path: e.target.value })} />
            <button type="button" className="btn btn-ghost" onClick={async () => { const r = await call<{ path: string | null }>('dialog:pickFolder'); if (r.path) setFolder({ ...folder, path: r.path }); }}>Browse…</button>
          </div>
          <input className="input" placeholder="Product title" value={folder.title} onChange={(e) => setFolder({ ...folder, title: e.target.value })} />
          <input className="input" placeholder="https://your-store.com/products/handle" value={folder.url} onChange={(e) => setFolder({ ...folder, url: e.target.value })} />
          <button type="button" className="btn btn-clay" onClick={async () => { try { const r = await call<{ count: number }>('catalog:importFolder', { folder: folder.path, title: folder.title, url: folder.url }); push('ok', `Imported ${r.count} photos`); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Import folder</button>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-1 text-xl">Local boards (text labels)</h2>
        <p className="mb-3 text-sm" style={{ color: '#84776D' }}>Mirrored from your Shopify collections on each sync (generic catch-alls like New Arrivals, Featured, Frontpage, Home page and All products are always skipped). Renaming or deleting here is safe — re-syncs never duplicate boards or overwrite your manual picks.</p>
        <ul className="mb-2 flex flex-col gap-1.5">
          {boards.map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-xl border px-3 py-1.5 text-sm" style={{ borderColor: '#E5DDD5' }}>
              <span>{b.name}</span>
              <button type="button" className="btn btn-danger !px-2 !py-1 !text-xs" onClick={async () => { await call('boards:delete', { id: b.id }); await refresh(); }}>Delete</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input className="input" placeholder="New board name…" value={newBoard} onChange={(e) => setNewBoard(e.target.value)} />
          <button type="button" className="btn btn-ghost" onClick={async () => { try { await call('boards:create', { name: newBoard }); setNewBoard(''); await refresh(); push('ok', 'Board added'); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Add</button>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-1 text-xl">Image output</h2>
        <div className="grid grid-cols-3 gap-2">
          <div><label className="label">Format</label><select className="select" value={String(exportsCfg.format ?? 'jpg')} onChange={async (e) => { const v = { ...exportsCfg, format: e.target.value }; setExportsCfg(v); await call('settings:set', { key: 'exports', value: v }); }}><option value="jpg">JPG</option><option value="png">PNG</option></select></div>
          <div><label className="label">Quality</label><input type="number" min={60} max={100} className="input" value={Number(exportsCfg.quality ?? 88)} onChange={async (e) => { const v = { ...exportsCfg, quality: Number(e.target.value) }; setExportsCfg(v); await call('settings:set', { key: 'exports', value: v }); }} /></div>
          <div><label className="label">Background</label><input type="color" className="input !p-1" value={String(exportsCfg.background ?? '#F7F4F0')} onChange={async (e) => { const v = { ...exportsCfg, background: e.target.value }; setExportsCfg(v); await call('settings:set', { key: 'exports', value: v }); }} /></div>
        </div>
        <p className="mt-2 text-xs" style={{ color: '#84776D' }}>Scheduler defaults (days, times, gap, timezone) live in Calendar. Current gap: {String((sched as { minProductGapDays?: number }).minProductGapDays ?? '—')} days.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-ghost" onClick={async () => { try { push('ok', 'Rebuilding thumbnails — the Library may take a moment to refresh.'); const r = await call<{ rebuilt: number; missing: number }>('images:rebuildThumbs'); push('ok', `Thumbnails rebuilt: ${r.rebuilt} sharp, ${r.missing} missing originals`); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Rebuild thumbnails (sharper previews)</button>
        </div>
        <p className="mt-1 text-xs" style={{ color: '#84776D' }}>Grid tiles are small previews. Click any photo for its full-resolution file — originals are never downscaled.</p>
      </div>

      <div className="card">
        <h2 className="mb-1 text-xl">Backup & restore</h2>
        <p className="mb-3 text-sm" style={{ color: '#84776D' }}>Snapshots the database plus generated images, with checksum manifest. Keep 7 rolling backups.</p>
        <div className="mb-2 flex gap-2">
          <button type="button" className="btn btn-primary" onClick={async () => { try { const r = await call<{ path: string }>('backup:create', { includeImages: true }); push('ok', `Backup saved: ${r.path}`); await refresh(); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Create backup</button>
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          {backups.map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-xl border px-3 py-1.5" style={{ borderColor: '#E5DDD5' }}>
              <span className="truncate">{b.path}</span>
              <span style={{ color: '#84776D' }}>{new Date(b.created_at).toLocaleString()}</span>
            </li>
          ))}
          {backups.length === 0 && <li className="text-sm" style={{ color: '#84776D' }}>No backups yet.</li>}
        </ul>
        <p className="mt-2 text-xs" style={{ color: '#84776D' }}>To restore: close the app, replace <code>pinstudio.db</code> in the app-data folder with the backup's copy, and restart. The backup folder shows its manifest for verification.</p>
      </div>

      <div className="card" style={{ borderColor: '#B35B54' }}>
        <h2 className="mb-1 text-xl" style={{ color: '#B35B54' }}>Danger zone — reset library</h2>
        <p className="mb-2 text-sm" style={{ color: '#84776D' }}>
          Permanently deletes <strong>all products, photos, pins, schedule entries, posting history and activity</strong>,
          including the downloaded image files. Your Shopify connection, credentials, settings and board names are kept,
          so you can sync fresh afterwards. Export packs and backups on disk are left alone.
        </p>
        <p className="mb-3 text-sm font-semibold" style={{ color: '#B35B54' }}>This cannot be undone. Create a backup above first if you might want the data back.</p>
        <div className="flex flex-col gap-2">
          <div><label className="label" htmlFor="reset-confirm">Type RESET to enable the button</label><input id="reset-confirm" className="input" placeholder="RESET" value={resetText} onChange={(e) => setResetText(e.target.value)} autoComplete="off" /></div>
          <label className="flex items-start gap-2 text-sm" style={{ color: '#84776D' }}>
            <input type="checkbox" className="mt-1" checked={resetAck} onChange={(e) => setResetAck(e.target.checked)} />
            I understand this permanently deletes everything listed above.
          </label>
          <div>
            <button
              type="button"
              className="btn btn-danger"
              disabled={resetBusy || resetText.trim() !== 'RESET' || !resetAck}
              onClick={async () => {
                if (!window.confirm('FINAL CHECK: delete ALL products, photos, pins, schedule and history? The Shopify connection and settings stay. This cannot be undone.')) return;
                setResetBusy(true);
                try {
                  const r = await call<{ products: number; images: number; pins: number; entries: number }>('data:resetLibrary', { confirm: resetText.trim() });
                  push('ok', `Library reset: removed ${r.products} products, ${r.images} photos, ${r.pins} pins, ${r.entries} schedule entries. Connection and settings kept.`);
                  setResetText('');
                  setResetAck(false);
                  await refresh();
                } catch (e) {
                  push('err', e instanceof Error ? e.message : String(e));
                } finally {
                  setResetBusy(false);
                }
              }}
            >{resetBusy ? 'Resetting…' : 'Reset library (keeps login & settings)'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
