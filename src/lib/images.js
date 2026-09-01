/**
 * Crops and shrinks images in the browser before they're uploaded.
 *
 * Done here rather than on the server for two reasons. Server-side resizing
 * means a native image library on the VPS, which is the sort of dependency that
 * breaks on a Node upgrade. And doing it before the upload means someone on a
 * hotel wifi sends 250 kB instead of 6 MB.
 *
 * The output is what recipients download on the landing page, so it matters:
 * an uncompressed camera JPEG as a background is several seconds of blank page
 * on a phone.
 */

// Backgrounds are full-bleed behind a page; card images are square.
export const PRESETS = {
  background: { aspect: 16 / 9, width: 1920, label: 'Bakgrunnsbilde' },
  thumb: { aspect: 1, width: 800, label: 'Bilde i kortet' },
};

const QUALITY = 0.82;

/** WebP where it's supported, JPEG where it isn't. */
const bestType = () => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  return canvas.toDataURL('image/webp').startsWith('data:image/webp')
    ? 'image/webp'
    : 'image/jpeg';
};

/**
 * The object URL is deliberately *not* revoked once the image has decoded.
 *
 * The crop preview renders the same element's src, so revoking on load leaves
 * an empty frame — the image is in memory and drawable, but the browser has
 * nothing to display. The caller revokes it with releaseImage when the crop is
 * finished or abandoned.
 */
export const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Kunne ikke lese bildet.'));
    };

    image.src = url;
  });

/** Frees the memory the browser is holding for a chosen file. */
export const releaseImage = (image) => {
  if (image?.src?.startsWith('blob:')) URL.revokeObjectURL(image.src);
};

/**
 * The scale at which the image just covers the frame. Everything else is
 * expressed as a multiple of this, so zoom 1 always means "no empty corners".
 */
export const coverScale = (image, frameW, frameH) =>
  Math.max(frameW / image.naturalWidth, frameH / image.naturalHeight);

/**
 * Keeps the image covering the frame no matter how it's dragged — without
 * this you can pull it away from an edge and leave a transparent gap.
 */
export const clampOffset = (offset, image, frameW, frameH, zoom) => {
  const scale = coverScale(image, frameW, frameH) * zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;

  const minX = Math.min(0, frameW - width);
  const minY = Math.min(0, frameH - height);

  return {
    x: Math.min(0, Math.max(minX, offset.x)),
    y: Math.min(0, Math.max(minY, offset.y)),
  };
};

/**
 * Renders the visible part of the frame to a file.
 *
 * The preview frame and the output are the same crop at different sizes, so
 * whatever the person lined up is exactly what gets uploaded.
 */
export const cropToFile = async (image, { frameW, frameH, zoom, offset, preset }) => {
  const { aspect, width } = PRESETS[preset];
  const scale = coverScale(image, frameW, frameH) * zoom;

  // The source rectangle, in the original image's own pixels.
  const sx = -offset.x / scale;
  const sy = -offset.y / scale;
  const sw = frameW / scale;
  const sh = frameH / scale;

  // Never upscale: a small image stays small rather than being blown up soft.
  const outWidth = Math.min(width, Math.round(sw));
  const outHeight = Math.round(outWidth / aspect);

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;

  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sx, sy, sw, sh, 0, 0, outWidth, outHeight);

  const type = bestType();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
  if (!blob) throw new Error('Kunne ikke behandle bildet.');

  return blob;
};

export const formatKb = (bytes) => `${Math.round(bytes / 1024)} kB`;
