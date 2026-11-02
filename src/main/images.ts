import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RENDER_W = 1000;
export const RENDER_H = 1500;

const PALETTES: Array<[string, string, string]> = [
  ['#E9DFD4', '#C9AE97', '#5d4a3f'],
  ['#DFE4DE', '#9DB0A0', '#33463a'],
  ['#E8E0EC', '#A794BC', '#4a3f5d'],
  ['#F0E4D2', '#C8A06A', '#5d4526'],
  ['#DCE8EC', '#7FA3B5', '#2e4450'],
  ['#EFDDE0', '#C08A96', '#5d3038'],
  ['#E4E4DE', '#8F8F7E', '#3c3c30'],
];

function paletteFor(key: string): [string, string, string] {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Generate a deterministic offline placeholder (used when the original photo can't be downloaded). Returns file path. */
export async function generatePlaceholder(outPath: string, label: string, seedKey: string, w = 1200, h = 1800): Promise<string> {
  const [bg, accent, ink] = paletteFor(seedKey);
  const title = esc(label.length > 42 ? label.slice(0, 42) + '…' : label);
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${accent}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <ellipse cx="${w / 2}" cy="${h * 0.36}" rx="${w * 0.16}" ry="${h * 0.12}" fill="none" stroke="${ink}" stroke-opacity="0.5" stroke-width="6"/>
    <path d="M ${w / 2 - w * 0.16} ${h * 0.36} L ${w / 2 - w * 0.24} ${h * 0.82} L ${w / 2 + w * 0.24} ${h * 0.82} L ${w / 2 + w * 0.16} ${h * 0.36} Z" fill="none" stroke="${ink}" stroke-opacity="0.55" stroke-width="6"/>
    <rect x="${w * 0.12}" y="${h * 0.86}" width="${w * 0.76}" height="70" rx="35" fill="#ffffff" fill-opacity="0.82"/>
    <text x="50%" y="${h * 0.86 + 46}" text-anchor="middle" font-family="Georgia, serif" font-size="34" fill="${ink}">${title}</text>
    <text x="50%" y="${h - 40}" text-anchor="middle" font-family="Georgia, serif" font-size="24" fill="#ffffff" fill-opacity="0.9">OFFLINE PLACEHOLDER</text>
  </svg>`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(outPath);
  return outPath;
}

export function sha256File(p: string): string {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

export interface RenderOptions {
  template: string;
  title?: string;
  format: 'jpg' | 'png';
  quality: number;
  background: string;
}

/** Render a 1000×1500 Pin image non-destructively (contain/fit). Never modifies the original. */
export async function renderPin(sourcePath: string, outPath: string, opts: RenderOptions): Promise<{ path: string; sha256: string }> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const fit = await sharp(sourcePath, { failOn: 'none' })
    .rotate()
    .resize(RENDER_W, RENDER_H, { fit: 'contain', background: opts.background })
    .toBuffer();

  let composed: sharp.Sharp;
  if (opts.template === 'editorial' || opts.template === 'minimal') {
    const border = opts.template === 'editorial' ? 46 : 26;
    const bandH = opts.template === 'editorial' ? 210 : 150;
    const title = esc((opts.title ?? '').slice(0, 90));
    const svg = `<svg width="${RENDER_W}" height="${RENDER_H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${RENDER_W}" height="${RENDER_H}" fill="none" stroke="${opts.template === 'editorial' ? '#B48E78' : '#E5DDD5'}" stroke-width="${border}" />
      ${title ? `<rect x="${border}" y="${RENDER_H - bandH - border}" width="${RENDER_W - border * 2}" height="${bandH}" fill="#302925" fill-opacity="0.72"/>
      <text x="${RENDER_W / 2}" y="${RENDER_H - border - bandH / 2 + 12}" text-anchor="middle" font-family="Georgia, serif" font-size="44" fill="#F7F4F0">${title}</text>` : ''}
    </svg>`;
    composed = sharp(fit).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);
  } else {
    composed = sharp(fit);
  }

  if (opts.format === 'png') {
    await composed.png().toFile(outPath);
  } else {
    await composed.jpeg({ quality: opts.quality, mozjpeg: true }).toFile(outPath);
  }
  return { path: outPath, sha256: sha256File(outPath) };
}

/** Create a small thumbnail for library grids. */
export async function makeThumb(sourcePath: string, outPath: string, width = 480): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(sourcePath, { failOn: 'none' }).rotate().resize(width, Math.round((width * 3) / 2), { fit: 'cover' }).jpeg({ quality: 82 }).toFile(outPath);
}

/** Bounded-concurrency downloader with retries. Returns per-item results. */
export async function downloadMany(
  jobs: Array<{ url: string; dest: string }>,
  opts?: { concurrency?: number; retries?: number },
): Promise<Array<{ dest: string; ok: boolean; error?: string }>> {
  const concurrency = Math.max(1, Math.min(8, opts?.concurrency ?? 4));
  const retries = opts?.retries ?? 3;
  const results: Array<{ dest: string; ok: boolean; error?: string }> = new Array(jobs.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const i = cursor++;
      const j = jobs[i];
      let lastErr = '';
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          fs.mkdirSync(path.dirname(j.dest), { recursive: true });
          const res = await fetch(j.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const ct = res.headers.get('content-type') ?? '';
          if (ct && !/image\//i.test(ct) && !ct.includes('octet-stream')) throw new Error(`Unexpected content-type ${ct}`);
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 1024) throw new Error('File too small — likely an error page');
          const tmp = j.dest + '.part';
          fs.writeFileSync(tmp, buf);
          fs.renameSync(tmp, j.dest);
          results[i] = { dest: j.dest, ok: true };
          break;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          if (attempt === retries) results[i] = { dest: j.dest, ok: false, error: lastErr };
          else await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return results;
}
