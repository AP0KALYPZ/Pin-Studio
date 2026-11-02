import { describe, expect, it } from 'vitest';
import { fetchAllMedia, fetchAllProducts, paginateAll, storefrontUrl } from '../src/shared/shopify';

function cursorPages<T>(items: T[], pageSize: number) {
  return async (after: string | null, first: number) => {
    const start = after ? parseInt(after, 10) : 0;
    const slice = items.slice(start, start + Math.min(first, pageSize));
    const end = start + slice.length;
    return {
      nodes: slice,
      pageInfo: { hasNextPage: end < items.length, endCursor: end < items.length ? String(end) : null },
    };
  };
}

describe('shopify cursor pagination', () => {
  it('retrieves 260+ products across pages (never stops early)', async () => {
    const items = Array.from({ length: 260 }, (_, i) => ({ id: `gid://shopify/Product/${i}`, handle: `dress-${i}`, title: `Dress ${i}`, descriptionHtml: '', status: 'ACTIVE', tags: [], productType: 'Dresses' }));
    const all = await fetchAllProducts(cursorPages(items, 50));
    expect(all.length).toBe(260);
  });

  it('retrieves 265 media from a single product (no 10/100/250 cap)', async () => {
    const media = Array.from({ length: 265 }, (_, i) => ({ id: `gid://shopify/MediaImage/${i}`, image: { url: `https://cdn.example/${i}.jpg` } }));
    const all = await fetchAllMedia('gid://shopify/Product/1', async (_pid, after, first) => cursorPages(media, 50)(after, first));
    expect(all.length).toBe(265);
    // first:10-style small pages still exhaust
    const allSmall = await fetchAllMedia('gid://shopify/Product/1', async (_pid, after) => cursorPages(media, 10)(after, 10));
    expect(allSmall.length).toBe(265);
  });

  it('generic paginator handles empty + exact-page boundaries', async () => {
    expect(await paginateAll(cursorPages([], 50))).toEqual([]);
    const ten = Array.from({ length: 10 }, (_, i) => i);
    expect((await paginateAll(cursorPages(ten, 10))).length).toBe(10);
  });

  it('storefrontUrl never yields admin URLs', () => {
    const u = storefrontUrl('https://bellanera.com', 'satin-dress');
    expect(u).toBe('https://bellanera.com/products/satin-dress');
    expect(u).not.toMatch(/admin/);
  });
});
