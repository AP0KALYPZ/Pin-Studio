# PIN STUDIO — MASTER BUILD SPECIFICATION
Version 3.0 — 27 October 2026 | Manual Pinterest publishing only

## 0. Mission, scope and hard exclusions

Build **Pin Studio**, a beautiful, polished, fast **local-first Windows desktop application** for any Shopify store. It imports **every product's actual number of images**, lets me review and choose photos, automatically makes a balanced long-term editorial posting calendar, prepares attractive Pin-sized images and descriptions, and gives me the simplest possible workflow to **manually upload the image and paste the right text/link into Pinterest**. Provide a Windows installer; keep project architecture portable to macOS for a future build on macOS.

**ABSOLUTELY DO NOT IMPLEMENT:** Pinterest API, Pinterest OAuth, token storage for Pinterest, auto-posting, headless browser/site automation, browser extensions, Pinterest account syncing, fetching Pinterest boards or analytics, cloud posting workers, 'connect Pinterest' screens, fake connected states, or background publication. **No network request to Pinterest is needed.** Opening the user's regular Pinterest creation webpage in their ordinary browser is permitted; the user uploads and posts everything themselves. A **local** board-name list is permitted.

The **Shopify Admin GraphQL API is needed** for read-only import. This is separate from the removed Pinterest integration. The application must still be fully testable without any store credentials via a bundled synthetic demo catalog and manually imported folders.

## 1. Definition of success — my 60-second daily workflow

1. Open app -> land on **Today's Pins** in the Dashboard / Posting Desk.
2. Click the first due Pin. See a large image on the left and a right-side **Copy Desk** with ALL details clearly visible (title, description, product link, intended board, time, optional alt text).
3. Click **Prepare Image** once. The app generates the finished 1000x1500 JPG/PNG in a stable, easily accessed export folder, with buttons: **Copy Image**, **Save Image As…**, **Reveal File**, **Copy File Path**. On Windows, **Copy Image** puts actual bitmap/image data on the OS clipboard, not just its file path. For sites that do not accept pasted clipboard images, I can upload the file using the file picker. Never pretend clipboard paste to Pinterest is guaranteed.
4. Click individual **Copy Title**, **Copy Description**, and **Copy Product Link** buttons while I fill Pinterest's fields in the browser. **Copy All Text** copies a legible plain-text posting packet, useful as a fallback, but is NOT a claim that one paste will populate multiple Pinterest form fields. **Copy Board Name** lets me find/select my board manually in Pinterest.
5. Click **Open Pinterest Create Pin**; the app opens Pinterest's normal web creator in my default browser; it does not interact with it or assume I am logged in. User uploads and posts manually.
6. Return to Pin Studio -> **Mark Posted** (with confirmation, optional actual Pinterest Pin URL and actual posting timestamp). Then **Next Pin** jumps to the next planned item. Exporting, copying, or opening Pinterest never automatically marks an item posted.

The complete **Copy Desk** remains visible when I return from the browser. Clipboard actions show success/failure toasts. Keyboard shortcuts are optional but desirable, with a discoverable shortcut hint and no collisions with standard shortcuts. Persistence is immediate and survives app restart.

## 2. Primary screens and navigation

Left sidebar (224px, collapsible): **Overview**, **Today's Pins** (prominent), **Products**, **Image Library**, **Calendar**, **Pin Studio**, **Exports**, **Insights**, **Settings**. Top bar: context title, global search, Shopify Sync, current date/time zone, alerts. No Pinterest connection or auto-publish UI. Every button is functional or removed, never a dead demo button.

### 2.1 Overview
- Real cards: products, imported image count (actual, never fixed 10), images approved, Pins drafted, Pins due today, Pins manually marked posted.
- Local queue health: upcoming 7/30 days, content pool, first unscheduled date, errors; *theoretical* remaining days = approved unused images / Pins per day, explicitly labeled as an upper bound constrained by spacing.
- Next 5 scheduled Pins with photographs; quick links to **Today's Pins**, Sync Shopify, Review new images, Generate schedule, Export week.
- Activity: local import, approval, edits, exports and manual posting confirmations. No fake impressions/saves/clicks/revenue.

