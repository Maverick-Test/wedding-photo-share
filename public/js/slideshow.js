(() => {
  const cfg = window.PHOTO_SHARE_CONFIG;
  const params = new URLSearchParams(location.search);
  const album = (params.get("album") || cfg.defaultAlbum).trim();
  const intervalMs = Number(params.get("interval") || 5000);

  document.getElementById("ssAlbum").textContent = `📸 ${album}`;
  const slideA = document.getElementById("slideA");
  const slideB = document.getElementById("slideB");
  const placeholder = document.getElementById("placeholder");
  const countEl = document.getElementById("ssCount");

  let items = [];
  let idx = 0;
  let activeIsA = true;

  // Keyboard: F = fullscreen, Esc handled by browser
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "f") {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    }
  });
  // Click to enter fullscreen (helps on Apple TV via AirPlay too)
  document.body.addEventListener("click", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  });

  async function refresh() {
    try {
      const url = `${cfg.workerUrl.replace(/\/$/, "")}/list?album=${encodeURIComponent(album)}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      const next = (data.items || []).sort((a, b) =>
        (a.uploaded || "").localeCompare(b.uploaded || "")
      );
      items = next;
      countEl.textContent = String(items.length);
      placeholder.classList.toggle("hidden", items.length > 0);
    } catch (_) { /* keep showing what we have */ }
  }

  function showCurrent() {
    if (items.length === 0) return;
    const item = items[idx % items.length];
    const next = activeIsA ? slideB : slideA;
    const current = activeIsA ? slideA : slideB;
    paintSlide(next, item);
    next.classList.add("visible");
    current.classList.remove("visible");
    activeIsA = !activeIsA;
  }

  function paintSlide(slide, item) {
    slide.innerHTML = "";
    const isVideo = (item.contentType || "").startsWith("video/");
    if (isVideo) {
      const v = document.createElement("video");
      v.src = item.url;
      v.muted = true;
      v.autoplay = true;
      v.playsInline = true;
      v.loop = false;
      slide.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = "";
      slide.appendChild(img);
    }
  }

  function tick() {
    if (items.length === 0) return;
    showCurrent();
    idx = (idx + 1) % items.length;
  }

  refresh().then(() => {
    if (items.length > 0) showCurrent();
    idx = 1;
  });
  setInterval(refresh, cfg.galleryRefreshMs);
  setInterval(tick, intervalMs);
})();
