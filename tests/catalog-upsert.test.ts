import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/db';
import { upsertShopifyProducts } from '../src/main/catalog';

function freshStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpup-'));
  return new Store(path.join(dir, 'test.db'));
}

const P = (over: Record<string, unknown> = {}) => ({
  gid: 'gid://shopify/Product/1',
  handle: 'satin-dress',
  title: 'Satin Dress',
  descriptionHtml: '<p>Lovely.</p>',
  status: 'ACTIVE',
  tags: ['evening'],
  collections: ['Evening Looks'],
  productType: 'Dresses',
  storefrontUrl: 'https://example.com/products/satin-dress',
  ...over,
});

describe('upsertShopifyProducts', () => {
  it('inserts a brand-new product without NOT NULL violations', () => {
    const s = freshStore();
    const r = upsertShopifyProducts(s, 'conn1', [P()]);
    expect(r).toEqual({ added: 1, updated: 0 });
    const row = s.db.prepare(`SELECT collections_json, tags_json FROM products WHERE handle='satin-dress'`).get() as { collections_json: string; tags_json: string };
    expect(JSON.parse(row.collections_json)).toEqual(['Evening Looks']);
    expect(JSON.parse(row.tags_json)).toEqual(['evening']);
    s.close();
  });

  it('inserts a product with no collections as empty list, and preserves user fields on resync', () => {
    const s = freshStore();
    upsertShopifyProducts(s, 'conn1', [P({ gid: 'gid://shopify/Product/2', handle: 'plain', collections: [] })]);
    const id = 'shop_gid___shopify_Product_2';
    s.db.prepare(`UPDATE products SET priority='High', custom_url_override='https://example.com/custom' WHERE id=?`).run(id);
    const r = upsertShopifyProducts(s, 'conn1', [P({ gid: 'gid://shopify/Product/2', handle: 'plain', title: 'Plain v2', collections: [] })]);
    expect(r).toEqual({ added: 0, updated: 1 });
    const row = s.db.prepare(`SELECT title, priority, custom_url_override, collections_json FROM products WHERE id=?`).get(id) as Record<string, string>;
    expect(row.title).toBe('Plain v2');
    expect(row.priority).toBe('High');
    expect(row.custom_url_override).toBe('https://example.com/custom');
    expect(JSON.parse(row.collections_json)).toEqual([]);
    s.close();
  });
});
