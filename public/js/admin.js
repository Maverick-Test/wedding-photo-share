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
    const canvas = document.createElement("canvas");
    qrEl.appendChild(canvas);
    QRCode.toCanvas(canvas, uploadUrl, { width: 320, margin: 2 }, (err) => {
      if (err) console.error(err);
      dlBtn.href = canvas.toDataURL("image/png");
      dlBtn.download = `album-${album}-qr.png`;
    });

    out.classList.remove("hidden");
  });
})();