### 2.2 Today's Pins / Posting Desk — MAIN SCREEN, most polished and frictionless
- Date picker default today, left/right previous/next day controls, show due and late local calendar entries.
- Main 3-region desktop layout: left vertical queue strip with image thumbnails and status, center **large 2:3 image preview** (complete product visible), right persistent **Copy Desk**.
- Right Copy Desk, in exact order: status/date/time; local board name; title with Copy button; description with Copy button; storefront product URL with Copy button; alt text with Copy button (when meaningful); selected product/source image; quick buttons **Prepare Image**, **Copy Image**, **Open Image Folder**, **Open Pinterest**, **Mark Posted**, **Next Pin**.
- **Copy All Text** places clear labeled lines/sections on the clipboard, including Title, Description, Link, Board, Alt and scheduled time; ability to preview packet before copying. All values come from the selected current Pin, never the previous Pin.
- Clicking Copy Title then Copy Description replaces clipboard as expected; the right Copy Desk does not close or reset. Toast confirms WHICH field was copied.
- Primary action first: **Prepare & Open Pin Workspace** generates/reuses finished exported image, reveals the file conveniently, and keeps fields visible for copying. Do NOT try to put text and image on clipboard as separate successive items or promise to populate Pinterest automatically.
- Present checklist indicator **Image ready**, **Title copied**, **Description copied**, **Link copied**, **Board selected (manual checkbox, optional)** — purely local optional process indicators reset appropriately on a different Pin. Do not represent these as proof actions occurred on Pinterest.
- **Mark Posted** is a distinct deliberate user action; confirm and save timestamp, optional posted Pin URL, optional notes. Optional **Mark Skipped** with reason; restore/reopen and undo where possible.
- If image cannot copy via OS clipboard, show actionable reason and fallback **Save Image / Reveal File**. If not prepared, Copy Image should render/prepare automatically then copy, not fail silently.
- Preset quick keyboard actions optionally: `1` Copy Image; `2` Copy Title; `3` Copy Description; `4` Copy Link; `5` Copy Board Name; `N` Next Pin; shortcuts disabled in text fields and shown in shortcuts sheet. OS clipboard actions routed safely through Electron main/preload, not exposed as arbitrary file reads.
- Empty day: friendly "No Pins planned" with Go to Calendar and Generate Drafts actions; past date late pins not mislabeled as published.

### 2.3 Products
- Grid/list with responsive portrait cards, product title, SKU/handle if known, collections/tags, Shopify status, exact media count, number approved/scheduled/posted.
- Filters: active, archived, product group, image count (0, 1–4, 5–9, 10+, custom), sync state, campaign eligibility, priority; search and sort.
- Detail drawer: all images in original Shopify order, per-image review state, full public product link, local board-name preference and scheduling history.
- Include/exclude from planning, product priority High/Normal/Low, manual verified public URL override; no Shopify writes.
- Zero image products remain visible with explanation; do not invent images. One product may have 1, another 32 or 265.

### 2.4 Image Library
- Large searchable portrait gallery, virtual scroll/lazy thumbnail loading with 5,000+ media, image count from actual imported data.
- Filter review state (New/Approved/Rejected), product, collection, source, used/scheduled/posted, orientation, duplicate flag.
- Image review detail with zoom, source alt, original size, file path, copy original source image (optional), approve/reject, add internal tags, exclude near duplicates (requires human choice).
- SHA256 exact and perceptual-hash near-duplicate detection; warnings only, no silent delete. Preserve actual product association even if media URLs match.
- Multi-select batch **review** and export originals; when scheduling, only eligible approved media.

### 2.5 Calendar / Scheduler
- Month, week and list views, visible thumbnails, Pin count/day, times and statuses; drag/drop or equivalent keyboard accessible reschedule, validation and Undo.
- Generate: start, end/duration, `Pins/day` default 5 range 1–20, editable local posting times default 09:00,12:00,15:00,18:00,21:00; IANA time zone default America/Bogota; minimum days between Pins of the same product default 14; optional product filters and seed.
- Preview counts and exact image selections before Apply; no automatic apply; protect locked/manual/posted entries; fill-empty-only default.
- Draft calendar is MY external publishing PLAN; no timer ever calls Pinterest or changes to Posted automatically.
- Show reason when slot remains empty: no new approved images, same-product gap, unusable URL, duplicate exclusion, etc.

