/**
 * Downscales a picked image to a JPEG data URL small enough to upload quickly
 * and stay within the server body limit, while staying detailed enough for the
 * vision model. Keeps the longest edge <= maxDim and shrinks quality until the
 * data URL is under ~targetChars.
 */
export async function fileToDataUrl(
  file: File,
  maxDim = 1024,
  targetChars = 800_000
): Promise<string> {
  const bitmap = await loadImage(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ('close' in bitmap) (bitmap as ImageBitmap).close?.();

  let quality = 0.72;
  let url = canvas.toDataURL('image/jpeg', quality);
  while (url.length > targetChars && quality > 0.4) {
    quality -= 0.12;
    url = canvas.toDataURL('image/jpeg', quality);
  }
  return url;
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}
