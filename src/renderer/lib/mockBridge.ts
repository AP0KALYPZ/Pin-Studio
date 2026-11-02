// DEV-ONLY web preview bridge. Used when the renderer runs in a plain browser
// (vite dev server without Electron). Starts empty + in-memory state +
// client-generated SVG artwork. Never bundled into the desktop app's
// critical path: api.ts loads this module only when window.bpApi is missing
// AND import.meta.env.DEV is true.
import { planSchedule } from '@shared/scheduler';
import { autoAlt, autoDescription, autoTitle } from '@shared/textgen';
import { isAdminUrl, isHttpsUrl, PINTEREST_CREATE_URL, type SchedulerSettings } from '@shared/types';
import { toCsv } from '@shared/files';

interface MockImage {
  id: string;
  product_id: string;
  product_title: string;
  source_order: number;
  alt_text: string;
  review_state: string;
  download_state: string;
}

interface MockProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  status: string;
  tags: string[];
  collections: string[];
  canonical_url: string;
  custom_url_override: string | null;
  include_in_schedule: number;
  priority: string;
  demo: number;
}

interface MockPin {
  id: string;
  product_id: string;
  product_image_id: string | null;
  title: string;
  description: string;
  alt_text: string | null;
  destination_url: string;
  board_name: string;
  template_id: string;
  metadata_revision: number;
  posting_state: string;
  review_state: string;
  notes: string | null;
}

interface MockEntry {
  entry_id: string;
  pin_id: string;
  local_date: string;
  local_time: string;
  timezone: string;
  locked: number;
  moved_manually: number;
  generation_batch_id: string | null;
}

const PALETTES: Array<[string, string, string]> = [
  ['#E9DFD4', '#C9AE97', '#5d4a3f'],
  ['#DFE4DE', '#9DB0A0', '#33463a'],
  ['#E8E0EC', '#A794BC', '#4a3f5d'],
  ['#F0E4D2', '#C8A06A', '#5d4526'],
  ['#DCE8EC', '#7FA3B5', '#2e4450'],
];

