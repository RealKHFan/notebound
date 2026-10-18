// Small preview copies of pictures, stored inside the note file.
//
// A note refers to its pictures as ../attachments/photo.jpg. That works when
// the file is opened from a computer, but on Android the Files app hands a
// browser only the note file itself, so the browser cannot reach the picture
// next to it. Each picture therefore also carries a small JPEG copy
// (data-preview) that the note file shows when the full picture cannot load.

export const PREVIEW_MAX = 640; // longest side in pixels
const QUALITY = 0.72;

export function vaultUrl(path) {
  return '/vault/' + String(path).split('/').map(encodeURIComponent).join('/');
}

/** Size of a picture in the folder plus a preview data: URL (null when it cannot be decoded). */
export function imageInfo(path, { preview = true } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || null;
      const height = img.naturalHeight || null;
      let data = null;
      if (preview && width && height) {
        try {
          const k = Math.min(1, PREVIEW_MAX / Math.max(width, height));
          const w = Math.max(1, Math.round(width * k));
          const h = Math.max(1, Math.round(height * k));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          data = c.toDataURL('image/jpeg', QUALITY);
          if (!/^data:image\/jpeg;base64,/.test(data)) data = null;
        } catch {
          data = null;
        }
      }
      resolve({ width, height, preview: data });
    };
    img.onerror = () => resolve({ width: null, height: null, preview: null });
    img.src = vaultUrl(path);
  });
}

/** Add previews to every <img src="../attachments/..."> in an HTML string that has none yet. */
export async function addPreviewsToHtml(html) {
  if (!/<img\b/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  let changed = false;
  for (const img of doc.querySelectorAll('img[src]')) {
    if (img.hasAttribute('data-preview')) continue;
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('../attachments/')) continue;
    let path = src.slice(3);
    try { path = decodeURIComponent(path); } catch { /* keep */ }
    const info = await imageInfo(path);
    if (info.preview) {
      img.setAttribute('data-preview', info.preview);
      if (info.width && !img.getAttribute('width')) img.setAttribute('width', String(info.width));
      if (info.height && !img.getAttribute('height')) img.setAttribute('height', String(info.height));
      changed = true;
    }
  }
  return changed ? doc.body.innerHTML : html;
}
