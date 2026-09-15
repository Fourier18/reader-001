# Reader

Paste an article URL, get a clean reader view — no images, no ads, just the text. Font size is adjustable, and you can save the extracted article as `.txt`, `.md`, or `.html`.

## Why

A local, self-hosted alternative to browser reader-mode extensions: it fetches the page server-side (so it works with any URL, no CORS issues), runs it through [Mozilla's Readability](https://github.com/mozilla/readability) (the engine behind Firefox's reader view), then strips images, ads, scripts, iframes, and tracking attributes before rendering plain article text.

## Running it

**As a standalone Windows app** (no Node install required):

1. Download `dist/Reader.exe` (and `dist/Reader.vbs` if you want it to launch without a console window).
2. Double-click `Reader.vbs` to launch — it starts the server hidden and opens the reader in a chromeless Edge/Chrome app window. Closing that window shuts the server down automatically.
3. Double-click `Reader.exe` directly instead if you want to see the server console (useful for debugging).

**From source:**

```bash
npm install
npm start
```

Then open `http://localhost:4173`.

To rebuild the standalone exe after making changes:

```bash
npm run build
```

This produces `dist/Reader.exe` and copies `dist/Reader.vbs` alongside it.

## How it works

- `server.js` — Express server. `GET /api/extract?url=...` fetches the target page, parses it with `jsdom` + `@mozilla/readability`, strips images/ads/scripts/tracking attributes, and returns clean article JSON. Blocks requests to private/internal IP ranges (basic SSRF guard).
- `public/` — the frontend: a URL field, a font-size dropdown, and a Save As control that exports the current article as `.txt`, `.md`, or `.html` (using the File System Access API for a native save dialog where supported, falling back to a plain download).
- Packaged into a single Windows executable with [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg).

## Notes

- Windows only for the packaged exe (the app-window launch and hidden-console launcher rely on Windows-specific APIs). Running from source with `npm start` works cross-platform.
- No data leaves your machine except the fetch to the article's own URL — there's no analytics, no third-party calls.
