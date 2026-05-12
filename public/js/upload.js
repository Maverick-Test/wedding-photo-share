(() => {
  const cfg = window.PHOTO_SHARE_CONFIG;
  const params = new URLSearchParams(location.search);
  const album = (params.get("album") || cfg.defaultAlbum).trim();

  document.getElementById("albumLabel").textContent = `Album: ${album}`;

  const picker = document.getElementById("picker");
  const pickerLabel = document.getElementById("pickerLabel");
  const queueEl = document.getElementById("queue");
  const uploadBtn = document.getElementById("uploadBtn");
  const statusEl = document.getElementById("status");
  const closedBanner = document.getElementById("closedBanner");
  const closedGalleryLink = document.getElementById("closedGalleryLink");

  let queue = [];

  // Check upload window
  fetch(`${cfg.workerUrl.replace(/\/$/, "")}/status`, { cache: "no-store" })
    .then(r => r.ok ? r.json() : null)
    .then(s => {
      if (s && s.uploadsOpen === false) {
        closedBanner.classList.remove("hidden");
        pickerLabel.style.display = "none";
        uploadBtn.style.display = "none";
        closedGalleryLink.href = `gallery.html?album=${encodeURIComponent(album)}`;
      }
    })
    .catch(() => {});

  picker.addEventListener("change", () => {
    const files = Array.from(picker.files || []);
    for (const f of files) {
      if (f.size > cfg.maxFileSize) {
        addRow(f, "err", `Too big (${humanSize(f.size)})`);
        continue;
      }
      queue.push(f);
      addRow(f, "pending", "Ready");
    }
    uploadBtn.disabled = queue.length === 0;
  });

  uploadBtn.addEventListener("click", async () => {
    if (queue.length === 0) return;
    uploadBtn.disabled = true;
    statusEl.className = "status";
    statusEl.textContent = `Uploading ${queue.length} item(s)…`;

    let ok = 0, fail = 0;
    for (let i = 0; i < queue.length; i++) {
      const file = queue[i];
      const row = queueEl.children[i];
      try {
        setRowState(row, "pending", "Uploading…");
        await uploadOne(file, album);
        setRowState(row, "ok", "Done");
        ok++;
      } catch (err) {
        console.error(err);
        setRowState(row, "err", err.message || "Failed");
        fail++;
      }
    }

    statusEl.className = "status " + (fail === 0 ? "ok" : "err");
    statusEl.textContent = fail === 0
      ? `🎉 Uploaded ${ok} item(s). Add more anytime!`
      : `Uploaded ${ok}, failed ${fail}. You can retry.`;

    queue = [];
    uploadBtn.disabled = true;
    picker.value = "";
  });

  async function uploadOne(file, album) {
    const url = `${cfg.workerUrl.replace(/\/$/, "")}/upload?album=${encodeURIComponent(album)}`;
    const fd = new FormData();
    fd.append("file", file, file.name);
    const resp = await fetch(url, { method: "POST", body: fd });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${t.slice(0, 80)}`);
    }
    return await resp.json().catch(() => ({}));
  }

  function addRow(file, state, label) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
      <span class="size muted small">${humanSize(file.size)}</span>
      <span class="state ${state}">${escapeHtml(label)}</span>
    `;
    queueEl.appendChild(li);
  }

  function setRowState(row, state, label) {
    const s = row.querySelector(".state");
    s.className = "state " + state;
    s.textContent = label;
  }

  function humanSize(n) {
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
})();
