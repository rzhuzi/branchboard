import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webstore = process.argv.includes("--webstore");
const buildDirectory = resolve(projectRoot, webstore ? "dist-webstore" : "dist");
const packageJson = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8")
);
const manifest = JSON.parse(
  await readFile(resolve(buildDirectory, "manifest.json"), "utf8")
);

const lockfile = JSON.parse(await readFile(resolve(projectRoot, "package-lock.json"), "utf8"));
if (lockfile.version !== packageJson.version || lockfile.packages?.[""]?.version !== packageJson.version) {
  throw new Error("package-lock.json version does not match package.json");
}
const expectedVersion = webstore
  ? JSON.parse(await readFile(resolve(projectRoot, "webstore.config.json"), "utf8")).version
  : packageJson.version;
if (manifest.version !== expectedVersion) {
  throw new Error(
    `Version mismatch: expected ${expectedVersion}, manifest ${manifest.version}`
  );
}
if (manifest.manifest_version !== 3) {
  throw new Error("Only Manifest V3 release packages are supported");
}
if (manifest.content_scripts?.length !== 1) {
  throw new Error("Expected exactly one content script entry");
}
if (manifest.content_scripts[0].js?.join(",") !== "content.js") {
  throw new Error("Content script must be bundled into content.js");
}
if (manifest.background?.service_worker !== "background.js") {
  throw new Error("Background service worker must be background.js");
}

const requiredFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "offscreen.html",
  "offscreen.js",
  "canvas.html",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

for (const relativePath of requiredFiles) {
  const filePath = resolve(buildDirectory, relativePath);
  await access(filePath);
  if ((await stat(filePath)).size === 0) {
    throw new Error(`Release file is empty: ${relativePath}`);
  }
}

const canvasHtml = await readFile(resolve(buildDirectory, "canvas.html"), "utf8");
if (!/assets\/[^"']+\.js/.test(canvasHtml)) {
  throw new Error("canvas.html is missing its bundled script");
}

const canvasAssets = manifest.web_accessible_resources?.[0]?.resources ?? [];
if (!canvasAssets.includes("canvas.html") || !canvasAssets.includes("assets/*")) {
  throw new Error("Canvas page and bundled assets must be web accessible");
}

console.log(
  `Branchboard ${webstore ? "Web Store" : "GitHub"} ${manifest.version} release validated (${requiredFiles.length} required files)`
);
