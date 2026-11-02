# Start here — Pin Studio

**Everything needed to brief Codex is already in this folder.** Nothing needs to be installed manually before asking Codex to scaffold it, except Node.js/npm and VS Code with Codex.

1. Create or open an EMPTY folder named `pin-studio` on your Windows PC.
2. Unzip this kit and put ALL its contents in the root of that folder, preserving `docs/` and `fixtures/`.
3. In VS Code, choose **File → Open Folder** and select `pin-studio`.
4. Open Codex in VS Code, select a coding mode with permission to write files and run terminal commands.
5. Open `CODEX_PROMPT.txt`, copy **the whole file**, paste into Codex, and send it **once**. No need to paste four separate milestone prompts.
6. Let Codex create the actual app files and run its checks. If Codex's environment blocks OS installers, use the README instructions it generates to package on your own Windows machine.
7. Once app is usable, connect your Shopify store INSIDE THE APP when ready. Do not paste secrets into Codex chat.

## What the app will do
Read Shopify product images regardless of per-product image count; review photos; build a fair manual publishing schedule; create 1000x1500 images; keep a one-screen Copy Desk where image, title, description, product link and board can be copied in separate clicks; offer file upload fallback and exports; track manually posted Pins.

## What it will NOT do
It will **never** log in to Pinterest, schedule posts on Pinterest itself, post automatically, or use Pinterest APIs. You personally upload/publish in the regular browser. The app's calendar is a local plan.

## Expected project files after Codex finishes
Codex creates the source code, package.json, Electron app, database setup, UI screens, tests and packaging scripts in this folder. The kit itself is a blueprint and **not yet a working app**.

## Do I need to buy anything?
No paid app service is required for the manual workflow. Shopify connection requires your own store and legitimate Shopify app API access. Pinterest itself is used manually. The app does not require an AI API key.
