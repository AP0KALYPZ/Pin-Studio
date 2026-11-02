import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/db';
import { syncBoardsFromCollections, upsertShopifyProducts } from '../src/main/catalog';

function emptyStore(): Store {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bpb-'));
  return new Store(path.join(base, 'test.db'));
}

const PRODS = [
  { gid: 'gid://shopify/Product/1', handle: 'a', title: 'A', descriptionHtml: '', status: 'ACTIVE', tags: [], collections: ['Everyday Style', 'Summer'], productType: '', storefrontUrl: 'https://x.example/a' },
  { gid: 'gid://shopify/Product/2', handle: 'b', title: 'B', descriptionHtml: '', status: 'ACTIVE', tags: [], collections: ['everyday style', '  ', 'Winter'], productType: '', storefrontUrl: 'https://x.example/b' },
  { gid: 'gid://shopify/Product/3', handle: 'c', title: 'C', descriptionHtml: '', status: 'ACTIVE', tags: [], collections: [], productType: '', storefrontUrl: 'https://x.example/c' },
];

describe('syncBoardsFromCollections', () => {
  it('creates one board per collection, case-insensitive, and idempotent', () => {
    const s = emptyStore();
    upsertShopifyProducts(s, 'sh1', PRODS);
    const first = syncBoardsFromCollections(s, PRODS);
    // seeded 3 + Everyday Style reused (case-insensitive) + Summer + Winter
    expect(first.created).toBe(2);
    const names = (s.db.prepare(`SELECT name FROM local_boards`).all() as Array<{ name: string }>).map((r) => r.name);
    expect(names).toContain('Summer');
    expect(names).toContain('Winter');
    expect(names.filter((x) => x.toLowerCase() === 'everyday style')).toHaveLength(1);
    const second = syncBoardsFromCollections(s, PRODS);
    expect(second.created).toBe(0);
    s.close();
  });

  it('never creates a New Arrivals board, in any casing', () => {
    const s = emptyStore();
    upsertShopifyProducts(s, 'sh1', [
      { gid: 'gid://shopify/Product/9', handle: 'n', title: 'N', descriptionHtml: '', status: 'ACTIVE', tags: [], collections: ['New Arrivals', 'NEW ARRIVALS', 'Everyday Style'], productType: '', storefrontUrl: 'https://x.example/n' },
    ]);
    const r = syncBoardsFromCollections(s, [{ gid: 'gid://shopify/Product/9', collections: ['New Arrivals', 'NEW ARRIVALS', 'Everyday Style'] }]);
    const names = (s.db.prepare(`SELECT name FROM local_boards`).all() as Array<{ name: string }>).map((x) => x.name.toLowerCase());
    expect(names).not.toContain('new arrivals');
    expect(r.created).toBe(0); // Everyday Style already seeded
    const pref = (s.db.prepare(`SELECT preferred_local_board_id p FROM products`).get() as { p: string | null }).p;
    const styleId = (s.db.prepare(`SELECT id FROM local_boards WHERE LOWER(name)='everyday style'`).get() as { id: string }).id;
    expect(pref).toBe(styleId); // falls through to first non-blocked collection
    s.close();
  });

  it('never creates generic catch-all boards, in any casing, and assigns nothing when only blocked', () => {
    const s = emptyStore();
    upsertShopifyProducts(s, 'sh1', [
      { gid: 'gid://shopify/Product/7', handle: 'd', title: 'D', descriptionHtml: '', status: 'ACTIVE', tags: [], collections: ['FRONTPAGE', 'Featured', 'Everyday Style'], productType: '', storefrontUrl: 'https://x.example/d' },
      { gid: 'gid://shopify/Product/8', handle: 'e', title: 'E', descriptionHtml: '', status: 'ACTIVE', tags: [], collections: ['All Products'], productType: '', storefrontUrl: 'https://x.example/e' },
    ]);
    const r = syncBoardsFromCollections(s, [
      { gid: 'gid://shopify/Product/7', collections: ['FRONTPAGE', 'Featured', 'Everyday Style'] },
      { gid: 'gid://shopify/Product/8', collections: ['All Products'] },
    ]);
    const names = (s.db.prepare(`SELECT name FROM local_boards`).all() as Array<{ name: string }>).map((x) => x.name.toLowerCase());
    expect(names).not.toContain('frontpage');
    expect(names).not.toContain('featured');
    expect(names).not.toContain('all products');
    expect(r.created).toBe(0); // Everyday Style already seeded
    const styleId = (s.db.prepare(`SELECT id FROM local_boards WHERE LOWER(name)='everyday style'`).get() as { id: string }).id;
    const prefD = (s.db.prepare(`SELECT preferred_local_board_id p FROM products WHERE handle='d'`).get() as { p: string | null }).p;
    expect(prefD).toBe(styleId); // falls through past both blocked names
    const prefE = (s.db.prepare(`SELECT preferred_local_board_id p FROM products WHERE handle='e'`).get() as { p: string | null }).p;
    expect(prefE).toBeNull(); // only blocked collections -> no auto-assignment
    s.close();
  });

  it('assigns preferred board from first collection but never overwrites a manual choice', () => {
    const s = emptyStore();
    upsertShopifyProducts(s, 'sh1', PRODS);
    syncBoardsFromCollections(s, PRODS);
    const pref = (gid: string): string | null => {
      const id = `shop_${gid.replace(/[^a-zA-Z0-9]/g, '_')}`;
      return (s.db.prepare(`SELECT preferred_local_board_id p FROM products WHERE id=?`).get(id) as { p: string | null }).p;
    };
    const styleId = (s.db.prepare(`SELECT id FROM local_boards WHERE LOWER(name)='everyday style'`).get() as { id: string }).id;
    expect(pref('gid://shopify/Product/1')).toBe(styleId);
    expect(pref('gid://shopify/Product/3')).toBeNull();

    // user picks a different board manually, then re-syncs with changed collections
    const custom = (s.db.prepare(`SELECT id FROM local_boards WHERE name='Season Favorites'`).get() as { id: string }).id;
    s.db.prepare(`UPDATE products SET preferred_local_board_id=? WHERE handle='a'`).run(custom);
    syncBoardsFromCollections(s, [{ ...PRODS[0], collections: ['Winter'] }]);
    expect(pref('gid://shopify/Product/1')).toBe(custom);
    s.close();
  });
});
