import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/db';

describe('sqlite store', () => {
  it('migrates, seeds boards + scheduler defaults, and round-trips settings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpdb-'));
    const s = new Store(path.join(dir, 'test.db'));
    expect((s.db.prepare(`SELECT value FROM schema_meta WHERE key='version'`).get() as { value: string }).value).toBe('4');
    expect((s.db.prepare(`SELECT COUNT(*) c FROM local_boards`).get() as { c: number }).c).toBeGreaterThanOrEqual(3);
    s.setSetting('x', { a: 1 });
    expect(s.getSetting<{ a: number }>('x', { a: 0 }).a).toBe(1);
    s.close();
  });
});