### 2.6 Pin Studio
- WYSIWYG portrait canvas 1000x1500px default, image safe-fit/contain on background, optional user-directed crop, non-destructive templates: Original Photo, Editorial Border, Minimal Headline. Protect the entire product from accidental crops; overlays default off. Preview must match export.
- Tabs: Content (Title, Description, optional Alt Text), Design, Destination (verified public product URL, optional UTM query toggle, local target board name), Schedule, History.
- **Auto Fill Text** uses only verified Shopify title/description/type/tag fields; deterministic templates, editable, no invented claims (fabric/color/discount/material/stock/fit etc.). No LLM or account keys required. Show character counters and warnings; sensible target/title limits based on current Pinterest form behavior; don't block exports on artificial assumptions when no API is involved.
- Local board manager: plain user-editable names and preferred board per product/collection, offline only. No board IDs, no remote board fetch.
- Editable Pin metadata persists separately from source product. When key fields change after local review, set Needs Review (without undoing past actual publication). Optional per-Pin Reviewed checkbox; no API authorization mechanism.

### 2.7 Exports
- **One Pin:** export/render image JPG or PNG in destination folder; preserve correspondence with current title, description and link. Toolbar for Copy Image, Copy Title, Copy Description, Copy Link, Copy Board, Copy All, Reveal Folder, Copy File Path, Save As.
- **Day Pack / Week Pack / Date Range Pack:** export each Pin image plus CSV, JSON and a friendly offline HTML/TXT posting sheet with each thumbnail/file name and all fields. Local-only, no request to Pinterest. User chooses root folder or app-managed default `Exports/YYYY-MM-DD/`.
- Example filename: `2026-11-02_0900_satin-evening-dress_img03_a14c2f.jpg`; sanitize Windows reserved names, illegal characters, Unicode edge cases; avoid collisions and path traversal.
- For each packet, field names: local_pin_id, scheduled_date, scheduled_time, timezone, product_id, product_title, source_image_id, image_filename, image_relative_path, title, description, alt_text, board_name, product_url, review_state, posting_state, exported_at.
- A friendly `POSTING_SHEET.html` should work offline and include clickable **Copy Title**, **Copy Description**, **Copy Link** controls only if safe/browser clipboard permission allows; always provide visible/selectable text as fallback. No code running against Pinterest.
- Stable local export references; all rendered photos generated from local originals; running export again must not overwrite unexpectedly or duplicate records. For exports, use output checksums or revision-aware caching; regenerate after content/design changes.
- Folder chooser, date range, progress, cancel, retry failed, reveal folder, clipboard notices and file existence checks.

### 2.8 Insights (LOCAL analytics only)
- Owned activity only: photos approved, number of distinct products represented, drafted/extracted/marked posted per week, on-time manual posting as confirmed by user, unused image count, queue gaps.
- Optional manual notes after publishing; never show Pinterest views, impressions, saves, clicks, conversions, or sales as if retrieved automatically.

### 2.9 Settings
- Shopify connection and Sync, catalog rules, timezone/time slots, scheduling interval, default board names, export folder, image format/quality/background, backup/restore, rebuild thumbnails, local logs, version and accessibility preferences.
- No Pinterest login, token, permissions, API keys, board sync, or scheduling service setting.

## 3. Style and UI system

Premium editorial fashion look, designed for Pin Studio, light theme (not generic admin dashboard). Base `#F7F4F0`, surfaces `#FFFFFF`, secondary `#F0EBE5`, primary text `#302925`, muted text `#84776D`, action `#453A35`, warm accent `#B48E78`, dividers `#E5DDD5`, green `#5C8069`, error `#B35B54`. Legible font Inter with tasteful serif for major headings if available (do not ship unlicensed fonts). 8px spacing scale, 12–16px radius, restrained soft shadows, 150–200ms motion, visible keyboard focus and reduced-motion support. Large editorial photos hero of the screen. Left sidebar 224px or 72px compact; main layout comfortable at 1366x768 and 1920x1080, min window ~1100x740. Provide skeletons, empty/error states, toasts, confirmations. No inaccessible tiny copy buttons; use inline buttons with clear tooltips/aria labels.

