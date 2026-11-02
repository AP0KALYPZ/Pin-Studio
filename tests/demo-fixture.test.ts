import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('demo fixture contract', () => {
  it('has 7 products with counts 0,1,3,6,10,14,32 = 66 images', () => {
    const p = path.resolve(__dirname, '../fixtures/demo_catalog.json');
    const fx = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      expected_products: number;
      expected_images: number;
      products: Array<{ images: unknown[] }>;
    };
    expect(fx.expected_products).toBe(7);
    expect(fx.expected_images).toBe(66);
    expect(fx.products.length).toBe(7);
    const counts = fx.products.map((x) => x.images.length).sort((a, b) => a - b);
    expect(counts).toEqual([0, 1, 3, 6, 10, 14, 32]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(66);
  });
});
