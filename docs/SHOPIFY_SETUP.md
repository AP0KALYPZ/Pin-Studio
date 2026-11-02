# Pin Studio — Shopify Setup and Local Manual Posting

This app has **one optional store connection: Shopify**. It does not connect to Pinterest accounts. The user uploads all Pins and enters text in Pinterest by hand; the app prepares content and makes copying easy.

## Development first

1. Open project in VS Code/Codex. Start with an empty local library — no account or token needed for development; the bundled fixture under `fixtures/` exists only for automated tests.
2. Never paste Shopify admin credentials, passwords or client secrets into Codex chat, Git files or README. Enter only through the finished app's connection form, with OS-protected secret handling.
3. Use typed mock-network tests to verify Shopify product/media pagination and failure recovery before connecting the real store.

## Connecting the real Shopify store (READ ONLY)

1. Obtain the real `<shop>.myshopify.com` admin hostname and Pin Studio's verified PUBLIC storefront domain (these may be different).
2. From Shopify's current Dev Dashboard/merchant app documentation, create an app installed/authorized for your store. Grant minimal `read_products` scope. Don't grant `write_products` or any unrelated write scope.
3. Determine supported auth based on your eligibility. Shopify's client-credentials method has conditions, including applicable organization membership; do not assume it works for every store. For other cases implement the suitable secure supported flow and honestly explain any backend requirement rather than embedding shared secrets in an Electron distributable.
4. Enter authorized connection information **into the app** and click Test Connection. Shopify calls run in Electron main process; access tokens and secrets never enter React renderer or exports.
5. Run first synchronization; ensure app imports every product and **all image pages** per product. Images per product can vary from zero to hundreds. Confirm import totals in the actual store and check failed download list.
6. Confirm the public storefront link on product detail cards is correct. A Shopify Admin URL is NOT the Pinterest destination link.
7. Re-run sync when adding products or replacing photos. Human edited Pin titles/descriptions, approvals, planned slots and manual Posted history must remain intact.

Official Shopify sources:
- https://shopify.dev/docs/apps/build/authentication-authorization
- https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
- https://shopify.dev/docs/api/admin-graphql/2026-10/queries/products
- https://shopify.dev/docs/api/admin-graphql/2026-10/queries/product
- https://shopify.dev/docs/api/usage/pagination-graphql

## If Shopify connection isn't ready

The app still works with **Explore Demo**. It can also import a user-selected folder of owned product photographs and map the photos to manually created products after reviewing the mapping and verified product destination URLs. Photos never need to be sent to a cloud service for rendering.

## Manual Pinterest posting — NO API

1. Create/login to your Pinterest account and create your own boards in a normal web browser.
2. In app Settings > Local Boards, enter their names manually (example: `Evening Looks`, `Season Favorites`, `Special Occasions`). These are text labels, not remotely synced boards.
3. In Image Library, review/approve photos; in Calendar generate a plan; in **Today's Pins** edit content and post manually.
4. For each planned Pin: **Prepare Image -> Copy Image OR Reveal File -> Open Pinterest -> upload image -> Copy Title -> Copy Description -> Copy Product Link -> choose board manually -> publish yourself**.
5. Back in the app explicitly click **Mark Posted**. The schedule is only a local calendar; it does not reserve or automatically schedule a post on Pinterest.
6. For batch preparation, export day/week/date range to a folder with JPG/PNG images + CSV, JSON, TXT and HTML posting sheet.

Pinterest manual create help (not developer/API docs):
https://help.pinterest.com/en/article/create-a-pin-from-an-image-or-video

Browser note: the system clipboard can contain an image, but some website upload inputs accept only files. If Ctrl+V doesn't upload the Pin image, click the file upload picker in Pinterest and select the prepared file from `Reveal File`. This is why both image copy and file access must be first-class features.

## Windows / macOS packaging

Use package scripts documented by Codex after building the project (`npm install`, `npm run dev`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run package:win` or equivalent). Package Windows NSIS on Windows with correctly rebuilt Electron native dependencies. A macOS `.dmg` should be built/tested on macOS or suitable macOS CI with signing/notarization as applicable, not claimed generated successfully on Windows without evidence. No GitHub pushing unless explicitly requested.
