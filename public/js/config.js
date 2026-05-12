// Edit this after you deploy your Cloudflare Worker.
// Example: "https://photo-share.your-subdomain.workers.dev"
window.PHOTO_SHARE_CONFIG = {
  workerUrl: "https://REPLACE-ME.workers.dev",
  defaultAlbum: "default",
  // Polling interval (ms) for the live gallery
  galleryRefreshMs: 8000,
  // Max upload size enforced client-side (bytes). Default 50 MB.
  maxFileSize: 50 * 1024 * 1024,
};