function palette(key: string): [string, string, string] {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Client-side SVG artwork (600x900 display, 1000x1500 for copy). */
export function svgArt(title: string, seed: string, w = 600, h = 900, demoTag = false): string {
  const [bg, accent, ink] = palette(seed);
  const t = esc(title.length > 40 ? title.slice(0, 40) + '…' : title);
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><ellipse cx="${w / 2}" cy="${h * 0.36}" rx="${w * 0.16}" ry="${h * 0.12}" fill="none" stroke="${ink}" stroke-opacity="0.5" stroke-width="5"/><path d="M ${w / 2 - w * 0.16} ${h * 0.36} L ${w / 2 - w * 0.24} ${h * 0.82} L ${w / 2 + w * 0.24} ${h * 0.82} L ${w / 2 + w * 0.16} ${h * 0.36} Z" fill="none" stroke="${ink}" stroke-opacity="0.55" stroke-width="5"/><rect x="${w * 0.12}" y="${h * 0.86}" width="${w * 0.76}" height="52" rx="26" fill="#ffffff" fill-opacity="0.85"/><text x="50%" y="${h * 0.86 + 34}" text-anchor="middle" font-family="Georgia,serif" font-size="24" fill="${ink}">${t}</text>${demoTag ? `<text x="50%" y="${h - 24}" text-anchor="middle" font-family="Georgia,serif" font-size="16" fill="#ffffff" fill-opacity="0.9">WEB PREVIEW · DEMO</text>` : ''}</svg>`;
}

function svgUrl(title: string, seed: string, w = 600, h = 900): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgArt(title, seed, w, h))}`;
}

let uidN = 0;
function uid(p: string): string {
  uidN += 1;
  return `${p}_web${Date.now().toString(36)}${uidN}`;
}
function nowIso(): string {
  return new Date().toISOString();
}

interface DB {
  products: MockProduct[];
  images: MockImage[];
  boards: Array<{ id: string; name: string }>;
  pins: Map<string, MockPin>;
  entries: MockEntry[];
  activity: Array<{ message: string; at_utc: string; kind: string }>;
  settings: Record<string, unknown>;
  backups: Array<{ id: string; path: string; created_at: string }>;
}

const db: DB = {
  products: [],
  images: [],
  boards: [
    { id: 'b1', name: 'Everyday Style' },
    { id: 'b2', name: 'Season Favorites' },
    { id: 'b3', name: 'Special Occasions' },
  ],
  pins: new Map(),
  entries: [],
  activity: [],
  settings: {
    scheduler: { pinsPerDay: 5, timeSlots: ['09:00', '12:00', '15:00', '18:00', '21:00'], timezone: 'America/Bogota', minProductGapDays: 14, seed: 20261102, startDate: new Date().toISOString().slice(0, 10), days: 0 },
    exports: { format: 'jpg', quality: 88, background: '#F7F4F0', template: 'original' },
  },
  backups: [],
};

function log(kind: string, message: string): void {
  db.activity.unshift({ kind, message, at_utc: nowIso() });
}


function prod(id: string): MockProduct {
  const p = db.products.find((x) => x.id === id);
  if (!p) throw new Error('Product not found.');
  return p;
}

function effUrl(p: MockProduct): string {
  return (p.custom_url_override && p.custom_url_override.trim()) || p.canonical_url;
}

function entryView(e: MockEntry): Record<string, unknown> {
  const pin = db.pins.get(e.pin_id);
  if (!pin) throw new Error('Pin missing.');
  const p = prod(pin.product_id);
  const img = db.images.find((i) => i.id === pin.product_image_id);
  return {
    entry_id: e.entry_id, local_date: e.local_date, local_time: e.local_time, timezone: e.timezone,
    locked: e.locked, moved_manually: e.moved_manually, generation_batch_id: e.generation_batch_id,
    id: pin.id, product_id: pin.product_id, product_image_id: pin.product_image_id,
    title: pin.title, description: pin.description, alt_text: pin.alt_text,
    destination_url: pin.destination_url, board_name: pin.board_name, template_id: pin.template_id,
    posting_state: pin.posting_state, handle: p.handle, image_order: img?.source_order ?? 1,
    source_path: null,
  };
}

function toDay(s: string): number {
  return Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
}

async function copyTextBrowser(text: string): Promise<void> {
  if (!text) throw new Error('Nothing to copy — this field is empty.');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('Browser blocked clipboard access — select the text manually.');
}

async function copyImageBrowser(pin: MockPin): Promise<void> {
  const svg = svgArt(pin.title || 'Pin', pin.product_image_id ?? pin.id, 1000, 1500, false);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not render image.'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1500;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable in this browser.');
  ctx.fillStyle = '#F7F4F0';
  ctx.fillRect(0, 0, 1000, 1500);
  ctx.drawImage(img, 0, 0, 1000, 1500);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not encode image.');
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch {
    // Fallback: download the PNG so the user still gets the file.
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${pin.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    throw new Error('Browser blocked image clipboard — PNG downloaded instead.');
  }
}

function download(filename: string, content: string, mime: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function mockInvoke(channel: string, args?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    switch (channel) {
      case 'app:state':
        return ok({ version: 'web-preview', dataDir: '(browser memory)', demoMode: false });
      case 'catalog:importDemo':
        throw new Error('The demo catalog was removed. Connect Shopify in Settings or import a folder in the desktop app.');
      case 'catalog:stats': {
        const approved = db.images.filter((i) => i.review_state === 'approved');
        const today = new Date();
        const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const in7 = (n: number): string => {
          const d = new Date(today);
          d.setDate(d.getDate() + n);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const used = new Set([...db.pins.values()].map((p) => p.product_image_id));
        return ok({
          products: db.products.length,
          images: db.images.length,
          approved: approved.length,
          drafts: db.pins.size,
          dueToday: db.entries.filter((e) => e.local_date === t).length,
          posted: [...db.pins.values()].filter((p) => p.posting_state === 'posted').length,
          upcoming7: db.entries.filter((e) => e.local_date >= t && e.local_date <= in7(7)).length,
          upcoming30: db.entries.filter((e) => e.local_date >= t && e.local_date <= in7(30)).length,
          unusedApproved: approved.filter((i) => !used.has(i.id)).length,
          lastSync: null,
        });
      }
      case 'catalog:importFolder':
        throw new Error('Folder import needs the desktop app.');
      case 'products:list': {
        const search = String(a.search ?? '').toLowerCase();
        const stock = String(a.stock ?? '');
        let rows = db.products.map((p) => {
          const imgs = db.images.filter((i) => i.product_id === p.id);
          return {
            ...p,
            image_count: imgs.length,
            approved_count: imgs.filter((i) => i.review_state === 'approved').length,
            scheduled_count: db.entries.filter((e) => db.pins.get(e.pin_id)?.product_id === p.id).length,
            posted_count: [...db.pins.values()].filter((x) => x.product_id === p.id && x.posting_state === 'posted').length,
            missing_source: null,
          };
        });
        if (search) rows = rows.filter((p) => p.title.toLowerCase().includes(search) || p.handle.includes(search));
        if (stock === 'zero') rows = rows.filter((p) => p.image_count === 0);
        if (stock === '1-4') rows = rows.filter((p) => p.image_count >= 1 && p.image_count <= 4);
        if (stock === '5-9') rows = rows.filter((p) => p.image_count >= 5 && p.image_count <= 9);
        if (stock === '10plus') rows = rows.filter((p) => p.image_count >= 10);
        return ok(rows.sort((x, y) => x.title.localeCompare(y.title)));
      }
      case 'products:get': {
        const p = prod(String(a.id));
        return ok({ product: p, images: db.images.filter((i) => i.product_id === p.id).sort((x, y) => x.source_order - y.source_order) });
      }
      case 'products:update': {
        const p = prod(String(a.id));
        const patch = a.patch as Record<string, unknown>;
        if ('include_in_schedule' in patch) p.include_in_schedule = Number(patch.include_in_schedule) ? 1 : 0;
        if ('priority' in patch) p.priority = String(patch.priority);
        if ('title' in patch && String(patch.title).trim()) {
          p.title = String(patch.title);
          db.images.filter((i) => i.product_id === p.id).forEach((i) => { i.product_title = p.title; });
        }
        if ('custom_url_override' in patch) p.custom_url_override = String(patch.custom_url_override ?? '') || null;
        log('product-edit', `Product ${p.id} updated (web preview).`);
        return ok({ updated: true });
      }
      case 'images:list': {
        let rows = db.images.slice();
        if (a.review && a.review !== 'all') rows = rows.filter((i) => i.review_state === String(a.review));
        if (a.productId) rows = rows.filter((i) => i.product_id === String(a.productId));
        if (a.search) {
          const s = String(a.search).toLowerCase();
          rows = rows.filter((i) => i.product_title.toLowerCase().includes(s) || (i.alt_text ?? '').toLowerCase().includes(s));
        }
        rows.sort((x, y) => x.product_title.localeCompare(y.product_title) || x.source_order - y.source_order);
        const total = rows.length;
        return ok({ rows: rows.slice(Number(a.offset ?? 0), Number(a.offset ?? 0) + Math.min(500, Number(a.limit ?? 200))), total });
      }
      case 'images:thumb':
      case 'images:original': {
        const img = db.images.find((i) => i.id === String(a.id));
        if (!img) return ok({ dataUrl: null });
        return ok({ dataUrl: svgUrl(img.product_title, img.id) });
      }
      case 'images:review': {
        const ids = a.ids as string[];
        if (!Array.isArray(ids) || !ids.length) throw new Error('No images selected.');
        for (const id of ids) {
          const img = db.images.find((i) => i.id === id);
          if (img) img.review_state = String(a.state);
        }
        log('review', `${ids.length} image(s) marked ${String(a.state)} (web preview).`);
        return ok({ updated: ids.length });
      }
      case 'images:reviewFiltered': {
        const st = String(a.state);
        if (!['new', 'approved', 'rejected'].includes(st)) throw new Error('Bad review state.');
        let n = 0;
        for (const img of db.images) {
          if (a.review && a.review !== 'all' && img.review_state !== String(a.review)) continue;
          if (a.productId && img.product_id !== String(a.productId)) continue;
          if (a.search && !(img.product_title.toLowerCase().includes(String(a.search).toLowerCase()) || (img.alt_text ?? '').toLowerCase().includes(String(a.search).toLowerCase()))) continue;
          img.review_state = st;
          n++;
        }
        log('review', `${n} image(s) marked ${st} (web preview bulk).`);
        return ok({ updated: n });
      }
      case 'images:rebuildThumbs':
        return ok({ rebuilt: db.images.length, missing: 0 });
      case 'data:resetLibrary': {
        if (String(a.confirm ?? '') !== 'RESET') throw new Error('Type RESET to confirm. Nothing was deleted.');
        const out = { products: db.products.length, images: db.images.length, pins: db.pins.size, entries: db.entries.length };
        db.products = [];
        db.images = [];
        db.pins = new Map();
        db.entries = [];
        log('reset', `Library reset by user (web preview): removed ${out.products} products, ${out.images} photos.`);
        return ok(out);
      }
      case 'boards:list':
        return ok(db.boards);
      case 'boards:create': {
        const name = String(a.name ?? '').trim();
        if (!name) throw new Error('Board name is required.');
        if (db.boards.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw new Error('That board name already exists.');
        const b = { id: uid('board'), name };
        db.boards.push(b);
        return ok(b);
      }
      case 'boards:delete':
        db.boards = db.boards.filter((b) => b.id !== String(a.id));
        return ok({ deleted: true });
      case 'schedule:settings:get':
        return ok(db.settings.scheduler);
      case 'schedule:settings:set':
        db.settings.scheduler = a.settings as SchedulerSettings;
        return ok({ saved: true });
      case 'schedule:coverage': {
        const s = { ...(a.settings as SchedulerSettings), days: 0 };
        const today = new Date().toISOString().slice(0, 10);
        const startDate = s.startDate && s.startDate >= today ? s.startDate : today;
        const eligible = db.images
          .filter((i) => i.review_state === 'approved' && i.download_state === 'ready')
          .filter((i) => {
            const p = prod(i.product_id);
            return p.include_in_schedule === 1 && effUrl(p);
          })
          .map((i) => ({ image_id: i.id, product_id: i.product_id, product_title: i.product_title, priority: (prod(i.product_id).priority ?? 'Normal') as 'High' | 'Normal' | 'Low', source_order: i.source_order }));
        const used = new Set([...db.pins.values()].map((p) => p.product_image_id));
        const existing = db.entries.map((e) => {
          const pin = db.pins.get(e.pin_id);
          return { product_id: pin?.product_id ?? '', image_id: pin?.product_image_id ?? '', date: e.local_date };
        });
        const { daysUsed, endDate, idleDays, leftover } = planSchedule(eligible, existing, { ...s, startDate }, { protectedSlots: db.entries.filter((e) => e.locked).map((e) => ({ date: e.local_date, time: e.local_time })) });
        return ok({
          remaining: eligible.filter((e) => !used.has(e.image_id)).length,
          pinsPerDay: Math.min(20, Math.max(1, s.pinsPerDay)),
          daysNeeded: daysUsed, endDate, idleDays, leftover, startDate,
        });
      }
      case 'schedule:preview': {
        const s = a.settings as SchedulerSettings;
        const eligible = db.images
          .filter((i) => i.review_state === 'approved' && i.download_state === 'ready')
          .filter((i) => {
            const p = prod(i.product_id);
            return p.include_in_schedule === 1 && effUrl(p);
          })
          .map((i) => ({ image_id: i.id, product_id: i.product_id, product_title: i.product_title, priority: (prod(i.product_id).priority ?? 'Normal') as 'High' | 'Normal' | 'Low', source_order: i.source_order }));
        // Exclude already-used images so preview never double-books.
        const used = new Set([...db.pins.values()].map((p) => p.product_image_id));
        const fresh = eligible.filter((e) => !used.has(e.image_id));
        const existing = db.entries.map((e) => {
          const pin = db.pins.get(e.pin_id);
          return { product_id: pin?.product_id ?? '', image_id: pin?.product_image_id ?? '', date: e.local_date };
        });
        const { slots } = planSchedule(fresh, existing, s, { protectedSlots: db.entries.filter((e) => e.locked).map((e) => ({ date: e.local_date, time: e.local_time })) });
        return ok({
          slots: slots.map((sl) => ('reason' in sl && sl.reason
            ? { date: sl.date, time: sl.time, product_id: null, product_image_id: null, reason: sl.reason }
            : { date: sl.date, time: sl.time, product_id: sl.product_id, product_title: (sl as { product_title: string }).product_title, product_image_id: (sl as { product_image_id: string }).product_image_id })),
        });
      }
      case 'schedule:apply': {
        const s = a.settings as SchedulerSettings;
        const slots = a.slots as Array<{ date: string; time: string; product_id: string | null; product_image_id?: string | null }>;
        const batchId = uid('batch');
        let placed = 0;
        let empty = 0;
        for (const sl of slots) {
          if (!sl.product_id || !sl.product_image_id) {
            empty++;
            continue;
          }
          if ([...db.pins.values()].some((p) => p.product_image_id === sl.product_image_id)) {
            empty++;
            continue;
          }
          const p = prod(sl.product_id);
          const url = effUrl(p);
          if (!url) {
            empty++;
            continue;
          }
          const facts = { title: p.title, description: p.description, productType: '', tags: p.tags, collections: p.collections };
          const pin: MockPin = {
            id: uid('pin'), product_id: p.id, product_image_id: sl.product_image_id,
            title: autoTitle(facts), description: autoDescription(facts, url), alt_text: autoAlt(facts),
            destination_url: url, board_name: db.boards[0]?.name ?? 'Everyday Style',
            template_id: 'original', metadata_revision: 1, posting_state: 'not_posted', review_state: 'draft', notes: null,
          };
          db.pins.set(pin.id, pin);
          db.entries.push({ entry_id: uid('sched'), pin_id: pin.id, local_date: sl.date, local_time: sl.time, timezone: s.timezone, locked: 0, moved_manually: 0, generation_batch_id: batchId });
          placed++;
        }
        log('schedule-apply', `Schedule applied (web preview): ${placed} pins placed, ${empty} empty.`);
        return ok({ placed, empty, batchId });
      }
      case 'schedule:undo': {
        const before = db.entries.length;
        const pinIds = new Set(db.entries.filter((e) => e.generation_batch_id === String(a.batchId) && !e.locked).map((e) => e.pin_id));
        db.entries = db.entries.filter((e) => !(e.generation_batch_id === String(a.batchId) && !e.locked));
        for (const pid of pinIds) {
          if (!db.entries.some((e) => e.pin_id === pid)) {
            const pin = db.pins.get(pid);
            if (pin && pin.posting_state === 'not_posted') db.pins.delete(pid);
          }
        }
        return ok({ removed: before - db.entries.length });
      }
      case 'schedule:list': {
        const from = String(a.from ?? '2000-01-01');
        const to = String(a.to ?? '2100-01-01');
        return ok({ entries: db.entries.filter((e) => e.local_date >= from && e.local_date <= to).sort((x, y) => (x.local_date + x.local_time).localeCompare(y.local_date + y.local_time)).map(entryView) });
      }
      case 'schedule:move': {
        const e = db.entries.find((x) => x.entry_id === String(a.entryId));
        if (!e) throw new Error('Entry not found.');
        const pin = db.pins.get(e.pin_id);
        if (!pin) throw new Error('Pin missing.');
        const s = db.settings.scheduler as SchedulerSettings;
        const gap = s.minProductGapDays ?? 14;
        const target = toDay(String(a.date));
        for (const o of db.entries) {
          if (o.entry_id === e.entry_id) continue;
          const op = db.pins.get(o.pin_id);
          if (!op) continue;
          if (op.product_id === pin.product_id && Math.abs(target - toDay(o.local_date)) < gap) {
            throw new Error(`Same-product gap: this product already appears within ${gap} days of ${String(a.date)}.`);
          }
          if (op.product_image_id && op.product_image_id === pin.product_image_id) throw new Error('That photo is already scheduled elsewhere.');
        }
        e.local_date = String(a.date);
        e.local_time = String(a.time);
        e.moved_manually = 1;
        return ok({ moved: true });
      }
      case 'schedule:lock': {
        const e = db.entries.find((x) => x.entry_id === String(a.entryId));
        if (!e) throw new Error('Entry not found.');
        e.locked = a.locked ? 1 : 0;
        return ok({ locked: !!a.locked });
      }
      case 'schedule:delete': {
        const e = db.entries.find((x) => x.entry_id === String(a.entryId));
        if (!e) throw new Error('Entry not found.');
        db.entries = db.entries.filter((x) => x.entry_id !== e.entry_id);
        if (!db.entries.some((x) => x.pin_id === e.pin_id)) db.pins.delete(e.pin_id);
        return ok({ deleted: true });
      }
      case 'pins:get': {
        const pin = db.pins.get(String(a.id));
        if (!pin) throw new Error('Pin not found.');
        const p = prod(pin.product_id);
        const img = db.images.find((i) => i.id === pin.product_image_id);
        const e = db.entries.find((x) => x.pin_id === pin.id);
        return ok({ pin: { ...pin, handle: p.handle, image_order: img?.source_order ?? 1, source_path: null, thumb_path: null, local_date: e?.local_date ?? null, local_time: e?.local_time ?? null, timezone: e?.timezone ?? null, planned_utc: null, locked: e?.locked ?? 0 } });
      }
      case 'pins:update': {
        const pin = db.pins.get(String(a.id));
        if (!pin) throw new Error('Pin not found.');
        if (pin.posting_state === 'posted') throw new Error('Posted pins are read-only history.');
        const patch = a.patch as Record<string, unknown>;
        for (const k of ['title', 'description', 'alt_text', 'destination_url', 'board_name', 'template_id', 'notes', 'review_state'] as const) {
          if (!(k in patch)) continue;
          if (k === 'destination_url') {
            const u = String(patch[k] ?? '');
            if (u && (!isHttpsUrl(u) || isAdminUrl(u))) throw new Error('Destination must be a public https product URL (never a Shopify admin URL).');
          }
          if (k === 'board_name' && !String(patch[k] ?? '').trim()) throw new Error('Board name is required.');
          (pin as unknown as Record<string, unknown>)[k] = patch[k];
        }
        if (['title', 'description', 'alt_text', 'destination_url', 'template_id'].some((k) => k in patch)) {
          pin.metadata_revision += 1;
          if (pin.review_state === 'reviewed') pin.review_state = 'needs_review';
        }
        return ok({ updated: true });
      }
      case 'pins:autofill': {
        const pin = db.pins.get(String(a.id));
        if (!pin) throw new Error('Pin not found.');
        const p = prod(pin.product_id);
        const facts = { title: p.title, description: p.description, productType: '', tags: p.tags, collections: p.collections };
        pin.title = autoTitle(facts);
        pin.description = autoDescription(facts, pin.destination_url);
        pin.alt_text = autoAlt(facts);
        pin.metadata_revision += 1;
        return ok({ filled: true });
      }
      case 'pins:markPosted': {
        const pin = db.pins.get(String(a.id));
        if (!pin) throw new Error('Pin not found.');
        const url = String(a.pinUrl ?? '').trim();
        if (url) {
          const u = new URL(url);
          if (u.protocol !== 'https:' || !/pinterest\./i.test(u.hostname)) throw new Error('Pin URL must be an https Pinterest link (or empty).');
        }
        pin.posting_state = 'posted';
        log('posted', `Pin ${pin.id} marked posted by user (web preview).`);
        return ok({ posted: true, at: nowIso() });
      }
      case 'pins:undoPosted': {
        const pin = db.pins.get(String(a.id));
        if (!pin) throw new Error('Pin not found.');
        pin.posting_state = 'not_posted';
        return ok({ undone: true });
      }
      case 'pins:skip': {
        const pin = db.pins.get(String(a.id));
        if (!pin) throw new Error('Pin not found.');
        pin.posting_state = 'skipped';
        pin.notes = (a.notes as string) ?? null;
        return ok({ skipped: true });
      }
      case 'pins:restore': {
        const pin = db.pins.get(String(a.id));
        if (!pin) throw new Error('Pin not found.');
        pin.posting_state = 'not_posted';
        return ok({ restored: true });
      }
      case 'desk:prepareImage': {
        const pin = db.pins.get(String((a as { pinId: string }).pinId));
        if (!pin) throw new Error('Pin not found.');
        return ok({ path: `memory://renders/${pin.id}.jpg (web preview — use Save to download)` });
      }
      case 'desk:copyImage': {
        const pin = db.pins.get(String((a as { pinId: string }).pinId));
        if (!pin) throw new Error('Pin not found.');
        await copyImageBrowser(pin);
        return ok({ copied: true });
      }
      case 'desk:copyText': {
        const t = a as { pinId?: string; field?: string; text: string };
        await copyTextBrowser(t.text);
        return ok({ copied: true });
      }
      case 'desk:openPinterest':
        window.open(PINTEREST_CREATE_URL, '_blank', 'noopener');
        return ok({ opened: true });
      case 'desk:reveal':
        throw new Error('File reveal needs the desktop app — use Save As to download the image.');
      case 'desk:saveAs': {
        const pin = db.pins.get(String((a as { pinId: string }).pinId));
        if (!pin) throw new Error('Pin not found.');
        const svg = svgArt(pin.title || 'Pin', pin.product_image_id ?? pin.id, 1000, 1500, false);
        download(`${pin.id}-1000x1500.svg`, svg, 'image/svg+xml');
        return ok({ saved: true, path: 'browser downloads' });
      }
      case 'exports:pack': {
        const from = String(a.from);
        const to = String(a.to);
        const rows = db.entries
          .filter((e) => e.local_date >= from && e.local_date <= to)
          .sort((x, y) => (x.local_date + x.local_time).localeCompare(y.local_date + y.local_time))
          .map((e) => {
            const pin = db.pins.get(e.pin_id);
            const p = prod(pin?.product_id ?? '');
            return { pin: pin as MockPin, handle: p.handle, local_date: e.local_date, local_time: e.local_time, timezone: e.timezone };
          });
        if (!rows.length) throw new Error('No scheduled pins in that range.');
        const headers = ['local_pin_id', 'scheduled_date', 'scheduled_time', 'timezone', 'product_id', 'product_title', 'title', 'description', 'alt_text', 'board_name', 'product_url', 'posting_state'];
        const csv = toCsv(headers, rows.map((r) => [r.pin.id, r.local_date, r.local_time, r.timezone, r.pin.product_id, prod(r.pin.product_id).title, r.pin.title, r.pin.description, r.pin.alt_text ?? '', r.pin.board_name, r.pin.destination_url, r.pin.posting_state]));
        const cards = rows.map((r, i) => {
          const p = prod(r.pin.product_id);
          const img = svgUrl(p.title, r.pin.product_image_id ?? r.pin.id, 300, 450);
          return `<article style="background:#fff;border:1px solid #E5DDD5;border-radius:14px;padding:16px;margin-bottom:16px"><div style="color:#84776D;font-size:13px">Pin ${i + 1}/${rows.length} · ${r.local_date} ${r.local_time}</div><img src="${img}" style="width:200px;border-radius:8px" alt=""/><h2>${r.pin.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h2><p style="white-space:pre-wrap">${r.pin.description.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p><strong>Link:</strong> ${r.pin.destination_url}</p><p><strong>Board:</strong> ${r.pin.board_name}</p></article>`;
        }).join('\n');
        download(`POSTING_SHEET-${String(a.label)}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>Pack ${String(a.label)}</title></head><body style="font-family:Georgia,serif;background:#F7F4F0;max-width:860px;margin:auto;padding:24px"><h1>Posting pack — ${String(a.label)} (web preview)</h1><p>${rows.length} pins. Full JPG renders + CSV manifest are produced by the desktop app.</p>${cards}</body></html>`, 'text/html');
        log('export', `Web preview pack "${String(a.label)}": ${rows.length} pins (HTML sheet downloaded).`);
        return ok({ dir: 'browser downloads', images: rows.length, manifest: 'POSTING_SHEET (downloaded)' });
      }
      case 'exports:revealDir':
        throw new Error('Packs download to your browser downloads folder in web preview.');
      case 'backup:create': {
        const b = { id: uid('bak'), path: `(browser memory) backup-${new Date().toISOString().slice(0, 19)}`, created_at: nowIso() };
        db.backups.unshift(b);
        download(`pin-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exported_at: nowIso(), products: db.products.length, pins: db.pins.size, entries: db.entries, boards: db.boards }, null, 2), 'application/json');
        return ok({ id: b.id, path: b.path, sha256: 'preview', files: 1 });
      }
      case 'backup:list':
        return ok(db.backups);
      case 'backup:inspect':
        return ok({ ok: true, manifest: { note: 'Web preview backup (JSON download).' } });
      case 'settings:get':
        return ok(db.settings[String(a.key)] ?? null);
      case 'settings:set':
        db.settings[String(a.key)] = a.value;
        return ok({ saved: true });
      case 'shopify:status':
        return ok({ connections: [] });
      case 'shopify:connect':
      case 'shopify:sync':
        throw new Error('Shopify sync needs the desktop app (OS-protected credential storage). Enter Client ID + secret in the installed app instead — web preview cannot hold secrets.');
      case 'shopify:disconnect':
        return ok({ disconnected: true });
      case 'ai:status':
        return ok({ hasKey: false, model: 'gpt-4o-mini' });
      case 'ai:setKey':
      case 'ai:clearKey':
      case 'ai:enhance':
        throw new Error('AI copy needs the desktop app and your own OpenAI API key (Settings → AI copy).');
      case 'dialog:pickFolder':
        return ok({ path: null });
      case 'activity:list':
        return ok(db.activity.slice(0, Math.min(200, Number(a.limit ?? 60))));
      case 'insights:get': {
        const approved = db.images.filter((i) => i.review_state === 'approved');
        const byWeek = new Map<string, number>();
        for (const e of db.entries) {
          const d = new Date(`${e.local_date}T12:00:00`);
          const wk = `${d.getFullYear()}-W${String(Math.ceil((d.getDate() + (new Date(d.getFullYear(), d.getMonth(), 1).getDay() + 6) % 7) / 7)).padStart(2, '0')}`;
          byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
        }
        return ok({
          approved: approved.length,
          products: new Set(approved.map((i) => i.product_id)).size,
          drafted: db.pins.size,
          posted: [...db.pins.values()].filter((p) => p.posting_state === 'posted').length,
          skipped: [...db.pins.values()].filter((p) => p.posting_state === 'skipped').length,
          unused: approved.filter((i) => ![...db.pins.values()].some((p) => p.product_image_id === i.id)).length,
          perWeek: [...byWeek.entries()].map(([wk, c]) => ({ wk, c })).sort().reverse().slice(0, 12),
        });
      }
      default:
        throw new Error(`Unknown channel: ${channel}`);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function ok(data: unknown): { ok: boolean; data?: unknown } {
  return { ok: true, data };
}

export function mockOnProgress(): () => void {
  return () => undefined;
}
