// 浏览器端缩略图生成：上传前用 canvas 把原图压成 420px 的小 WebP，
// 这样客人端的画廊秒开，也不用任何付费的图片处理服务。
export async function makeThumb(file: File, maxEdge = 420): Promise<Blob> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image", // 按 EXIF 方向摆正
  }).catch(() => null);
  if (!bitmap) throw new Error("无法读取图片");

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 不可用");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("缩略图生成失败"))),
      "image/webp",
      0.8
    );
  });
}
