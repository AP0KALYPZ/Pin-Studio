import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { generatePlaceholder, renderPin, sha256File } from '../src/main/images';

describe('image pipeline', () => {
  it('placeholder + 1000x1500 render for all three templates; original untouched', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
    const src = path.join(dir, 'src.jpg');
    await generatePlaceholder(src, 'Test Dress', 'seed-1', 1200, 1800);
    const before = sha256File(src);

    for (const t of ['original', 'editorial', 'minimal']) {
      const out = path.join(dir, `${t}.jpg`);
      await renderPin(src, out, { template: t, title: 'A very long title that must stay inside the safe zone and wrap or clamp gracefully', format: 'jpg', quality: 80, background: '#F7F4F0' });
      const meta = await sharp(out).metadata();
      expect(meta.width).toBe(1000);
      expect(meta.height).toBe(1500);
      expect(fs.existsSync(out)).toBe(true);
    }
    expect(sha256File(src)).toBe(before); // non-destructive
  }, 60000);
});
