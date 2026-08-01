(function registerBranchboardRuntimeUtils() {
  if (globalThis.__branchboardRuntimeUtils) return;

  function uniqueByKey(items, keyOf) {
    const seen = new Set();
    const unique = [];
    for (const item of items) {
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (value) =>
      value.toString(16).padStart(2, "0")
    ).join("");
  }

  async function sha256Hex(data, subtleCrypto = globalThis.crypto?.subtle) {
    if (!subtleCrypto) {
      throw new Error("当前浏览器不支持图片内容指纹");
    }
    const digest = await subtleCrypto.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(digest));
  }

  function pixelNumber(value, fallback) {
    const match = String(value || "").match(/^(-?\d+(?:\.\d+)?)px$/);
    return match ? Number(match[1]) : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeFloatingGeometry(
    geometry,
    viewport,
    options = {}
  ) {
    const margin = Math.max(0, Number(options.margin ?? 8));
    const viewportWidth = Math.max(1, Number(viewport?.width || 0));
    const viewportHeight = Math.max(1, Number(viewport?.height || 0));
    const maxWidth = Math.max(1, viewportWidth - margin * 2);
    const maxHeight = Math.max(1, viewportHeight - margin * 2);
    const minWidth = Math.min(
      Math.max(1, Number(options.minWidth ?? 520)),
      maxWidth
    );
    const minHeight = Math.min(
      Math.max(1, Number(options.minHeight ?? 420)),
      maxHeight
    );
    const width = clamp(
      pixelNumber(
        geometry?.width,
        Math.min(Number(options.defaultWidth ?? 860), maxWidth)
      ),
      minWidth,
      maxWidth
    );
    const height = clamp(
      pixelNumber(
        geometry?.height,
        Math.min(Number(options.defaultHeight ?? 690), maxHeight)
      ),
      minHeight,
      maxHeight
    );
    const fallbackLeft = viewportWidth - width - 18;
    const fallbackTop = viewportHeight - height - 18;
    const right = pixelNumber(geometry?.right, Number.NaN);
    const bottom = pixelNumber(geometry?.bottom, Number.NaN);
    const left = clamp(
      pixelNumber(
        geometry?.left,
        Number.isFinite(right)
          ? viewportWidth - width - right
          : fallbackLeft
      ),
      margin,
      Math.max(margin, viewportWidth - width - margin)
    );
    const top = clamp(
      pixelNumber(
        geometry?.top,
        Number.isFinite(bottom)
          ? viewportHeight - height - bottom
          : fallbackTop
      ),
      margin,
      Math.max(margin, viewportHeight - height - margin)
    );
    return { left, top, width, height };
  }

  globalThis.__branchboardRuntimeUtils = Object.freeze({
    uniqueByKey,
    bytesToHex,
    sha256Hex,
    normalizeFloatingGeometry
  });
})();