## 4. Recommended implementation

- Electron stable + Vite + React + strict TypeScript; React Router; TanStack Query; Zustand or small state store.
- Tailwind CSS + shadcn/ui + Lucide, React Hook Form + Zod.
- SQLite + `better-sqlite3` **main process only**, durable migrations, WAL, foreign keys. Electron ABI rebuild when packaging.
- Sharp in main process bounded worker for thumbnails/renders, sRGB convert, background fit and overlays; don't load full originals into React state.
- `electron` main clipboard for text and real images through a narrowly validated preload API; validate exported local image path/record ID before read. **Consult currently installed Electron clipboard API**; Electron versions vary. Prefer image PNG-compatible OS clipboard with preserved transparency where relevant; show fallback when target browser refuses paste. Security first.
- Use OS appData directory for mutable assets; database and downloaded originals are outside install directory. Securely store only Shopify credentials if needed, use OS-protected secret storage and clear disconnect; never exposed to renderer.
- Typed, allowlisted Electron IPC, `contextIsolation:true`, `nodeIntegration:false`, sandbox where feasible, strict CSP, secure `shell.openExternal` only to validated HTTPS URLs; renderer never makes authenticated Shopify requests.
- Dates via Luxon/date-fns-tz: store UTC timestamp and IANA time zone; use local date boundaries and handle DST.
- Testing Vitest + React Testing Library + Playwright Electron E2E; Electron Builder/Forge NSIS on Windows, macOS scaffolding only; don't pretend a `.dmg` is built on Windows.

Suggested structure:
```
src/
  main/             # bootstrap, secure IPC, SQLite, OS clipboard, safe file dialogs
    integrations/shopify/
    services/catalog-sync/
    services/images/
    services/scheduler/
    services/exports/
    services/backups/
  preload/          # typed small bridge, no arbitrary filesystem access
  renderer/
    app/
    components/
    features/overview/
    features/posting-desk/
    features/products/
    features/image-library/
    features/calendar/
    features/pin-studio/
    features/exports/
    features/insights/
    features/settings/
  shared/           # schemas and types
  tests/
fixtures/
```

## 5. Shopify connection and import (read-only)

- Integrate with current versioned Shopify Admin GraphQL; re-check schema/version during build. Minimum needed scopes normally `read_products`; never request write permissions.
- Authenticate through eligible Shopify merchant app flow: verify own-organization eligibility for client-credentials if chosen; otherwise use supported flow instead of leaking or bundling shared secrets. Don't ask me to paste credentials into Codex. Credentials entered into app Settings, protected in main process. Demo works entirely without credentials.
- Product pagination `products(first:N, after:cursor) {pageInfo{hasNextPage,endCursor} ...}` until exhausted.
- **Per product media pagination** `product(id:...) {media(first:N, after:cursor, query:"media_type:IMAGE", sortKey:POSITION) {pageInfo{hasNextPage,endCursor} nodes{id alt ... on MediaImage { image { url width height }}}}}` until exhausted. For example the official doc's `first:10` is merely an example page size, NOT a 10-image maximum. Also distinguish total media from successfully usable image files. Test 265 on one product.
- Import product IDs/handles/title/description/status/tags/collections, image stable IDs/position/alt/dimensions, and verified **public storefront product URL**. Never use admin URLs. Products with zero media remain visible.
- Download media safely with resumable error-aware bounded concurrency, content and size checks, atomic filenames, thumbnails and original images, source hash/perceptual hash. Retry/backoff, sync progress, cancellation, logs with sensitive URLs redacted.
- Stable upsert by Shopify IDs. Sync additions, edits, reorders, archived/missing items without deleting manual Pin edits, reviews, schedule, exported files or posted history. Product removed/unavailable -> flags scheduled future Pin for human review, no silent deletion.
- As offline fallback support image-folder import with user mapping to product IDs/handles and confirmed destination URLs, with preview before apply. Do not mislabel manual data Shopify-synced.

## 6. Local data model

Use SQLite tables (migration-tested), relationships and scoped unique constraints:

