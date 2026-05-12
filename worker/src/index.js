// Cloudflare Worker: photo-share
// Endpoints:
//   POST /upload?album=<id>     multipart/form-data, field "file"
//   GET  /list?album=<id>       returns { items: [{ key, url, contentType, size, uploaded }] }
//   GET  /photo/<key...>        streams an object from R2 (used when PUBLIC_BASE_URL is empty)
//   GET  /status                returns { uploadsOpen, deadline }
// Cron:
//   scheduled() runs monthly cleanup, deleting old objects from R2.
//
// Storage layout: <album>/<yyyy-mm-dd>/<uuid>.<ext>

const ALBUM_RE = /^[a-z0-9_-]{1,64}$/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === "/upload" && request.method === "POST") {
        return withCors(await handleUpload(request, env, url), cors);
      }
      if (url.pathname === "/list" && request.method === "GET") {
        return withCors(await handleList(request, env, url), cors);
      }
      if (url.pathname.startsWith("/photo/") && (request.method === "GET" || request.method === "HEAD")) {
        return withCors(await handlePhoto(request, env, url), cors);
      }
      if (url.pathname === "/status" && request.method === "GET") {
        return withCors(handleStatus(env), cors);
      }
      if (url.pathname === "/" || url.pathname === "/health") {
        return withCors(json({ ok: true, service: "photo-share" }), cors);
      }
      return withCors(json({ error: "not found" }, 404), cors);
    } catch (err) {
      console.error(err);
      return withCors(json({ error: err.message || "server error" }, 500), cors);
    }
  },

  async scheduled(event, env, ctx) {
    // Two crons share this handler — branch on event.cron.
    // "0 3 24 * *" => 7-day warning. "0 3 1 * *" => actual cleanup.
    if (event.cron && event.cron.startsWith("0 3 24")) {
      ctx.waitUntil(runWarning(env, event.scheduledTime));
    } else {
      ctx.waitUntil(runCleanup(env, event.scheduledTime));
    }
  },
};

async function runWarning(env, scheduledTime) {
  const mode = (env.CLEANUP_MODE || "month").toLowerCase();
  if (mode === "off") return;

  const now = new Date(scheduledTime || Date.now());
  // The cleanup that runs ~7 days from now uses next-month's 1st as `now`.
  const nextRun = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 3, 0, 0));
  const cutoff = computeCutoff(mode, env, nextRun);
  if (!cutoff) return;

  const { count, bytes } = await summarizeOlderThan(env, cutoff);
  if (count === 0) {
    console.log("[warning] nothing scheduled for deletion, skipping email");
    return;
  }

  const subject = `⚠️ Photo Share: ${count} item(s) will be deleted on ${nextRun.toISOString().slice(0,10)}`;
  const body =
    `Heads up — your scheduled cleanup runs on ${nextRun.toUTCString()}.\n\n` +
    `Items to be deleted: ${count}\n` +
    `Estimated size:      ${humanSize(bytes)}\n` +
    `Cutoff date:         everything uploaded before ${cutoff.toISOString()}\n\n` +
    `If you want to keep these photos, download the album as a ZIP from your gallery page before then.\n\n` +
    `To cancel auto-cleanup, set CLEANUP_MODE = "off" in worker/wrangler.toml and redeploy.`;
  await sendEmail(env, subject, body);
}

async function runCleanup(env, scheduledTime) {
  const mode = (env.CLEANUP_MODE || "month").toLowerCase();
  if (mode === "off") {
    console.log("[cleanup] disabled");
    return;
  }

  const now = new Date(scheduledTime || Date.now());
  const cutoff = computeCutoff(mode, env, now);
  if (!cutoff) {
    console.log("[cleanup] no cutoff computed, skipping");
    return;
  }
  console.log(`[cleanup] mode=${mode} cutoff=${cutoff.toISOString()}`);

  let cursor;
  let scanned = 0;
  let deleted = 0;
  do {
    const page = await env.PHOTOS.list({ limit: 1000, cursor });
    const toDelete = page.objects
      .filter((o) => o.uploaded && new Date(o.uploaded) < cutoff)
      .map((o) => o.key);
    scanned += page.objects.length;
    if (toDelete.length > 0) {
      await env.PHOTOS.delete(toDelete);
      deleted += toDelete.length;
      console.log(`[cleanup] deleted batch of ${toDelete.length}`);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  console.log(`[cleanup] done. scanned=${scanned} deleted=${deleted}`);

  if (deleted > 0) {
    const subject = `✅ Photo Share: ${deleted} item(s) deleted in monthly cleanup`;
    const body =
      `Monthly cleanup ran at ${now.toUTCString()}.\n\n` +
      `Mode:    ${mode}\n` +
      `Cutoff:  ${cutoff.toISOString()}\n` +
      `Scanned: ${scanned}\n` +
      `Deleted: ${deleted}\n`;
    await sendEmail(env, subject, body);
  }
}

async function summarizeOlderThan(env, cutoff) {
  let cursor;
  let count = 0;
  let bytes = 0;
  do {
    const page = await env.PHOTOS.list({ limit: 1000, cursor });
    for (const o of page.objects) {
      if (o.uploaded && new Date(o.uploaded) < cutoff) {
        count++;
        bytes += o.size || 0;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { count, bytes };
}

async function sendEmail(env, subject, body) {
  const to = (env.NOTIFY_EMAIL || "").trim();
  const apiKey = (env.RESEND_API_KEY || "").trim();
  if (!to) {
    console.log("[email] NOTIFY_EMAIL not set, skipping");
    return;
  }
  if (!apiKey) {
    console.log("[email] RESEND_API_KEY not set, skipping. Run: npx wrangler secret put RESEND_API_KEY");
    return;
  }
  const from = (env.NOTIFY_FROM || "Photo Share <onboarding@resend.dev>").trim();
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text: body }),
    });
    if (!r.ok) {
      console.error(`[email] send failed: HTTP ${r.status} ${await r.text()}`);
    } else {
      console.log(`[email] sent to ${to}: ${subject}`);
    }
  } catch (err) {
    console.error(`[email] error: ${err.message}`);
  }
}

