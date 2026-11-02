import React, { useCallback, useEffect, useState } from 'react';
import { call } from '../lib/api';
import { Empty, Skeleton, StatusBadge, useToasts } from '../components/ui';

interface Product {
  id: string; handle: string; title: string; status: string; canonical_url: string;
  custom_url_override: string | null; include_in_schedule: number; priority: string;
  image_count: number; approved_count: number; scheduled_count: number; posted_count: number;
  missing_source: string | null; demo: number; collections_json?: string;
}

export function Products({ go }: { go: (s: string) => void }): React.ReactElement {
  const [rows, setRows] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [stock, setStock] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ product: Record<string, unknown>; images: Array<Record<string, unknown>> } | null>(null);
  const [lightbox, setLightbox] = useState<Record<string, unknown> | null>(null);
  const { push } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Product[]>('products:list', { search: search || undefined, stock: stock || undefined });
      setRows(r);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [search, stock, push]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), search ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load, search]);

  async function openDetail(id: string): Promise<void> {
    try {
      const r = await call<{ product: Record<string, unknown>; images: Array<Record<string, unknown>> }>('products:get', { id });
      setDetail(r);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function setReview(ids: string[], state: string): Promise<void> {
    try {
      await call('images:review', { ids, state });
      push('ok', `${ids.length} photo(s) marked ${state}`);
      setLightbox(null);
      if (detail) await openDetail(String(detail.product.id));
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function approveWholeProduct(state: 'approved' | 'rejected'): Promise<void> {
    if (!detail) return;
    const n = detail.images.length;
    if (n === 0) return;
    if (!window.confirm(`${state === 'approved' ? 'Approve' : 'Reject'} all ${n} photos of "${String(detail.product.title)}"?`)) return;
    try {
      await call('images:reviewFiltered', { state, productId: String(detail.product.id) });
      push('ok', `${n} photo(s) marked ${state}`);
      await openDetail(String(detail.product.id));
      await load();
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function updateProduct(id: string, patch: Record<string, unknown>): Promise<void> {
    try {
      await call('products:update', { id, patch });
      push('ok', 'Product updated');
      await load();
      await openDetail(id);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Products</h1>
          <p className="text-sm" style={{ color: '#84776D' }}>{rows.length} products · exact photo counts from your data, never estimated.</p>
        </div>
        <div className="flex gap-2">
          <input className="input !w-56" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
          <select className="select !w-auto" value={stock} onChange={(e) => setStock(e.target.value)} aria-label="Filter by photo count">
            <option value="">All photo counts</option>
            <option value="zero">0 photos</option>
            <option value="1-4">1–4 photos</option>
            <option value="5-9">5–9 photos</option>
            <option value="10plus">10+ photos</option>
          </select>
        </div>
      </div>

      {loading ? <Skeleton lines={5} /> : rows.length === 0 ? (
        <Empty title="No products yet" hint="Connect Shopify in Settings and sync, or import a folder of your own photos." action={<button type="button" className="btn btn-clay" onClick={() => go('settings')}>Go to Settings</button>} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <button key={p.id} type="button" onClick={() => openDetail(p.id)} className="card text-left transition-shadow hover:shadow-md" aria-label={`Open ${p.title}`}>
              <div className="mb-1 flex items-start justify-between gap-2">
                <span className="serif text-lg leading-tight">{p.title}</span>
                {p.image_count === 0 && <span className="badge badge-review">No images</span>}
              </div>
              <div className="mb-2 text-xs" style={{ color: '#84776D' }}>{p.handle} · {p.status} · priority {p.priority}</div>
              <div className="flex gap-3 text-xs">
                <span>📷 {p.image_count} photos</span>
                <span>✓ {p.approved_count} approved</span>
                <span>🗓 {p.scheduled_count} scheduled</span>
                <span>📌 {p.posted_count} posted</span>
              </div>
              {p.include_in_schedule === 0 && <div className="mt-1 text-xs" style={{ color: '#B35B54' }}>Excluded from planning</div>}
              {p.image_count === 0 && <div className="mt-1 text-xs" style={{ color: '#84776D' }}>Zero-photo product — visible with explanation, never schedulable.</div>}
            </button>
          ))}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Product detail">
          <div className="card max-h-[90vh] w-full max-w-4xl overflow-auto scroll-thin">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl">{String(detail.product.title)}</h2>
                <p className="break-all text-xs" style={{ color: '#84776D' }}>{String(detail.product.custom_url_override || detail.product.canonical_url || '')}</p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>Close</button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => updateProduct(String(detail.product.id), { include_in_schedule: detail.product.include_in_schedule ? 0 : 1 })}>
                {detail.product.include_in_schedule ? 'Exclude from planning' : 'Include in planning'}
              </button>
              {(['High', 'Normal', 'Low'] as const).map((pr) => (
                <button key={pr} type="button" className={`btn ${detail.product.priority === pr ? 'btn-primary' : 'btn-ghost'}`} onClick={() => updateProduct(String(detail.product.id), { priority: pr })}>{pr}</button>
              ))}
              <button type="button" className="btn btn-ghost" onClick={() => { const u = window.prompt('Verified public product URL override (https, never an admin URL):', String(detail.product.custom_url_override || detail.product.canonical_url || '')); if (u !== null) void updateProduct(String(detail.product.id), { custom_url_override: u }); }}>Edit URL…</button>
              {detail.images.length > 0 && (
                <>
                  <button type="button" className="btn btn-clay" onClick={() => approveWholeProduct('approved')}>✓ Approve all {detail.images.length}</button>
                  <button type="button" className="btn btn-danger" onClick={() => approveWholeProduct('rejected')}>Reject all</button>
                </>
              )}
            </div>
            <p className="mb-2 text-xs" style={{ color: '#84776D' }}>Tip: click any photo for its full-resolution file. Grid tiles are small previews.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {detail.images.map((img) => (
                <ImageCell key={String(img.id)} img={img} onOpen={setLightbox} onReview={(s) => setReview([String(img.id)], s)} />
              ))}
            </div>
            {lightbox && <Lightbox img={lightbox} onClose={() => setLightbox(null)} onReview={(id, s) => setReview([id], s)} />}
            {detail.images.length === 0 && <p className="text-sm" style={{ color: '#84776D' }}>This product has no photos. It stays visible but can never be scheduled.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ImageCell({ img, onReview, selectable, checked, onCheck, onOpen }: {
  img: Record<string, unknown>;
  onReview?: (s: string) => void;
  selectable?: boolean;
  checked?: boolean;
  onCheck?: (id: string, on: boolean) => void;
  onOpen?: (img: Record<string, unknown>) => void;
}): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    call<{ dataUrl: string | null }>('images:thumb', { id: String(img.id) }).then((r) => {
      if (alive) setUrl(r.dataUrl);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [img.id]);
  const body = url
    ? <img src={url} alt={String(img.alt_text ?? '')} className="aspect-[2/3] w-full object-cover" loading="lazy" />
    : <div className="flex aspect-[2/3] w-full items-center justify-center text-xs" style={{ background: '#F0EBE5', color: '#84776D' }}>#{String(img.source_order)}</div>;
  return (
    <div className="relative overflow-hidden rounded-xl border" style={{ borderColor: '#E5DDD5' }}>
      {selectable && <input type="checkbox" className="absolute left-2 top-2 z-10 h-4 w-4" checked={!!checked} onChange={(e) => onCheck?.(String(img.id), e.target.checked)} aria-label={`Select photo ${img.source_order}`} />}
      {onOpen ? (
        <button type="button" onClick={() => onOpen(img)} className="block w-full" aria-label={`View full-size photo ${img.source_order} of ${String(img.product_title ?? '')}`} title="Click for full-resolution view">
          {body}
        </button>
      ) : body}
      <div className="flex items-center justify-between bg-white px-2 py-1">
        <StatusBadge state={String(img.review_state)} />
        {onReview && (
          <span className="flex gap-1">
            <button type="button" className="text-xs font-semibold" style={{ color: '#5C8069' }} onClick={() => onReview('approved')} aria-label="Approve photo">✓</button>
            <button type="button" className="text-xs font-semibold" style={{ color: '#B35B54' }} onClick={() => onReview('rejected')} aria-label="Reject photo">✕</button>
            <button type="button" className="text-xs" style={{ color: '#84776D' }} onClick={() => onReview('new')} aria-label="Reset review">↺</button>
          </span>
        )}
      </div>
    </div>
  );
}

/** Full-resolution viewer: grid thumbnails are small previews; this shows the real file. */
export function Lightbox({ img, onClose, onReview }: {
  img: Record<string, unknown>;
  onClose: () => void;
  onReview: (id: string, state: string) => void;
}): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const { push } = useToasts();
  useEffect(() => {
    let alive = true;
    setUrl(null);
    call<{ dataUrl: string | null }>('images:original', { id: String(img.id) }).then((r) => {
      if (alive) setUrl(r.dataUrl);
    }).catch((e: Error) => {
      if (alive) push('err', e.message);
    });
    return () => {
      alive = false;
    };
  }, [img.id, push]);
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Full-resolution photo" onClick={onClose}>
      <div className="card max-h-[92vh] w-auto max-w-4xl overflow-auto scroll-thin" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <span className="font-semibold">{String(img.product_title)} <span style={{ color: '#84776D' }}>#{String(img.source_order)}</span></span>
            <span className="ml-2"><StatusBadge state={String(img.review_state)} /></span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close ✕</button>
        </div>
        {url ? (
          <button type="button" onClick={() => setZoom((z) => !z)} className="block w-full" title={zoom ? 'Zoom out' : 'Click to zoom to actual pixels'}>
            <img src={url} alt={String(img.alt_text ?? '')} className={zoom ? 'max-w-none rounded-xl border' : 'mx-auto max-h-[62vh] rounded-xl border object-contain'} style={{ borderColor: '#E5DDD5', imageRendering: 'auto' }} />
          </button>
        ) : <p className="py-10 text-center text-sm" style={{ color: '#84776D' }}>Loading full-resolution photo…</p>}
        <p className="mt-1 text-xs" style={{ color: '#84776D' }}>Full file{zoom ? ' at actual pixels — scroll to inspect sharpness' : ''}. Grid thumbnails are small previews only.</p>
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn btn-primary" onClick={() => onReview(String(img.id), 'approved')}>✓ Approve</button>
          <button type="button" className="btn btn-danger" onClick={() => onReview(String(img.id), 'rejected')}>✕ Reject</button>
          <button type="button" className="btn btn-ghost" onClick={() => onReview(String(img.id), 'new')}>↺ Reset</button>
        </div>
      </div>
    </div>
  );
}

export function Library(): React.ReactElement {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [review, setReview] = useState('all');
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<{ rows: Array<Record<string, unknown>>; total: number }>('images:list', { review, search: search || undefined, limit: 200, offset: 0 });
      setRows(r.rows);
      setTotal(r.total);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [review, search, push]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), search ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load, search]);

  async function batch(state: string): Promise<void> {
    if (checked.size === 0) {
      push('err', 'Select photos first.');
      return;
    }
    try {
      await call('images:review', { ids: [...checked], state });
      push('ok', `${checked.size} photo(s) marked ${state}`);
      setChecked(new Set());
      await load();
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function approveAll(state: 'approved' | 'rejected'): Promise<void> {
    const scope = review === 'all' ? 'every photo' : `every "${review}"`;
    const where = `Approve ${state === 'approved' ? 'all' : 'reject all'} ${total} ${scope} photos${search ? ` matching "${search}"` : ''}?`;
    if (!window.confirm(state === 'approved'
      ? `${where} Approved photos become eligible for scheduling.`
      : `${where} Rejected photos are hidden from scheduling but kept.`)) return;
    setBusy(true);
    try {
      const r = await call<{ updated: number }>('images:reviewFiltered', { state, review, search: search || undefined });
      push('ok', `${r.updated} photo(s) marked ${state}`);
      setChecked(new Set());
      await load();
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function singleReview(id: string, state: string): Promise<void> {
    try {
      await call('images:review', { ids: [id], state });
      push('ok', `Photo marked ${state}`);
      setLightbox(null);
      await load();
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Image Library</h1>
          <p className="text-sm" style={{ color: '#84776D' }}>{total} photos · only approved photos can be scheduled.</p>
        </div>
        <div className="flex gap-2">
          <input className="input !w-52" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search images" />
          <select className="select !w-auto" value={review} onChange={(e) => setReview(e.target.value)} aria-label="Filter by review state">
            <option value="all">All states</option>
            <option value="new">New</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>
      <div className="card flex flex-wrap items-center gap-2 !py-3">
        <span className="text-sm" style={{ color: '#84776D' }}>Tip: click any photo for its full-resolution file. Grid tiles are small previews.</span>
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn btn-clay" disabled={busy || total === 0} onClick={() => approveAll('approved')}>✓ Approve all {total > 0 ? `(${total})` : ''}</button>
          <button type="button" className="btn btn-danger" disabled={busy || total === 0} onClick={() => approveAll('rejected')}>Reject all</button>
        </span>
      </div>
      {checked.size > 0 && (
        <div className="card flex items-center gap-2 !py-3">
          <span className="text-sm font-semibold">{checked.size} selected</span>
          <button type="button" className="btn btn-primary" onClick={() => batch('approved')}>Approve</button>
          <button type="button" className="btn btn-danger" onClick={() => batch('rejected')}>Reject</button>
          <button type="button" className="btn btn-ghost" onClick={() => batch('new')}>Reset</button>
          <button type="button" className="btn btn-ghost" onClick={() => setChecked(new Set())}>Clear</button>
        </div>
      )}
      {lightbox && <Lightbox img={lightbox} onClose={() => setLightbox(null)} onReview={singleReview} />}
      {loading ? <Skeleton lines={6} /> : rows.length === 0 ? (
        <Empty title="No photos match" hint="Adjust filters or import photos first." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {rows.map((img) => (
            <div key={String(img.id)}>
              <div className="mb-1 truncate text-xs font-medium">{String(img.product_title)} <span style={{ color: '#84776D' }}>#{String(img.source_order)}</span></div>
              <ImageCell
                img={img}
                selectable
                onOpen={setLightbox}
                checked={checked.has(String(img.id))}
                onCheck={(id, on) => setChecked((s) => {
                  const n = new Set(s);
                  if (on) n.add(id);
                  else n.delete(id);
                  return n;
                })}
                onReview={(s) => {
                  call('images:review', { ids: [String(img.id)], state: s })
                    .then(() => {
                      push('ok', `Photo marked ${s}`);
                      void load();
                    })
                    .catch((e: Error) => push('err', e.message));
                }}
              />
            </div>
          ))}
        </div>
      )}
      {total > rows.length && <p className="text-center text-xs" style={{ color: '#84776D' }}>Showing first {rows.length} of {total} — refine search to narrow down.</p>}
    </div>
  );
}
