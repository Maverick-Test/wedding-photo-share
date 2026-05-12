(() => {
  const cfg = window.PHOTO_SHARE_CONFIG;
  const params = new URLSearchParams(location.search);
  const album = (params.get("album") || cfg.defaultAlbum).trim();

  document.getElementById("albumLabel").textContent = `Album: ${album}`;

  const picker = document.getElementById("picker");
  const pickerLabel = document.getElementById("pickerLabel");
  const cameraPicker = document.getElementById("cameraPicker");
  const cameraPickerLabel = document.getElementById("cameraPickerLabel");
  const queueEl = document.getElementById("queue");
  const uploadBtn = document.getElementById("uploadBtn");
  const statusEl = document.getElementById("status");
  const summaryEl = document.getElementById("summary");
  const closedBanner = document.getElementById("closedBanner");
  const closedGalleryLink = document.getElementById("closedGalleryLink");

  // Concurrency: how many uploads to run at once
  const MAX_CONCURRENT = 3;

  // Running totals
  const stats = { ok: 0, fail: 0, bytes: 0, pending: 0 };
  // FIFO of {file, row} waiting for a slot
  const queue = [];
  let active = 0;

  // Check upload window
  fetch(`${cfg.workerUrl.replace(/\/$/, "")}/status`, { cache: "no-store" })
    .then(r => r.ok ? r.json() : null)
    .then(s => {
      if (s && s.uploadsOpen === false) {
        closedBanner.classList.remove("hidden");
        pickerLabel.style.display = "none";
        if (cameraPickerLabel) cameraPickerLabel.style.display = "none";
        uploadBtn.style.display = "none";
        closedGalleryLink.href = `gallery.html?album=${encodeURIComponent(album)}`;
      }
    })
    .catch(() => {});

  function handlePicked(input) {
    const files = Array.from(input.files || []);
    handleFiles(files);
    input.value = "";
  }

  picker.addEventListener("change", () => handlePicked(picker));
  if (cameraPicker) cameraPicker.addEventListener("change", () => handlePicked(cameraPicker));

  // Paste support: Cmd/Ctrl+V an image from the clipboard
  document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          // Clipboard images often have no name — give them one
          if (!f.name || f.name === "image.png") {
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            const ext = (f.type.split("/")[1] || "png").split("+")[0];
            files.push(new File([f], `pasted-${ts}.${ext}`, { type: f.type }));
          } else {
            files.push(f);
          }
        }
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    handleFiles(files);
  });

  // Drag-and-drop support
  ["dragenter", "dragover"].forEach(ev => {
    document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add("drag-over"); });
  });
  ["dragleave", "drop"].forEach(ev => {
    document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.remove("drag-over"); });
  });
  document.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) handleFiles(files);
  });

  function handleFiles(files) {
    for (const f of files) {
      if (f.size > cfg.maxFileSize) {
        const row = addRow(f, "err", `Too big (${humanSize(f.size)})`);
        stats.fail++;
        renderSummary();
        continue;
      }
      const row = addRow(f, "pending", "Queued");
      queue.push({ file: f, row });
      stats.pending++;
    }
    renderSummary();
    pump();
  }

  function pump() {
    while (active < MAX_CONCURRENT && queue.length > 0) {
      const { file, row } = queue.shift();
      active++;
      stats.pending--;
      setRowState(row, "pending", "Uploading…");
      uploadOne(file, album)
        .then(() => {
          setRowState(row, "ok", "Done");
          stats.ok++;
          stats.bytes += file.size;
        })
        .catch((err) => {
          console.error(err);
          setRowState(row, "err", err.message || "Failed");
          stats.fail++;
        })
        .finally(() => {
          active--;
          renderSummary();
          pump();
        });
    }
    renderSummary();
  }

  function renderSummary() {
    const inFlight = active + stats.pending;
    const totalDone = stats.ok + stats.fail;
    if (totalDone === 0 && inFlight === 0) {
      summaryEl.classList.add("hidden");
      statusEl.textContent = "";
      statusEl.className = "status";
      return;
    }
    summaryEl.classList.remove("hidden");
    const parts = [];
    parts.push(`<strong>${stats.ok}</strong> uploaded`);
    if (stats.fail) parts.push(`<strong class="err">${stats.fail}</strong> failed`);
    if (inFlight) parts.push(`${inFlight} in progress`);
    parts.push(`${humanSize(stats.bytes)} total`);
    summaryEl.innerHTML = parts.join(" &middot; ");

    if (inFlight > 0) {
      statusEl.className = "status";
      statusEl.textContent = `Uploading… ${inFlight} remaining`;
    } else if (stats.fail === 0) {
      statusEl.className = "status ok";
      statusEl.textContent = `🎉 All ${stats.ok} uploaded! Add more anytime.`;
    } else {
      statusEl.className = "status err";
      statusEl.textContent = `Done. ${stats.ok} uploaded, ${stats.fail} failed — try those again.`;
    }
  }

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
    return li;
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
