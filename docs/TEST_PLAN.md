# Pin Studio — Manual-Only Acceptance Tests

Codex must implement automated unit/integration/E2E coverage for key scenarios below, plus a human walkthrough. A test passing against a stub does not count as real functionality.

## A. Product sync, actual image counts, and storage

- [ ] Demo fixture imports **7 products with media counts 0, 1, 3, 6, 10, 14, 32 = 66 images**, preserving original order; every number displayed matches the DB.
- [ ] Zero image product stays visible with `No images`, and has no schedulable media.
- [ ] Simulated live product pagination retrieves 260+ products; nested product media pagination retrieves **265 image media from one product**, never silently stopping at 10, 25, 100 or 250.
- [ ] File download failure/expired URL shows recoverable failed state; another product sync continues, retry eventually downloads the missing media.
- [ ] Image without valid media URL is not treated as ready or approved, and user sees warning.
- [ ] User approves image #2, rejects #3, then product title changes and one image added and another removed; sync preserves old reviews, edited Pin text, calendar entries, manually posted history; missing image flagged/archived not deleted.
- [ ] Two products sharing same CDN image still receive separate product-image relationship records and correct product links. Near-duplicate detector warns but never deletes.
- [ ] Merchant has only read permission; connection errors (401/403/throttle) provide actionable UI without secrets in logs.
- [ ] Fresh demo starts with locally generated thumbnails that **actually render** offline, not fake CDN URLs or broken icons.
- [ ] Reopen app -> database, review state, board names, user-edited public URL and schedule persist.

## B. Scheduler and calendar

- [ ] No newly imported photo schedules until user approves it.
- [ ] 7 products, 1 photo each, 5/day, 14 day product gap: at most 7 Pins placed total, empty remaining slots explained.
- [ ] Uneven photo counts rotate fairly; when feasible, represent each eligible product before scheduling a second source photo from a single product.
- [ ] 120 products with variable counts calculate actual remaining available approved images, not `120*10`.
- [ ] Same snapshot, seed, time zone and settings yield same preview; changing seed never violates any hard rule.
- [ ] Preview never writes schedule until Apply; undo generated batch restores original slots.
- [ ] Same source image never scheduled twice; no double insertion from fast clicking Apply twice.
- [ ] Same-product min gap enforced in destination local calendar days against both past and future entries; overconstraint => empty slot and reason.
- [ ] Drag move/drop/list rescheduling validates collisions and gap, preserves manually locked or posted history and offers undo.
- [ ] Re-generation fill empty only preserves existing manually placed, reviewed, locked and posted entries.
- [ ] DST invalid/ambiguous local times are deterministic and visible; `America/Bogota` defaults remain sensible.
- [ ] When product becomes missing/unavailable on sync, future Pin flags `Needs review` instead of vanishing.
- [ ] Local planned/scheduled date never means remote Pinterest scheduled/posted status.

## C. Pin editing and precise image output

- [ ] Default export is 1000x1500 sRGB JPG or PNG; wide image uses Fit padding, whole product can stay visible.
- [ ] Original downloaded file bytes identical before and after any preview/edit/export, verified with SHA256.
- [ ] All three templates render and preview matches exported image (image regression threshold documented).
- [ ] Text overlay keeps very long title within safe bound or wraps/truncates visibly, never spills out of output.
- [ ] Auto Fill Text uses only product attributes from actual data; does not invent materials, colors, discounts, prices, fit, availability, or brand claims.
- [ ] Board name is a plain offline-editable label; not a synced remote board.
- [ ] Correct product-specific public storefront URL used for all media regardless of how many images a product has.
- [ ] Editing selected Pin title/description immediately updates Copy Desk and export manifest. Changing design invalidates cached export and forces fresh render.
- [ ] A previously posted Pin's original recorded publication snapshot/history isn't silently rewritten by later metadata edits.

## D. One-click Copy Desk — **must work, not just look clickable**