- `app_settings(key, typed_json, updated_at)`
- `shop_connections(id, shop_domain, storefront_domain, auth_mode, credential_ref, scopes, last_sync_at, api_version)`
- `products(id, shop_connection_id, shopify_gid, handle, title, description, status, tags_json, collections_json, canonical_url, custom_url_override, include_in_schedule, priority, preferred_local_board_id, first_seen_at, last_seen_at, missing_source_at)`
- `product_images(id, product_id, shopify_media_gid, source_order, alt_text, source_url, width, height, sha256, perceptual_hash, original_local_path, thumb_local_path, review_state, download_state, missing_source_at, created_at, updated_at)`
- `local_boards(id, name, color, is_default, created_at, updated_at)` (**no remote Pinterest board IDs**)
- `pin_drafts(id, product_id, product_image_id, title, description, alt_text, destination_url, local_board_id, template_id, design_json, metadata_revision, reviewed_revision, posting_state, notes, created_at, updated_at)`
- `schedule_entries(id, pin_draft_id, planned_utc, timezone, locked, moved_manually, generation_batch_id, created_at, updated_at)`
- `manual_post_records(id, pin_draft_id, actual_posted_utc, optional_user_entered_pin_url, notes, created_at)`
- `copy_actions(id, pin_draft_id, field_name, at_utc)` optional local audit for convenience only, not proof of publishing
- `export_assets(id, pin_draft_id, metadata_revision, design_checksum, output_path, sha256, created_at)`
- `sync_runs`, `sync_errors`, `activity_events`, `backup_history`, optional `image_review_notes`

All mutable path fields validated, no direct trusted renderer file paths; all timestamps UTC consistently. Human labels and source IDs remain separate. Make statuses simple: image `new|approved|rejected`, draft `draft|needs_review|reviewed`, plan `planned`, manual posting `not_posted|posted|skipped`; don't add automated `publishing/failed_request/remote_id` states. Export and copy are actions, not publishing.

## 7. Schedule algorithm — deterministic and honest

Inputs: start/end, 1–20 Pins/day default 5, ordered time slots, tz `America/Bogota` default, min same-product gap in **calendar days** default 14, only live included products/images approved and locally ready, valid public destination, seed and campaign filters, fill-empty-only.

HARD rules:
1. Source image belongs to active included product, download ready, approved, not missing/rejected, with reviewed/verified suitable product URL.
2. An individual image is proposed only once across current future plans and already marked posted history. No repeat unless user creates an explicitly different creative manually in a separately designed future feature (not in initial build).
3. Same product cannot appear in two entries closer than min gap (in destination timezone local calendar days), including manually placed, future and past planned and posted records. Never silently violate for high pin-frequency input.
4. One Pin per slot; protected planned/reviewed/locked/manual/posted records cannot be overwritten by schedule regenerations.
5. Missing supply => visibly empty slot + precise reason; never fabricate images/duplicate to fill quotas.
6. Scheduler generates previews without writing until Apply; Apply one transaction, undo last batch, preserve user edits.

FAIRNESS: Prefer giving all eligible products their first used image before giving any one product its second, when date spacing allows; then fair rounds. Weigh High/Normal/Low priority without permanent starvation. Seeded stable tie breaks; deterministic same snapshot/seed. Respect spacing from entries **both earlier and later than proposed slot**. Image count is calculated from actual imported + approved + available media, not products times ten.

## 8. Rendering, exporting, copying: precise requirements

