// Headless end-to-end smoke: DB -> demo import -> approve -> schedule -> render -> pack -> backup.
// Runs against compiled dist-electron output with plain Node (no display needed).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../dist-electron/main/db.js');
const { importDemoCatalog } = require('../dist-electron/main/catalog.js');
const { previewSchedule, applySchedule } = require('../dist-electron/main/scheduleApply.js');
const { pinsForRange, exportPack } = require('../dist-electron/main/packExporter.js');
const { createBackup } = require('../dist-electron/main/backup.js');

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-smoke-'));
  const dirs = {
    originalsDir: path.join(base, 'originals'),
    thumbsDir: path.join(base, 'thumbs'),
    rendersDir: path.join(base, 'renders'),
    exportsDir: path.join(base, 'Exports'),
    backupsDir: path.join(base, 'backups'),
  };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const store = new Store(path.join(base, 'pinstudio.db'));

  // 1. Demo import: expect 7 products / 66 images
  const imp = await importDemoCatalog(store, dirs, path.resolve(__dirname, '../fixtures/demo_catalog.json'));
  console.log(`demo: ${imp.products} products, ${imp.images} images`);
  if (imp.products !== 7 || imp.images !== 66) throw new Error('Demo counts wrong!');

  // 2. Approve 15+ images across dresses
  const ids = store.db.prepare(`SELECT id FROM product_images WHERE product_id != 'demo-product-001' LIMIT 20`).all().map((r) => r.id);
  const stmt = store.db.prepare(`UPDATE product_images SET review_state='approved' WHERE id=?`);
  ids.forEach((id) => stmt.run(id));
  console.log(`approved: ${ids.length}`);

  // 3. Preview + apply schedule
  const settings = { pinsPerDay: 5, timeSlots: ['09:00', '12:00', '15:00', '18:00', '21:00'], timezone: 'America/Bogota', minProductGapDays: 14, seed: 20261102, startDate: '2026-11-02', days: 14 };
  const slots = previewSchedule(store, settings);
  const placedPreview = slots.filter((s) => s.product_id).length;
  console.log(`preview: ${placedPreview} placeable / ${slots.length} slots`);
  const applied = applySchedule(store, settings, slots);
  console.log(`applied: ${applied.placed} placed, batch ${applied.batchId}`);

  // 4. Export a pack for the first scheduled week
  const pins = pinsForRange(store, '2026-11-02', '2026-11-09');
  console.log(`range pins: ${pins.length}`);
  const pack = await exportPack(store, dirs, dirs.exportsDir, 'week-2026-11-02', pins, 'jpg');
  for (const f of ['manifest.csv', 'manifest.json', 'POSTING_SHEET.txt', 'POSTING_SHEET.html']) {
    if (!fs.existsSync(path.join(pack.dir, f))) throw new Error(`Missing ${f} in pack`);
  }
  console.log(`pack: ${pack.dir} (${pack.images} pins, all manifests present)`);

  // 5. Mark one posted (manual-only path) + backup
  const first = store.db.prepare(`SELECT id FROM pin_drafts LIMIT 1`).get();
  store.db.prepare(`UPDATE pin_drafts SET posting_state='posted' WHERE id=?`).run(first.id);
  const bak = await createBackup(store, path.join(base, 'pinstudio.db'), dirs, dirs.backupsDir, true);
  console.log(`backup: ${bak.path} (${bak.files} files)`);
  if (!fs.existsSync(path.join(bak.path, 'pinstudio.db'))) throw new Error('Backup DB missing');

  store.close();
  console.log('SMOKE OK');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
