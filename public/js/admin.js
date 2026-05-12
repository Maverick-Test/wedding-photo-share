(() => {
  const cfg = window.PHOTO_SHARE_CONFIG;
  const input = document.getElementById("albumInput");
  const btn = document.getElementById("genBtn");
  const out = document.getElementById("output");
  const uploadLinkEl = document.getElementById("uploadLink");
  const galleryLinkEl = document.getElementById("galleryLink");
  const qrEl = document.getElementById("qr");
  const dlBtn = document.getElementById("downloadQr");

  input.value = cfg.defaultAlbum;

  btn.addEventListener("click", () => {
    const raw = input.value.trim() || cfg.defaultAlbum;
    const album = raw.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
    if (!album) return;

    const base = location.origin + location.pathname.replace(/admin\.html$/, "");
    const uploadUrl = `${base}upload.html?album=${encodeURIComponent(album)}`;
    const galleryUrl = `${base}gallery.html?album=${encodeURIComponent(album)}`;

    uploadLinkEl.textContent = uploadUrl;
    galleryLinkEl.textContent = galleryUrl;

    qrEl.innerHTML = "";
    new QRCode(qrEl, {
      text: uploadUrl,
      width: 320,
      height: 320,
      correctLevel: QRCode.CorrectLevel.M,
    });

    // qrcodejs renders both a <canvas> (preferred) and an <img> fallback.
    // Wait a tick so the canvas is in the DOM, then wire up the download link.
    setTimeout(() => {
      const canvas = qrEl.querySelector("canvas");
      const img = qrEl.querySelector("img");
      const dataUrl = canvas ? canvas.toDataURL("image/png") : (img ? img.src : "");
      dlBtn.href = dataUrl;
      dlBtn.download = `album-${album}-qr.png`;
    }, 0);

    out.classList.remove("hidden");
  });
})();