function humanSize(n) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function computeCutoff(mode, env, now) {
  if (mode === "days") {
    const days = Number(env.CLEANUP_RETENTION_DAYS || 60);
    if (!Number.isFinite(days) || days <= 0) return null;
    return new Date(now.getTime() - days * 86400 * 1000);
  }
  // "month": delete anything uploaded before the start of the previous month.
  // e.g. on June 1, delete anything from before May 1.
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0));
}

function handleStatus(env) {
  const deadline = (env.UPLOAD_DEADLINE || "").trim();
  const open = uploadsOpen(env);
  return json({ uploadsOpen: open, deadline: deadline || null });
}

function uploadsOpen(env) {
  const deadline = (env.UPLOAD_DEADLINE || "").trim();
  if (!deadline) return true;
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return true; // misconfigured = fail open
  return Date.now() < t;
}

async function handleUpload(request, env, url) {
  if (!uploadsOpen(env)) {
    return json({ error: "uploads closed", deadline: env.UPLOAD_DEADLINE || null }, 403);
  }
  const album = readAlbum(url);
  const max = Number(env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024);

  const ct = request.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")) {
    return json({ error: "expected multipart/form-data" }, 400);
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return json({ error: "missing file field" }, 400);
  }
  if (file.size > max) {
    return json({ error: `file too large (${file.size} > ${max})` }, 413);
  }

  const ext = guessExt(file.name, file.type);
  const id = crypto.randomUUID();
  const day = new Date().toISOString().slice(0, 10);
  const key = `${album}/${day}/${id}${ext}`;

  await env.PHOTOS.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
      contentDisposition: `inline; filename="${safeName(file.name)}"`,
    },
    customMetadata: {
      originalName: safeName(file.name),
      uploadedAt: new Date().toISOString(),
    },
  });

  return json({ ok: true, key, url: publicUrl(env, url, key) }, 201);
}

async function handleList(request, env, url) {
  const album = readAlbum(url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 500), 1000);

  const list = await env.PHOTOS.list({ prefix: `${album}/`, limit, include: ["httpMetadata"] });
  const items = list.objects.map((o) => ({
    key: o.key,
    url: publicUrl(env, url, o.key),
    contentType: o.httpMetadata?.contentType || "",
    size: o.size,
    uploaded: o.uploaded?.toISOString?.() || "",
  }));

  return json({ album, count: items.length, items });
}

async function handlePhoto(request, env, url) {
  const key = decodeURIComponent(url.pathname.replace(/^\/photo\//, ""));
  if (!key || key.includes("..")) return json({ error: "bad key" }, 400);

  if (request.method === "HEAD") {
    const head = await env.PHOTOS.head(key);
    if (!head) return json({ error: "not found" }, 404);
    const headers = new Headers();
    head.writeHttpMetadata(headers);
    headers.set("etag", head.httpEtag);
    headers.set("content-length", String(head.size));
    headers.set("cache-control", "public, max-age=86400");
    return new Response(null, { headers });
  }

  const obj = await env.PHOTOS.get(key);
  if (!obj) return json({ error: "not found" }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(obj.body, { headers });
}

function publicUrl(env, requestUrl, key) {
  const base = (env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (base) return `${base}/${encodeKey(key)}`;
  // Fall back to the Worker itself
  return `${requestUrl.origin}/photo/${encodeKey(key)}`;
}

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function readAlbum(url) {
  const album = (url.searchParams.get("album") || "").trim();
  if (!album || !ALBUM_RE.test(album)) {
    throw httpError(400, "invalid album");
  }
  return album.toLowerCase();
}

function guessExt(name, type) {
  const m = /\.[a-z0-9]{1,8}$/i.exec(name || "");
  if (m) return m[0].toLowerCase();
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/heic") return ".heic";
  if (type === "image/webp") return ".webp";
  if (type === "video/mp4") return ".mp4";
  if (type === "video/quicktime") return ".mov";
  return ".bin";
}

function safeName(name) {
  return String(name || "upload").replace(/[\r\n"\\]/g, "_").slice(0, 200);
}

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
  const origin = request.headers.get("origin") || "";
  const allow = allowed.includes("*")
    ? "*"
    : (allowed.includes(origin) ? origin : allowed[0] || "");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

function withCors(resp, cors) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, headers: h });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
