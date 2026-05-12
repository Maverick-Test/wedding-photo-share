# 📸 Wedding Photo Share

A self-hosted, QR-code-driven shared photo album for weddings and events.

- **Static site** on GitHub Pages — upload page, live gallery, QR code generator.
- **Cloudflare Worker + R2** for uploads — generous free tier, no surprise bills.
- **No app downloads** for guests. They scan a QR code and upload from their browser.
- **Live gallery** view that polls every few seconds — perfect for an Apple TV slideshow.

## Pages

| Page | What it does |
|------|-------------|
| `/upload.html?album=<id>` | Mobile-friendly uploader. This is what guests scan into. |
| `/gallery.html?album=<id>` | Live, auto-refreshing photo wall. Includes a "Download all as ZIP" button. |
| `/slideshow.html?album=<id>` | Full-screen single-photo slideshow. Designed for AirPlay → Apple TV. |
| `/admin.html` | Generates an `upload.html` URL + downloadable QR PNG for an album. |

## How it fits together

```
guest's phone ──scan QR──> Pages /upload.html ──POST file──> Cloudflare Worker ──> R2 bucket
                                                                                   │
TV (Apple TV / browser) ──> Pages /gallery.html ──GET /list──> Worker ──list R2────┘
```

---

## One-time setup

You need: a GitHub account (you already have one), a Cloudflare account (free), and Node.js installed locally.

### 1. Cloudflare — create the R2 bucket and Worker

```bash
# from the repo root
cd worker
npm install
npx wrangler login          # opens browser, logs you in
npx wrangler r2 bucket create photo-share
npx wrangler deploy         # deploys the Worker
```

Wrangler will print a URL like `https://photo-share.<your-subdomain>.workers.dev`. Copy it — you need it next.

### 2. Tell the static site about the Worker

Edit [public/js/config.js](public/js/config.js):

```js
window.PHOTO_SHARE_CONFIG = {
  workerUrl: "https://photo-share.<your-subdomain>.workers.dev", // ← paste here
  defaultAlbum: "default",
  galleryRefreshMs: 8000,
  maxFileSize: 50 * 1024 * 1024,
};
```

### 3. Lock CORS down to your Pages site (recommended)

Once you know your Pages URL (e.g. `https://maverick-test.github.io`), edit [worker/wrangler.toml](worker/wrangler.toml):

```toml
[vars]
ALLOWED_ORIGINS = "https://maverick-test.github.io"
```

Then redeploy:

```bash
cd worker && npx wrangler deploy
```

### 4. Enable GitHub Pages

In the repo on GitHub → **Settings → Pages → Build and deployment**: set **Source** to **GitHub Actions**. The included workflow (`.github/workflows/deploy-pages.yml`) will publish `public/` on every push to `main`.

### 5. Generate a QR for your event

1. Visit `https://<your-pages-url>/admin.html`
2. Type an album name (e.g. `james-and-anne-wedding`)
3. Click **Generate**, then **Download QR (PNG)**
4. Print it on table cards or signage

Open `…/gallery.html?album=james-and-anne-wedding` on the TV for the live photo wall — or `…/slideshow.html?album=james-and-anne-wedding` for a full-screen single-photo slideshow.

### Putting the slideshow on Apple TV

Apple TV doesn't have a browser, so use **AirPlay mirroring** from a Mac or iPhone:

1. Open `…/slideshow.html?album=<your-album>` in Safari on your Mac (or iPhone)
2. Click anywhere on the page to enter full-screen (or press <kbd>F</kbd>)
3. Control Center → **Screen Mirroring** → pick your Apple TV
4. The slideshow auto-advances every 5 seconds and pulls in new photos as guests upload

To change the slide interval, add `&interval=8000` to the URL (8 seconds, etc.).

---

## Downloading all photos after the event

On `/gallery.html`, click **⬇️ Download all**. This streams every photo + video into a single zip in your browser — no server load, works for thousands of files.

---

## Auto-cleanup

A Cloudflare Cron Trigger runs at **03:00 UTC on the 1st of every month** and deletes old photos. Configure in [worker/wrangler.toml](worker/wrangler.toml):

```toml
CLEANUP_MODE = "month"   # delete anything older than the start of the previous month (~30+ day retention)
# or:
CLEANUP_MODE = "days"
CLEANUP_RETENTION_DAYS = "60"
# or:
CLEANUP_MODE = "off"     # never auto-delete
```

With the default `"month"` setting, photos uploaded May 15 are kept through June and deleted on July 1. View cleanup logs with:

```bash
cd worker && npx wrangler tail
```

---

## Closing uploads after the event

Set `UPLOAD_DEADLINE` in [worker/wrangler.toml](worker/wrangler.toml) to an ISO 8601 UTC timestamp:

```toml
UPLOAD_DEADLINE = "2026-06-15T23:59:59Z"
```

Redeploy: `cd worker && npx wrangler deploy`.

After that timestamp:
- New uploads return HTTP 403 with `{ "error": "uploads closed" }`.
- The upload page shows a friendly "uploads closed" banner with a gallery link.
- The live gallery and existing photos continue to work normally.

Leave `UPLOAD_DEADLINE = ""` (empty) to allow uploads forever.

---

## Optional: serve photos directly from R2 (skip the Worker for downloads)

By default, photos are streamed through the Worker (`/photo/<key>`). For higher traffic, attach a custom domain to the bucket and set `PUBLIC_BASE_URL` in `wrangler.toml`:

1. Cloudflare dashboard → **R2** → your bucket → **Settings** → **Custom domains** → add `photos.yourdomain.com`.
2. Update `wrangler.toml`:
   ```toml
   PUBLIC_BASE_URL = "https://photos.yourdomain.com"
   ```
3. Redeploy the Worker.

`/list` will now return direct R2 URLs and the gallery will load images straight from R2.

---

## Costs

For a wedding-scale event (a few hundred guests, a few thousand photos):

- **Cloudflare R2**: 10 GB storage + 1M Class A ops/mo free. You will not exceed this.
- **Cloudflare Workers**: 100k requests/day free.
- **GitHub Pages**: free.

You should pay $0.

---

## Local development

```bash
# serve the static site
cd public && python3 -m http.server 8000
# in another terminal, run the worker locally
cd worker && npx wrangler dev
```

Set `workerUrl` in `config.js` to `http://127.0.0.1:8787` while developing.

---

## Security notes

- The album ID is the only access control. Anyone with the upload URL can post; anyone with the gallery URL can view. That is fine for a wedding; do not use this for private business documents.
- File size is capped client- and server-side (default 50 MB).
- CORS defaults to `*` so you can test quickly. **Lock it down to your Pages origin before the event.**
- No EXIF stripping is performed. If you care about that, add a step in the Worker.
