(() => {
  const cfg = window.PHOTO_SHARE_CONFIG;
  const params = new URLSearchParams(location.search);
  const album = (params.get("album") || cfg.defaultAlbum).trim();

  document.getElementById("albumTitle").textContent = `📸 ${album}`;
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const countEl = document.getElementById("count");

  const seen = new Set();

  async function refresh() {
    try {
      const url = `${cfg.workerUrl.replace(/\/$/, "")}/list?album=${encodeURIComponent(album)}`;
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const items = (data.items || []).sort((a, b) =>
        (a.uploaded || "").localeCompare(b.uploaded || "")
      );

      let added = 0;
      for (const item of items) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        grid.prepend(makeTile(item));
        added++;
      }

      countEl.textContent = `${seen.size} item${seen.size === 1 ? "" : "s"}`;
      empty.classList.toggle("hidden", seen.size > 0);
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

  refresh();
  setInterval(refresh, cfg.galleryRefreshMs);
})();