- [ ] Click Pin A -> Copy Title -> OS clipboard text equals A's exact title, including Unicode and line breaks where appropriate.
- [ ] Click Pin B -> Copy Description immediately -> OS clipboard text equals B's description, never stale Pin A field.
- [ ] Copy Product Link copies exact current URL, not the Shopify admin URL, no extra labels/quotes.
- [ ] Copy Board Name copies exact local board label; optional alt text is disabled when missing.
- [ ] **Copy Image populates the actual OS clipboard with image data**, not just path/name/URL. Electron integration test reads back nonempty image with expected width/height; test on Windows build/manual QA where OS supports it. Mock-only clipboard assertions are insufficient.
- [ ] Copy Image lazily prepares image if needed; failures show a clear message and **Save As / Reveal File** fallback, never a false success toast.
- [ ] Copy Image Path returns path as text and is visibly distinct from Copy Image.
- [ ] Clicking Copy Title after Copy Image puts text on clipboard. UI explains clipboard holds most recently copied value.
- [ ] **Copy All Text** includes correct selected title, description, link, board name, optional alt text, date/time; plain text uses labeled sections, no accidental previous Pin data.
- [ ] Rapidly switching images during image render/export cannot produce wrong image in selected Pin's Copy Desk. Ignore stale async response by Pin ID/revision.
- [ ] Copy actions stay available/visible when returning from the default browser; no edit drawer resetting or losing scroll position.
- [ ] Open Pinterest uses a legitimate HTTPS user-facing page in default browser; it does not log in, publish, automate, or call Pinterest developer services.
- [ ] Copying, exporting or opening Pinterest **NEVER** marks Pin Posted or Skipped or implies it was posted.
- [ ] Mark Posted opens a deliberate confirmation; if confirmed records actual date/time, optional user-entered URL and notes; Undo Posted restores planned/manual state, with guardrails.
- [ ] Next Pin updates preview, all copy fields and ephemeral copied badges. No prior item's photo/text remains.
- [ ] Copy controls keyboard reachable and have specific accessible labels and focus rings.

## E. Manual posting packs and exports

- [ ] Single export renders image with an unmistakably associated current metadata set; file exists; Reveal File selects file in OS file browser.
- [ ] Day/Week/Custom pack includes ONE distinct asset per selected Pin and `manifest.csv`, `manifest.json`, `POSTING_SHEET.txt`, `POSTING_SHEET.html`; can be used offline with no app connection.
- [ ] All manifest entries match scheduled date/time/timezone, board label, product URL, title, full description, original media and local Pin ID.
- [ ] HTML uses safe escaped text, relative image paths and still displays readable text when clipboard scripting is blocked.
- [ ] CSV handles commas, quote marks, newlines, accented characters, Unicode and potential formula injection; cannot be used for unexpected spreadsheet execution.
- [ ] Filenames reject reserved/unsafe Windows characters, collisions, `..` traversal, and duplicates. Re-export does not clobber changed Pin's old export unexpectedly.
- [ ] Progress/cancel/retry works with large pack; interrupted export doesn't claim completed manifest for missing images.
- [ ] Saving exported file doesn't overwrite Shopify original, nor automatically mark it posted.

## F. Desktop, release and security

- [ ] Fresh install/app restart fully functional in Demo without Shopify credentials, with DEMO labels on sample content.
- [ ] 5000+ thumbnails scroll, filter and open without UI lockup; file/image jobs bounded.
- [ ] App offline after initial sync can still view images, edit metadata/calendar, export and copy; an unavailable original offers clear warning/recovery.
- [ ] Backup and restore successfully round trips DB, schedule, approvals, manual posting history, local board labels, optional downloaded asset files with checksum verification.
- [ ] Protected Electron main/preload API: renderer cannot get arbitrary filesystem access, tokens, shell commands, network auth, or unsafe local file reads.
- [ ] No Pinterest API/OAuth/auto-posting/remote analytics code or UI is implemented; no requests sent to Pinterest automatically.
- [ ] No unverified metrics. Owner's app-local counts and demo labels are truthful.
- [ ] 1366x768 and 1920x1080 layouts work, dialog/drawer scroll correctly, all primary copy controls remain usable.
- [ ] `lint`, `typecheck`, `test`, `build` pass; Windows packaging tested or environment limitation clearly documented; installer launches and can access writable app-data folder.
- [ ] No GitHub push, repo creation, deployment or exposed secrets.

## G. End-to-end manual walkthrough (must be recorded as QA checklist)

1. Launch -> Explore Demo -> see exact product counts 0/1/3/6/10/14/32 and 66 photos.
2. Approve at least 15 images from different products, rejecting a known duplicate.
3. Generate preview for 5/day and 14-day spacing -> inspect empty slots/rotation -> Apply.
4. Open Today's Pins -> select a pin -> edit title and description -> choose Original Photo -> preview 1000x1500 output.
5. Open Today's Pins / Posting Desk -> choose a Pin -> Prepare Image -> Copy Image -> check OS clipboard image -> Reveal File -> check file on disk.
6. Copy Title -> inspect OS clipboard -> Copy Description -> inspect -> Copy Product Link -> inspect -> Copy Board -> inspect -> Copy All Text -> inspect packet.
7. Open Pinterest in browser without attempting automatic posting; **do not actually post synthetic demo content**. Back in app, use a separately designated demo-only sample to test Mark Posted and undo.
8. Export next seven days -> open manifest and offline posting sheet -> inspect that each Pin image matches exact fields.
9. Close/reopen -> verify all edits, selected images, schedule, local statuses and export records persist.
10. Backup + restore and rerun consistency checks. No Pinterest integration, authentication or posting job anywhere.
