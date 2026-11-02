# Pin Studio — Manual Posting Workflow and Interaction Contract

This is the UX north star. Optimize my real manual daily workflow, not an imagined automated posting system.

## Main screen visual hierarchy

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ PIN STUDIO     Today's Pins     Tue Nov 3    [◀ day] [day ▶]    [Sync Shopify]  │
├───────────────┬───────────────────────────────────┬─────────────────────────────────────────┤
│ TODAY'S QUEUE │           PIN PREVIEW             │  COPY DESK                              │
│ [photo] 09:00 │          1000 x 1500              │  09:00 · Planned · Board: Evening       │
│ [photo] 12:00 │                                   │                                         │
│ [photo] 15:00 │        [FULL DRESS VISIBLE]       │  TITLE                         [Copy]  │
│ [photo] 18:00 │                                   │  Satin Evening Gown                   │
│ [photo] 21:00 │                                   │  DESCRIPTION                   [Copy]  │
│               │                                   │  Shop this ...                         │
│ ○ planned     │  [Prepare Image] [Copy Image]     │  PRODUCT LINK                  [Copy]  │
│ ● posted      │  [Save As] [Reveal File]           │  https://...                           │
│               │                                   │  BOARD NAME                    [Copy]  │
│               │                                   │  Evening Looks                       │
│               │                                   │  [Copy All Text] [Open Pinterest]       │
│               │                                   │  [✓ Mark Posted] [Skip] [Next Pin →]   │
└───────────────┴───────────────────────────────────┴─────────────────────────────────────────┘
```

This is a wireframe, not final design. UI should be luxurious, readable, and calm. Photographs are much larger than decorative elements.

## Required user paths

### Posting a single scheduled Pin
1. In Posting Desk, click due Pin. Everything in image and right-hand fields changes together.
2. Click `Prepare Image`. Save/render current 1000x1500 JPG once; show absolute path or a clear reveal action. If local file already matches image/template revision, reuse it.
3. Click `Copy Image` (the actual OS image) OR click `Reveal File` to select it through Pinterest's browser upload dialog. Browser image-paste support is not guaranteed.
4. Click `Open Pinterest` to launch regular user-facing Pin creator; I personally upload.
5. Come back to app, click `Copy Title` -> paste into browser. Return and repeat `Copy Description`, `Copy Product Link`, and board lookup via `Copy Board Name`.
6. `Mark Posted` -> confirmation dialog -> optional actual Pin URL and notes. Set local posted status, actual posted timestamp, archive entry from remaining queue. Do NOT count other clicks as posted.
7. `Next Pin` -> selected Pin, image, copy fields and local checklist update immediately; no old image or text remains cached in preview.

### Preparing a whole week's Pins in advance
1. Choose Calendar date range / Export Week.
2. Preview all selected Pin drafts, local board assignment, image/template, URLs, and texts.
3. Click `Export Pack` -> pick folder; app creates one uniquely named image per Pin, `manifest.csv`, `manifest.json`, `POSTING_SHEET.txt`, `POSTING_SHEET.html`; groups assets in `YYYY-MM-DD` subfolders.
4. Offline posting sheet shows image and its title/description/board/link in one place. Can copy manually even without app running. A visible copy-to-clipboard script may be offered, but browser permission restrictions must be handled with manual text selection fallback.
5. Export doesn't mark posted. One may use app Copy Desk to mark each after real-world posting.

## Copy button contract

| Button | Clipboard payload | Notes |
|---|---|---|
| Copy Image | Actual rendered image/png bitmap data | Not a path. Needs Electron main; fallback Save/Reveal if browser won't accept pasted image. |
| Copy Title | Exact current Pin's title | Text, no label prefix. |
| Copy Description | Exact current Pin's full description | Preserve line breaks and accents. |
| Copy Product Link | Exact current public product URL | Validate HTTPS and block Shopify Admin URLs. |
| Copy Board Name | Exact local user-entered board label | Not linked to a remote board. |
| Copy Alt Text | Exact optional alt text | Some Pinterest manual UIs may not expose an alt field; this is optional helper. |
| Copy All Text | `Title: ...\n\nDescription: ...\n\nProduct link: ...\n\nBoard: ...\n\n...` | Useful fallback packet; will NOT auto populate browser form. |
| Copy Image Path | Absolute path to generated file | Text only, distinct from Copy Image. |

Action feedback: `Title copied`, `Image copied`, `File saved to ...`, never generic unexplained 'Done'. Empty values disable copy with a tooltip. A clipboard write must resolve successfully before success toast; old action completion cannot overwrite the new Pin's indicators. Switching Pin requires fresh ID/revision; no cross-Pin values.

## Manual statuses

- **Planned**: on local calendar, not posted to Pinterest.
- **Ready**: file exported and Pin details prepared (local); not necessarily posted.
- **Due/Late**: local time relative to planned slot; still not posted.
- **Posted**: only after explicit user confirmation, with actual date/time (and optional user-entered Pin URL).
- **Skipped**: user explicitly skips; can be restored.
- **Needs Review**: source image, destination or metadata needs human attention.

Edits to scheduled Pin text update Copy Desk immediately and regenerate cached output if design changes. A posted Pin can be viewed historically; edits should not rewrite the recorded publication snapshot. Keep a snapshot of what was posted or exported for auditing.

## Important caveats

- No unattended posting and no Pinterest account or API connection.
- Clipboard contains only the last copied payload unless OS multi-format write is deliberately used. Prefer separate buttons; don't claim one click populates Pinterest.
- Public Pinterest creation UI may change; use a documented HTTPS landing URL and display a polite fallback with instructions to navigate manually to Create Pin.
- Manual scheduling done on Pinterest itself is separate from the **local** plan. Never imply the calendar schedules something on Pinterest's servers.