- Non-destructive Sharp 1000 x 1500 JPG/PNG export; contain/fit default; neutral border/background when needed, preserve the product in shot, detect tiny images and warn; editable crop opt-in only. Output sRGB. Templates may place text only in safe zone, clamp/wrap overflow; rendered output identical to editor preview within practical color/render tolerance.
- **Image to system clipboard:** main process first renders or validates the selected final output; use the installed Electron version's supported clipboard API (and `nativeImage` where appropriate) to place actual image data. Test that OS clipboard contains an image (not only string path), also test text copy. Show 'Image copied' only after OS API succeeds. Clipboard lifetime/system formats vary; ALWAYS offer Save/Reveal as primary reliable fallback.
- **Text copying:** separate one-click buttons for title, description, product link, board, alt text, file path and full posting packet. Copy data from currently selected Pin record. Empty optional fields show disabled/empty state, not fake placeholder copy.
- **Prepare Image** uses deterministic/cached render keyed by source hash + template + revision. No staleness after editing. Full-res export readable by OS picker. **Save As** uses native dialog; **Reveal File** via Electron `shell.showItemInFolder` on application-generated files only; **Open Pinterest** via validated external HTTPS link, never embedded login.
- **Posting pack for selected dates:** image per Pin, CSV and JSON manifest, TXT and offline HTML human-friendly sheet, grouped by day. Must contain exact Title, Description, Product URL, Board Name, Alt text, schedule date/time/time zone, source photo and file filename; all text selectable. CSV proper quoting, Excel-friendly UTF-8 BOM optional, safe CSV formula-injection escaping and relative asset links in HTML; no spreadsheet formulas executable from untrusted titles.
- **Clipboard usability is the highest-priority UX:** copy buttons large and always visible in Posting Desk, keep view stable, focus not lost, keyboard accessible; obvious state when copying current/next pin. User can click Copy Title, switch browser, paste, return, click Copy Description, and repeat without needing to re-open a drawer.
- Mark Posted optional URL must be validated HTTPS pinterest.com Pin URL if supplied (also allow empty); never auto-infer posting from copy or export. Allow 'Undo posted' with confirmation. Local 'due' and 'late' statuses are inferred from calendar; actual Posted is human-confirmed only.

## 9. Backup, QA, resilience

- SQLite WAL + safe native snapshot, with optional image copy and manifest/checksums; restore preview, conflict warnings, verification and atomic swap. 7 rolling backups as configurable default.
- Handle offline state after sync, aborted downloads, missing files, protected original images, broken exports, duplicate clicks, partial folder exports, protected HTTPS validation, 5000+ virtualized thumbnails, errors with recovery paths.
- No telemetry by default. Never put Shopify secrets in Git, logs, renderer, export manifest, HTML, or app's clipboard except user-requested product link.
- Real functional demo using fixture `fixtures/demo_catalog.json` (7 products, image counts 0/1/3/6/10/14/32 = 66) and generated local placeholder thumbnails so app works offline. Label DEMO everywhere relevant.
- Build scripts: `npm run dev`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run package:win` or documented equivalents. Tests include unit, integration and UI E2E. Windows installer must run on Windows; macOS packaging is not claimed from Windows.

## 10. Single-run implementation order (DO ALL PHASES WITHOUT WAITING FOR A NEW PROMPT)

**Phase A — Foundation:** Scaffold a fully installable application, sophisticated UI shell, local database and migrations, demo catalog, Shopify read-only sync, Products and Image Library.

**Phase B — Calendar:** Implement an actual deterministic scheduler, Calendar, constraints and persistent scheduling actions.

**Phase C — Posting Desk:** Implement Pin Studio, Today's Pins / Copy Desk, actual OS text/image clipboard and manual day/week export packs. Prioritize the Copy Desk as the critical feature; do not leave it as a mockup.

**Phase D — Finish and verify:** Implement local Insights, backup/restore, polished empty/error states, performance, tests, packaging, and end-to-end QA. **No Pinterest API work in any phase.**

Proceed through all phases autonomously in the same Codex assignment. Do not stop at phase boundaries or ask for follow-up milestone prompts. After each phase, run available checks, fix failures, and carry on. Report any limitations honestly in the final handoff. If a packaging step requires Windows and the current agent is on another OS, prepare the Windows configuration, document the exact Windows command and clearly say it was not verified.

## 11. Official development docs to verify during implementation

Shopify: https://shopify.dev/docs/api/admin-graphql/2026-10/queries/products ; https://shopify.dev/docs/api/admin-graphql/2026-10/queries/product ; https://shopify.dev/docs/api/usage/pagination-graphql ; https://shopify.dev/docs/apps/build/authentication-authorization
Electron clipboard: https://www.electronjs.org/docs/latest/api/clipboard ; Electron nativeImage: https://www.electronjs.org/docs/latest/api/native-image
Pinterest's user-facing manual image upload instructions: https://help.pinterest.com/en/article/create-a-pin-from-an-image-or-video . **This last URL is for manual user workflow only, not developer/API integration.**
