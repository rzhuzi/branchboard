export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: BufferSource | Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("当前浏览器不支持图片内容指纹");
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await subtle.digest("SHA-256", buffer);
  return bytesToHex(new Uint8Array(digest));
}

export function uniqueByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) {
    throw new Error("无效的图片数据");
  }
  const header = dataUrl.slice(5, comma);
  const mime = header.split(";")[0] || "image/png";
  const payload = dataUrl.slice(comma + 1);
  if (header.includes(";base64")) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function imageSizeFromBlob(
  blob: Blob
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob)
      .then((bitmap) => {
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
      })
      .catch(() => imageSizeWithElement(blob));
  }
  return imageSizeWithElement(blob);
}

function imageSizeWithElement(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片尺寸"));
    };
    image.src = url;
  });
}

export function extensionForMime(mime: string): string {
  const subtype = (mime.split("/")[1] || "png").toLowerCase();
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype.replace(/[^a-z0-9]/g, "") || "png";
}
