import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8")
);
const manifest = JSON.parse(
  await readFile(resolve(projectRoot, "dist", "manifest.json"), "utf8")
);

if (manifest.version !== packageJson.version) {
  throw new Error(
    `Version mismatch: package ${packageJson.version}, manifest ${manifest.version}`
  );
}
if (manifest.manifest_version !== 3) {
  throw new Error("Only Manifest V3 release packages are supported");
}

const requiredFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "runtime-utils.js",
  "offscreen.html",
  "offscreen.js",
  "canvas.html",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

for (const relativePath of requiredFiles) {
  const filePath = resolve(projectRoot, "dist", relativePath);
  await access(filePath);
  if ((await stat(filePath)).size === 0) {
    throw new Error(`Release file is empty: ${relativePath}`);
  }
}

console.log(
  `Branchboard ${manifest.version} release validated (${requiredFiles.length} required files)`
);
