// Preparing a chosen image in the browser before it is sent (profile pictures).

/** The picture as kept: at most this many pixels a side, and this many bytes (the API's limit). */
const SIDE = 256
const MAX_BYTES = 256 * 1024
/** The largest file accepted before resizing. */
const MAX_FILE = 10 * 1024 * 1024

/** A chosen image, cropped to a centred square and resized to 256 px, as a WebP (or JPEG) data URL. */
export async function resizeImage(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif|bmp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP image')
  if (file.size > MAX_FILE) throw new Error('Choose an image under 10 MB')
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image couldn't be read")
  })
  const side = Math.min(bitmap.width, bitmap.height)
  const out = Math.min(SIDE, side)
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("That image couldn't be read")
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out)
  bitmap.close()
  for (const [type, quality] of [['image/webp', 0.85], ['image/jpeg', 0.85], ['image/jpeg', 0.6]] as const) {
    const url = canvas.toDataURL(type, quality)
    // A browser without WebP encoding hands back a PNG instead: try the next.
    if (!url.startsWith(`data:${type}`)) continue
    if (Math.ceil(((url.length - url.indexOf(',') - 1) * 3) / 4) <= MAX_BYTES) return url
  }
  throw new Error('The image is too large even after resizing')
}
