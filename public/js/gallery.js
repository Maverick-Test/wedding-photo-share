import { downloadZip } from "https://cdn.jsdelivr.net/npm/client-zip@2.4.5/index.js";

(() => {
  const cfg = window.PHOTO_SHARE_CONFIG;
  const params = new URLSearchParams(location.search);
  const album = (params.get("album") || cfg.defaultAlbum).trim();

  document.getElementById("albumTitle").textContent = `📸 ${album}`;
  document.getElementById("slideshowLink").href = `slideshow.html?album=${encodeURIComponent(album)}`;

  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const countEl = document.getElementById("count");
  const dlBtn = document.getElementById("downloadAllBtn");
  const dlStatus = document.getElementById("downloadStatus");

  const seen = new Set();
  let allItems = [];

  async function refresh() {
    try {
      const url = `${cfg.workerUrl.replace(/\/$/, "")}/list?album=${encodeURIComponent(album)}`;
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const items = (data.items || []).sort((a, b) =>
        (a.uploaded || "").localeCompare(b.uploaded || "")
      );
      allItems = items;

      for (const item of items) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        grid.prepend(makeTile(item));
      }

      countEl.textContent = `${seen.size} item${seen.size === 1 ? "" : "s"}`;
      empty.classList.toggle("hidden", seen.size > 0);
      dlBtn.disabled = seen.size === 0;
    } catch (err) {
      console.warn("Gallery refresh failed:", err);
    }
  }

  function makeTile(item) {
    const tile = document.createElement("div");
    tile.className = "tile";
    const isVideo = (item.contentType || "").startsWith("video/");
    if (isVideo) {
      const v = document.createElement("video");
      v.src = item.url;
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.playsInline = true;
      tile.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = item.url;
      img.alt = "";
      tile.appendChild(img);
    }
    return tile;
  }

  dlBtn.addEventListener("click", async () => {
    if (allItems.length === 0) return;
    dlBtn.disabled = true;
    dlStatus.classList.remove("hidden");
    dlStatus.textContent = `Preparing ${allItems.length} files… (this may take a minute)`;

    try {
      // Stream each file lazily into the zip generator
      const files = allItems.map((item, i) => ({
        name: filenameFor(item, i),
        lastModified: item.uploaded ? new Date(item.uploaded) : new Date(),
        async *input() {
          const r = await fetch(item.url);
          if (!r.ok) throw new Error(`Failed: ${item.key}`);
          const reader = r.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield value;
          }
        },
      }));

      const blob = await downloadZip(files).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${album}-photos.zip`;
      a.click();
      URL.revokeObjectURL(url);
      dlStatus.textContent = `✅ Downloaded ${allItems.length} files as ${album}-photos.zip`;
    } catch (err) {
      console.error(err);
      dlStatus.textContent = `❌ Download failed: ${err.message}`;
    } finally {
      dlBtn.disabled = false;
    }
  });

  function filenameFor(item, i) {
    // item.key looks like "album/2026-05-15/uuid.jpg"
    const base = item.key.split("/").pop();
    const date = item.key.split("/")[1] || "";
    const num = String(i + 1).padStart(4, "0");
    return `${num}_${date}_${base}`;
  }

  refresh();
  setInterval(refresh, cfg.galleryRefreshMs);
})();
