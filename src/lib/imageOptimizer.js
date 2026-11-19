// Client-side image resizer, square/proportional cropper, and WebP/JPEG compressor
// optimized for fast loading over mobile data in Cuba and compact storage on GitHub Pages.

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo seleccionado no es una imagen válida.'));
      img.onload = () => resolve(img);
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function estimateBase64Bytes(dataUrl) {
  const idx = dataUrl.indexOf(',');
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  return Math.round((b64.length * 3) / 4);
}

/**
 * Optimizes an uploaded or camera-captured image in the browser:
 * - Optional centered 1:1 square crop (clean product cards) or original aspect ratio
 * - Scales down to maxDimension (default 800x800 px)
 * - Encodes to WebP (with automatic JPEG fallback) stepping quality down if needed
 *   so images load fast on Cuban mobile data and fit comfortably in SQLite / localStorage.
 */
export async function optimizeProductImage(
  file,
  { maxDimension = 800, cropSquare = true, maxBytes = 120 * 1024, initialQuality = 0.8 } = {}
) {
  if (!file) throw new Error('Selecciona una imagen.');
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Selecciona un archivo de imagen (JPG, PNG, WebP o foto de cámara).');
  }

  const img = await loadImageFromFile(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;

  if (cropSquare) {
    const side = Math.min(srcW, srcH);
    sx = Math.round((srcW - side) / 2);
    sy = Math.round((srcH - side) / 2);
    sw = side;
    sh = side;
  }

  const scale = Math.min(1, maxDimension / Math.max(sw, sh));
  let targetW = Math.max(1, Math.round(sw * scale));
  let targetH = Math.max(1, Math.round(sh * scale));

  const renderAt = (w, h, mime, quality) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    return canvas.toDataURL(mime, quality);
  };

  // Prefer WebP; fall back to JPEG if browser returns PNG instead of WebP
  let mime = 'image/webp';
  let dataUrl = renderAt(targetW, targetH, mime, initialQuality);
  if (!dataUrl.startsWith('data:image/webp')) {
    mime = 'image/jpeg';
    dataUrl = renderAt(targetW, targetH, mime, initialQuality);
  }

  // Adaptive quality & dimension step-down for slow mobile connections
  const qualities = [0.72, 0.62, 0.52];
  for (const q of qualities) {
    if (estimateBase64Bytes(dataUrl) <= maxBytes) break;
    dataUrl = renderAt(targetW, targetH, mime, q);
  }

  if (estimateBase64Bytes(dataUrl) > maxBytes && Math.max(targetW, targetH) > 560) {
    const shrink = 560 / Math.max(targetW, targetH);
    targetW = Math.max(1, Math.round(targetW * shrink));
    targetH = Math.max(1, Math.round(targetH * shrink));
    dataUrl = renderAt(targetW, targetH, mime, 0.68);
  }

  const bytes = estimateBase64Bytes(dataUrl);
  return {
    dataUrl,
    width: targetW,
    height: targetH,
    format: mime === 'image/webp' ? 'WebP' : 'JPEG',
    sizeKb: Math.max(1, Math.round(bytes / 1024)),
    originalKb: Math.max(1, Math.round((file.size || bytes) / 1024)),
  };
}
