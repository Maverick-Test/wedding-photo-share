// Cloudflare Worker: photo-share
// Endpoints:
//   POST /upload?album=<id>     multipart/form-data, field "file"
//   GET  /list?album=<id>       returns { items: [{ key, url, contentType, size, uploaded }] }
//   GET  /photo/<key...>        streams an object from R2 (used when PUBLIC_BASE_URL is empty)
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
      if (url.pathname.startsWith("/photo/") && request.method === "GET") {
        return withCors(await handlePhoto(request, env, url), cors);
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
};

async function handleUpload(request, env, url) {
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

  const list = await env.PHOTOS.list({ prefix: `${album}/`, limit });
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
